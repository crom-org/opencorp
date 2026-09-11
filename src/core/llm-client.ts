import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { opencorpHome } from "../utils/paths.js";
import { mascararChave } from "./opencode-server.js";

export interface MensagemChat {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpcoesCompletar {
  model: string;
  messages: MensagemChat[];
  temperature?: number;
  maxTokens?: number;
  homeDir?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface RespostaCompletar {
  content: string;
  model: string;
  provider?: string;
  is_byok?: boolean;
  cost?: number;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  duration_ms: number;
}

export interface ResultadoTesteModelo {
  ok: boolean;
  status: number;
  ms: number;
  model: string;
  content?: string;
  error?: string;
  provider?: string;
  is_byok?: boolean;
  cost?: number;
}

export interface ProvedorInfo {
  id: string;
  nome: string;
  conectado: boolean;
  tipo: "api_key" | "local" | "oauth";
  previewChave?: string;
  fonte?: string;
  descricao: string;
  modelosSugeridos: string[];
}

/**
 * Resolve todas as chaves de API conhecidas nos locais de configuração do OpenCorp e OpenCode.
 */
export function obterChavesProvedores(homeDir?: string): Record<string, string> {
  const home = homeDir ?? opencorpHome();
  const chaves: Record<string, string> = {};

  const arquivosAuth = [
    join(home, ".opencorp", "opencode-data", "opencode", "auth.json"),
    join(home, ".local", "share", "opencode", "auth.json"),
    join(home, ".opencorp", "opencode-home", ".opencode", "auth.json"),
  ];

  for (const arq of arquivosAuth) {
    if (existsSync(arq)) {
      try {
        const json = JSON.parse(readFileSync(arq, "utf8")) as Record<string, any>;
        for (const [prov, val] of Object.entries(json)) {
          if (!chaves[prov]) {
            if (typeof val === "string" && val.trim()) chaves[prov] = val.trim();
            else if (val && typeof val === "object" && typeof val.key === "string" && val.key.trim()) {
              chaves[prov] = val.key.trim();
            }
          }
        }
      } catch {}
    }
  }

  // secrets.json
  const secretsPath = join(home, ".opencorp", "secrets.json");
  if (existsSync(secretsPath)) {
    try {
      const sec = JSON.parse(readFileSync(secretsPath, "utf8")) as Record<string, any>;
      if (!chaves["openrouter"] && sec.openrouter_api_key) chaves["openrouter"] = String(sec.openrouter_api_key).trim();
      if (!chaves["openrouter"] && sec.openrouter) chaves["openrouter"] = String(sec.openrouter).trim();
      if (!chaves["openai"] && sec.openai_api_key) chaves["openai"] = String(sec.openai_api_key).trim();
      if (!chaves["anthropic"] && sec.anthropic_api_key) chaves["anthropic"] = String(sec.anthropic_api_key).trim();
      if (!chaves["google"] && sec.google_api_key) chaves["google"] = String(sec.google_api_key).trim();
    } catch {}
  }

  // Variáveis de ambiente como fallback
  if (!chaves["openrouter"] && process.env.OPENROUTER_API_KEY) chaves["openrouter"] = process.env.OPENROUTER_API_KEY.trim();
  if (!chaves["openai"] && process.env.OPENAI_API_KEY) chaves["openai"] = process.env.OPENAI_API_KEY.trim();
  if (!chaves["anthropic"] && process.env.ANTHROPIC_API_KEY) chaves["anthropic"] = process.env.ANTHROPIC_API_KEY.trim();
  if (!chaves["google"] && process.env.GEMINI_API_KEY) chaves["google"] = process.env.GEMINI_API_KEY.trim();

  return chaves;
}

/**
 * Retorna o status de conexão de cada provedor para exibição na UI
 */
export function listarProvedoresStatus(homeDir?: string): ProvedorInfo[] {
  const chaves = obterChavesProvedores(homeDir);

  const provedoresDefinidos: Array<{
    id: string;
    nome: string;
    tipo: "api_key" | "local" | "oauth";
    descricao: string;
    modelosSugeridos: string[];
  }> = [
    {
      id: "openrouter",
      nome: "OpenRouter (Universal & BYOK)",
      tipo: "api_key",
      descricao: "Roteador universal com suporte a BYOK Google AI Studio (custo $0), NVIDIA e centenas de modelos.",
      modelosSugeridos: [
        "google/gemini-3.8-flash",
        "nvidia/nemotron-3.5-lightning:free",
        "nvidia/nemotron-3-ultra-550b-a55b:free",
        "minimax/minimax-m3:free",
        "anthropic/claude-3.5-haiku",
      ],
    },
    {
      id: "opencode-go",
      nome: "OpenCode-Go Native",
      tipo: "api_key",
      descricao: "Backend oficial de inferência rápida do OpenCode.",
      modelosSugeridos: ["glm-5.3-flash", "deepseek-v3"],
    },
    {
      id: "anthropic",
      nome: "Anthropic API Direta",
      tipo: "api_key",
      descricao: "Acesso direto à API da Anthropic para Claude Sonnet/Haiku/Opus.",
      modelosSugeridos: ["claude-3-7-sonnet", "claude-3-5-haiku"],
    },
    {
      id: "google",
      nome: "Google AI Studio Direto",
      tipo: "api_key",
      descricao: "Chave direta do Google AI Studio para Gemini 2.5/3.8 Flash e Pro.",
      modelosSugeridos: ["gemini-2.5-flash", "gemini-3.8-flash"],
    },
    {
      id: "openai",
      nome: "OpenAI API Direta",
      tipo: "api_key",
      descricao: "Acesso direto à API da OpenAI para GPT-4o, o3-mini e embeddings.",
      modelosSugeridos: ["gpt-4o-mini", "o3-mini"],
    },
    {
      id: "ollama",
      nome: "Ollama (Modelos Locais)",
      tipo: "local",
      descricao: "Servidor local Ollama rodando em http://localhost:11434.",
      modelosSugeridos: ["llama3.2:latest", "qwen2.5-coder:latest"],
    },
  ];

  return provedoresDefinidos.map((p) => {
    const chave = chaves[p.id];
    const conectado = Boolean(chave && chave.length > 5);
    return {
      id: p.id,
      nome: p.nome,
      tipo: p.tipo,
      conectado,
      previewChave: conectado && chave ? mascararChave(chave) : undefined,
      descricao: p.descricao,
      modelosSugeridos: p.modelosSugeridos,
    };
  });
}

/**
 * Cliente Universal Leve para Inferência Direta de LLM.
 * Não inicializa processos do OpenCode, não cria sessões no corp.db e não usa watchdog.
 * Retorna o texto puro ou JSON diretamente da API do provedor em ~1-3s.
 */
export async function completarChatDirect(opcoes: OpcoesCompletar): Promise<RespostaCompletar> {
  const home = opcoes.homeDir ?? opencorpHome();
  const chaves = obterChavesProvedores(home);
  const timeoutMs = opcoes.timeoutMs ?? 30_000;
  const inicio = Date.now();

  let modelo = opcoes.model.trim();
  // Se começar com prefixo de harness ex: "opencode/openrouter/..." -> normaliza
  if (modelo.startsWith("opencode/")) modelo = modelo.slice("opencode/".length);
  if (modelo.startsWith("claude-code/")) modelo = modelo.slice("claude-code/".length);

  let url = "https://openrouter.ai/api/v1/chat/completions";
  let apiKey = chaves["openrouter"];
  let modelParam = modelo;
  const headersReq: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (modelo.startsWith("opencode-go/")) {
    url = "https://opencode.ai/zen/go/v1/chat/completions";
    apiKey = chaves["opencode-go"] || chaves["opencode"];
    modelParam = modelo.slice("opencode-go/".length);
    if (!apiKey) {
      throw new Error("Nenhuma chave de API configurada para o provedor OpenCode-Go. Configure em Config → Motores & Provedores.");
    }
    headersReq["Authorization"] = `Bearer ${apiKey}`;
    headersReq["x-opencode-session"] = "ses_" + Math.random().toString(36).slice(2);
  } else {
    if (modelo.startsWith("openrouter/")) {
      modelParam = modelo.slice("openrouter/".length);
    } else if (modelo.startsWith("google/") || modelo.startsWith("nvidia/") || modelo.startsWith("minimax/") || modelo.startsWith("anthropic/") || modelo.startsWith("openai/")) {
      // Se foi passado sem openrouter/ mas tem formato org/model, usa OpenRouter como hub
      modelParam = modelo;
    }

    if (!apiKey) {
      throw new Error(
        "Nenhuma chave de API encontrada para o provedor OpenRouter. Configure em Config → Chaves ou em ~/.opencorp/secrets.json",
      );
    }
    headersReq["Authorization"] = `Bearer ${apiKey}`;
    headersReq["HTTP-Referer"] = "https://opencorp.local";
    headersReq["X-Title"] = "OpenCorp Direct Inference";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: headersReq,
      body: JSON.stringify({
        model: modelParam,
        messages: opcoes.messages,
        temperature: opcoes.temperature ?? 0.7,
        max_tokens: opcoes.maxTokens ?? 1500,
      }),
      signal: opcoes.signal ?? controller.signal,
    });

    const duration_ms = Date.now() - inicio;
    const data = (await res.json()) as any;

    if (!res.ok) {
      const errMsg = data?.error?.message || data?.message || `HTTP ${res.status}`;
      throw new Error(`Falha na chamada ao modelo (${modelParam}): ${errMsg}`);
    }

    const choice = data?.choices?.[0];
    const content = choice?.message?.content ?? "";

    return {
      content,
      model: data?.model || modelParam,
      provider: data?.provider,
      is_byok: data?.usage?.is_byok ?? false,
      cost: data?.usage?.cost ?? 0,
      usage: data?.usage
        ? {
            prompt_tokens: data.usage.prompt_tokens ?? 0,
            completion_tokens: data.usage.completion_tokens ?? 0,
            total_tokens: data.usage.total_tokens ?? 0,
          }
        : undefined,
      duration_ms,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Dispara uma requisição de teste de 1 token para validar a chave e conexão com o modelo.
 */
export async function testarModeloDirect(
  model: string,
  homeDir?: string,
): Promise<ResultadoTesteModelo> {
  const inicio = Date.now();
  try {
    const resp = await completarChatDirect({
      model,
      messages: [{ role: "user", content: "Diga apenas: OK" }],
      maxTokens: 10,
      temperature: 0.1,
      homeDir,
      timeoutMs: 15_000,
    });

    return {
      ok: true,
      status: 200,
      ms: resp.duration_ms,
      model: resp.model,
      content: resp.content.trim(),
      provider: resp.provider,
      is_byok: resp.is_byok,
      cost: resp.cost,
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 500,
      ms: Date.now() - inicio,
      model,
      error: err.message || String(err),
    };
  }
}
