import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { createApiServer } from "../src/server/index.js";
import { WorkspaceManager } from "../src/core/workspace-manager.js";
import { FlowStore } from "../src/core/flow-store.js";

describe("Produção & Marketplace — API Endpoints (Audit, Rate Limit, Components)", () => {
  let homeDir: string;
  let wsPath: string;
  let server: Server;
  let baseUrl: string;
  let apiToken: string;

  beforeAll(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "opencorp-audit-rate-test-"));
    const wm = new WorkspaceManager({ homeDir });
    const ws = await wm.criar("corp-prod-test");
    wsPath = ws.path;
    apiToken = "test-token-prod-999";

    const criado = createApiServer({
      homeDir,
      token: apiToken,
      instalarMencoes: false,
    });
    server = criado.server;
    server.listen(0, "127.0.0.1");
    const port = await criado.porta;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise((r) => setTimeout(r, 600));
    try {
      await rm(homeDir, { recursive: true, force: true });
    } catch {
      await new Promise((r) => setTimeout(r, 600));
      await rm(homeDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  async function reqApi(path: string, options: RequestInit = {}) {
    const headers: Record<string, string> = {
      ...((options.headers as Record<string, string>) || {}),
    };
    if (!headers["authorization"] && !headers["Authorization"]) {
      headers["Authorization"] = `Bearer ${apiToken}`;
    }
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text, headers: res.headers };
  }

  describe("Endpoints /components (Marketplace)", () => {
    it("GET /components auto-registra builtins e retorna lista", async () => {
      const res = await reqApi("/components");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.json)).toBe(true);
      expect(res.json.length).toBeGreaterThanOrEqual(6);
      expect(res.json.some((c: any) => c.id === "slack-message")).toBe(true);
    });

    it("POST /components cria novo componente e GET /components/:id retorna detalhes", async () => {
      const payload = {
        id: "validador-cpf",
        nome: "Validador de CPF",
        descricao: "Valida formato de documento",
        runtime: "node",
        codigo: `console.log(JSON.stringify({ output: "valido" }));`,
        tags: ["fiscal", "brasil"],
      };

      const resCreate = await reqApi("/components", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(resCreate.status).toBe(201);
      expect(resCreate.json.id).toBe("validador-cpf");

      const resGet = await reqApi("/components/validador-cpf");
      expect(resGet.status).toBe(200);
      expect(resGet.json.nome).toBe("Validador de CPF");
    });

    it("POST /components/:id/test executa o componente", async () => {
      const resTest = await reqApi("/components/validador-cpf/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entrada: "123.456.789-00" }),
      });
      expect(resTest.status).toBe(200);
      expect(resTest.json.ok).toBe(true);
      expect(resTest.json.json).toEqual({ output: "valido" });
    });

    it("publica e instala componente via API", async () => {
      const resPub = await reqApi("/components/validador-cpf/publish", { method: "POST" });
      expect(resPub.status).toBe(200);
      expect(resPub.json.ok).toBe(true);

      const resShared = await reqApi("/components/shared");
      expect(resShared.status).toBe(200);
      expect(resShared.json.some((c: any) => c.id === "validador-cpf")).toBe(true);
    });

    it("DELETE /components/:id remove o componente", async () => {
      const resDel = await reqApi("/components/validador-cpf", { method: "DELETE" });
      expect(resDel.status).toBe(200);

      const resGet = await reqApi("/components/validador-cpf");
      expect(resGet.status).toBe(404);
    });
  });

  describe("Audit Log de Execuções e Endpoints /audit", () => {
    it("execução de fluxo registra auditoria consultável em /audit e /audit/flows", async () => {
      const flowStore = new FlowStore({ homeDir });
      const f = await flowStore.criar(wsPath, "flow-auditado", "Flow de Auditoria");
      await flowStore.salvar(wsPath, {
        ...f,
        nos: [{ id: "inicio", tipo: "manual", config: {} }],
        arestas: [],
      });

      // Executa o flow
      await flowStore.executar(wsPath, "flow-auditado", { entrada: "teste de auditoria" });

      // Consulta /audit
      const resAudit = await reqApi("/audit");
      expect(resAudit.status).toBe(200);
      expect(resAudit.json.total).toBeGreaterThanOrEqual(2); // flow_iniciado + flow_concluido
      expect(
        resAudit.json.eventos.some((e: any) => e.evento === "flow_iniciado" && e.flow_id === "flow-auditado"),
      ).toBe(true);
      expect(
        resAudit.json.eventos.some((e: any) => e.evento === "flow_concluido" && e.flow_id === "flow-auditado"),
      ).toBe(true);

      // Consulta /audit/flows
      const resAuditFlows = await reqApi("/audit/flows");
      expect(resAuditFlows.status).toBe(200);
      expect(resAuditFlows.json.eventos.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Rate Limiting no Webhook (/flows/:id/webhook)", () => {
    it("permite até 30 requisições e retorna 429 Too Many Requests com Retry-After na 31ª", async () => {
      const flowStore = new FlowStore({ homeDir });
      const f = await flowStore.criar(wsPath, "flow-webhook-rate", "Flow com Webhook");
      await flowStore.salvar(wsPath, {
        ...f,
        nos: [{ id: "inicio", tipo: "manual", config: {} }],
        arestas: [],
      });

      // Envia 30 requests rápidas
      for (let i = 0; i < 30; i++) {
        const r = await reqApi("/flows/flow-webhook-rate/webhook", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ item: i }),
        });
        expect(r.status).toBe(202);
      }

      // 31ª requisição deve estourar o limite de 30 req/min
      const r31 = await reqApi("/flows/flow-webhook-rate/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ item: 31 }),
      });
      expect(r31.status).toBe(429);
      expect(r31.json.erro).toContain("Too Many Requests");
      expect(r31.headers.get("retry-after")).toBeTruthy();
    });
  });
});
