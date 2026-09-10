import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MODELOS_ROTACAO_PADRAO,
  PADRAO_ERRO_MODELO,
  PADRAO_ERRO_CREDITOS,
  ehModeloGratuito,
  obterListaRotacaoCompleta,
  SessionManager,
} from "../src/core/session-manager.js";

describe("Rotação de Modelos e Detecção de Erros de API (TEST-04)", () => {
  it("detecta erro HTTP 429 e rate limit", () => {
    const saida = 'Error: 429 Rate limit exceeded: You have exceeded the free models per day quota.';
    expect(PADRAO_ERRO_MODELO.test(saida)).toBe(true);
  });

  it("detecta erro HTTP 402, payment_required e insufficient balance (OpenRouter/NVIDIA)", () => {
    const saidaJson = '{"code":402,"message":"Insufficient balance","metadata":{"error_type":"payment_required"}}';
    expect(PADRAO_ERRO_MODELO.test(saidaJson)).toBe(true);
    expect(PADRAO_ERRO_CREDITOS.test(saidaJson)).toBe(true);

    const saidaTexto = 'Your account has an insufficient credit balance to complete this request.';
    expect(PADRAO_ERRO_MODELO.test(saidaTexto)).toBe(true);
    expect(PADRAO_ERRO_CREDITOS.test(saidaTexto)).toBe(true);
  });

  it("detecta erro de créditos insuficientes do OpenRouter (requires more credits / can only afford)", () => {
    const erroReal = 'Error: This request requires more credits, or fewer max_tokens. You requested up to 32000 tokens, but can only afford 11487. To increase, visit https://openrouter.ai/settings/credits and add more credits';
    expect(PADRAO_ERRO_MODELO.test(erroReal)).toBe(true);
    expect(PADRAO_ERRO_CREDITOS.test(erroReal)).toBe(true);
  });

  it("detecta erro de saldo excedido por requisições concorrentes (in-flight requests)", () => {
    const erroInFlight = 'Error: This request would exceed your available credits given your current in-flight requests. Retry after in-flight requests settle, or add credits.';
    expect(PADRAO_ERRO_MODELO.test(erroInFlight)).toBe(true);
    expect(PADRAO_ERRO_CREDITOS.test(erroInFlight)).toBe(true);
  });

  it("detecta travamento de concorrência de banco SQLite (database is locked)", () => {
    const erroSqlite = 'Error: Unexpected error\n\ndatabase is locked';
    expect(PADRAO_ERRO_MODELO.test(erroSqlite)).toBe(true);
  });

  it("detecta sobrecarga e indisponibilidade de modelos gratuitos", () => {
    const saidaOverloaded = 'Provider returned error: model is temporarily overloaded or resource exhausted.';
    expect(PADRAO_ERRO_MODELO.test(saidaOverloaded)).toBe(true);
  });

  it("detecta indisponibilidade de modelos gratuitos", () => {
    const saidaUnavailable = 'Model openrouter/nvidia/nemotron-3-ultra-550b-a55b is unavailable for free users.';
    expect(PADRAO_ERRO_MODELO.test(saidaUnavailable)).toBe(true);
  });

  it("não dispara falso positivo para saída de sucesso ou erros normais de aplicação", () => {
    const saidaOk = 'Processamento concluído com sucesso. 10 arquivos atualizados.';
    expect(PADRAO_ERRO_MODELO.test(saidaOk)).toBe(false);
    expect(PADRAO_ERRO_CREDITOS.test(saidaOk)).toBe(false);

    const erroSintaxe = 'SyntaxError: Unexpected token < in JSON at position 0';
    expect(PADRAO_ERRO_MODELO.test(erroSintaxe)).toBe(false);
    expect(PADRAO_ERRO_CREDITOS.test(erroSintaxe)).toBe(false);
  });

  it("ehModeloGratuito identifica corretamente modelos gratuitos e pagos", () => {
    expect(ehModeloGratuito("openrouter/nvidia/nemotron-3.5-lightning:free")).toBe(true);
    expect(ehModeloGratuito("openrouter/minimax/minimax-m3:free")).toBe(true);
    expect(ehModeloGratuito("opencode-go/glm-5.3-flash")).toBe(true);
    expect(ehModeloGratuito("openrouter/google/gemini-3.8-flash")).toBe(false);
    expect(ehModeloGratuito("openrouter/nvidia/nemotron-3-ultra-550b-a55b")).toBe(false);
    expect(ehModeloGratuito("openrouter/deepseek/deepseek-chat")).toBe(false);
  });

  it("garante que a lista de rotação contém os modelos NVIDIA e Fallbacks em ordem válida", () => {
    expect(MODELOS_ROTACAO_PADRAO.length).toBeGreaterThanOrEqual(3);

    const temNvidia = MODELOS_ROTACAO_PADRAO.some((m) => m.includes("nemotron"));
    expect(temNvidia).toBe(true);

    const temFallback = MODELOS_ROTACAO_PADRAO.some((m) => m.includes("minimax") || m.includes("gemini") || m.includes("deepseek"));
    expect(temFallback).toBe(true);

    const idx0 = 0;
    const proximo = MODELOS_ROTACAO_PADRAO[idx0 + 1];
    expect(proximo).toBeDefined();
    expect(proximo).not.toBe(MODELOS_ROTACAO_PADRAO[0]);
  });
});

describe("E2E — Integração de Rotação com Configurações de Modelos (tab=modelos)", () => {
  let tempHome: string;
  let wsPath: string;

  beforeEach(() => {
    tempHome = join(tmpdir(), `opencorp-rot-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    wsPath = join(tempHome, "workspace-teste");
    mkdirSync(join(wsPath, ".opencorp", "agents"), { recursive: true });
    mkdirSync(join(wsPath, ".opencorp", "registries"), { recursive: true });
    mkdirSync(join(tempHome, ".opencorp"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("obterListaRotacaoCompleta puxa a rotação e default_model de settings.json (config?tab=modelos)", async () => {
    const settingsJson = {
      default_model: "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
      tests: {
        rotation: [
          "openrouter/nvidia/nemotron-3.5-lightning:free",
          "openrouter/minimax/minimax-m3:free",
          "openrouter/z-ai/glm-5.2:free",
        ],
      },
    };
    writeFileSync(join(tempHome, ".opencorp", "settings.json"), JSON.stringify(settingsJson, null, 2), "utf8");

    const sessoes = new SessionManager({ homeDir: tempHome });
    const lista = await obterListaRotacaoCompleta(
      (sessoes as any).agentes,
      wsPath,
      "qualquer-agente",
      tempHome,
    );

    expect(lista).toContain("openrouter/nvidia/nemotron-3.5-lightning:free");
    expect(lista).toContain("openrouter/minimax/minimax-m3:free");
    expect(lista).toContain("openrouter/z-ai/glm-5.2:free");
    expect(lista).toContain("openrouter/nvidia/nemotron-3-ultra-550b-a55b:free");
  });

  it("proximoModeloDaRotacao filtra modelos pagos quando ocorre erro de créditos (apenasGratuitos)", async () => {
    const settingsJson = {
      tests: {
        rotation: [
          "openrouter/google/gemini-3.8-flash", // Pago
          "openrouter/nvidia/nemotron-3-ultra-550b-a55b", // Pago (sem :free)
          "openrouter/nvidia/nemotron-3.5-lightning:free", // Gratuito
          "openrouter/minimax/minimax-m3:free", // Gratuito
        ],
      },
    };
    writeFileSync(join(tempHome, ".opencorp", "settings.json"), JSON.stringify(settingsJson, null, 2), "utf8");

    const sessoes = new SessionManager({ homeDir: tempHome });

    // Se gemini-3.8-flash falhar por erro de créditos, deve pular os modelos pagos e ir direto para o gratuito
    const proximo = await sessoes.proximoModeloDaRotacao(
      "openrouter/google/gemini-3.8-flash",
      wsPath,
      undefined,
      ["openrouter/google/gemini-3.8-flash"],
      true, // apenasGratuitos = true
    );

    expect(proximo).toBe("openrouter/nvidia/nemotron-3.5-lightning:free");
  });

  it("percorre toda a cadeia de rotação sem loops e retorna null somente após esgotar todos", async () => {
    const settingsJson = {
      tests: {
        rotation: [
          "openrouter/nvidia/nemotron-3.5-lightning:free",
          "openrouter/minimax/minimax-m3:free",
          "opencode-go/glm-5.3-flash",
        ],
      },
    };
    writeFileSync(join(tempHome, ".opencorp", "settings.json"), JSON.stringify(settingsJson, null, 2), "utf8");

    const sessoes = new SessionManager({ homeDir: tempHome });

    let tentados: string[] = ["openrouter/google/gemini-3.8-flash"];
    let prox = await sessoes.proximoModeloDaRotacao("openrouter/google/gemini-3.8-flash", wsPath, undefined, tentados);
    expect(prox).toBe("openrouter/nvidia/nemotron-3.5-lightning:free");

    tentados.push(prox!);
    prox = await sessoes.proximoModeloDaRotacao(prox!, wsPath, undefined, tentados);
    expect(prox).toBe("openrouter/minimax/minimax-m3:free");

    tentados.push(prox!);
    prox = await sessoes.proximoModeloDaRotacao(prox!, wsPath, undefined, tentados);
    expect(prox).toBe("opencode-go/glm-5.3-flash");

    tentados.push(prox!);
    prox = await sessoes.proximoModeloDaRotacao(prox!, wsPath, undefined, tentados);
    // Todos os modelos foram esgotados
    expect(prox).toBeNull();
  });
});
