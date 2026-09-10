import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FlowStore, type SessaoFlow } from "../src/core/flow-store.js";
import { type OpcoesRun, type ResultadoRun } from "../src/core/session-manager.js";

describe("FlowStore — Loops HLE, Sessões Persistentes e Componentes Modulares", () => {
  let wsDir: string;
  let homeDir: string;
  let store: FlowStore;
  let runsMock: OpcoesRun[];

  beforeEach(() => {
    wsDir = mkdtempSync(join(tmpdir(), "opencorp-flow-ws-"));
    homeDir = mkdtempSync(join(tmpdir(), "opencorp-flow-home-"));
    runsMock = [];

    const fakeSessoes: SessaoFlow = {
      rodar: async (opts: OpcoesRun): Promise<ResultadoRun> => {
        runsMock.push(opts);
        const seq = runsMock.length;
        // Mock de resposta do agente
        return {
          id: `run-${seq}`,
          exit_code: 0,
          captura: `Resposta do agente para: ${opts.ordem} (volta ${seq})`,
        };
      },
    };

    store = new FlowStore({
      homeDir,
      sessoes: fakeSessoes,
      agora: () => new Date("2026-09-10T15:00:00.000Z"),
    });
  });

  afterEach(() => {
    rmSync(wsDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("permite ciclo controlado por nó de loop e encerra no teto de max_iteracoes", async () => {
    const flow = {
      id: "flow-loop-teto",
      nome: "Flow Loop com Teto de Segurança",
      nos: [
        { id: "inicio", tipo: "manual" },
        {
          id: "exec-script",
          tipo: "script",
          config: {
            comando: "echo 'iteracao executada'",
          },
        },
        {
          id: "hle-loop",
          tipo: "loop",
          config: {
            max_iteracoes: 3,
            condicao_parada: "TERMINAR_AGORA",
            retornar_para: "exec-script",
            saida_final: "fim",
          },
        },
        {
          id: "fim",
          tipo: "script",
          config: {
            comando: "echo 'loop concluido com sucesso'",
          },
        },
      ],
      arestas: [
        { de: "inicio", para: "exec-script" },
        { de: "exec-script", para: "hle-loop" },
      ],
    };

    await store.salvar(wsDir, flow as any);
    const resultado = await store.executar(wsDir, "flow-loop-teto", { entrada: "start" });

    expect(resultado.status).toBe("concluido");
    expect(resultado.contextoFinal).toContain("loop concluido com sucesso");
  });

  it("encerra o loop antecipadamente quando atinge a condicao_parada", async () => {
    let contador = 0;
    const scriptPath = join(wsDir, "contador.mjs");
    writeFileSync(
      scriptPath,
      `
      import fs from "node:fs";
      let val = 0;
      try { val = parseInt(fs.readFileSync('contador.txt', 'utf8') || '0'); } catch(e){}
      val++;
      fs.writeFileSync('contador.txt', String(val));
      if (val >= 2) {
        console.log("STATUS_OK: META ATINGIDA");
      } else {
        console.log("STATUS_PENDENTE: TENTATIVA " + val);
      }
      `
    );

    const flow = {
      id: "flow-loop-condicao",
      nome: "Flow com parada antecipada por condição",
      nos: [
        { id: "inicio", tipo: "manual" },
        {
          id: "processar",
          tipo: "script",
          config: {
            arquivo: "contador.mjs",
          },
        },
        {
          id: "hle-loop",
          tipo: "loop",
          config: {
            max_iteracoes: 5,
            condicao_parada: "STATUS_OK",
            retornar_para: "processar",
            saida_final: "fim",
          },
        },
        {
          id: "fim",
          tipo: "script",
          config: {
            comando: "echo 'processo finalizado'",
          },
        },
      ],
      arestas: [
        { de: "inicio", para: "processar" },
        { de: "processar", para: "hle-loop" },
      ],
    };

    await store.salvar(wsDir, flow as any);
    const resultado = await store.executar(wsDir, "flow-loop-condicao", { entrada: "iniciar" });

    expect(resultado.status).toBe("concluido");
    expect(resultado.contextoFinal).toContain("processo finalizado");
  });

  it("reaproveita session_id para nós de agentes com session_mode: 'reaproveitar'", async () => {
    const flow = {
      id: "flow-session-persist",
      nome: "Flow com memória persistente de sessão",
      nos: [
        { id: "inicio", tipo: "manual" },
        {
          id: "agente-memoria",
          tipo: "agente",
          config: {
            agente: "secretario",
            ordem: "Trabalhe no problema: {{$input}}",
            session_mode: "reaproveitar",
            max_iteracoes: 2,
          },
        },
        {
          id: "hle-loop",
          tipo: "loop",
          config: {
            max_iteracoes: 2,
            retornar_para: "agente-memoria",
          },
        },
      ],
      arestas: [
        { de: "inicio", para: "agente-memoria" },
        { de: "agente-memoria", para: "hle-loop" },
      ],
    };

    await store.salvar(wsDir, flow as any);
    const resultado = await store.executar(wsDir, "flow-session-persist", { entrada: "problema_inicial" });

    expect(resultado.status).toBe("concluido");
    expect(runsMock.length).toBe(2);
    // Verifica que ambas as chamadas usaram rigorosamente o MESMO session ID!
    expect(runsMock[0]!.session).toBeDefined();
    expect(runsMock[0]!.session).toBe(runsMock[1]!.session);
  });

  it("executa nó do tipo 'componente' com injeção segura de OPENCORP_INPUT e sem custo de LLM", async () => {
    const componentePath = join(wsDir, "meu_componente.sh");
    writeFileSync(
      componentePath,
      `#!/bin/bash
      echo "COMPONENTE_PROCESSADO: $OPENCORP_INPUT (node=$OPENCORP_NODE_ID)"
      `
    );

    const flow = {
      id: "flow-componente",
      nome: "Flow com nó do tipo componente",
      nos: [
        { id: "inicio", tipo: "manual" },
        {
          id: "calc-externo",
          tipo: "componente",
          config: {
            arquivo: "meu_componente.sh",
          },
        },
      ],
      arestas: [{ de: "inicio", para: "calc-externo" }],
    };

    await store.salvar(wsDir, flow as any);
    const resultado = await store.executar(wsDir, "flow-componente", { entrada: "dados_de_teste" });

    expect(resultado.status).toBe("concluido");
    expect(resultado.contextoFinal).toContain("COMPONENTE_PROCESSADO: dados_de_teste (node=calc-externo)");
    // Zero chamadas ao LLM!
    expect(runsMock.length).toBe(0);
  });

  it("bloqueia path traversal em nós de script/componente por segurança", async () => {
    const flow = {
      id: "flow-seguranca",
      nome: "Flow com tentativa de path traversal",
      nos: [
        { id: "inicio", tipo: "manual" },
        {
          id: "script-malicioso",
          tipo: "script",
          config: {
            arquivo: "../../../etc/passwd",
          },
        },
      ],
      arestas: [{ de: "inicio", para: "script-malicioso" }],
    };

    await store.salvar(wsDir, flow as any);
    await expect(store.executar(wsDir, "flow-seguranca")).rejects.toThrow(/fora do workspace/);
  });
});
