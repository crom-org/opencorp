import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComponentStore } from "../src/core/component-store.js";
import { registrarBuiltins, BUILTIN_COMPONENTS } from "../src/core/builtin-components.js";
import { FlowStore } from "../src/core/flow-store.js";
import { WorkspaceManager } from "../src/core/workspace-manager.js";

describe("ComponentStore — Marketplace de Componentes", () => {
  let homeDir: string;
  let wsPath: string;
  let store: ComponentStore;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "opencorp-comp-test-"));
    const wm = new WorkspaceManager({ homeDir });
    const ws = await wm.criar("ws-comp");
    wsPath = ws.path;
    store = new ComponentStore({ homeDir });
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  it("cria, obtém, lista e exclui um componente customizado", async () => {
    const comp = await store.criar(wsPath, {
      id: "formatador-texto",
      nome: "Formatador de Texto",
      descricao: "Converte texto para maiúsculas",
      runtime: "node",
      codigo: `
        const entrada = process.env.OPENCORP_ENTRADA || "";
        console.log(JSON.stringify({ output: entrada.toUpperCase() }));
      `,
      tags: ["texto", "util"],
    });

    expect(comp.id).toBe("formatador-texto");
    expect(comp.versao).toBe("1.0.0");

    // Obter
    const obtido = await store.obter(wsPath, "formatador-texto");
    expect(obtido.nome).toBe("Formatador de Texto");

    // Listar
    const lista = await store.listar(wsPath);
    expect(lista.length).toBe(1);
    expect(lista[0]!.id).toBe("formatador-texto");

    // Atualizar
    const atualizado = await store.atualizar(wsPath, "formatador-texto", {
      nome: "Formatador V2",
      descricao: "Nova versão",
    });
    expect(atualizado.nome).toBe("Formatador V2");

    // Excluir
    await store.excluir(wsPath, "formatador-texto");
    const aposExcluir = await store.listar(wsPath);
    expect(aposExcluir.length).toBe(0);
  });

  it("valida schema kebab-case para o id do componente", async () => {
    await expect(
      store.criar(wsPath, {
        id: "Nome Invalido!",
        nome: "Invalido",
        codigo: "console.log(1)",
      }),
    ).rejects.toThrow(/use kebab-case/);
  });

  it("executa teste do componente com I/O JSON", async () => {
    await store.criar(wsPath, {
      id: "somador",
      nome: "Somador",
      runtime: "node",
      codigo: `
        const entrada = JSON.parse(process.env.OPENCORP_ENTRADA || '{"a": 0, "b": 0}');
        const resultado = (Number(entrada.a) || 0) + (Number(entrada.b) || 0);
        console.log(JSON.stringify({ output: resultado, soma: resultado }));
      `,
    });

    const res = await store.testar(wsPath, "somador", JSON.stringify({ a: 15, b: 27 }));
    expect(res.ok).toBe(true);
    expect(res.json).toEqual({ output: 42, soma: 42 });
    expect(res.duracao_ms).toBeGreaterThanOrEqual(0);
  });

  it("publica componente para repositório compartilhado global e instala em outro workspace", async () => {
    await store.criar(wsPath, {
      id: "logger-padrao",
      nome: "Logger Padrão",
      descricao: "Gera logs padronizados",
      runtime: "node",
      codigo: `console.log(JSON.stringify({ output: "log registrado" }));`,
    });

    // Publicar
    const destino = await store.publicar(wsPath, "logger-padrao");
    expect(destino).toContain("shared-components");

    // Listar globais
    const globais = await store.listarGlobais();
    expect(globais.some((c) => c.id === "logger-padrao")).toBe(true);

    // Criar outro workspace e instalar
    const wm = new WorkspaceManager({ homeDir });
    const ws2 = await wm.criar("ws-outro");
    const instalado = await store.instalar(ws2.path, "logger-padrao");
    expect(instalado.id).toBe("logger-padrao");

    const listaWs2 = await store.listar(ws2.path);
    expect(listaWs2.some((c) => c.id === "logger-padrao")).toBe(true);
  });

  it("exporta e importa componente com sobrescrever", async () => {
    await store.criar(wsPath, {
      id: "comp-exp",
      nome: "Componente Exportável",
      codigo: `console.log("ok");`,
    });

    const envelope = await store.exportar(wsPath, "comp-exp");
    expect(envelope.version).toBe(1);
    expect(envelope.component.id).toBe("comp-exp");

    // Importar no mesmo workspace requer sobrescrever=true
    await expect(store.importar(wsPath, envelope)).rejects.toThrow(/já existe/);
    const reimportado = await store.importar(wsPath, envelope, { sobrescrever: true });
    expect(reimportado.id).toBe("comp-exp");
  });

  it("registra componentes builtin (Slack, Discord, GitHub, Sheets, HTTP, Email)", async () => {
    const registrados = await registrarBuiltins(wsPath, store);
    expect(registrados).toBe(BUILTIN_COMPONENTS.length);

    const lista = await store.listar(wsPath);
    const ids = lista.map((c) => c.id);
    expect(ids).toContain("slack-message");
    expect(ids).toContain("discord-message");
    expect(ids).toContain("github-issue");
    expect(ids).toContain("google-sheets-append");
    expect(ids).toContain("http-request");
    expect(ids).toContain("email-send");

    // Registro idempotente não duplica
    const repetido = await registrarBuiltins(wsPath, store);
    expect(repetido).toBe(0);
  });

  it("FlowStore executa nó do tipo 'componente' usando componente_id e inline codigo", async () => {
    const flowStore = new FlowStore({ homeDir });

    // 1. Cria componente no marketplace
    await store.criar(wsPath, {
      id: "duplicador",
      nome: "Duplicador",
      runtime: "node",
      codigo: `
        const entrada = process.env.OPENCORP_ENTRADA || "";
        console.log(JSON.stringify({ output: entrada + "-" + entrada }));
      `,
    });

    // 2. Flow com nó componente referenciando componente_id
    const flow1 = await flowStore.criar(wsPath, "flow-com-comp", "Flow com Componente");
    await flowStore.salvar(wsPath, {
      ...flow1,
      nos: [
        { id: "inicio", tipo: "manual", config: {} },
        { id: "proc", tipo: "componente", config: { componente_id: "duplicador" } },
      ],
      arestas: [{ id: "a1", de: "inicio", para: "proc" }],
    });

    const exec1 = await flowStore.executar(wsPath, "flow-com-comp", { entrada: "alpha" });
    expect(exec1.status).toBe("concluido");
    expect(exec1.contextoFinal).toBe("alpha-alpha");

    // 3. Flow com código inline direto no nó
    const flow2 = await flowStore.criar(wsPath, "flow-inline", "Flow com Código Inline");
    await flowStore.salvar(wsPath, {
      ...flow2,
      nos: [
        { id: "inicio", tipo: "manual", config: {} },
        {
          id: "proc",
          tipo: "componente",
          config: {
            runtime: "node",
            codigo: `console.log(JSON.stringify({ output: "inline-ok" }));`,
          },
        },
      ],
      arestas: [{ id: "a1", de: "inicio", para: "proc" }],
    });

    const exec2 = await flowStore.executar(wsPath, "flow-inline", { entrada: "teste" });
    expect(exec2.status).toBe("concluido");
    expect(exec2.contextoFinal).toBe("inline-ok");
  });
});
