/**
 * Testes unitários — EngineAccountStore: sincronização de auth e rotação de contas
 *
 * Cobre:
 * 1. sincronizarAuth() propaga chave ativa para auth.json global e de workspaces
 * 2. rotacionarProximaConta() alterna entre contas do mesmo motor
 * 3. ativarConta() sincroniza auth automaticamente
 * 4. desconectarConta() sincroniza auth e promove próxima
 * 5. adicionarConta() sincroniza auth na criação
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { EngineAccountStore } from "../src/core/engines/engine-account-store.js";

const TMP = "/tmp/opencorp-test-engine-sync-" + Date.now();

function setupHome(): string {
  const home = join(TMP, "home-" + Math.random().toString(36).slice(2, 8));
  mkdirSync(join(home, ".opencorp", "opencode-data", "opencode"), { recursive: true });
  mkdirSync(join(home, ".opencorp", "opencode-data", "workspaces", "ws-alpha", "opencode"), { recursive: true });
  mkdirSync(join(home, ".opencorp", "opencode-data", "workspaces", "ws-beta", "opencode"), { recursive: true });

  const auth = { openrouter: { type: "api", key: "sk-or-test" } };
  writeFileSync(join(home, ".opencorp", "opencode-data", "opencode", "auth.json"), JSON.stringify(auth, null, 2));
  writeFileSync(join(home, ".opencorp", "opencode-data", "workspaces", "ws-alpha", "opencode", "auth.json"), JSON.stringify(auth, null, 2));
  writeFileSync(join(home, ".opencorp", "opencode-data", "workspaces", "ws-beta", "opencode", "auth.json"), JSON.stringify(auth, null, 2));

  // engine-accounts.json vazio
  writeFileSync(join(home, ".opencorp", "engine-accounts.json"), "[]");

  return home;
}

function lerAuth(home: string, subpath = "opencode"): Record<string, any> {
  const p = join(home, ".opencorp", "opencode-data", subpath, "auth.json");
  return JSON.parse(readFileSync(p, "utf8"));
}

describe("EngineAccountStore — Sync & Rotation", () => {
  let home: string;
  let store: EngineAccountStore;

  beforeEach(() => {
    home = setupHome();
    store = new EngineAccountStore({ homeDir: home });
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  // ── adicionarConta sincroniza auth ──
  test("adicionarConta sincroniza auth.json global e workspaces", async () => {
    await store.adicionarConta("opencode-go", {
      nome: "Conta Go 1",
      authType: "apiKey",
      tokenOuChave: "sk-go-key-111",
    });

    const global = lerAuth(home, "opencode");
    expect(global["opencode-go"]?.key).toBe("sk-go-key-111");
    expect(global["opencode"]?.key).toBe("sk-go-key-111"); // alias

    const wsAlpha = lerAuth(home, "workspaces/ws-alpha/opencode");
    expect(wsAlpha["opencode-go"]?.key).toBe("sk-go-key-111");

    const wsBeta = lerAuth(home, "workspaces/ws-beta/opencode");
    expect(wsBeta["opencode-go"]?.key).toBe("sk-go-key-111");

    // openrouter original preservado
    expect(global["openrouter"]?.key).toBe("sk-or-test");
  });

  // ── ativarConta sincroniza auth ──
  test("ativarConta propaga nova chave para auth.json", async () => {
    const c1 = await store.adicionarConta("opencode-go", {
      nome: "Go Principal",
      tokenOuChave: "sk-go-principal",
    });
    const c2 = await store.adicionarConta("opencode-go", {
      nome: "Go Secundária",
      tokenOuChave: "sk-go-secundaria",
    });

    // c1 é ativa por padrão — auth deve ter sk-go-principal
    let global = lerAuth(home, "opencode");
    expect(global["opencode-go"]?.key).toBe("sk-go-principal");

    // Ativar c2
    await store.ativarConta("opencode-go", c2.id);
    global = lerAuth(home, "opencode");
    expect(global["opencode-go"]?.key).toBe("sk-go-secundaria");
    expect(global["opencode"]?.key).toBe("sk-go-secundaria");

    // Workspace também atualizado
    const wsAlpha = lerAuth(home, "workspaces/ws-alpha/opencode");
    expect(wsAlpha["opencode-go"]?.key).toBe("sk-go-secundaria");
  });

  // ── rotacionarProximaConta ──
  test("rotacionarProximaConta alterna entre contas", async () => {
    const c1 = await store.adicionarConta("opencode-go", {
      nome: "R1",
      tokenOuChave: "sk-r1",
    });
    const c2 = await store.adicionarConta("opencode-go", {
      nome: "R2",
      tokenOuChave: "sk-r2",
    });

    // c1 é ativa
    const ativa1 = await store.obterContaAtiva("opencode-go");
    expect(ativa1?.id).toBe(c1.id);

    // Rotacionar → deve ir para c2
    const prox = await store.rotacionarProximaConta("opencode-go");
    expect(prox?.id).toBe(c2.id);
    expect(prox?.nome).toBe("R2");

    const ativa2 = await store.obterContaAtiva("opencode-go");
    expect(ativa2?.id).toBe(c2.id);

    // auth.json atualizado
    const global = lerAuth(home, "opencode");
    expect(global["opencode-go"]?.key).toBe("sk-r2");

    // Rotacionar de novo → volta para c1 (circular)
    const prox2 = await store.rotacionarProximaConta("opencode-go");
    expect(prox2?.id).toBe(c1.id);
  });

  test("rotacionarProximaConta retorna null se só tem 1 conta", async () => {
    await store.adicionarConta("opencode-go", {
      nome: "Unica",
      tokenOuChave: "sk-unica",
    });

    const prox = await store.rotacionarProximaConta("opencode-go");
    expect(prox).toBeNull();
  });

  test("rotacionarProximaConta retorna null se não tem contas", async () => {
    const prox = await store.rotacionarProximaConta("opencode-go");
    expect(prox).toBeNull();
  });

  // ── desconectarConta sincroniza auth ──
  test("desconectarConta ativa promove próxima e sincroniza", async () => {
    const c1 = await store.adicionarConta("opencode-go", {
      nome: "D1",
      tokenOuChave: "sk-d1",
    });
    const c2 = await store.adicionarConta("opencode-go", {
      nome: "D2",
      tokenOuChave: "sk-d2",
    });

    // Desconectar c1 (ativa)
    await store.desconectarConta("opencode-go", c1.id);

    // c2 deve ser promovida
    const contas = await store.listar("opencode-go");
    expect(contas.length).toBe(1);
    expect(contas[0]!.ativa).toBe(true);
    expect(contas[0]!.id).toBe(c2.id);

    // auth.json deve ter sk-d2
    const global = lerAuth(home, "opencode");
    expect(global["opencode-go"]?.key).toBe("sk-d2");
  });

  // ── sincronizarAuth não quebra se auth.json não existe ──
  test("sincronizarAuth tolera auth.json ausente em workspaces", async () => {
    // Remove auth de ws-beta
    const betaAuth = join(home, ".opencorp", "opencode-data", "workspaces", "ws-beta", "opencode", "auth.json");
    rmSync(betaAuth, { force: true });

    // Não deve lançar erro
    await store.adicionarConta("opencode-go", {
      nome: "T1",
      tokenOuChave: "sk-t1",
    });

    // Global e ws-alpha devem estar OK
    const global = lerAuth(home, "opencode");
    expect(global["opencode-go"]?.key).toBe("sk-t1");

    const wsAlpha = lerAuth(home, "workspaces/ws-alpha/opencode");
    expect(wsAlpha["opencode-go"]?.key).toBe("sk-t1");

    // ws-beta auth.json não existe — não deve ter sido criado
    expect(existsSync(betaAuth)).toBe(false);
  });

  // ── Limites padrão ──
  test("conta criada tem limites padrão corretos", async () => {
    const c = await store.adicionarConta("opencode-go", {
      nome: "Limites Padrão",
      tokenOuChave: "sk-lp",
    });

    expect(c.limits.max_turns).toBe(0); // ilimitado
    expect(c.limits.timeout_min).toBe(120);
    expect(c.limits.fallback_action).toBe("rotate");
    expect(c.limits.status_cota).toBe("normal");
  });

  // ── Motor diferente não interfere ──
  test("contas de motores diferentes são independentes", async () => {
    const goC = await store.adicionarConta("opencode-go", {
      nome: "Go",
      tokenOuChave: "sk-go",
    });
    const antiC = await store.adicionarConta("antigravity", {
      nome: "Anti",
      tokenOuChave: "gemini-key",
    });

    const goContas = await store.listar("opencode-go");
    expect(goContas.length).toBe(1);

    const antiContas = await store.listar("antigravity");
    expect(antiContas.length).toBe(1);

    // Rotacionar opencode-go não afeta antigravity
    await store.adicionarConta("opencode-go", {
      nome: "Go2",
      tokenOuChave: "sk-go2",
    });
    await store.rotacionarProximaConta("opencode-go");

    const antiAtiva = await store.obterContaAtiva("antigravity");
    expect(antiAtiva?.id).toBe(antiC.id);
  });
});
