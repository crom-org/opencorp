import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowStore, type Flow } from "../src/core/flow-store.js";
import { FlowError } from "../src/core/errors.js";

let home: string;
let wsPath: string;
let store: FlowStore;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "opencorp-flow-exp-"));
  wsPath = join(home, "workspaces", "test-ws");
  mkdirSync(join(wsPath, ".opencorp", "flows"), { recursive: true });
  mkdirSync(join(wsPath, ".opencorp", "registries"), { recursive: true });
  store = new FlowStore({ homeDir: home });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("FlowStore — exportar e exportarJson", () => {
  it("exporta um flow existente com metadados de versão e timestamp", async () => {
    const flow = await store.salvarComId(wsPath, {
      id: "meu-flow",
      nome: "Meu Flow de Teste",
      nos: [
        { id: "gatilho", tipo: "manual", config: {} },
        { id: "script-1", tipo: "script", config: { comando: "echo ola" } },
      ],
      arestas: [{ de: "gatilho", para: "script-1" }],
    });

    const exp = await store.exportar(wsPath, "meu-flow");
    expect(exp.version).toBe(1);
    expect(typeof exp.exported_at).toBe("string");
    expect(exp.flow.id).toBe("meu-flow");
    expect(exp.flow.nome).toBe("Meu Flow de Teste");
    expect(exp.flow.nos.length).toBe(2);

    const jsonStr = await store.exportarJson(wsPath, "meu-flow");
    const parsed = JSON.parse(jsonStr);
    expect(parsed.flow.id).toBe("meu-flow");
  });

  it("lança erro ao exportar flow inexistente", async () => {
    await expect(store.exportar(wsPath, "inexistente")).rejects.toThrow(FlowError);
  });
});

describe("FlowStore — importar", () => {
  const flowValido: Flow = {
    id: "flow-importado",
    nome: "Flow Importado do JSON",
    nos: [
      { id: "inicio", tipo: "manual", config: {} },
      { id: "fim", tipo: "script", config: { comando: "echo fim" } },
    ],
    arestas: [{ de: "inicio", para: "fim" }],
  };

  it("importa a partir de objeto Flow direto", async () => {
    const importado = await store.importar(wsPath, flowValido);
    expect(importado.id).toBe("flow-importado");
    expect(existsSync(store.caminho(wsPath, "flow-importado"))).toBe(true);

    const lido = await store.obter(wsPath, "flow-importado");
    expect(lido.nome).toBe("Flow Importado do JSON");
    expect(lido.nos.length).toBe(2);
  });

  it("importa a partir de envelope { flow: ... } com metadados", async () => {
    const envelope = {
      version: 1,
      exported_at: new Date().toISOString(),
      flow: {
        ...flowValido,
        id: "flow-envelope",
      },
    };

    const importado = await store.importar(wsPath, envelope);
    expect(importado.id).toBe("flow-envelope");
    expect(existsSync(store.caminho(wsPath, "flow-envelope"))).toBe(true);
  });

  it("importa a partir de string JSON", async () => {
    const jsonStr = JSON.stringify(flowValido);
    const importado = await store.importar(wsPath, jsonStr, { novoId: "flow-de-string" });
    expect(importado.id).toBe("flow-de-string");
    expect(existsSync(store.caminho(wsPath, "flow-de-string"))).toBe(true);
  });

  it("rejeita sobrescrita sem a flag sobrescrever", async () => {
    await store.importar(wsPath, flowValido);
    await expect(store.importar(wsPath, flowValido)).rejects.toThrow("já existe");
  });

  it("permite sobrescrita quando sobrescrever=true", async () => {
    await store.importar(wsPath, flowValido);
    const flowAtualizado = {
      ...flowValido,
      nome: "Nome Atualizado",
    };
    const atualizado = await store.importar(wsPath, flowAtualizado, { sobrescrever: true });
    expect(atualizado.nome).toBe("Nome Atualizado");

    const lido = await store.obter(wsPath, "flow-importado");
    expect(lido.nome).toBe("Nome Atualizado");
  });

  it("permite renomear id durante importação via opts.novoId", async () => {
    const importado = await store.importar(wsPath, flowValido, { novoId: "flow-custom-id" });
    expect(importado.id).toBe("flow-custom-id");
    expect(existsSync(store.caminho(wsPath, "flow-custom-id"))).toBe(true);
  });

  it("rejeita JSON malformado ou estrutura inválida", async () => {
    await expect(store.importar(wsPath, "{json invalido")).rejects.toThrow(FlowError);
    await expect(store.importar(wsPath, { semNos: true })).rejects.toThrow(FlowError);
  });

  it("rejeita flow com aresta apontando para nó inexistente", async () => {
    const flowInvalido = {
      id: "flow-quebrado",
      nome: "Flow Quebrado",
      nos: [{ id: "inicio", tipo: "manual", config: {} }],
      arestas: [{ de: "inicio", para: "fantasma" }],
    };
    await expect(store.importar(wsPath, flowInvalido)).rejects.toThrow("inexistente");
  });
});

describe("FlowStore — Branching de Decisão via arestas rotuladas", () => {
  it("suporta arestas com rotulo e condicao no schema", async () => {
    const flowBranch = await store.salvarComId(wsPath, {
      id: "flow-branch",
      nome: "Flow com Bifurcação",
      nos: [
        { id: "gatilho", tipo: "manual", config: {} },
        {
          id: "decisor",
          tipo: "decisao",
          config: {
            agente: "executor-padrao",
            pergunta: "Aprovar?",
            opcoes: [
              { rotulo: "SIM", proximo: "caminho-sim" },
              { rotulo: "NAO", proximo: "caminho-nao" },
            ],
          },
        },
        { id: "caminho-sim", tipo: "script", config: { comando: "echo sim" } },
        { id: "caminho-nao", tipo: "script", config: { comando: "echo nao" } },
      ],
      arestas: [
        { de: "gatilho", para: "decisor" },
        { de: "decisor", para: "caminho-sim", rotulo: "SIM" },
        { de: "decisor", para: "caminho-nao", rotulo: "NAO" },
      ],
    });

    expect(flowBranch.arestas[1]!.rotulo).toBe("SIM");
    expect(flowBranch.arestas[2]!.rotulo).toBe("NAO");
  });
});

describe("FlowStore — Loop com Journal de Iterações", () => {
  it("persiste snapshot de cada iteração no journal da execução", async () => {
    // Criar flow com loop que faz 3 iterações
    await store.salvarComId(wsPath, {
      id: "flow-loop",
      nome: "Flow com Loop",
      nos: [
        { id: "gatilho", tipo: "manual", config: {} },
        { id: "loop-1", tipo: "loop", config: { max_iteracoes: 3, retornar_para: "gatilho", saida_final: "fim" } },
        { id: "fim", tipo: "saida", config: { registro: "saidas/loop-resultado" } },
      ],
      arestas: [
        { de: "gatilho", para: "loop-1" },
      ],
    });

    const resultado = await store.executar(wsPath, "flow-loop", { entrada: "teste-loop" });
    expect(resultado.status).toBe("concluido");

    // Ler o journal da execução e verificar eventos de loop-iteracao
    const journal = await store["registros"].lerJournal(wsPath, "execucoes", resultado.execId);
    const iteracoes = journal.filter((e: any) => e.evento === "loop-iteracao");
    expect(iteracoes.length).toBeGreaterThanOrEqual(1);
    // Primeira iteração deve ter volta=1
    const primeiro = iteracoes[0] as any;
    expect(primeiro.no).toBe("loop-1");
    expect(primeiro.volta).toBe(1);
    expect(typeof primeiro.contexto_preview).toBe("string");
    expect(typeof primeiro.resumo).toBe("string");
  });
});

describe("FlowStore — Componente JSON I/O", () => {
  it("parseia stdout JSON de script e preserva a saída estruturada", async () => {
    // Criar flow com script que emite JSON
    await store.salvarComId(wsPath, {
      id: "flow-json-io",
      nome: "Flow com JSON I/O",
      nos: [
        { id: "gatilho", tipo: "manual", config: {} },
        {
          id: "script-json",
          tipo: "script",
          config: { comando: 'echo \'{"output":"resultado-ok","dados":{"chave":"valor"}}\'' },
        },
        { id: "fim", tipo: "saida", config: { registro: "saidas/json-resultado" } },
      ],
      arestas: [
        { de: "gatilho", para: "script-json" },
        { de: "script-json", para: "fim" },
      ],
    });

    const resultado = await store.executar(wsPath, "flow-json-io", { entrada: "inicio" });
    expect(resultado.status).toBe("concluido");
    // O contexto final deve conter o campo "output" extraído do JSON
    expect(resultado.contextoFinal).toContain("resultado-ok");
  });

  it("trata stdout não-JSON como texto puro (fallback)", async () => {
    await store.salvarComId(wsPath, {
      id: "flow-texto-puro",
      nome: "Flow Texto Puro",
      nos: [
        { id: "gatilho", tipo: "manual", config: {} },
        { id: "script-texto", tipo: "script", config: { comando: "echo texto simples" } },
        { id: "fim", tipo: "saida", config: { registro: "saidas/texto-resultado" } },
      ],
      arestas: [
        { de: "gatilho", para: "script-texto" },
        { de: "script-texto", para: "fim" },
      ],
    });

    const resultado = await store.executar(wsPath, "flow-texto-puro", { entrada: "inicio" });
    expect(resultado.status).toBe("concluido");
    expect(resultado.contextoFinal).toContain("texto simples");
  });
});

describe("FlowStore — listarWebhooks", () => {
  it("lista nós webhook com URLs determinísticas", async () => {
    await store.salvarComId(wsPath, {
      id: "flow-com-webhook",
      nome: "Flow com Webhook",
      nos: [
        { id: "wh-entrada", tipo: "webhook", config: { url: "https://example.com/callback" } },
        { id: "processador", tipo: "script", config: { comando: "echo ok" } },
      ],
      arestas: [{ de: "wh-entrada", para: "processador" }],
    });

    const webhooks = await store.listarWebhooks(wsPath, "http://localhost:3578");
    expect(webhooks.length).toBe(1);
    expect(webhooks[0]!.flow_id).toBe("flow-com-webhook");
    expect(webhooks[0]!.no_id).toBe("wh-entrada");
    expect(webhooks[0]!.url).toBe("http://localhost:3578/flows/flow-com-webhook/webhook");
    expect(webhooks[0]!.metodo).toBe("POST");
    expect(webhooks[0]!.config_url).toBe("https://example.com/callback");
  });

  it("retorna lista vazia quando não há flows com webhook", async () => {
    await store.salvarComId(wsPath, {
      id: "flow-sem-webhook",
      nome: "Flow Simples",
      nos: [
        { id: "gatilho", tipo: "manual", config: {} },
        { id: "fim", tipo: "saida", config: { registro: "saidas/teste" } },
      ],
      arestas: [{ de: "gatilho", para: "fim" }],
    });

    const webhooks = await store.listarWebhooks(wsPath);
    expect(webhooks.length).toBe(0);
  });
});
