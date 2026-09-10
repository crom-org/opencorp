import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { createApiServer, type ApiServerOptions, type SessaoApi } from "../src/server/index.js";
import type { OpcoesRun, ResultadoRun } from "../src/core/session-manager.js";

const raizes: string[] = [];

/** Etapa 6 — sala de reunião consultável em tempo real:
 *  POST /meetings devolve id · GET /meetings/:id expõe o buffer vivo
 *  (mensagens/turno/consenso) · stop 404 para desconhecida e interrompe a viva. */
describe("API — Reuniões v2 (sala viva)", () => {
  let home: string;
  let token = "t1";
  let port: number;
  let fetchApi: (path: string, opts?: RequestInit) => Promise<{ status: number; json: any }>;
  let server: ReturnType<typeof createApiServer>["server"];

  // roteiro do fake de sessões: consenso (marcador) x travado (turno pendente)
  let roteiro: { marcador: boolean; travar: boolean } = { marcador: true, travar: false };
  let turnoEmVoo = 0;
  let gateAberto = false;

  function resultadoFake(opcoes: OpcoesRun, captura: string): ResultadoRun {
    return {
      id: opcoes.execId ?? `exec-${Math.random().toString(36).slice(2, 8)}`,
      agente: opcoes.agente,
      modelo: opcoes.model ?? "test-model",
      ordem: opcoes.ordem ?? "",
      inicio: new Date().toISOString(),
      fim: new Date().toISOString(),
      status: "concluido",
      exit_code: 0,
      duracao_ms: 1,
      pid: null,
      log: `logs/x.log`,
      captura,
      custo_usd: 0.0001,
    } as ResultadoRun;
  }

  const fakeSessoes: SessaoApi = {
    async rodar(opcoes) {
      if (roteiro.travar) {
        turnoEmVoo += 1;
        while (!gateAberto) await sleep(5);
      }
      const marcador = roteiro.marcador ? " [CONSENSO-ENCERRAR]" : "";
      return resultadoFake(opcoes, `fala de ${opcoes.agente}${marcador}`);
    },
    async listarExecucoes() {
      return [];
    },
    async logDe() {
      return "fake log";
    },
  } as unknown as SessaoApi;

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), "opencorp-reunioes-v2-"));
    const srv = createApiServer({
      homeDir: home,
      token,
      sessoes: fakeSessoes,
      instalarMencoes: false,
    } as ApiServerOptions);
    server = srv.server;
    token = srv.token;
    server.listen(0, "127.0.0.1");
    port = await srv.porta;
    const base = `http://127.0.0.1:${port}`;
    fetchApi = async (path, opts = {}) => {
      const res = await fetch(`${base}${path}`, {
        ...opts,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(opts.headers ?? {}) },
        signal: AbortSignal.timeout(10_000),
      });
      const text = await res.text();
      let json: unknown;
      try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
      return { status: res.status, json };
    };
    await fetchApi("/workspaces", { method: "POST", body: JSON.stringify({ id: "ws1" }) });

    // participantes reais para o loop rodar com sessões fake
    const dirAgentes = join(home, ".opencorp", "workspaces", "ws1", ".opencorp", "agents");
    await mkdir(dirAgentes, { recursive: true });
    const agenteMd = (id: string) => `---
id: ${id}
role: Participante
category: custom
model: test/model
tools: [bash]
permissions: level-1
budget:
  daily_usd: 1.00
  max_turns: 10
memory:
  reads: []
  writes: []
---

prompt do ${id}
`;
    await writeFile(join(dirAgentes, "ag-a.md"), agenteMd("ag-a"), "utf8");
    await writeFile(join(dirAgentes, "ag-b.md"), agenteMd("ag-b"), "utf8");

    // semente de config.json escrita direto (evita depender do caminho de settings no teste)
    await mkdir(join(home, ".opencorp", "workspaces", "ws1", ".opencorp"), { recursive: true });
    await writeFile(
      join(home, ".opencorp", "workspaces", "ws1", ".opencorp", "config.json"),
      JSON.stringify({ version: 1, meeting: { max_turnos: 4 } }, null, 2) + "\n",
      "utf8",
    );
  });

  afterAll(async () => {
    server.close();
    await Promise.all(raizes.map((r) => rm(r, { recursive: true, force: true })));
  });

  const wsq = "?workspace=ws1";

  async function estadoAte(id: string, pred: (e: any) => boolean, timeoutMs = 5000): Promise<any> {
    const limite = Date.now() + timeoutMs;
    let estado: any = null;
    while (Date.now() < limite) {
      const r = await fetchApi(`/meetings/${id}${wsq}`);
      if (r.status === 200) {
        estado = r.json;
        if (pred(estado)) return estado;
      }
      await sleep(20);
    }
    return estado;
  }

  it("POST /meetings responde 202 { status: 'iniciado', id } (compat mantida)", async () => {
    const res = await fetchApi(`/meetings${wsq}`, { method: "POST", body: JSON.stringify({ pauta: "pauta compat" }) });
    expect(res.status).toBe(202);
    expect((res.json as { status: string }).status).toBe("iniciado");
    expect(String((res.json as { id: string }).id)).toMatch(/^reuniao-/);
  });

  it("sala viva expõe estado em tempo real: buffer de mensagens, consenso e encerramento por consenso", async () => {
    const criado = await fetchApi(`/meetings${wsq}`, { method: "POST", body: JSON.stringify({ pauta: "reduzir custo de nuvem", agentes: "ag-a,ag-b" }) });
    expect(criado.status).toBe(202);
    const id = (criado.json as { id: string }).id;

    const estado = await estadoAte(id, (e) => e.status === "encerrada");
    expect(estado).toBeTruthy();
    expect(estado.id).toBe(id);
    expect(estado.pauta).toBe("reduzir custo de nuvem");
    expect(estado.participantes).toEqual([{ id: "ag-a", ativo: true }, { id: "ag-b", ativo: true }]);
    // ambos sinalizam [CONSENSO-ENCERRAR] → encerra no turno 2 (max_turnos era 4)
    expect(estado.turno_atual).toBe(2);
    expect(estado.mensagens).toHaveLength(2);
    expect(estado.mensagens[0]).toMatchObject({ agente: "ag-a", texto: "fala de ag-a [CONSENSO-ENCERRAR]" });
    expect(typeof estado.mensagens[0].ts).toBe("string");
    expect(estado.consenso).toEqual({ pedidos: 2, total: 2 });
    expect(estado.iniciado_em).toBeTruthy();
    expect(estado.encerrada_em).toBeTruthy();

    // estado continua consultável após encerrar (memória) e aparece na lista
    const deNovo = await fetchApi(`/meetings/${id}${wsq}`);
    expect(deNovo.status).toBe(200);
    const lista = await fetchApi(`/meetings${wsq}`);
    const item = (lista.json as Array<{ id: string; status: string }>).find((s) => s.id === id);
    expect(item?.status).toBe("encerrada");
  });

  it("GET /meetings/:id desconhecido → 404; reunião com participantes inválidos não cria sala fantasma", async () => {
    const r404 = await fetchApi(`/meetings/reuniao-fantasma${wsq}`);
    expect(r404.status).toBe(404);

    const criado = await fetchApi(`/meetings${wsq}`, { method: "POST", body: JSON.stringify({ pauta: "x", agentes: "fantasma-1,fantasma-2" }) });
    expect(criado.status).toBe(202);
    const idFantasma = (criado.json as { id: string }).id;
    const r = await fetchApi(`/meetings/${idFantasma}${wsq}`);
    expect(r.status).toBe(404);
  });

  it("stop: desconhecida → 404; sala viva → interrupção por sala e loop sai entre turnos", { timeout: 90_000 }, async () => {
    const r404 = await fetchApi(`/meetings/reuniao-nada/stop${wsq}`, { method: "POST" });
    expect(r404.status).toBe(404);

    roteiro = { marcador: false, travar: true };
    turnoEmVoo = 0;
    gateAberto = false;
    try {
      const criado = await fetchApi(`/meetings${wsq}`, { method: "POST", body: JSON.stringify({ pauta: "pauta interrompida", agentes: "ag-a,ag-b" }) });
      const id = (criado.json as { id: string }).id;

      // espera o turno entrar em execução (fake travado no gate)
      const limite = Date.now() + 5000;
      while (Date.now() < limite && turnoEmVoo === 0) await sleep(5);
      expect(turnoEmVoo).toBeGreaterThan(0);

      const stop = await fetchApi(`/meetings/${id}/stop${wsq}`, { method: "POST" });
      expect(stop.status).toBe(200);

      gateAberto = true;
      const estado = await estadoAte(id, (e) => e.status === "encerrada");
      expect(estado).toBeTruthy();
      expect(estado.turno_atual).toBe(1);
      expect(estado.mensagens).toHaveLength(1);
      expect(estado.consenso).toEqual({ pedidos: 0, total: 2 });

      // segunda chamada de stop: sala já não está em andamento → 409
      const stop2 = await fetchApi(`/meetings/${id}/stop${wsq}`, { method: "POST" });
      expect(stop2.status).toBe(409);
    } finally {
      gateAberto = true;
      roteiro = { marcador: true, travar: false };
    }
  });
});
