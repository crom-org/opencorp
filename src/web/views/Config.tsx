import { type Component, createSignal, onMount, createEffect, For, Show } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import {
  Settings,
  Cpu,
  Key,
  Shield,
  ShieldCheck,
  Save,
  Bot,
  Terminal,
  CircleCheck,
  CircleAlert,
  Zap,
  RefreshCw,
  Server,
  Trash2,
  Plus,
  Play,
  Activity,
  Layers,
  Unplug,
  Download,
  ExternalLink,
  Star,
  Check,
  X,
  Package,
  Circle,
  ShieldAlert,
  ShieldX,
  Coins,
  Clock,
  RotateCcw,
  Gauge,
  DollarSign,
  Folder,
  Users,
  Wrench,
  Lock,
  FileText,
} from "lucide-solid";
import { Button } from "../ui/Button";
import { showToast } from "../ui/Toast";
import { fetchApi, wsAtivo } from "../lib/context";
import { EngineAuthModal } from "../components/EngineAuthModal";

export interface ProvedorAgenteItem {
  id: string;
  nome: string;
  tipo: "api_key" | "oauth_cli" | "token" | "local";
  descricao: string;
  loginUrl?: string;
  loginUrlLabel?: string;
  loginCmd?: string;
  envVar?: string;
  modelosSugeridos?: string[];
}

const PROVEDORES_POR_AGENTE: Record<string, ProvedorAgenteItem[]> = {
  opencode: [
    {
      id: "openrouter",
      nome: "OpenRouter (Universal & BYOK)",
      tipo: "api_key",
      descricao: "Roteador universal com suporte a BYOK Google AI Studio (custo $0), NVIDIA, MiniMax e centenas de modelos.",
      loginUrl: "https://openrouter.ai/keys",
      loginUrlLabel: "Chaves OpenRouter",
      envVar: "OPENROUTER_API_KEY",
      modelosSugeridos: ["google/gemini-3.8-flash", "nvidia/nemotron-3.5-lightning:free", "anthropic/claude-3.5-haiku"],
    },
    {
      id: "google",
      nome: "Google AI Studio Direto",
      tipo: "api_key",
      descricao: "Chave direta do Google AI Studio para Gemini 2.5/3.8 Flash e Gemini Pro (Tier Gratuito / Custo $0).",
      loginUrl: "https://aistudio.google.com/app/apikey",
      loginUrlLabel: "Google AI Studio",
      envVar: "GEMINI_API_KEY",
      modelosSugeridos: ["gemini-2.5-flash", "gemini-3.8-flash"],
    },
    {
      id: "anthropic",
      nome: "Anthropic API Direta",
      tipo: "api_key",
      descricao: "Acesso direto à API da Anthropic para modelos Claude 3.7 Sonnet, Claude 3.5 Sonnet e Haiku.",
      loginUrl: "https://console.anthropic.com/settings/keys",
      loginUrlLabel: "Console Anthropic",
      envVar: "ANTHROPIC_API_KEY",
      modelosSugeridos: ["claude-3-7-sonnet", "claude-3-5-haiku"],
    },
    {
      id: "openai",
      nome: "OpenAI API Direta",
      tipo: "api_key",
      descricao: "Acesso direto à API da OpenAI para GPT-4o, o3-mini e modelos de raciocínio.",
      loginUrl: "https://platform.openai.com/api-keys",
      loginUrlLabel: "OpenAI Keys",
      envVar: "OPENAI_API_KEY",
      modelosSugeridos: ["gpt-4o-mini", "o3-mini"],
    },
    {
      id: "opencode-go",
      nome: "OpenCode-Go Native",
      tipo: "api_key",
      descricao: "Backend oficial de inferência rápida e streaming de tokens do ecossistema OpenCode.",
      loginUrl: "https://opencode.ai",
      loginUrlLabel: "OpenCode AI",
      modelosSugeridos: ["glm-5.3-flash", "deepseek-v3"],
    },
    {
      id: "ollama",
      nome: "Ollama (Modelos Locais)",
      tipo: "local",
      descricao: "Servidor local Ollama rodando em http://localhost:11434 (privacidade total, 100% offline).",
      loginUrl: "https://ollama.com",
      loginUrlLabel: "Ollama Docs",
      modelosSugeridos: ["llama3.2:latest", "qwen2.5-coder:latest"],
    },
  ],
  "crom-agente": [
    {
      id: "openrouter",
      nome: "OpenRouter (Loop ReAct Nativo)",
      tipo: "api_key",
      descricao: "Provedor principal utilizado pelo runtime Go para execução de planos autônomos ReAct.",
      loginUrl: "https://openrouter.ai/keys",
      loginUrlLabel: "Chaves OpenRouter",
      envVar: "OPENROUTER_API_KEY",
      modelosSugeridos: ["google/gemini-3.8-flash", "anthropic/claude-3.5-haiku"],
    },
    {
      id: "openai",
      nome: "OpenAI API Direta",
      tipo: "api_key",
      descricao: "Suporte direto a Function Calling e Tool Use para o agente Go.",
      loginUrl: "https://platform.openai.com/api-keys",
      loginUrlLabel: "OpenAI Keys",
      envVar: "OPENAI_API_KEY",
      modelosSugeridos: ["gpt-4o-mini", "o3-mini"],
    },
    {
      id: "anthropic",
      nome: "Anthropic API Direta",
      tipo: "api_key",
      descricao: "Inferência direta Claude para raciocínio em tarefas de código.",
      loginUrl: "https://console.anthropic.com/settings/keys",
      loginUrlLabel: "Console Anthropic",
      envVar: "ANTHROPIC_API_KEY",
      modelosSugeridos: ["claude-3-7-sonnet"],
    },
  ],
  "claude-code": [
    {
      id: "claude-oauth",
      nome: "Conta Claude Pro / Team (OAuth CLI)",
      tipo: "oauth_cli",
      descricao: "Sessão interativa persistida em ~/.claude/.credentials.json. Não consome créditos de API, utiliza sua assinatura Claude Pro/Team.",
      loginCmd: "claude login",
      loginUrl: "https://claude.ai",
      loginUrlLabel: "Claude.ai",
      modelosSugeridos: ["claude-3-7-sonnet", "claude-3-5-sonnet"],
    },
    {
      id: "anthropic",
      nome: "Anthropic API Key (Pay-as-you-go)",
      tipo: "api_key",
      descricao: "Chave direta da API da Anthropic para execução headless ou via CI/CD.",
      loginUrl: "https://console.anthropic.com/settings/keys",
      loginUrlLabel: "Console Anthropic",
      envVar: "ANTHROPIC_API_KEY",
      modelosSugeridos: ["claude-3-7-sonnet", "claude-3-5-haiku"],
    },
  ],
  antigravity: [
    {
      id: "google",
      nome: "Google AI Studio (Gemini 2.5/3.8 Flash)",
      tipo: "api_key",
      descricao: "Chave oficial do Google AI Studio. Custo $0 com limites generosos para Gemini Flash.",
      loginUrl: "https://aistudio.google.com/app/apikey",
      loginUrlLabel: "Google AI Studio",
      envVar: "GEMINI_API_KEY",
      modelosSugeridos: ["gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.5-pro"],
    },
    {
      id: "antigravity-runtime",
      nome: "Google Antigravity Runtime (AGY CLI)",
      tipo: "oauth_cli",
      descricao: "Runtime do sistema com suporte a skills, plugins e workflows corporativos do Antigravity.",
      loginCmd: "agy login",
      loginUrl: "https://cloud.google.com",
      loginUrlLabel: "Google Cloud Console",
      modelosSugeridos: ["gemini-3.8-flash"],
    },
  ],
  copilot: [
    {
      id: "copilot-device",
      nome: "GitHub Copilot Device Code (CLI Auth)",
      tipo: "oauth_cli",
      descricao: "Autenticação oficial do GitHub Copilot CLI via código no navegador. Utiliza sua assinatura Copilot Individual/Business/Enterprise.",
      loginCmd: "copilot login --device-code",
      loginUrl: "https://github.com/login/device",
      loginUrlLabel: "GitHub Device Login",
      modelosSugeridos: ["claude-3.7-sonnet", "gpt-4o", "o3-mini"],
    },
    {
      id: "github-token",
      nome: "GitHub CLI Token (gh auth token)",
      tipo: "token",
      descricao: "Token capturado automaticamente do GitHub CLI ou variável de ambiente GITHUB_TOKEN.",
      loginCmd: "gh auth login",
      loginUrl: "https://github.com/settings/tokens",
      loginUrlLabel: "GitHub Tokens",
      envVar: "GITHUB_TOKEN",
      modelosSugeridos: ["copilot-default"],
    },
  ],
  cursor: [
    {
      id: "cursor-account",
      nome: "Conta Cursor (OAuth Device Login)",
      tipo: "oauth_cli",
      descricao: "Login oficial no CLI do Cursor Agent headless. Utiliza seu plano Cursor Pro / Business.",
      loginCmd: "agent login",
      loginUrl: "https://www.cursor.com/settings",
      loginUrlLabel: "Cursor Settings",
      modelosSugeridos: ["cursor-fast", "claude-3.7-sonnet", "gpt-4o"],
    },
    {
      id: "cursor-api",
      nome: "Cursor API Key Direta",
      tipo: "api_key",
      descricao: "Chave de API gerada em cursor.com/settings para execuções automatizadas sem terminal interativo.",
      loginUrl: "https://www.cursor.com/settings",
      loginUrlLabel: "Cursor Settings",
      envVar: "CURSOR_API_KEY",
      modelosSugeridos: ["cursor-small", "claude-3.5-sonnet"],
    },
  ],
  codex: [
    {
      id: "codex-oauth",
      nome: "OpenAI Codex CLI Session (Device Auth)",
      tipo: "oauth_cli",
      descricao: "Autenticação de terminal para o runtime oficial OpenAI Codex CLI com isolamento em sandbox.",
      loginCmd: "codex login --device-auth",
      loginUrl: "https://platform.openai.com/account",
      loginUrlLabel: "OpenAI Account",
      modelosSugeridos: ["codex-1", "gpt-4o"],
    },
    {
      id: "openai",
      nome: "OpenAI API Key Direta",
      tipo: "api_key",
      descricao: "Chave de API padrão da OpenAI para chamadas à API com quota pay-as-you-go.",
      loginUrl: "https://platform.openai.com/api-keys",
      loginUrlLabel: "OpenAI API Keys",
      envVar: "OPENAI_API_KEY",
      modelosSugeridos: ["gpt-4o-mini", "o3-mini"],
    },
  ],
  aider: [
    {
      id: "openrouter",
      nome: "OpenRouter (BYOK Custo $0)",
      tipo: "api_key",
      descricao: "Acesso a modelos de ponta com streaming de diffs no Aider.",
      loginUrl: "https://openrouter.ai/keys",
      loginUrlLabel: "Chaves OpenRouter",
      envVar: "OPENROUTER_API_KEY",
      modelosSugeridos: ["google/gemini-3.8-flash", "deepseek/deepseek-chat"],
    },
    {
      id: "anthropic",
      nome: "Anthropic Claude Direto",
      tipo: "api_key",
      descricao: "Melhor experiência de pair programming com Claude 3.7 Sonnet no Aider.",
      loginUrl: "https://console.anthropic.com/settings/keys",
      loginUrlLabel: "Console Anthropic",
      envVar: "ANTHROPIC_API_KEY",
      modelosSugeridos: ["claude-3-7-sonnet"],
    },
    {
      id: "openai",
      nome: "OpenAI API Direta",
      tipo: "api_key",
      descricao: "Suporte completo a modelos GPT-4o e modo arquiteto do Aider.",
      loginUrl: "https://platform.openai.com/api-keys",
      loginUrlLabel: "OpenAI API Keys",
      envVar: "OPENAI_API_KEY",
      modelosSugeridos: ["gpt-4o", "o3-mini"],
    },
    {
      id: "google",
      nome: "Google AI Studio (Gemini Flash)",
      tipo: "api_key",
      descricao: "Execução rápida e de alta capacidade de contexto para diffs grandes.",
      loginUrl: "https://aistudio.google.com/app/apikey",
      loginUrlLabel: "Google AI Studio",
      envVar: "GEMINI_API_KEY",
      modelosSugeridos: ["gemini-2.5-pro", "gemini-2.5-flash"],
    },
  ],
};

const LINKS_LOGIN: Record<string, { label: string; url: string }> = {
  openrouter: { label: "Chaves OpenRouter", url: "https://openrouter.ai/keys" },
  "opencode-go": { label: "OpenCode AI", url: "https://opencode.ai" },
  anthropic: { label: "Console Anthropic", url: "https://console.anthropic.com/settings/keys" },
  "claude-code": { label: "Console Anthropic", url: "https://console.anthropic.com/settings/keys" },
  google: { label: "AI Studio", url: "https://aistudio.google.com/app/apikey" },
  antigravity: { label: "AI Studio", url: "https://aistudio.google.com/app/apikey" },
  openai: { label: "OpenAI Keys", url: "https://platform.openai.com/api-keys" },
  codex: { label: "OpenAI Keys", url: "https://platform.openai.com/api-keys" },
  cursor: { label: "Cursor Settings", url: "https://www.cursor.com/settings" },
  copilot: { label: "GitHub Tokens", url: "https://github.com/settings/tokens?type=beta" },
  aider: { label: "Aider Docs", url: "https://aider.chat" },
};

export type TabConfigId =
  | "motores"
  | "limites"
  | "modelos"
  | "orcamento"
  | "seguranca"
  | "scheduler"
  | "workspace"
  | "testes"
  | "reunioes"
  | "chaves"
  | "ferramentas"
  | "geral";

export const ABAS_CONFIG: Array<{ id: TabConfigId; label: string; icon: any }> = [
  { id: "motores", label: "Motores & Provedores", icon: Bot },
  { id: "limites", label: "Limites dos Motores", icon: Activity },
  { id: "modelos", label: "Modelos", icon: Cpu },
  { id: "orcamento", label: "Orçamento", icon: Coins },
  { id: "seguranca", label: "Segurança", icon: Shield },
  { id: "scheduler", label: "Scheduler", icon: Clock },
  { id: "workspace", label: "Workspace", icon: Folder },
  { id: "testes", label: "Testes", icon: CircleCheck },
  { id: "reunioes", label: "Reuniões", icon: Users },
  { id: "chaves", label: "Chaves de API & Secrets", icon: Key },
  { id: "ferramentas", label: "Ferramentas", icon: Wrench },
  { id: "geral", label: "Geral", icon: Settings },
];

export const ConfigView: Component = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const abaAtiva = () => (searchParams.tab as TabConfigId) || "motores";
  const setAbaAtiva = (tab: TabConfigId) => setSearchParams({ tab });

  // Escopo de Configuração: Global vs Workspace
  const [escopoConfig, setEscopoConfig] = createSignal<"global" | "workspace">("global");

  const [settings, setSettings] = createSignal<any>({});
  const [todasEntradas, setTodasEntradas] = createSignal<Array<{ chave: string; valor: any; origem: string }>>([]);
  const [toolsLista, setToolsLista] = createSignal<any[]>([]);
  const [carregandoTools, setCarregandoTools] = createSignal(false);
  const [secretsLista, setSecretsLista] = createSignal<Array<{ nome: string; definido: boolean }>>([]);
  const [novoSecretNome, setNovoSecretNome] = createSignal("");
  const [novoSecretValor, setNovoSecretValor] = createSignal("");
  const [salvandoSecret, setSalvandoSecret] = createSignal(false);
  const [salvando, setSalvando] = createSignal(false);

  // Estado dos Motores e Diagnóstico
  const [statusMotores, setStatusMotores] = createSignal<any>(null);
  const [carregandoMotores, setCarregandoMotores] = createSignal(false);
  const [opencodePath, setOpencodePath] = createSignal("opencode");
  const [opencodeTimeout, setOpencodeTimeout] = createSignal(20);
  const [motorSelecionadoTab, setMotorSelecionadoTab] = createSignal<string>("opencode");
  const [limitesMotores, setLimitesMotores] = createSignal<Record<string, any>>({});
  const [salvandoLimites, setSalvandoLimites] = createSignal(false);
  const [contasPorMotor, setContasPorMotor] = createSignal<any[]>([]);
  const [tokensMotores, setTokensMotores] = createSignal<Record<string, any>>({});
  const [carregandoTokens, setCarregandoTokens] = createSignal(false);
  const [tokensContas, setTokensContas] = createSignal<Record<string, any>>({});
  const [consultandoConta, setConsultandoConta] = createSignal<string | null>(null);

  const motores = () => statusMotores()?.motores || [];
  const currentMotor = () => {
    const list = motores();
    return list.find((m: any) => m.id === motorSelecionadoTab()) || list[0] || {
      id: "opencode",
      name: "OpenCode Engine",
      description: "Runtime nativo de execução com sandbox e suporte multi-modelo",
      category: "REACTIVE CODEBASE AGENT",
      maintainer: "@opencorp",
      installed: true,
      ativo: true,
      isManaged: true,
      path: "opencode",
      version: "v0.7.0",
    };
  };

  // Sub-provedores que pertencem ao ecossistema de cada motor
  const SUB_PROVEDORES: Record<string, string[]> = {
    opencode: ["opencode", "opencode-go"],
  };

  /** Filtra contas que pertencem ao motor atual (incluindo sub-provedores) */
  const contasDoMotorAtual = () => {
    const motorId = currentMotor().id;
    const ids = SUB_PROVEDORES[motorId] || [motorId];
    return contasPorMotor().filter((c) => ids.includes(c.motorId));
  };

  const getProvedorStatus = (prov: ProvedorAgenteItem, motor: any) => {
    // 1. Provedor padrão no statusMotores()?.provedores
    const provPadrao = (statusMotores()?.provedores || []).find((p: any) => p.id === prov.id);
    if (provPadrao) {
      return {
        conectado: Boolean(provPadrao.conectado),
        detalhe: provPadrao.previewChave || (provPadrao.conectado ? "Chave configurada" : "Não configurado"),
        isDirectKey: true,
        provPadrao,
      };
    }

    // 2. Método via OAuth CLI ou Token de terminal
    if (prov.tipo === "oauth_cli" || prov.tipo === "token") {
      const auth = motor?.authStatus;
      const isAuthThisMethod = Boolean(
        auth?.authenticated && (
          auth.method?.toLowerCase().includes(prov.id.split("-")[0]) ||
          auth.details?.toLowerCase().includes(prov.id.split("-")[0]) ||
          (prov.id === "claude-oauth" && auth.method?.toLowerCase().includes("oauth")) ||
          (prov.id === "copilot-device" && (auth.method?.toLowerCase().includes("github") || auth.details?.toLowerCase().includes("github"))) ||
          (prov.id === "github-token" && (auth.method?.toLowerCase().includes("token") || auth.method?.toLowerCase().includes("gh"))) ||
          (prov.id === "cursor-account" && auth.method?.toLowerCase().includes("cursor")) ||
          (prov.id === "codex-oauth" && auth.method?.toLowerCase().includes("codex")) ||
          (prov.id === "antigravity-runtime" && (auth.method?.toLowerCase().includes("agy") || auth.method?.toLowerCase().includes("sistema")))
        )
      );
      return {
        conectado: isAuthThisMethod,
        detalhe: isAuthThisMethod ? (auth?.details || auth?.method || "Sessão Ativa") : "Requer autenticação",
        isDirectKey: false,
      };
    }

    // 3. Chave de API direta específica (ex: cursor-api)
    if (prov.id === "cursor-api") {
      const hasCursorKey = Boolean(motor?.authStatus?.method?.includes("CURSOR_API_KEY"));
      return {
        conectado: hasCursorKey,
        detalhe: hasCursorKey ? "CURSOR_API_KEY ativa" : "Não configurado",
        isDirectKey: true,
      };
    }

    return {
      conectado: false,
      detalhe: "Não configurado",
      isDirectKey: false,
    };
  };

  // Estado das Chaves de API
  const [chavesApi, setChavesApi] = createSignal<any>({ global: { chaves: [] }, workspace: { chaves: [], herdadas: [] } });
  const [carregandoChaves, setCarregandoChaves] = createSignal(false);
  const [novoProvider, setNovoProvider] = createSignal("openrouter");
  const [novaChaveValor, setNovaChaveValor] = createSignal("");
  const [novoEscopo, setNovoEscopo] = createSignal<"global" | "workspace">("global");
  const [salvandoChave, setSalvandoChave] = createSignal(false);

  // Estado dos Modelos e Fallback
  const [modeloPrincipal, setModeloPrincipal] = createSignal("openrouter/google/gemini-3.8-flash");
  const [modeloCustomizado, setModeloCustomizado] = createSignal("");
  const [ordemFallback, setOrdemFallback] = createSignal(
    "openrouter/google/gemini-3.8-flash\nopenrouter/nvidia/nemotron-3.5-lightning:free\nopenrouter/nvidia/nemotron-3-ultra-550b-a55b:free\nopenrouter/minimax/minimax-m3:free"
  );
  const [acessoTotalGlobal, setAcessoTotalGlobal] = createSignal(false);
  const [aplicandoEmTodos, setAplicandoEmTodos] = createSignal(false);

  // Testes de Conectividade de Modelos e Provedores
  const [testandoModelo, setTestandoModelo] = createSignal<string | null>(null);
  const [resultadoTeste, setResultadoTeste] = createSignal<Record<string, any>>({});

  // Estado da Política de Segurança
  const [nivelSeguranca, setNivelSeguranca] = createSignal<"permissive" | "standard" | "strict">("permissive");
  const [allowlistRede, setAllowlistRede] = createSignal("pulso-diario.wp.crom.me, *.crom.me, *.wp.crom.me, github.com, registry.npmjs.org");
  const [promptRegras, setPromptRegras] = createSignal("Permitir curl, inspeção de páginas e comandos de rotina de agentes sem requerer aprovação manual.");
  const [autoAprovarRotinas, setAutoAprovarRotinas] = createSignal(true);

  const carregarTools = async () => {
    setCarregandoTools(true);
    try {
      const data = await fetchApi<any[]>("/tools");
      setToolsLista(Array.isArray(data) ? data : []);
    } catch {
      setToolsLista([]);
    } finally {
      setCarregandoTools(false);
    }
  };

  const carregarSecrets = async () => {
    try {
      const data = await fetchApi<any[]>("/secrets");
      setSecretsLista(Array.isArray(data) ? data : []);
    } catch {
      setSecretsLista([]);
    }
  };

  const salvarSecret = async () => {
    if (!novoSecretNome().trim() || !novoSecretValor().trim()) {
      showToast("Informe o nome e o valor do segredo", "aviso");
      return;
    }
    setSalvandoSecret(true);
    try {
      await fetchApi("/secrets", {
        method: "POST",
        body: JSON.stringify({
          nome: novoSecretNome().trim(),
          valor: novoSecretValor().trim(),
          escopo: escopoConfig(),
        }),
      });
      showToast(`Segredo "${novoSecretNome()}" salvo!`, "sucesso");
      setNovoSecretNome("");
      setNovoSecretValor("");
      await carregarSecrets();
    } catch (err: any) {
      showToast(`Erro ao salvar secret: ${err.message}`, "erro");
    } finally {
      setSalvandoSecret(false);
    }
  };

  const removerSecret = async (nome: string) => {
    if (!confirm(`Remover segredo "${nome}"?`)) return;
    try {
      await fetchApi(`/secrets/${encodeURIComponent(nome)}?escopo=${escopoConfig()}`, { method: "DELETE" });
      showToast(`Segredo "${nome}" removido`, "sucesso");
      await carregarSecrets();
    } catch (err: any) {
      showToast(`Erro ao remover secret: ${err.message}`, "erro");
    }
  };

  const salvarChaveConfig = async (chave: string, valor: any) => {
    setSalvando(true);
    try {
      let vFinal: any = valor;
      if (typeof valor === "object" && valor !== null) {
        vFinal = JSON.stringify(valor);
      } else {
        vFinal = String(valor);
      }
      await fetchApi("/settings", {
        method: "PUT",
        body: JSON.stringify({
          chave,
          valor: vFinal,
          scope: escopoConfig(),
        }),
      });
      showToast(`"${chave}" salvo!`, "sucesso");
      await carregarSettings();
    } catch (err: any) {
      showToast(`Erro ao salvar "${chave}": ${err.message}`, "erro");
    } finally {
      setSalvando(false);
    }
  };

  const carregarSettings = async () => {
    try {
      const data = await fetchApi<any>(`/settings?escopo=${escopoConfig()}`);
      if (Array.isArray(data)) {
        setTodasEntradas(data);
      }
      setSettings(data || {});
    } catch {}

    try {
      const mod = await fetchApi<any>("/settings/modelos");
      if (mod) {
        if (mod.default_model) setModeloPrincipal(mod.default_model);
        if (Array.isArray(mod.rotation)) setOrdemFallback(mod.rotation.join("\n"));
        if (mod.global_full_access !== undefined) setAcessoTotalGlobal(Boolean(mod.global_full_access));
      }
    } catch {}

    try {
      const sec = await fetchApi<any>("/settings/security");
      if (sec) {
        if (sec.level) setNivelSeguranca(sec.level);
        if (Array.isArray(sec.network_allowlist)) setAllowlistRede(sec.network_allowlist.join(", "));
        if (sec.prompt_regras !== undefined) setPromptRegras(sec.prompt_regras);
        if (sec.auto_aprovar_rotinas !== undefined) setAutoAprovarRotinas(sec.auto_aprovar_rotinas);
        if (sec.global_full_access !== undefined) setAcessoTotalGlobal(Boolean(sec.global_full_access));
      }
    } catch {}
  };

  const SettingRow = (props: {
    chave: string;
    label: string;
    descricao: string;
    tipo?: "text" | "number" | "bool" | "textarea" | "select";
    opcoes?: Array<{ valor: string; label: string }>;
    step?: string;
    min?: string;
  }) => {
    const item = () => todasEntradas().find((e) => e.chave === props.chave);
    const valorAtual = () => {
      const it = item();
      if (!it) return "";
      if (props.tipo === "textarea" && Array.isArray(it.valor)) {
        return it.valor.join("\n");
      }
      return it.valor ?? "";
    };
    const [val, setVal] = createSignal<any>(valorAtual());
    const [modificado, setModificado] = createSignal(false);

    createEffect(() => {
      setVal(valorAtual());
      setModificado(false);
    });

    const origem = () => item()?.origem || "default";

    const handleSalvar = async () => {
      let finalVal: any = val();
      if (props.tipo === "number") {
        finalVal = Number(finalVal);
      } else if (props.tipo === "textarea") {
        finalVal = String(finalVal)
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
      }
      await salvarChaveConfig(props.chave, finalVal);
      setModificado(false);
    };

    const badgeClass = () => {
      const o = origem();
      if (o === "workspace") return "text-purple-400 bg-purple-950/40 border-purple-800/40";
      if (o === "global") return "text-cyan-400 bg-cyan-950/40 border-cyan-800/40";
      return "text-zinc-400 bg-zinc-800/40 border-zinc-700/40";
    };

    return (
      <div class="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-transparent">
        <div class="space-y-0.5 max-w-md sm:max-w-lg">
          <div class="flex items-center gap-2">
            <span class="text-xs font-medium text-zinc-200">{props.label}</span>
            <span class={`text-[10px] font-mono px-1.5 py-0.2 rounded border ${badgeClass()}`}>
              {origem()}
            </span>
          </div>
          <p class="text-[11px] text-zinc-500 leading-relaxed">{props.descricao}</p>
          <span class="text-[10px] font-mono text-zinc-600 block">{props.chave}</span>
        </div>

        <div class="flex items-center gap-2 shrink-0 self-start sm:self-center">
          <Show when={props.tipo === "bool"}>
            <button
              type="button"
              class={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                Boolean(val()) ? "bg-zinc-200" : "bg-zinc-800"
              }`}
              onClick={async () => {
                const novo = !Boolean(val());
                setVal(novo);
                await salvarChaveConfig(props.chave, novo);
              }}
            >
              <span
                class={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-zinc-950 shadow-sm ring-0 transition duration-200 ease-in-out ${
                  Boolean(val()) ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </Show>

          <Show when={props.tipo === "select"}>
            <select
              value={String(val())}
              onChange={(e) => {
                setVal(e.currentTarget.value);
                void salvarChaveConfig(props.chave, e.currentTarget.value);
              }}
              class="bg-zinc-900/80 border border-zinc-800 rounded-md px-2.5 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600"
            >
              <For each={props.opcoes || []}>
                {(op) => <option value={op.valor}>{op.label}</option>}
              </For>
            </select>
          </Show>

          <Show when={props.tipo === "number"}>
            <div class="flex items-center gap-1.5">
              <input
                type="number"
                step={props.step || "1"}
                min={props.min}
                value={val() ?? ""}
                onInput={(e) => {
                  setVal(e.currentTarget.value);
                  setModificado(true);
                }}
                class="w-24 bg-zinc-900/80 border border-zinc-800 rounded-md px-2 py-1 text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-600 text-right"
              />
              <Show when={modificado()}>
                <Button size="xs" variant="secondary" onClick={handleSalvar} loading={salvando()}>
                  <Check size={11} />
                </Button>
              </Show>
            </div>
          </Show>

          <Show when={!props.tipo || props.tipo === "text"}>
            <div class="flex items-center gap-1.5">
              <input
                type="text"
                value={val() ?? ""}
                onInput={(e) => {
                  setVal(e.currentTarget.value);
                  setModificado(true);
                }}
                class="w-48 sm:w-64 bg-zinc-900/80 border border-zinc-800 rounded-md px-2 py-1 text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-600"
              />
              <Show when={modificado()}>
                <Button size="xs" variant="secondary" onClick={handleSalvar} loading={salvando()}>
                  <Check size={11} />
                </Button>
              </Show>
            </div>
          </Show>

          <Show when={props.tipo === "textarea"}>
            <div class="space-y-1.5 w-full sm:w-80">
              <textarea
                rows={3}
                value={val() ?? ""}
                onInput={(e) => {
                  setVal(e.currentTarget.value);
                  setModificado(true);
                }}
                class="w-full bg-zinc-900/80 border border-zinc-800 rounded-md p-2 text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-600 leading-relaxed"
              />
              <Show when={modificado()}>
                <div class="flex justify-end">
                  <Button size="xs" variant="secondary" onClick={handleSalvar} loading={salvando()}>
                    <Save size={11} class="mr-1" /> Salvar
                  </Button>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    );
  };

  const carregarStatusMotores = async () => {
    setCarregandoMotores(true);
    try {
      const data = await fetchApi<any>("/motores/status");
      if (data && data.ok) {
        setStatusMotores(data);
        if (data.limits) setLimitesMotores(data.limits);
        if (data.contas) setContasPorMotor(data.contas);
        if (data.tokens) setTokensMotores(data.tokens);
        if (data.opencode?.path) setOpencodePath(data.opencode.path);
      }
    } catch (err: any) {
      console.error("Falha ao carregar status dos motores:", err);
    } finally {
      setCarregandoMotores(false);
    }
  };

  const recarregarTokensAoVivo = async (motorId?: string) => {
    setCarregandoTokens(true);
    try {
      if (motorId) {
        const res = await fetchApi<any>(`/api/motores/${encodeURIComponent(motorId)}/tokens`);
        if (res?.tokens) {
          setTokensMotores((prev) => ({ ...prev, [motorId]: res.tokens }));
          showToast(`Quota e tokens de ${motorId} atualizados diretamente do adaptador`, "sucesso");
        }
      } else {
        const res = await fetchApi<any>("/api/motores/tokens");
        if (res?.tokens) {
          setTokensMotores(res.tokens);
          showToast("Tokens de todos os motores atualizados ao vivo diretamente dos adaptadores", "sucesso");
        }
      }
    } catch (err: any) {
      showToast(`Erro ao consultar tokens ao vivo: ${err?.message || err}`, "erro");
    } finally {
      setCarregandoTokens(false);
    }
  };

  const consultarTokensConta = async (motorId: string, contaId: string) => {
    setConsultandoConta(contaId);
    try {
      const res = await fetchApi<any>(`/api/motores/${encodeURIComponent(motorId)}/contas/${encodeURIComponent(contaId)}/tokens`);
      if (res?.tokens) {
        setTokensContas((prev) => ({ ...prev, [contaId]: res.tokens }));
        showToast("Tokens da conta consultados diretamente do adaptador do motor", "sucesso");
      }
    } catch (err: any) {
      showToast(`Erro ao consultar tokens da conta: ${err?.message || err}`, "erro");
    } finally {
      setConsultandoConta(null);
    }
  };

  const salvarLimitesMotores = async (novosLimites: Record<string, any>) => {
    setSalvandoLimites(true);
    try {
      await fetchApi("/api/motores/limites", {
        method: "PUT",
        body: JSON.stringify(novosLimites),
      });
      showToast("Limites dos motores atualizados com sucesso!", "sucesso");
      await carregarStatusMotores();
    } catch (err: any) {
      showToast(`Erro ao salvar limites: ${err.message}`, "erro");
    } finally {
      setSalvandoLimites(false);
    }
  };

  const ativarContaMotor = async (motorId: string, contaId: string) => {
    try {
      await fetchApi(`/api/motores/${encodeURIComponent(motorId)}/contas/${encodeURIComponent(contaId)}/ativar`, {
        method: "POST",
      });
      showToast("Conta ativada como principal do motor!", "sucesso");
      await carregarStatusMotores();
    } catch (err: any) {
      showToast(`Erro ao ativar conta: ${err.message}`, "erro");
    }
  };

  const desconectarContaMotor = async (motorId: string, contaId: string) => {
    try {
      await fetchApi(`/api/motores/${encodeURIComponent(motorId)}/contas/${encodeURIComponent(contaId)}`, {
        method: "DELETE",
      });
      showToast("Conta desconectada com sucesso!", "sucesso");
      await carregarStatusMotores();
    } catch (err: any) {
      showToast(`Erro ao desconectar conta: ${err.message}`, "erro");
    }
  };

  const carregarChaves = async () => {
    setCarregandoChaves(true);
    try {
      const data = await fetchApi<any>("/provider-keys");
      if (data) setChavesApi(data);
    } catch (err: any) {
      console.error("Falha ao carregar chaves:", err);
    } finally {
      setCarregandoChaves(false);
    }
  };

  const testarConexaoModelo = async (model: string) => {
    setTestandoModelo(model);
    try {
      const res = await fetchApi<any>("/llm/test", {
        method: "POST",
        body: JSON.stringify({ model }),
      });
      setResultadoTeste((prev) => ({ ...prev, [model]: res }));
      if (res.ok) {
        showToast(`Modelo respondendo com sucesso (${res.ms}ms)! ${res.is_byok ? "• BYOK Custo $0" : ""}`, "sucesso");
      } else {
        showToast(`Falha no teste: ${res.error || "Erro na API"}`, "erro");
      }
    } catch (err: any) {
      setResultadoTeste((prev) => ({ ...prev, [model]: { ok: false, error: err.message } }));
      showToast(`Erro ao testar: ${err.message}`, "erro");
    } finally {
      setTestandoModelo(null);
    }
  };

  const adicionarChave = async () => {
    const prov = novoProvider().trim();
    const chave = novaChaveValor().trim();
    if (!chave) {
      showToast("Insira a chave de API", "aviso");
      return;
    }
    setSalvandoChave(true);
    try {
      await fetchApi("/provider-keys", {
        method: "PUT",
        body: JSON.stringify({
          provider: prov,
          key: chave,
          escopo: novoEscopo(),
        }),
      });
      showToast(`Chave do provedor ${prov} salva com sucesso!`, "sucesso");
      setNovaChaveValor("");
      await carregarChaves();
      await carregarStatusMotores();
    } catch (err: any) {
      showToast("Erro ao salvar chave: " + err.message, "erro");
    } finally {
      setSalvandoChave(false);
    }
  };

  const removerChave = async (provider: string, escopo: string) => {
    if (!confirm(`Deseja remover a chave do provedor "${provider}" no escopo ${escopo}?`)) return;
    try {
      await fetchApi(`/provider-keys/${encodeURIComponent(provider)}?escopo=${escopo}`, {
        method: "DELETE",
      });
      showToast(`Chave ${provider} removida`, "sucesso");
      await carregarChaves();
      await carregarStatusMotores();
    } catch (err: any) {
      showToast("Erro ao remover: " + err.message, "erro");
    }
  };

  const desconectarProvedor = async (provider: string) => {
    if (!confirm(`Desconectar o provedor "${provider}"? A chave de API será removida e o provedor ficará inativo.`)) return;
    try {
      // Tenta remover no escopo global primeiro, depois workspace
      await fetchApi(`/provider-keys/${encodeURIComponent(provider)}?escopo=global`, { method: "DELETE" }).catch(() => {});
      if (wsAtivo()) {
        await fetchApi(`/provider-keys/${encodeURIComponent(provider)}?escopo=workspace`, { method: "DELETE" }).catch(() => {});
      }
      showToast(`Provedor "${provider}" desconectado com sucesso`, "sucesso");
      await carregarStatusMotores();
      await carregarChaves();
    } catch (err: any) {
      showToast(`Erro ao desconectar provedor: ${err.message}`, "erro");
    }
  };

  const [instalandoMotor, setInstalandoMotor] = createSignal<string | null>(null);
  const [testandoMotor, setTestandoMotor] = createSignal<string | null>(null);

  const instalarMotor = async (id: string) => {
    setInstalandoMotor(id);
    try {
      showToast(`Iniciando instalação isolada de ${id} em ~/.opencorp/bin/...`, "aviso");
      const res = await fetchApi<any>(`/api/motores/${encodeURIComponent(id)}/install`, {
        method: "POST",
      });
      showToast(res.log || `Motor ${id} instalado com sucesso!`, "sucesso");
      await carregarStatusMotores();
    } catch (err: any) {
      showToast(`Falha ao instalar motor ${id}: ${err.message}`, "erro");
    } finally {
      setInstalandoMotor(null);
    }
  };

  const testarMotor = async (id: string) => {
    setTestandoMotor(id);
    try {
      const res = await fetchApi<any>(`/api/motores/${encodeURIComponent(id)}/test`, {
        method: "POST",
      });
      if (res.health?.healthy) {
        showToast(`[${id}] ${res.health.statusText}`, "sucesso");
      } else {
        showToast(`[${id}] ${res.health?.statusText || "Falha no diagnóstico"}`, "erro");
      }
      await carregarStatusMotores();
    } catch (err: any) {
      showToast(`Erro ao testar ${id}: ${err.message}`, "erro");
    } finally {
      setTestandoMotor(null);
    }
  };

  const [conectandoMotor, setConectandoMotor] = createSignal<string | null>(null);
  const [desconectandoMotor, setDesconectandoMotor] = createSignal<string | null>(null);
  const [motorSelecionadoAuth, setMotorSelecionadoAuth] = createSignal<any | null>(null);

  const conectarMotor = async (id: string) => {
    setConectandoMotor(id);
    try {
      const res = await fetchApi<any>(`/api/motores/${encodeURIComponent(id)}/conectar`, {
        method: "POST",
      });
      showToast(`Motor "${id}" conectado e definido como o motor ativo padrão!`, "sucesso");
      await carregarStatusMotores();
    } catch (err: any) {
      const m = motores().find((x) => x.id === id);
      if (err?.message?.includes("requer autenticação") || err?.message?.includes("não pode ser ativado")) {
        showToast(err.message, "aviso");
        if (m) setMotorSelecionadoAuth(m);
      } else {
        showToast(`Erro ao conectar motor ${id}: ${err.message}`, "erro");
      }
    } finally {
      setConectandoMotor(null);
    }
  };

  const desconectarMotor = async (id: string) => {
    setDesconectandoMotor(id);
    try {
      await fetchApi<any>(`/api/motores/${encodeURIComponent(id)}/desconectar`, {
        method: "POST",
      });
      showToast(`Motor "${id}" desconectado. OpenCode redefinido como padrão do sistema.`, "sucesso");
      await carregarStatusMotores();
    } catch (err: any) {
      showToast(`Erro ao desconectar motor ${id}: ${err.message}`, "erro");
    } finally {
      setDesconectandoMotor(null);
    }
  };

  const salvarModelos = async () => {
    setSalvando(true);
    try {
      const modFinal = modeloPrincipal() === "__custom__" ? modeloCustomizado().trim() : modeloPrincipal().trim();
      if (!modFinal) {
        showToast("Informe um modelo válido", "aviso");
        return;
      }

      const listaFallback = ordemFallback()
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      await fetchApi("/settings/modelos", {
        method: "PUT",
        body: JSON.stringify({
          default_model: modFinal,
          rotation: listaFallback,
          global_full_access: acessoTotalGlobal(),
        }),
      });

      showToast("Configurações de modelos salvas com sucesso!", "sucesso");
      await carregarSettings();
    } catch (err: any) {
      showToast("Erro ao salvar modelos: " + err.message, "erro");
    } finally {
      setSalvando(false);
    }
  };

  const aplicarModeloEmTodos = async () => {
    const modFinal = modeloPrincipal() === "__custom__" ? modeloCustomizado().trim() : modeloPrincipal().trim();
    if (!confirm(`Definir "${modFinal}" como modelo ativo para TODOS os agentes deste workspace?`)) return;

    setAplicandoEmTodos(true);
    try {
      const res = await fetchApi<any>("/agents/aplicar-modelo-global", {
        method: "POST",
        body: JSON.stringify({ model: modFinal }),
      });
      showToast(`${res.alterados || 0} agentes atualizados para "${modFinal}"!`, "sucesso");
    } catch (err: any) {
      showToast("Erro ao aplicar nos agentes: " + err.message, "erro");
    } finally {
      setAplicandoEmTodos(false);
    }
  };

  const salvarSeguranca = async () => {
    setSalvando(true);
    try {
      const listaRede = allowlistRede().split(",").map((s) => s.trim()).filter(Boolean);
      await fetchApi("/settings/security", {
        method: "PUT",
        body: JSON.stringify({
          level: nivelSeguranca(),
          network_allowlist: listaRede,
          prompt_regras: promptRegras(),
          auto_aprovar_rotinas: autoAprovarRotinas(),
        }),
      });
      showToast("Política de segurança atualizada!", "sucesso");
    } catch (err: any) {
      showToast("Erro ao salvar: " + err.message, "erro");
    } finally {
      setSalvando(false);
    }
  };

  const salvarMotores = async () => {
    setSalvando(true);
    try {
      await fetchApi("/settings", {
        method: "PUT",
        body: JSON.stringify({
          runner: {
            engine: "opencode",
            binary_path: opencodePath().trim() || "opencode",
            timeout_min: opencodeTimeout(),
          },
        }),
      });
      showToast("Configuração do OpenCode atualizada!", "sucesso");
      await carregarStatusMotores();
    } catch (err: any) {
      showToast("Erro ao salvar: " + err.message, "erro");
    } finally {
      setSalvando(false);
    }
  };

  onMount(() => {
    void carregarSettings();
    void carregarStatusMotores();
    void carregarChaves();
    void carregarTools();
    void carregarSecrets();
  });

  return (
    <div class="flex flex-col h-full p-3.5 sm:p-6 space-y-4 overflow-y-auto overflow-x-hidden scrollbar-thin">
      <div class="pb-2 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 class="text-base sm:text-lg font-bold text-zinc-100 tracking-tight">Configurações do Sistema</h1>
          <p class="text-xs text-zinc-400">
            Governança, motores de agentes autônomos, inferência direta e catálogo de inteligência.
          </p>
        </div>

        {/* SELETOR DE ESCOPO: GLOBAL VS WORKSPACE */}
        <div class="flex items-center bg-zinc-950 p-1 rounded-xl border border-zinc-800 w-full sm:w-auto">
          <button
            class={`flex-1 sm:flex-initial justify-center px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              escopoConfig() === "global"
                ? "bg-cyan-600 text-white shadow-xs"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
            onClick={() => {
              setEscopoConfig("global");
              void carregarSettings();
            }}
          >
            <Layers size={13} class="shrink-0" />
            <span>Global (Sistema)</span>
          </button>
          <button
            class={`flex-1 sm:flex-initial justify-center px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              escopoConfig() === "workspace"
                ? "bg-purple-600 text-white shadow-xs"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
            onClick={() => {
              if (!wsAtivo()) {
                showToast("Nenhum workspace ativo no momento", "aviso");
                return;
              }
              setEscopoConfig("workspace");
              void carregarSettings();
            }}
          >
            <Bot size={13} class="shrink-0" />
            <span class="truncate">Workspace: {wsAtivo() || "Nenhum"}</span>
          </button>
        </div>
      </div>

      {/* Indicador visual de escopo ativo */}
      <div class="py-1 flex items-center justify-between text-xs bg-transparent">
        <Show when={escopoConfig() === "global"}>
          <div class="flex items-center gap-2 text-cyan-400">
            <span class="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
            <span class="font-medium">Escopo Global:</span>
            <span class="text-zinc-400 truncate">Configurações padrão para todas as empresas.</span>
          </div>
        </Show>
        <Show when={escopoConfig() === "workspace"}>
          <div class="flex items-center gap-2 text-purple-400">
            <span class="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
            <span class="font-medium">Escopo Workspace:</span>
            <span class="text-zinc-400 truncate">Configurações exclusivas de "{wsAtivo()}".</span>
          </div>
        </Show>
      </div>

      {/* Abas de Navegação (Scroll horizontal suave no mobile, wrap no desktop) */}
      <div class="flex items-center gap-1.5 border-b border-zinc-800/40 pb-2.5 shrink-0 overflow-x-auto scrollbar-none -mx-3.5 px-3.5 sm:mx-0 sm:px-0 sm:flex-wrap">
        <For each={ABAS_CONFIG}>
          {(aba) => {
            const Icon = aba.icon;
            const ativa = () => abaAtiva() === aba.id;
            return (
              <button
                type="button"
                class={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap ${
                  ativa()
                    ? "text-zinc-100 bg-zinc-800/80 font-semibold shadow-xs"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30"
                }`}
                onClick={() => setAbaAtiva(aba.id)}
              >
                <Icon size={13} class={ativa() ? "text-zinc-200" : "text-zinc-500"} />
                {aba.label}
              </button>
            );
          }}
        </For>
      </div>

      {/* Conteúdo da Aba Ativa */}
      <div class="w-full max-w-6xl space-y-6">
        {/* ─────────────────────────────────────────────────────────────
            ABA MOTORES & OPENCODE (Clean, transparente, sem bordas)
           ───────────────────────────────────────────────────────────── */}
        <Show when={abaAtiva() === "motores"}>
          <div class="space-y-6 bg-transparent">
            {/* CABEÇALHO */}
            <div class="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-zinc-800/40 gap-2">
              <div>
                <h2 class="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                  <Bot size={15} class="text-zinc-400 shrink-0" />
                  <span>Diagnóstico dos Motores e Runtimes de Execução</span>
                </h2>
                <p class="text-xs text-zinc-400 mt-0.5">
                  Ambiente de execução autônoma dos agentes corporativos e status em tempo real.
                </p>
              </div>
              <Button
                size="xs"
                variant="ghost"
                class="self-start sm:self-auto border border-zinc-800/50"
                loading={carregandoMotores()}
                onClick={carregarStatusMotores}
                title="Atualizar diagnóstico agora"
              >
                <RefreshCw size={12} class="mr-1" /> Atualizar
              </Button>
            </div>

            {/* BANNER DE MOTOR ATIVO & DAEMONS (Clean, transparente) */}
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2.5 border-b border-zinc-800/40 text-xs">
              <div class="flex items-center gap-2.5 min-w-0">
                <div class="h-6 w-6 rounded-md bg-zinc-800/50 flex items-center justify-center text-zinc-300 shrink-0">
                  <Cpu size={13} />
                </div>
                <div class="flex items-center gap-1.5 flex-wrap min-w-0">
                  <span class="text-zinc-400">Motor Ativo:</span>
                  <span class="font-semibold text-zinc-100 font-mono">
                    {statusMotores()?.motor_ativo || statusMotores()?.runner?.engine || "opencode"}
                  </span>
                  <span class="text-[10px] font-mono text-zinc-300 px-1.5 py-0.5 rounded bg-zinc-800/70">
                    PADRÃO
                  </span>
                  <span class="hidden sm:inline-block text-[11px] text-zinc-500 font-mono truncate max-w-[200px]">
                    ({statusMotores()?.runner?.binary_path || "opencode"})
                  </span>
                </div>
              </div>

              <div class="flex items-center gap-3 text-[11px] font-mono text-zinc-400 flex-wrap">
                <span class="flex items-center gap-1.5">
                  <span
                    class={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      statusMotores()?.daemons?.scheduler?.ativo ? "bg-emerald-400" : "bg-zinc-600"
                    }`}
                  />
                  Scheduler ({statusMotores()?.daemons?.scheduler?.pid || "ativo"})
                </span>
                <span class="flex items-center gap-1.5">
                  <span
                    class={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      statusMotores()?.daemons?.secretario?.ativo ? "bg-emerald-400" : "bg-zinc-600"
                    }`}
                  />
                  Secretário ({statusMotores()?.daemons?.secretario?.porta ? `porta ${statusMotores()?.daemons?.secretario?.porta}` : "online"})
                </span>
              </div>
            </div>

            {/* SELEÇÃO E CONTROLE POR ABAS DE AGENTES */}
            <div class="space-y-4">
              <div class="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <span class="text-xs font-semibold text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
                    <Bot size={13} class="text-zinc-400" /> Motores & Agentes Autônomos
                  </span>
                  <p class="text-[11px] text-zinc-400 mt-0.5">
                    Selecione um agente para gerenciar credenciais, definir o executor padrão do sistema e configurar provedores compatíveis.
                  </p>
                </div>
                <span class="text-[11px] text-zinc-500 font-mono">
                  Gerenciamento isolado em ~/.opencorp/bin/
                </span>
              </div>

              {/* BARRA HORIZONTAL DE ABAS DE CADA AGENTE (Clean, sem borda, minimalista) */}
              <div class="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-none border-b border-zinc-800/40 -mx-3.5 px-3.5 sm:mx-0 sm:px-0">
                <For each={statusMotores()?.motores || []}>
                  {(mot: any) => {
                    const isSelected = () => motorSelecionadoTab() === mot.id;
                    const isAtivo = () => Boolean(mot.ativo);
                    return (
                      <button
                        type="button"
                        data-engine-id={mot.id}
                        onClick={() => setMotorSelecionadoTab(mot.id)}
                        class={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
                          isSelected()
                            ? "bg-zinc-800 text-zinc-100 font-semibold"
                            : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30"
                        }`}
                      >
                        <span
                          class={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            isAtivo()
                              ? "bg-emerald-400"
                              : mot.installed
                              ? "bg-zinc-400"
                              : "bg-zinc-600"
                          }`}
                        />
                        <span class="whitespace-nowrap">{mot.name}</span>
                        <Show when={isAtivo()}>
                          <span class="flex items-center gap-0.5 text-[9px] font-mono uppercase text-zinc-300 px-1 py-0.2 rounded bg-zinc-700/50">
                            <Star size={9} class="fill-current text-zinc-300 shrink-0" />
                            PADRÃO
                          </span>
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </div>

              {/* CONTEÚDO DO AGENTE SELECIONADO (Fundo transparente, sem bordas pesadas) */}
              <div class="space-y-4 pt-1 bg-transparent">
                {/* CABEÇALHO DO AGENTE E METADADOS */}
                <div class="flex items-start justify-between gap-3 flex-wrap">
                  <div class="space-y-1 min-w-0 flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                      <h3 class="text-sm font-semibold text-zinc-100">{currentMotor().name}</h3>
                      <span class="text-[10px] font-mono uppercase text-zinc-400">
                        {currentMotor().category}
                      </span>
                      <Show when={currentMotor().maintainer}>
                        <span class="text-[10px] font-mono text-zinc-500">
                          • {currentMotor().maintainer}
                        </span>
                      </Show>
                    </div>
                    <p class="text-xs text-zinc-400 leading-relaxed">
                      {currentMotor().description}
                    </p>
                  </div>

                  {/* STATUS DO AGENTE */}
                  <div class="shrink-0 flex items-center gap-2">
                    <Show
                      when={currentMotor().installed}
                      fallback={
                        <span class="text-[11px] font-mono text-zinc-500">
                          Disponível para instalação
                        </span>
                      }
                    >
                      <Show
                        when={currentMotor().ativo}
                        fallback={
                          <span class="text-[11px] font-mono text-zinc-400 flex items-center gap-1.5">
                            <span class="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                            {currentMotor().isManaged ? "Isolado em ~/.opencorp/bin" : "Binário do Sistema"}
                          </span>
                        }
                      >
                        <span class="text-[11px] font-mono font-medium text-zinc-200 flex items-center gap-1.5">
                          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          MOTOR PADRÃO ATIVO
                        </span>
                      </Show>
                    </Show>
                  </div>
                </div>

                {/* BOTÃO E DESTAQUE: DEFINIR COMO MOTOR PADRÃO (Clean & funcional) */}
                <div class="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-y border-zinc-800/40">
                  <Show
                    when={currentMotor().ativo}
                    fallback={
                      <>
                        <div>
                          <span class="text-xs font-medium text-zinc-200 block">
                            Executor padrão do sistema
                          </span>
                          <span class="text-[11px] text-zinc-400">
                            Executar tarefas autônomas, rotinas e chamadas ReAct com {currentMotor().name}.
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          class="font-medium text-xs px-3 py-1.5 whitespace-nowrap flex items-center gap-1.5 shrink-0"
                          loading={conectandoMotor() === currentMotor().id}
                          disabled={!currentMotor().installed}
                          onClick={() => conectarMotor(currentMotor().id)}
                          title={
                            currentMotor().installed
                              ? "Definir este motor como o executor ativo padrão"
                              : "Instale o motor primeiro"
                          }
                        >
                          <Star size={12} class="text-zinc-400 shrink-0" />
                          {currentMotor().installed ? "Definir como Motor Padrão" : "Instalar Primeiro"}
                        </Button>
                      </>
                    }
                  >
                    <div class="flex items-center gap-2.5">
                      <Star size={14} class="fill-zinc-300 text-zinc-300 shrink-0" />
                      <div>
                        <span class="text-xs font-medium text-zinc-200 block">
                          Motor Padrão Ativo do Sistema
                        </span>
                        <span class="text-[11px] text-zinc-400">
                          Orquestrando turnos autônomos, tarefas agendadas e chamadas de ferramentas no OpenCorp.
                        </span>
                      </div>
                    </div>
                    <Show when={currentMotor().id !== "opencode"}>
                      <Button
                        size="xs"
                        variant="ghost"
                        class="text-zinc-400 hover:text-zinc-200 text-xs px-2.5 py-1 whitespace-nowrap shrink-0"
                        loading={desconectandoMotor() === currentMotor().id}
                        onClick={() => desconectarMotor(currentMotor().id)}
                        title="Desconectar este motor e reverter para o OpenCode padrão"
                      >
                        <Unplug size={12} class="mr-1" /> Reverter para OpenCode
                      </Button>
                    </Show>
                  </Show>
                </div>

                {/* BARRA DE AÇÕES DO MOTOR (Sem emojis, clean) */}
                <div class="flex items-center gap-2 flex-wrap">
                  <Button
                    size="xs"
                    variant="secondary"
                    class="text-xs px-2.5 py-1 text-zinc-300 hover:text-zinc-100 whitespace-nowrap"
                    onClick={() => setMotorSelecionadoAuth(currentMotor())}
                    title={`Abrir orientações de login e CLI para ${currentMotor().name}`}
                  >
                    <Key size={12} class="mr-1.5 text-zinc-400 shrink-0" /> Autenticar / Chave
                  </Button>

                  <Show when={currentMotor().installed}>
                    <Button
                      size="xs"
                      variant="secondary"
                      class="text-xs px-2.5 py-1 text-zinc-300 hover:text-zinc-100 whitespace-nowrap"
                      loading={testandoMotor() === currentMotor().id}
                      onClick={() => testarMotor(currentMotor().id)}
                      title="Executar diagnóstico em tempo real de execução e parâmetros"
                    >
                      <Play size={12} class="mr-1.5 text-zinc-400 shrink-0" /> Testar
                    </Button>
                  </Show>

                  <Button
                    size="xs"
                    variant="ghost"
                    class="text-xs px-2.5 py-1 text-zinc-400 hover:text-zinc-200 whitespace-nowrap"
                    loading={instalandoMotor() === currentMotor().id}
                    onClick={() => instalarMotor(currentMotor().id)}
                    title={
                      currentMotor().installed
                        ? currentMotor().isManaged
                          ? "Reinstalar binário isolado em ~/.opencorp/bin"
                          : "Instalar binário isolado em ~/.opencorp/bin"
                        : "Instalar motor isolado"
                    }
                  >
                    <Download size={12} class="mr-1.5 shrink-0" />
                    {currentMotor().installed
                      ? currentMotor().isManaged
                        ? "Reinstalar Isolado"
                        : "Isolar em ~/.opencorp/bin"
                      : "Instalar Motor Isolado"}
                  </Button>
                </div>

                {/* ESPECIFICAÇÕES TÉCNICAS (Clean, transparente, sem caixas pesadas) */}
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 py-2 text-xs">
                  <div class="space-y-0.5">
                    <span class="text-[10px] uppercase font-mono tracking-wider text-zinc-500 block">
                      Localização do Binário
                    </span>
                    <div class="font-mono text-zinc-300 truncate" title={currentMotor().path || "(não instalado)"}>
                      {currentMotor().path || "(não instalado)"}
                    </div>
                    <span class="text-[10px] text-zinc-500 font-mono flex items-center gap-1">
                      <Show
                        when={currentMotor().isManaged}
                        fallback={
                          <Show
                            when={currentMotor().installed}
                            fallback={<><Circle size={10} class="text-zinc-500" /> Não instalado</>}
                          >
                            <Terminal size={10} class="text-zinc-400" /> Binário do Sistema
                          </Show>
                        }
                      >
                        <Package size={10} class="text-zinc-400" /> Isolado em ~/.opencorp/bin
                      </Show>
                    </span>
                  </div>

                  <div class="space-y-0.5">
                    <span class="text-[10px] uppercase font-mono tracking-wider text-zinc-500 block">
                      Versão
                    </span>
                    <div
                      class="font-mono text-zinc-300 truncate"
                      title={String(currentMotor().version || "n/d")}
                    >
                      {String(currentMotor().version || "n/d").split("\n")[0]}
                    </div>
                    <span class="text-[10px] text-zinc-500 font-mono block">
                      {currentMotor().installed ? "Compatível v0.7.0" : "Aguardando instalação"}
                    </span>
                  </div>

                  <div class="space-y-0.5">
                    <span class="text-[10px] uppercase font-mono tracking-wider text-zinc-500 block">
                      Diagnóstico & Auth
                    </span>
                    <div class="flex items-center gap-1.5 truncate">
                      <span
                        class={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          currentMotor().health?.healthy
                            ? "bg-emerald-400"
                            : currentMotor().installed
                            ? "bg-zinc-400"
                            : "bg-zinc-600"
                        }`}
                      />
                      <span
                        class="text-zinc-300 truncate font-mono"
                        title={
                          currentMotor().health?.statusText ||
                          currentMotor().authStatus?.details ||
                          (currentMotor().installed ? "Pronto" : "Não instalado")
                        }
                      >
                        {currentMotor().health?.statusText ||
                          currentMotor().authStatus?.details ||
                          (currentMotor().installed ? "Pronto" : "Não instalado")}
                      </span>
                    </div>
                    <span class="text-[10px] text-zinc-500 font-mono block truncate">
                      {currentMotor().authStatus?.method || "Detecção automática"}
                    </span>
                  </div>
                </div>
              </div>

              {/* LISTA DE PROVEDORES CONTEXTUALIZADA CONFORME O AGENTE (Clean, transparente, sem bordas pesadas) */}
              <div class="pt-4 border-t border-zinc-800/40 space-y-3">
                <div class="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span class="text-xs font-semibold text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
                      <Key size={13} class="text-zinc-400" /> Provedores & Autenticações de {currentMotor().name}
                    </span>
                    <p class="text-[11px] text-zinc-400 mt-0.5">
                      Provedores de inteligência e credenciais compatíveis com este agente.
                    </p>
                  </div>
                  <span class="text-[11px] text-zinc-500 font-mono">
                    {(PROVEDORES_POR_AGENTE[currentMotor().id] || []).length} método(s)
                  </span>
                </div>

                <div class="divide-y divide-zinc-800/40">
                  <For each={PROVEDORES_POR_AGENTE[currentMotor().id] || []}>
                    {(prov) => {
                      const st = () => getProvedorStatus(prov, currentMotor());
                      const testTarget = () => prov.modelosSugeridos?.[0] || prov.id;
                      const testando = () => testandoModelo() === testTarget();
                      const res = () => resultadoTeste()[testTarget()];

                      return (
                        <div class="py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-transparent">
                          <div class="space-y-1 min-w-0 flex-1">
                            <div class="flex items-center gap-2 flex-wrap">
                              <span class="text-xs font-medium text-zinc-200">{prov.nome}</span>
                              <span class="text-[10px] font-mono flex items-center gap-1 text-zinc-400">
                                <span class={`w-1.5 h-1.5 rounded-full ${st().conectado ? "bg-emerald-400" : "bg-zinc-600"}`} />
                                {st().conectado ? "Conectado" : "Não configurado"}
                              </span>
                              <Show when={st().detalhe}>
                                <span class="text-[10px] font-mono text-zinc-500 truncate max-w-xs">
                                  • {st().detalhe}
                                </span>
                              </Show>
                            </div>

                            <p class="text-[11px] text-zinc-400 leading-relaxed">{prov.descricao}</p>

                            <Show when={prov.modelosSugeridos && prov.modelosSugeridos.length > 0}>
                              <div class="flex items-center gap-1.5 flex-wrap pt-0.5">
                                <span class="text-[10px] text-zinc-500 font-mono">Modelos:</span>
                                <For each={prov.modelosSugeridos}>
                                  {(m) => (
                                    <span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800/50 text-zinc-300">
                                      {m}
                                    </span>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </div>

                          <div class="flex items-center gap-2 self-end md:self-auto shrink-0 flex-wrap">
                            <Show when={prov.loginUrl}>
                              <a
                                href={prov.loginUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                class="inline-flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded transition-colors shrink-0 whitespace-nowrap"
                                title={`Abrir console de ${prov.nome}`}
                              >
                                <ExternalLink size={10} /> {prov.loginUrlLabel || "Console"}
                              </a>
                            </Show>

                            <Show when={res()}>
                              <span class="text-[10px] font-mono flex items-center gap-1 text-zinc-300">
                                <Show when={res()?.ok} fallback={<><AlertCircle size={10} class="text-rose-400" /> Erro</>}>
                                  <Check size={10} class="text-emerald-400" /> {res()?.ms}ms
                                </Show>
                              </span>
                            </Show>

                            <Show when={st().conectado}>
                              <Show when={prov.modelosSugeridos && prov.modelosSugeridos.length > 0}>
                                <Button
                                  size="xs"
                                  variant="secondary"
                                  class="text-[11px] px-2 py-1 whitespace-nowrap"
                                  loading={testando()}
                                  onClick={() => testarConexaoModelo(testTarget())}
                                  title={`Testar inferência em ${testTarget()}`}
                                >
                                  <Play size={10} class="mr-1 text-zinc-400 shrink-0" /> Testar
                                </Button>
                              </Show>
                              <Show when={st().isDirectKey && prov.id}>
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  class="text-zinc-400 hover:text-rose-400 text-[11px] px-2 py-1 whitespace-nowrap"
                                  onClick={() => desconectarProvedor(prov.id)}
                                  title="Remover chave configurada"
                                >
                                  <Unplug size={10} class="mr-1 shrink-0" /> Desconectar
                                </Button>
                              </Show>
                            </Show>

                            <Show when={!st().conectado}>
                              <Show
                                when={prov.tipo === "oauth_cli" || prov.loginCmd}
                                fallback={
                                  <Button
                                    size="xs"
                                    variant="secondary"
                                    class="text-[11px] px-2 py-1 whitespace-nowrap text-zinc-300 hover:text-zinc-100"
                                    onClick={() => {
                                      setNovoProvider(prov.id);
                                      setAbaAtiva("chaves");
                                    }}
                                  >
                                    <Plus size={10} class="mr-1 shrink-0" /> Chave
                                  </Button>
                                }
                              >
                                <Button
                                  size="xs"
                                  variant="secondary"
                                  class="text-[11px] px-2 py-1 whitespace-nowrap text-zinc-300 hover:text-zinc-100"
                                  onClick={() => setMotorSelecionadoAuth(currentMotor())}
                                >
                                  <Key size={10} class="mr-1 text-zinc-400 shrink-0" /> Login
                                </Button>
                              </Show>
                            </Show>
                          </div>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>

              {/* CONTAS CONECTADAS DO MOTOR (Múltiplas Contas) */}
              <div class="space-y-3 pt-3 border-t border-zinc-800/40">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <Users size={14} class="text-zinc-400" />
                    <h4 class="text-xs font-semibold text-zinc-200">
                      Contas Conectadas ({contasDoMotorAtual().length})
                    </h4>
                  </div>
                  <Button
                    size="xs"
                    variant="secondary"
                    class="text-xs text-zinc-300 hover:text-white"
                    onClick={() => setMotorSelecionadoAuth(currentMotor())}
                  >
                    <Plus size={12} class="mr-1 text-emerald-400" /> Conectar Mais Uma Conta
                  </Button>
                </div>

                <div class="space-y-2">
                  <For
                    each={contasDoMotorAtual()}
                    fallback={
                      <div class="p-3 rounded-lg bg-zinc-900/30 border border-zinc-800/40 text-xs text-zinc-400 flex items-center justify-between">
                        <span>Nenhuma conta personalizada cadastrada no OpenCorp. O motor usa a credencial padrão do sistema.</span>
                        <Button
                          size="xs"
                          variant="ghost"
                          class="text-xs text-emerald-400 hover:text-emerald-300"
                          onClick={() => setMotorSelecionadoAuth(currentMotor())}
                        >
                          + Adicionar Conta
                        </Button>
                      </div>
                    }
                  >
                    {(c) => (
                      <div class="p-2.5 rounded-lg bg-zinc-900/40 border border-zinc-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                        <div class="flex items-center gap-2.5 min-w-0">
                          <span
                            class={`w-2 h-2 rounded-full shrink-0 ${
                              c.ativa ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)]" : "bg-zinc-600"
                            }`}
                          />
                          <div class="min-w-0">
                            <div class="flex items-center gap-2 flex-wrap">
                              <span class="font-medium text-zinc-200 truncate">{c.nome}</span>
                              <span
                                class={`text-[10px] font-mono px-1.5 py-0.2 rounded border ${
                                  c.ativa
                                    ? "bg-emerald-950/30 text-emerald-300 border-emerald-800/50"
                                    : "bg-zinc-800/50 text-zinc-400 border-zinc-700/40"
                                }`}
                              >
                                {c.ativa ? "CONTA ATIVA" : "SECUNDÁRIA"}
                              </span>
                              <span class="text-[10px] font-mono px-1.5 py-0.2 rounded border bg-cyan-950/30 text-cyan-300 border-cyan-800/40">
                                {c.motorId}
                              </span>
                            </div>
                            <div class="text-[11px] text-zinc-500 font-mono flex items-center gap-2 mt-0.5 flex-wrap">
                              <span>Auth: {c.authType}</span>
                              <span>•</span>
                              <span class="text-amber-400/80">
                                {c.tokenOuChave
                                  ? `${c.tokenOuChave.slice(0, 6)}…${c.tokenOuChave.slice(-4)}`
                                  : "—"}
                              </span>
                              <span>•</span>
                              <span>Cota: {c.limits?.status_cota || "normal"}</span>
                              <span>•</span>
                              <span>Teto: ${c.limits?.daily_cost_usd || 10}/dia</span>
                              <span>•</span>
                              <span>{c.limits?.rate_limit_rpm || 30} RPM</span>
                            </div>
                            <Show when={tokensContas()[c.id]}>
                              <div class="mt-1 p-1.5 rounded bg-zinc-950/70 border border-zinc-800/60 text-[11px] font-mono text-emerald-300 flex items-center justify-between">
                                <span>Tokens da Conta: {tokensContas()[c.id].mensagem}</span>
                                <span class="text-[10px] text-zinc-500 ml-2">
                                  {new Date(tokensContas()[c.id].consultadoEm).toLocaleTimeString()}
                                </span>
                              </div>
                            </Show>
                          </div>
                        </div>

                        <div class="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                          <Button
                            size="xs"
                            variant="ghost"
                            class="text-[11px] text-zinc-400 hover:text-white"
                            loading={consultandoConta() === c.id}
                            onClick={() => consultarTokensConta(currentMotor().id, c.id)}
                          >
                            <Coins size={11} class="mr-1 text-amber-400" /> Consultar Tokens
                          </Button>
                          <Show when={!c.ativa}>
                            <Button
                              size="xs"
                              variant="ghost"
                              class="text-[11px] text-zinc-300 hover:text-white"
                              onClick={() => ativarContaMotor(currentMotor().id, c.id)}
                            >
                              Tornar Ativa
                            </Button>
                          </Show>
                          <Button
                            size="xs"
                            variant="ghost"
                            class="text-[11px] text-red-400 hover:text-red-300 hover:bg-red-950/30"
                            onClick={() => desconectarContaMotor(currentMotor().id, c.id)}
                            title="Desconectar esta conta"
                          >
                            <Trash2 size={12} class="mr-1" /> Desconectar
                          </Button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>

              {/* LIMITES ESPECÍFICOS DO MOTOR */}
              <div class="space-y-3 pt-3 border-t border-zinc-800/40">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <Activity size={14} class="text-zinc-400" />
                    <h4 class="text-xs font-semibold text-zinc-200">
                      Limites & Cotas de {currentMotor().name}
                    </h4>
                  </div>
                </div>

                {(() => {
                  const mId = currentMotor().id;
                  const limAtual = () => limitesMotores()[mId] || {
                    timeout_min: 20,
                    max_turns: 40,
                    rate_limit_rpm: 30,
                    daily_cost_usd: 10.0,
                    status_cota: "normal",
                  };

                  return (
                    <div class="p-3 rounded-lg bg-zinc-900/30 border border-zinc-800/40 space-y-3 text-xs">
                      {/* LIVE TOKENS DO MOTOR SELECIONADO */}
                      {(() => {
                        const liveTok = () => tokensMotores()[mId] || currentMotor()?.tokens || null;
                        return (
                          <div class="p-2.5 rounded bg-zinc-950/70 border border-zinc-800/70 space-y-2">
                            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs">
                              <div class="flex items-center gap-1.5 text-zinc-200 font-medium flex-wrap">
                                <Coins size={13} class="text-amber-400 shrink-0" />
                                <span>Quota Real & Tokens Disponíveis</span>
                                <span class="hidden sm:inline-block text-[10px] px-1.5 py-0.2 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/50 font-mono">
                                  CONSULTA REAL AO VIVO
                                </span>
                                <span class="sm:hidden text-[9px] px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/50 font-mono">
                                  AO VIVO
                                </span>
                              </div>
                              <button
                                class="self-start sm:self-auto text-[11px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1 font-mono transition-colors cursor-pointer"
                                disabled={carregandoTokens()}
                                onClick={() => recarregarTokensAoVivo(mId)}
                              >
                                <RefreshCw size={10} class={carregandoTokens() ? "animate-spin" : ""} />
                                Consultar Adaptador
                              </button>
                            </div>

                            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                              <div class="p-2 rounded bg-zinc-900/50 border border-zinc-800/50">
                                <span class="text-[10px] text-zinc-400 block font-mono mb-0.5">Provedor Consultado</span>
                                <span class="text-xs text-zinc-100 font-semibold font-mono">
                                  {liveTok()?.provedor || currentMotor()?.maintainer || "Adaptador do Motor"}
                                </span>
                              </div>
                              <div class="p-2 rounded bg-zinc-900/50 border border-zinc-800/50">
                                <span class="text-[10px] text-zinc-400 block font-mono mb-0.5">Tokens / Reqs Disponíveis</span>
                                <span class="text-xs text-emerald-400 font-bold font-mono">
                                  {liveTok()?.tokensDisponiveis != null
                                    ? typeof liveTok()?.tokensDisponiveis === "number"
                                      ? Number(liveTok()?.tokensDisponiveis).toLocaleString()
                                      : String(liveTok()?.tokensDisponiveis).toUpperCase()
                                    : "Disponível via Adaptador"}
                                </span>
                              </div>
                              <div class="p-2 rounded bg-zinc-900/50 border border-zinc-800/50">
                                <span class="text-[10px] text-zinc-400 block font-mono mb-0.5">Saldo / Rate Limit</span>
                                <span class="text-xs text-zinc-200 font-mono">
                                  {liveTok()?.saldoUsd != null
                                    ? `$${liveTok()?.saldoUsd.toFixed(2)} USD`
                                    : (liveTok()?.rateLimitRpm ? `${liveTok()?.rateLimitRpm} RPM` : "Ativo")}
                                </span>
                              </div>
                            </div>

                            <div class="text-[11px] text-zinc-400 font-mono bg-zinc-900/40 p-2 rounded border border-zinc-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                              <span class="truncate">{liveTok()?.mensagem || "Pronto para consulta direta pelo adaptador"}</span>
                              <Show when={liveTok()?.consultadoEm}>
                                <span class="text-[10px] text-zinc-500 whitespace-nowrap">
                                  Última consulta: {new Date(liveTok()?.consultadoEm).toLocaleTimeString()}
                                </span>
                              </Show>
                            </div>
                          </div>
                        );
                      })()}

                      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <div class="p-2.5 rounded-lg bg-zinc-950/40 border border-zinc-800/60 focus-within:border-emerald-500/50 transition-colors">
                          <label class="flex items-center gap-1.5 text-zinc-400 mb-1.5 text-[11px] font-medium">
                            <Clock size={12} class="text-zinc-500" />
                            <span>Timeout por Run (min)</span>
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="120"
                            value={limAtual().timeout_min}
                            onInput={(e) => {
                              const val = Number(e.currentTarget.value) || 20;
                              setLimitesMotores((prev) => ({
                                ...prev,
                                [mId]: { ...limAtual(), timeout_min: val },
                              }));
                            }}
                            class="w-full bg-zinc-900/80 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-100 font-mono text-xs focus:outline-none focus:border-emerald-500/50"
                          />
                        </div>
                        <div class="p-2.5 rounded-lg bg-zinc-950/40 border border-zinc-800/60 focus-within:border-emerald-500/50 transition-colors">
                          <label class="flex items-center gap-1.5 text-zinc-400 mb-1.5 text-[11px] font-medium">
                            <RotateCcw size={12} class="text-zinc-500" />
                            <span>Max Turns (0 = Ilimitado)</span>
                          </label>
                          <input
                            type="number"
                            min="0"
                            max="999999"
                            placeholder="0 = ilimitado"
                            value={limAtual().max_turns}
                            onInput={(e) => {
                              const raw = e.currentTarget.value.trim();
                              const val = raw === "" ? 0 : Number(raw);
                              setLimitesMotores((prev) => ({
                                ...prev,
                                [mId]: { ...limAtual(), max_turns: isNaN(val) ? 0 : val },
                              }));
                            }}
                            class="w-full bg-zinc-900/80 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-100 font-mono text-xs focus:outline-none focus:border-emerald-500/50"
                          />
                        </div>
                        <div class="p-2.5 rounded-lg bg-zinc-950/40 border border-zinc-800/60 focus-within:border-emerald-500/50 transition-colors">
                          <label class="flex items-center gap-1.5 text-zinc-400 mb-1.5 text-[11px] font-medium">
                            <Gauge size={12} class="text-zinc-500" />
                            <span>Rate Limit (RPM)</span>
                          </label>
                          <input
                            type="number"
                            min="5"
                            max="300"
                            value={limAtual().rate_limit_rpm}
                            onInput={(e) => {
                              const val = Number(e.currentTarget.value) || 30;
                              setLimitesMotores((prev) => ({
                                ...prev,
                                [mId]: { ...limAtual(), rate_limit_rpm: val },
                              }));
                            }}
                            class="w-full bg-zinc-900/80 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-100 font-mono text-xs focus:outline-none focus:border-emerald-500/50"
                          />
                        </div>
                        <div class="p-2.5 rounded-lg bg-zinc-950/40 border border-zinc-800/60 focus-within:border-emerald-500/50 transition-colors">
                          <label class="flex items-center gap-1.5 text-zinc-400 mb-1.5 text-[11px] font-medium">
                            <DollarSign size={12} class="text-zinc-500" />
                            <span>Cota Diária (USD)</span>
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="1000"
                            step="1"
                            value={limAtual().daily_cost_usd}
                            onInput={(e) => {
                              const val = Number(e.currentTarget.value) || 10;
                              setLimitesMotores((prev) => ({
                                ...prev,
                                [mId]: { ...limAtual(), daily_cost_usd: val },
                              }));
                            }}
                            class="w-full bg-zinc-900/80 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-100 font-mono text-xs focus:outline-none focus:border-emerald-500/50"
                          />
                        </div>
                      </div>

                      <div class="flex items-center justify-between pt-2 border-t border-zinc-800/30">
                        <div class="flex items-center gap-2">
                          <span class="text-zinc-400">Status da Cota:</span>
                          <select
                            value={limAtual().status_cota}
                            onChange={(e) => {
                              const val = e.currentTarget.value;
                              setLimitesMotores((prev) => ({
                                ...prev,
                                [mId]: { ...limAtual(), status_cota: val },
                              }));
                            }}
                            class="bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5 text-zinc-200 text-xs"
                          >
                            <option value="normal">Normal (Operacional)</option>
                            <option value="alerta_80">Alerta (80% atingido)</option>
                            <option value="esgotado">Esgotado (Acionar fallback)</option>
                          </select>
                        </div>
                        <Button
                          size="xs"
                          variant="secondary"
                          loading={salvandoLimites()}
                          onClick={() => salvarLimitesMotores(limitesMotores())}
                        >
                          <Save size={12} class="mr-1" /> Salvar Limites de {currentMotor().name}
                        </Button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* DADOS ISOLADOS DO WORKSPACE (Clean, transparente) */}
            <Show when={escopoConfig() === "workspace"}>
              <div class="py-2.5 border-t border-zinc-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-zinc-400">
                <div class="flex items-center gap-2">
                  <span class="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                  <span>Este workspace executa em sandboxing com dados isolados.</span>
                </div>
                <span class="font-mono text-[11px] text-zinc-500">
                  ~/.opencorp/opencode-data/{wsAtivo()}
                </span>
              </div>
            </Show>
          </div>
        </Show>

        {/* ─────────────────────────────────────────────────────────────
            ABA LIMITES DOS MOTORES (TAB DEDICADA PARA TODOS OS MOTORES)
           ───────────────────────────────────────────────────────────── */}
        <Show when={abaAtiva() === "limites"}>
          <div class="space-y-6 bg-transparent" data-testid="tab-limites-motores">
            {/* CABEÇALHO */}
            <div class="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-zinc-800/40 gap-3">
              <div>
                <h2 class="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                  <Activity size={15} class="text-emerald-400 shrink-0" />
                  Limites de Operação, Taxas e Cotas por Motor
                </h2>
                <p class="text-xs text-zinc-400 mt-0.5">
                  Controle centralizado de timeouts, limites de turnos ReAct, rate limits (RPM) e tetos diários para todos os motores.
                </p>
              </div>
              <div class="flex items-center gap-2 w-full sm:w-auto">
                <Button
                  size="xs"
                  variant="secondary"
                  class="border border-zinc-750 text-zinc-300 hover:text-white text-xs font-medium flex-1 sm:flex-initial justify-center"
                  loading={carregandoTokens()}
                  onClick={() => recarregarTokensAoVivo()}
                >
                  <RefreshCw size={12} class={`mr-1 ${carregandoTokens() ? "animate-spin" : ""}`} /> Recarregar Quotas
                </Button>
                <Button
                  size="xs"
                  variant="primary"
                  class="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium flex-1 sm:flex-initial justify-center"
                  loading={salvandoLimites()}
                  onClick={() => salvarLimitesMotores(limitesMotores())}
                >
                  <Save size={12} class="mr-1" /> Salvar Todos
                </Button>
              </div>
            </div>

            {/* CARDS RESUMO */}
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div class="p-3.5 rounded-xl bg-zinc-900/40 border border-zinc-800/60 hover:border-zinc-700/60 transition-colors">
                <div class="flex items-center justify-between mb-1.5">
                  <span class="text-xs text-zinc-400 font-medium">Motores Ativos / Homologados</span>
                  <Cpu size={14} class="text-zinc-500" />
                </div>
                <div class="flex items-baseline gap-2">
                  <span class="text-xl font-bold text-zinc-100 font-mono">
                    {motores().filter((m: any) => m.installed).length}
                  </span>
                  <span class="text-xs text-zinc-500 font-mono">/ {motores().length} instalados</span>
                </div>
              </div>

              <div class="p-3.5 rounded-xl bg-zinc-900/40 border border-zinc-800/60 hover:border-zinc-700/60 transition-colors">
                <div class="flex items-center justify-between mb-1.5">
                  <span class="text-xs text-zinc-400 font-medium">Total de Contas Conectadas</span>
                  <Key size={14} class="text-emerald-500/80" />
                </div>
                <div class="flex items-baseline gap-2">
                  <span class="text-xl font-bold text-emerald-400 font-mono">
                    {contasPorMotor().length}
                  </span>
                  <span class="text-xs text-zinc-500 font-mono">credenciais ativas</span>
                </div>
              </div>

              <div class="p-3.5 rounded-xl bg-zinc-900/40 border border-zinc-800/60 hover:border-zinc-700/60 transition-colors">
                <div class="flex items-center justify-between mb-1.5">
                  <span class="text-xs text-zinc-400 font-medium">Fallback Global de Harness</span>
                  <ShieldCheck size={14} class="text-cyan-500/80" />
                </div>
                <span class="text-xs font-mono text-zinc-300 block truncate">
                  {statusMotores()?.runner?.harness_fallback?.join(" → ") || "antigravity → copilot → opencode"}
                </span>
              </div>
            </div>

            {/* TABELA / LISTA DE MOTORES E SEUS LIMITES */}
            <div class="space-y-4">
              <For each={motores()}>
                {(m: any) => {
                  const lim = () => limitesMotores()[m.id] || {
                    timeout_min: 20,
                    max_turns: 40,
                    rate_limit_rpm: 30,
                    daily_cost_usd: 10.0,
                    status_cota: "normal",
                  };
                  const contaIds = SUB_PROVEDORES[m.id] || [m.id];
                  const contas = () => contasPorMotor().filter((c) => contaIds.includes(c.motorId));
                  const contaAtiva = () => contas().find((c) => c.ativa) || contas()[0];
                  const liveTok = () => tokensMotores()[m.id] || m.tokens || null;
                  const cotaStatus = () => liveTok()?.statusCota || lim().status_cota || "normal";
                  const source = () => liveTok()?.source || (m.installed ? "cli_live" : "unconfigured");

                  return (
                    <div class="p-4 rounded-xl bg-zinc-900/30 border border-zinc-800/50 hover:border-zinc-700/50 transition-colors space-y-3.5">
                      {/* TOPO: STATUS, IDENTIFICAÇÃO E AÇÕES */}
                      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-zinc-800/40">
                        <div class="flex items-center gap-3">
                          <span
                            class={`w-2.5 h-2.5 rounded-full ${
                              m.ativo
                                ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]"
                                : m.installed
                                ? "bg-zinc-400"
                                : "bg-zinc-600"
                            }`}
                          />
                          <div>
                            <div class="flex items-center gap-2 flex-wrap">
                              <span class="font-semibold text-zinc-100 text-sm tracking-tight">{m.name}</span>
                              <span class="font-mono text-xs text-zinc-500">({m.id})</span>
                              <Show when={m.ativo}>
                                <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/50 font-medium">
                                  PADRÃO ATUAL
                                </span>
                              </Show>
                              {/* Badge de Origem da Informação (ao vivo) */}
                              <span
                                class={`text-[10px] font-mono px-2 py-0.5 rounded border font-medium ${
                                  source() === "api_live"
                                    ? "bg-cyan-950/40 text-cyan-300 border-cyan-800/50"
                                    : source() === "cli_live"
                                    ? "bg-purple-950/40 text-purple-300 border-purple-800/50"
                                    : source() === "oauth_session"
                                    ? "bg-blue-950/40 text-blue-300 border-blue-800/50"
                                    : "bg-zinc-800/50 text-zinc-400 border-zinc-700/50"
                                }`}
                              >
                                {source() === "api_live"
                                  ? "API AO VIVO"
                                  : source() === "cli_live"
                                  ? "CLI RUNTIME"
                                  : source() === "oauth_session"
                                  ? "SESSÃO OAUTH"
                                  : "SEM CONEXÃO"}
                              </span>
                            </div>
                            <div class="text-xs text-zinc-400 font-mono mt-0.5 flex items-center gap-2">
                              <span>Contas: {contas().length} conectada(s)</span>
                              <Show when={contaAtiva()}>
                                <span class="text-zinc-500">•</span>
                                <span class="text-zinc-300 font-medium">Ativa: {contaAtiva().nome}</span>
                              </Show>
                            </div>
                          </div>
                        </div>

                        <div class="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
                          <span
                            class={`text-xs px-2.5 py-1 rounded-md font-mono border font-medium ${
                              cotaStatus() === "normal"
                                ? "bg-emerald-950/40 text-emerald-300 border-emerald-800/50"
                                : cotaStatus() === "alerta_80"
                                ? "bg-amber-950/40 text-amber-300 border-amber-800/50"
                                : "bg-rose-950/40 text-rose-300 border-rose-800/50"
                            }`}
                          >
                            Cota: {cotaStatus().toUpperCase()}
                          </span>
                          <Button
                            size="xs"
                            variant="ghost"
                            class="text-xs text-zinc-400 hover:text-white border border-zinc-800/60"
                            onClick={() => {
                              setMotorSelecionadoTab(m.id);
                              setAbaAtiva("motores");
                            }}
                          >
                            Configurar Motor
                          </Button>
                        </div>
                      </div>

                      {/* CARD DE TOKENS E QUOTA REAL DO ADAPTADOR */}
                      <div class="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800/60 space-y-2.5">
                        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                          <div class="flex items-center gap-2 text-zinc-200 font-medium flex-wrap">
                            <Coins size={14} class="text-amber-400 shrink-0" />
                            <span>Quota Real & Tokens Disponíveis</span>
                            <span class="hidden sm:inline-block text-[10px] px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/50 font-mono">
                              CONSULTA REAL AO VIVO (SEM CÁLCULO CEGO)
                            </span>
                            <span class="sm:hidden text-[9px] px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/50 font-mono">
                              AO VIVO
                            </span>
                          </div>
                          <button
                            class="self-start sm:self-auto text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5 font-mono transition-colors cursor-pointer px-2 py-1 rounded hover:bg-zinc-800/40"
                            disabled={carregandoTokens()}
                            onClick={() => recarregarTokensAoVivo(m.id)}
                            title="Consultar adaptador do motor para atualizar quotas ao vivo"
                          >
                            <RefreshCw size={11} class={carregandoTokens() ? "animate-spin" : ""} />
                            Consultar Adaptador
                          </button>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                          <div class="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/60">
                            <span class="text-[11px] text-zinc-400 block font-mono mb-1">Provedor Consultado</span>
                            <span class="text-xs text-zinc-100 font-semibold font-mono truncate block">
                              {liveTok()?.provedor || m.maintainer || "Adaptador do Motor"}
                            </span>
                          </div>
                          <div class="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/60">
                            <span class="text-[11px] text-zinc-400 block font-mono mb-1">Tokens / Reqs Disponíveis</span>
                            <span
                              class={`text-sm font-bold font-mono ${
                                liveTok()?.tokensDisponiveis === 0 || liveTok()?.statusCota === "esgotado"
                                  ? "text-rose-400"
                                  : "text-emerald-400"
                              }`}
                            >
                              {liveTok()?.tokensDisponiveis != null
                                ? typeof liveTok()?.tokensDisponiveis === "number"
                                  ? Number(liveTok()?.tokensDisponiveis).toLocaleString()
                                  : String(liveTok()?.tokensDisponiveis).toUpperCase()
                                : "Disponível via Adaptador"}
                            </span>
                          </div>
                          <div class="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/60">
                            <span class="text-[11px] text-zinc-400 block font-mono mb-1">Saldo / Rate Limit</span>
                            <span class="text-xs text-zinc-200 font-mono font-medium block">
                              {liveTok()?.saldoUsd != null
                                ? `$${liveTok()?.saldoUsd.toFixed(2)} USD`
                                : (liveTok()?.rateLimitRpm ? `${liveTok()?.rateLimitRpm} RPM` : "Ativo")}
                            </span>
                          </div>
                        </div>

                        <div class="text-xs text-zinc-400 font-mono bg-zinc-900/50 p-2.5 rounded-lg border border-zinc-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                          <div class="flex items-center gap-2 truncate">
                            <Show
                              when={liveTok()?.statusCota === "esgotado"}
                              fallback={<CircleCheck size={12} class="text-emerald-400 shrink-0" />}
                            >
                              <CircleAlert size={12} class="text-rose-400 shrink-0" />
                            </Show>
                            <span class="truncate">{liveTok()?.mensagem || "Pronto para consulta direta pelo adaptador do motor"}</span>
                          </div>
                          <Show when={liveTok()?.consultadoEm}>
                            <span class="text-[11px] text-zinc-500 whitespace-nowrap shrink-0">
                              Última consulta: {new Date(liveTok()?.consultadoEm).toLocaleTimeString()}
                            </span>
                          </Show>
                        </div>
                      </div>

                      {/* GUARDRAILS & LIMITES OPERACIONAIS */}
                      <div class="space-y-2 pt-1">
                        <div class="flex items-center justify-between">
                          <div class="flex items-center gap-1.5 text-xs text-zinc-400 font-medium">
                            <Shield size={12} class="text-zinc-500" />
                            <span>Guardrails e Limites Operacionais</span>
                          </div>
                          <Button
                            size="xs"
                            variant="ghost"
                            class="text-[11px] text-zinc-400 hover:text-white"
                            loading={salvandoLimites()}
                            onClick={() => salvarLimitesMotores(limitesMotores())}
                          >
                            <Save size={11} class="mr-1" /> Salvar {m.name}
                          </Button>
                        </div>

                        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                          <div class="p-2 rounded-lg bg-zinc-950/40 border border-zinc-800/60 focus-within:border-emerald-500/50 transition-colors">
                            <label class="flex items-center gap-1 text-[11px] text-zinc-400 mb-1 font-medium">
                              <Clock size={11} class="text-zinc-500" /> Timeout (min)
                            </label>
                            <input
                              type="number"
                              min="1"
                              max="120"
                              value={lim().timeout_min}
                              onInput={(e) => {
                                const val = Number(e.currentTarget.value) || 20;
                                setLimitesMotores((prev) => ({
                                  ...prev,
                                  [m.id]: { ...lim(), timeout_min: val },
                                }));
                              }}
                              class="w-full bg-zinc-900/80 border border-zinc-800 rounded px-2.5 py-1 text-zinc-100 font-mono text-xs focus:outline-none focus:border-emerald-500/50"
                            />
                          </div>

                          <div class="p-2 rounded-lg bg-zinc-950/40 border border-zinc-800/60 focus-within:border-emerald-500/50 transition-colors">
                            <label class="flex items-center gap-1 text-[11px] text-zinc-400 mb-1 font-medium">
                              <RotateCcw size={11} class="text-zinc-500" /> Max Turns (0 = Ilimitado)
                            </label>
                            <input
                              type="number"
                              min="0"
                              max="999999"
                              placeholder="0 = ilimitado"
                              value={lim().max_turns}
                              onInput={(e) => {
                                const raw = e.currentTarget.value.trim();
                                const val = raw === "" ? 0 : Number(raw);
                                setLimitesMotores((prev) => ({
                                  ...prev,
                                  [m.id]: { ...lim(), max_turns: isNaN(val) ? 0 : val },
                                }));
                              }}
                              class="w-full bg-zinc-900/80 border border-zinc-800 rounded px-2.5 py-1 text-zinc-100 font-mono text-xs focus:outline-none focus:border-emerald-500/50"
                            />
                          </div>

                          <div class="p-2 rounded-lg bg-zinc-950/40 border border-zinc-800/60 focus-within:border-emerald-500/50 transition-colors">
                            <label class="flex items-center gap-1 text-[11px] text-zinc-400 mb-1 font-medium">
                              <Gauge size={11} class="text-zinc-500" /> Rate Limit (RPM)
                            </label>
                            <input
                              type="number"
                              min="5"
                              max="300"
                              value={lim().rate_limit_rpm}
                              onInput={(e) => {
                                const val = Number(e.currentTarget.value) || 30;
                                setLimitesMotores((prev) => ({
                                  ...prev,
                                  [m.id]: { ...lim(), rate_limit_rpm: val },
                                }));
                              }}
                              class="w-full bg-zinc-900/80 border border-zinc-800 rounded px-2.5 py-1 text-zinc-100 font-mono text-xs focus:outline-none focus:border-emerald-500/50"
                            />
                          </div>

                          <div class="p-2 rounded-lg bg-zinc-950/40 border border-zinc-800/60 focus-within:border-emerald-500/50 transition-colors">
                            <label class="flex items-center gap-1 text-[11px] text-zinc-400 mb-1 font-medium">
                              <DollarSign size={11} class="text-zinc-500" /> Cota Diária (USD)
                            </label>
                            <input
                              type="number"
                              min="1"
                              max="1000"
                              step="1"
                              value={lim().daily_cost_usd}
                              onInput={(e) => {
                                const val = Number(e.currentTarget.value) || 10;
                                setLimitesMotores((prev) => ({
                                  ...prev,
                                  [m.id]: { ...lim(), daily_cost_usd: val },
                                }));
                              }}
                              class="w-full bg-zinc-900/80 border border-zinc-800 rounded px-2.5 py-1 text-zinc-100 font-mono text-xs focus:outline-none focus:border-emerald-500/50"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        </Show>

        {/* ─────────────────────────────────────────────────────────────
            ABA MODELOS & ROTAÇÃO (COM GEMINI 3.8 FLASH E TESTE)
           ───────────────────────────────────────────────────────────── */}
        <Show when={abaAtiva() === "modelos"}>
          <div class="space-y-6 bg-transparent">
            <div class="pb-1 border-b border-zinc-800/40">
              <h2 class="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <Cpu size={15} class="text-zinc-400" />
                Modelo Padrão e Rotação Automática de Contingência
              </h2>
              <p class="text-xs text-zinc-400 mt-0.5">
                Defina a inteligência primária do sistema e a ordem de rotação em caso de 429 ou cota esgotada.
              </p>
            </div>

            {/* SELEÇÃO DO MODELO PRINCIPAL */}
            <div class="space-y-3 py-2 border-b border-zinc-800/40">
              <div>
                <label class="block text-xs font-semibold text-zinc-200 mb-1">Modelo Principal do Workspace</label>
                <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <select
                    value={
                      [
                        "openrouter/google/gemini-3.8-flash",
                        "openrouter/nvidia/nemotron-3.5-lightning:free",
                        "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
                        "openrouter/minimax/minimax-m3:free",
                        "openrouter/anthropic/claude-3.5-haiku",
                        "opencode-go/glm-5.3-flash",
                      ].includes(modeloPrincipal())
                        ? modeloPrincipal()
                        : "__custom__"
                    }
                    onChange={(e) => {
                      const v = e.currentTarget.value;
                      if (v === "__custom__") {
                        if (!modeloCustomizado()) setModeloCustomizado(modeloPrincipal());
                        setModeloPrincipal("__custom__");
                      } else {
                        setModeloPrincipal(v);
                      }
                    }}
                    class="flex-1 bg-zinc-900/80 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 font-medium focus:outline-none focus:border-zinc-600 cursor-pointer"
                  >
                    <option value="openrouter/google/gemini-3.8-flash">
                      Google Gemini 3.8 Flash (BYOK Google AI Studio • Custo $0) — Recomendado
                    </option>
                    <option value="openrouter/nvidia/nemotron-3.5-lightning:free">
                      NVIDIA Nemotron 3.5 Lightning (Gratuito / Rápido)
                    </option>
                    <option value="openrouter/nvidia/nemotron-3-ultra-550b-a55b:free">
                      NVIDIA Nemotron 3 Ultra 550B (Gratuito / Alta Capacidade)
                    </option>
                    <option value="openrouter/minimax/minimax-m3:free">MiniMax M3 (Gratuito)</option>
                    <option value="openrouter/anthropic/claude-3.5-haiku">Anthropic Claude 3.5 Haiku</option>
                    <option value="opencode-go/glm-5.3-flash">OpenCode-Go GLM 5.3 Flash</option>
                    <option value="__custom__">Outro / Personalizado (Digitar)</option>
                  </select>

                  <Button
                    size="xs"
                    variant="secondary"
                    loading={testandoModelo() === modeloPrincipal()}
                    onClick={() => testarConexaoModelo(modeloPrincipal())}
                  >
                    <Play size={11} class="mr-1 text-zinc-400" /> Testar Modelo
                  </Button>
                </div>

                <Show when={modeloPrincipal() === "__custom__"}>
                  <input
                    type="text"
                    placeholder="provedor/identificador-do-modelo (ex: openrouter/meta-llama/llama-3.3-70b-instruct)"
                    value={modeloCustomizado()}
                    onInput={(e) => setModeloCustomizado(e.currentTarget.value)}
                    class="mt-2 w-full bg-zinc-900/80 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 font-mono focus:outline-none focus:border-zinc-600"
                  />
                </Show>

                {/* Badge de resultado do teste */}
                <Show when={resultadoTeste()[modeloPrincipal()]}>
                  <div class="mt-2 p-2 rounded-lg text-xs font-mono flex items-center justify-between border border-zinc-800 bg-zinc-900/50">
                    <span class="flex items-center gap-1.5 text-zinc-300">
                      <Show
                        when={resultadoTeste()[modeloPrincipal()]?.ok}
                        fallback={<><AlertCircle size={12} class="text-rose-400" /> Erro na chamada</>}
                      >
                        <Check size={12} class="text-emerald-400" /> Modelo ativo e respondendo
                      </Show>
                      <span class="text-zinc-500 font-mono">({resultadoTeste()[modeloPrincipal()]?.ms}ms)</span>
                    </span>
                    <Show when={resultadoTeste()[modeloPrincipal()]?.is_byok}>
                      <span class="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] text-zinc-300">
                        BYOK Custo $0
                      </span>
                    </Show>
                  </div>
                </Show>
              </div>

              {/* PROPAGAR MODELO PARA TODOS OS AGENTES */}
              <div class="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div>
                  <span class="text-xs font-semibold text-zinc-300 block">Propagar Modelo aos Agentes</span>
                  <span class="text-[11px] text-zinc-500">
                    Aplica este modelo como o modelo padrão em todos os agentes ativos do workspace.
                  </span>
                </div>
                <Button
                  size="xs"
                  variant="secondary"
                  class="text-zinc-300"
                  loading={aplicandoEmTodos()}
                  onClick={aplicarModeloEmTodos}
                >
                  <Bot size={12} class="mr-1.5 text-zinc-400" /> Aplicar em Todos
                </Button>
              </div>
            </div>

            {/* ORDEM DE EXECUÇÃO & ROTAÇÃO DE CONTINGÊNCIA */}
            <div class="space-y-2 py-2 border-b border-zinc-800/40">
              <div>
                <label class="block text-xs font-semibold text-zinc-200 mb-1">
                  Ordem de Contingência & Fallback (Um por linha)
                </label>
                <textarea
                  rows={4}
                  value={ordemFallback()}
                  onInput={(e) => setOrdemFallback(e.currentTarget.value)}
                  class="w-full bg-zinc-900/80 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-200 font-mono focus:outline-none focus:border-zinc-600 leading-relaxed scrollbar-thin"
                />
                <span class="text-[11px] text-zinc-500 mt-1 block">
                  Em caso de erro 429, timeout ou cota esgotada, o sistema rotaciona automaticamente para o próximo modelo.
                </span>
              </div>
            </div>

            {/* PARÂMETROS ADICIONAIS DE MODELO DO SISTEMA */}
            <div class="pt-4 border-t border-zinc-800/40 space-y-1">
              <span class="text-xs font-semibold text-zinc-300 uppercase tracking-wider block mb-2">
                Fallback e Agentes Especiais
              </span>
              <div class="divide-y divide-zinc-800/40">
                <SettingRow
                  chave="default_model"
                  label="Modelo Fallback dos Agentes"
                  descricao="Utilizado como fallback padrão para agentes sem modelo definido no frontmatter."
                  tipo="text"
                />
                <SettingRow
                  chave="test_model"
                  label="Modelo Avaliador dos Testes"
                  descricao="Juiz independente utilizado para avaliar outputs e pontuar execuções cegas."
                  tipo="text"
                />
                <SettingRow
                  chave="secretary.agent"
                  label="Agente do Secretário Executivo"
                  descricao="Qual agente atende o chat corporativo e executa ordens (ex: secretario / secretario-exec)."
                  tipo="text"
                />
                <SettingRow
                  chave="secretary.model"
                  label="Override de Modelo do Secretário"
                  descricao="Modelo específico para o chat do Secretário. Deixe vazio para herdar o template."
                  tipo="text"
                />
              </div>
            </div>

            <div class="pt-2 flex justify-end">
              <Button
                size="sm"
                variant="primary"
                loading={salvando()}
                onClick={salvarModelos}
              >
                <Save size={13} class="mr-1.5" /> Salvar Configurações de Modelos
              </Button>
            </div>
          </div>
        </Show>

        {/* ─────────────────────────────────────────────────────────────
            ABA ORÇAMENTO & CUSTOS
           ───────────────────────────────────────────────────────────── */}
        <Show when={abaAtiva() === "orcamento"}>
          <div class="space-y-6 bg-transparent">
            <div class="pb-1 border-b border-zinc-800/40">
              <h2 class="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <Coins size={15} class="text-zinc-400" />
                Limites de Gasto & Orçamento Financeiro
              </h2>
              <p class="text-xs text-zinc-400 mt-0.5">
                Controle de custos diários, tetos por agente e pausa preventiva ao estourar orçamento.
              </p>
            </div>

            <div class="divide-y divide-zinc-800/40">
              <SettingRow
                chave="budget.daily_usd"
                label="Teto Diário do Workspace (USD)"
                descricao="Limite financeiro total em dólares permitido por dia para todas as tarefas do workspace."
                tipo="number"
                step="0.5"
                min="0"
              />
              <SettingRow
                chave="budget.per_agent_usd"
                label="Teto por Agente (USD)"
                descricao="Custo máximo permitido para uma única execução de agente autônomo."
                tipo="number"
                step="0.25"
                min="0"
              />
              <SettingRow
                chave="budget.pause_on_exceed"
                label="Pausar Agentes ao Estourar"
                descricao="Gera aviso ao atingir 80% do orçamento e pausa novos disparos preventivamente ao atingir 100%."
                tipo="bool"
              />
              <SettingRow
                chave="budget.notify_registry"
                label="Registry de Notificação"
                descricao="Canal ou registry do sistema que recebe alertas quando o consumo atinge limites."
                tipo="text"
              />
            </div>
          </div>
        </Show>

        {/* ─────────────────────────────────────────────────────────────
            ABA CHAVES DE API (CRUD REAL GLOBAL × WORKSPACE)
           ───────────────────────────────────────────────────────────── */}
        <Show when={abaAtiva() === "chaves"}>
          <div class="space-y-6 bg-transparent">
            <div class="flex items-center justify-between pb-1 border-b border-zinc-800/40">
              <div>
                <h2 class="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                  <Key size={15} class="text-zinc-400" />
                  Gerenciamento Seguro de Chaves de API
                </h2>
                <p class="text-xs text-zinc-400 mt-0.5">
                  Chaves de API para os motores e inferência direta, com herança por workspace.
                </p>
              </div>
              <Button size="xs" variant="ghost" loading={carregandoChaves()} onClick={carregarChaves}>
                <RefreshCw size={12} class="mr-1" /> Atualizar
              </Button>
            </div>

            {/* TABELA DE CHAVES ATIVAS */}
            <div class="space-y-3">
              <span class="text-xs font-semibold text-zinc-300 uppercase tracking-wider block">
                Chaves Configuradas no Sistema
              </span>

              <div class="divide-y divide-zinc-800/40">
                <For each={chavesApi()?.global?.chaves || []}>
                  {(chk: any) => (
                    <div class="py-3 flex items-center justify-between bg-transparent">
                      <div class="flex items-center gap-3">
                        <div class="h-7 w-7 rounded-md bg-zinc-800/60 flex items-center justify-center text-zinc-300 font-mono text-xs">
                          {chk.provider.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div class="flex items-center gap-2">
                            <span class="text-xs font-medium text-zinc-100">{chk.provider}</span>
                            <span class="px-1.5 py-0.2 rounded text-[10px] font-mono text-zinc-400 bg-zinc-800/60">
                              Escopo Global
                            </span>
                          </div>
                          <span class="text-[11px] font-mono text-zinc-500">{chk.preview}</span>
                        </div>
                      </div>

                      <div class="flex items-center gap-2">
                        <Button
                          size="xs"
                          variant="secondary"
                          onClick={() => testarConexaoModelo(chk.provider === "openrouter" ? "google/gemini-3.8-flash" : chk.provider)}
                        >
                          <Play size={10} class="mr-1 text-zinc-400" /> Testar
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          class="text-zinc-400 hover:text-rose-400"
                          onClick={() => removerChave(chk.provider, "global")}
                        >
                          <Trash2 size={12} />
                        </Button>
                      </div>
                    </div>
                  )}
                </For>

                <Show when={chavesApi()?.global?.chaves?.length === 0}>
                  <div class="py-6 text-center text-xs text-zinc-500">
                    Nenhuma chave cadastrada ainda. Adicione abaixo para habilitar o OpenRouter ou outros provedores.
                  </div>
                </Show>
              </div>
            </div>

            {/* FORMULÁRIO DE ADICIONAR / ATUALIZAR CHAVE */}
            <div class="pt-4 border-t border-zinc-800/40 space-y-3">
              <span class="text-xs font-semibold text-zinc-200 block">Adicionar ou Atualizar Chave de Provedor</span>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label class="block text-[11px] font-medium text-zinc-400 mb-1">Provedor</label>
                  <select
                    value={novoProvider()}
                    onChange={(e) => setNovoProvider(e.currentTarget.value)}
                    class="w-full bg-zinc-900/80 border border-zinc-800 rounded-lg px-2.5 py-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-600"
                  >
                    <option value="openrouter">OpenRouter (Universal)</option>
                    <option value="google">Google AI Studio Direto</option>
                    <option value="anthropic">Anthropic API</option>
                    <option value="openai">OpenAI API</option>
                    <option value="opencode-go">OpenCode-Go</option>
                  </select>
                </div>

                <div>
                  <label class="block text-[11px] font-medium text-zinc-400 mb-1">Escopo</label>
                  <select
                    value={novoEscopo()}
                    onChange={(e) => setNovoEscopo(e.currentTarget.value as any)}
                    class="w-full bg-zinc-900/80 border border-zinc-800 rounded-lg px-2.5 py-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-600"
                  >
                    <option value="global">Global (Todo o Sistema)</option>
                    <option value="workspace">Workspace Atual</option>
                  </select>
                </div>

                <div>
                  <label class="block text-[11px] font-medium text-zinc-400 mb-1">Chave de API (Token)</label>
                  <input
                    type="password"
                    placeholder="sk-or-v1-..."
                    value={novaChaveValor()}
                    onInput={(e) => setNovaChaveValor(e.currentTarget.value)}
                    class="w-full bg-zinc-900/80 border border-zinc-800 rounded-lg px-2.5 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-zinc-600"
                  />
                </div>
              </div>

              <div class="pt-2 flex justify-end">
                <Button
                  size="xs"
                  variant="primary"
                  loading={salvandoChave()}
                  onClick={adicionarChave}
                >
                  <Plus size={12} class="mr-1" /> Salvar Chave
                </Button>
              </div>

              {/* SEÇÃO SEGREDOS CORPORATIVOS */}
              <div class="pt-6 border-t border-zinc-800/40 space-y-4">
                <div class="flex items-center justify-between">
                  <div>
                    <span class="text-xs font-semibold text-zinc-200 block">Segredos de Ambiente (.secrets.json)</span>
                    <p class="text-[11px] text-zinc-500">Variáveis confidenciais protegidas gravadas em ~/.opencorp/secrets.json.</p>
                  </div>
                  <Button size="xs" variant="ghost" onClick={carregarSecrets}>
                    <RefreshCw size={12} class="mr-1" /> Atualizar
                  </Button>
                </div>

                <div class="divide-y divide-zinc-800/40">
                  <For each={secretsLista()}>
                    {(sec) => (
                      <div class="py-2.5 flex items-center justify-between bg-transparent">
                        <div class="flex items-center gap-2">
                          <Lock size={12} class="text-zinc-500" />
                          <span class="font-mono text-xs text-zinc-200">{sec.nome}</span>
                          <span class="text-[10px] font-mono text-zinc-500">• protegido</span>
                        </div>
                        <Button
                          size="xs"
                          variant="ghost"
                          class="text-zinc-500 hover:text-rose-400"
                          onClick={() => removerSecret(sec.nome)}
                        >
                          <Trash2 size={12} />
                        </Button>
                      </div>
                    )}
                  </For>
                  <Show when={secretsLista().length === 0}>
                    <div class="py-4 text-center text-xs text-zinc-500">
                      Nenhum segredo cadastrado neste escopo.
                    </div>
                  </Show>
                </div>

                {/* Form adicionar secret */}
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2">
                  <div>
                    <label class="block text-[11px] font-medium text-zinc-400 mb-1">Nome da Variável</label>
                    <input
                      type="text"
                      placeholder="API_SECRET_KEY"
                      value={novoSecretNome()}
                      onInput={(e) => setNovoSecretNome(e.currentTarget.value)}
                      class="w-full bg-zinc-900/80 border border-zinc-800 rounded-lg px-2.5 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-zinc-600"
                    />
                  </div>
                  <div>
                    <label class="block text-[11px] font-medium text-zinc-400 mb-1">Valor Confidencial</label>
                    <input
                      type="password"
                      placeholder="••••••••••••"
                      value={novoSecretValor()}
                      onInput={(e) => setNovoSecretValor(e.currentTarget.value)}
                      class="w-full bg-zinc-900/80 border border-zinc-800 rounded-lg px-2.5 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-zinc-600"
                    />
                  </div>
                  <div class="flex items-end">
                    <Button
                      size="xs"
                      variant="primary"
                      loading={salvandoSecret()}
                      onClick={salvarSecret}
                      class="w-full h-[34px]"
                    >
                      <Plus size={12} class="mr-1" /> Adicionar Segredo
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Show>

        {/* ─────────────────────────────────────────────────────────────
            ABA SEGURANÇA & HITL
           ───────────────────────────────────────────────────────────── */}
        <Show when={abaAtiva() === "seguranca"}>
          <div class="space-y-6 bg-transparent">
            <div class="pb-1 border-b border-zinc-800/40">
              <h2 class="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <ShieldCheck size={15} class="text-zinc-400" />
                Modo de Permissão & Autonomia dos Agentes
              </h2>
              <p class="text-xs text-zinc-400 mt-0.5">
                Escolha o nível de intervenção humana (HITL) para as execuções e rondas do workspace.
              </p>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div
                class={`p-3 rounded-lg border cursor-pointer transition-colors ${
                  nivelSeguranca() === "permissive"
                    ? "bg-zinc-800/80 border-zinc-600 text-zinc-100"
                    : "bg-transparent border-zinc-800 text-zinc-400 hover:border-zinc-700"
                }`}
                onClick={() => setNivelSeguranca("permissive")}
              >
                <div class="font-semibold text-xs text-zinc-100 mb-1 flex items-center gap-1.5">
                  <ShieldCheck size={13} class="text-zinc-300" /> Livre (Autônomo)
                </div>
                <div class="text-[11px] leading-relaxed text-zinc-400">
                  Sem pedir permissão para rotinas ou rede. Roda direto 24h sem interrupções.
                </div>
              </div>

              <div
                class={`p-3 rounded-lg border cursor-pointer transition-colors ${
                  nivelSeguranca() === "standard"
                    ? "bg-zinc-800/80 border-zinc-600 text-zinc-100"
                    : "bg-transparent border-zinc-800 text-zinc-400 hover:border-zinc-700"
                }`}
                onClick={() => setNivelSeguranca("standard")}
              >
                <div class="font-semibold text-xs text-zinc-100 mb-1 flex items-center gap-1.5">
                  <ShieldAlert size={13} class="text-zinc-300" /> Equilibrado
                </div>
                <div class="text-[11px] leading-relaxed text-zinc-400">
                  Aprova comandos normais e pede confirmação apenas para ações sensíveis.
                </div>
              </div>

              <div
                class={`p-3 rounded-lg border cursor-pointer transition-colors ${
                  nivelSeguranca() === "strict"
                    ? "bg-zinc-800/80 border-zinc-600 text-zinc-100"
                    : "bg-transparent border-zinc-800 text-zinc-400 hover:border-zinc-700"
                }`}
                onClick={() => setNivelSeguranca("strict")}
              >
                <div class="font-semibold text-xs text-zinc-100 mb-1 flex items-center gap-1.5">
                  <ShieldX size={13} class="text-zinc-300" /> Restrito
                </div>
                <div class="text-[11px] leading-relaxed text-zinc-400">
                  Pede confirmação humana (HITL) para qualquer comando bash ou rede.
                </div>
              </div>
            </div>

            {/* Allowlist de Rede */}
            <div class="space-y-2 pt-2 border-t border-zinc-800/40">
              <label class="block text-xs font-semibold text-zinc-200">
                Allowlist de Domínios de Rede (separados por vírgula)
              </label>
              <input
                type="text"
                value={allowlistRede()}
                onInput={(e) => setAllowlistRede(e.currentTarget.value)}
                class="w-full bg-zinc-900/80 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-600"
              />
            </div>

            {/* Parâmetros de Blocklist e HITL */}
            <div class="pt-4 border-t border-zinc-800/40 space-y-1">
              <span class="text-xs font-semibold text-zinc-300 uppercase tracking-wider block mb-2">
                Filtros e Aprovação Humana (HITL)
              </span>
              <div class="divide-y divide-zinc-800/40">
                <SettingRow
                  chave="security.blocklist"
                  label="Comandos Bloqueados (Blocklist)"
                  descricao="Comandos cujo disparo direto pelo terminal bash é terminantemente proibido (1 por linha)."
                  tipo="textarea"
                />
                <SettingRow
                  chave="security.hitl_patterns"
                  label="Padrões que Exigem Aprovação Humana"
                  descricao="Padrões que, se identificados no plano ou comando, pausarão o agente para aprovação humana (1 por linha)."
                  tipo="textarea"
                />
              </div>
            </div>

            <div class="pt-2 flex justify-end">
              <Button size="sm" variant="primary" loading={salvando()} onClick={salvarSeguranca}>
                <Save size={13} class="mr-1.5" /> Salvar Política de Segurança
              </Button>
            </div>
          </div>
        </Show>

        {/* ─────────────────────────────────────────────────────────────
            ABA SCHEDULER & SUPERVISOR
           ───────────────────────────────────────────────────────────── */}
        <Show when={abaAtiva() === "scheduler"}>
          <div class="space-y-6 bg-transparent">
            <div class="pb-1 border-b border-zinc-800/40">
              <h2 class="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <Clock size={15} class="text-zinc-400" />
                Supervisor em Segundo Plano & Scheduler
              </h2>
              <p class="text-xs text-zinc-400 mt-0.5">
                Manutenção preventiva de rotinas, limpeza de locks zumbis e resgate de tarefas agendadas.
              </p>
            </div>

            <div class="divide-y divide-zinc-800/40">
              <SettingRow
                chave="supervisor.enabled"
                label="Supervisor Ativo"
                descricao="Executa rotina contínua de auditoria que limpa processos zumbis e reencaixa ordens travadas."
                tipo="bool"
              />
              <SettingRow
                chave="supervisor.interval_minutes"
                label="Intervalo de Ciclo do Supervisor (minutos)"
                descricao="Frequência em minutos com que o supervisor audita os locks e o estado da empresa."
                tipo="number"
                min="1"
              />
              <SettingRow
                chave="supervisor.max_orders_per_tick"
                label="Máximo de Ordens por Ciclo"
                descricao="Quantidade máxima de tarefas que o supervisor pode disparar em uma mesma verificação."
                tipo="number"
                min="1"
              />
              <SettingRow
                chave="scheduler.catch_up"
                label="Catch-up de Tarefas Atrasadas"
                descricao="Se o daemon reiniciar ou a máquina suspender, executa tarefas que perderam a janela de agendamento."
                tipo="bool"
              />
              <SettingRow
                chave="scheduler.catch_up_max_min"
                label="Janela Máxima de Catch-up (minutos)"
                descricao="Teto máximo em minutos para resgatar uma tarefa atrasada antes de descartá-la com log."
                tipo="number"
                min="1"
              />
            </div>
          </div>
        </Show>

        {/* ─────────────────────────────────────────────────────────────
            ABA WORKSPACE & DIRETÓRIOS
           ───────────────────────────────────────────────────────────── */}
        <Show when={abaAtiva() === "workspace"}>
          <div class="space-y-6 bg-transparent">
            <div class="pb-1 border-b border-zinc-800/40">
              <h2 class="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <Folder size={15} class="text-zinc-400" />
                Diretórios & Estrutura de Workspaces
              </h2>
              <p class="text-xs text-zinc-400 mt-0.5">
                Localização física onde residem as empresas, repositórios de código e artefatos de execução.
              </p>
            </div>

            <div class="divide-y divide-zinc-800/40">
              <SettingRow
                chave="paths.workspaces_root"
                label="Diretório Raiz dos Workspaces"
                descricao="Caminho base no disco onde novas empresas e workspaces são criados e clonados."
                tipo="text"
              />
            </div>

            <div class="pt-4 border-t border-zinc-800/40 space-y-3">
              <span class="text-xs font-semibold text-zinc-300 uppercase tracking-wider block">
                Caminhos Padrão do Sistema Operacional
              </span>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div class="p-3 rounded-lg bg-zinc-900/30 border border-zinc-800/60 space-y-1">
                  <span class="text-zinc-200 font-medium block">Home OpenCorp</span>
                  <p class="text-[11px] font-mono text-zinc-400">~/.opencorp</p>
                </div>
                <div class="p-3 rounded-lg bg-zinc-900/30 border border-zinc-800/60 space-y-1">
                  <span class="text-zinc-200 font-medium block">Ledger & Registries</span>
                  <p class="text-[11px] font-mono text-zinc-400">registries/corp.db</p>
                </div>
                <div class="p-3 rounded-lg bg-zinc-900/30 border border-zinc-800/60 space-y-1">
                  <span class="text-zinc-200 font-medium block">Relatórios de Testes</span>
                  <p class="text-[11px] font-mono text-zinc-400">.opencorp/reports/testes</p>
                </div>
              </div>
            </div>
          </div>
        </Show>

        {/* ─────────────────────────────────────────────────────────────
            ABA TESTES CEGOS & BENCHMARKS
           ───────────────────────────────────────────────────────────── */}
        <Show when={abaAtiva() === "testes"}>
          <div class="space-y-6 bg-transparent">
            <div class="pb-1 border-b border-zinc-800/40">
              <h2 class="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <CircleCheck size={15} class="text-zinc-400" />
                Testes Cegos & Avaliação de Agentes
              </h2>
              <p class="text-xs text-zinc-400 mt-0.5">
                Modelos juízes e auditorias automatizadas para aferir conformidade e qualidade dos agentes.
              </p>
            </div>

            <div class="divide-y divide-zinc-800/40">
              <SettingRow
                chave="tests.blind"
                label="Testes Cegos Ativos"
                descricao="Executa avaliações cegas onde um modelo juiz independente valida a entrega do agente."
                tipo="bool"
              />
              <SettingRow
                chave="tests.test_model"
                label="Modelo Juiz Principal"
                descricao="Identificador provider/modelo utilizado para inspecionar saídas e emitir vereditos."
                tipo="text"
              />
              <SettingRow
                chave="tests.rotation"
                label="Rotação de Juízes de Teste"
                descricao="Lista de modelos alternativos para revezamento na avaliação dos testes (1 por linha)."
                tipo="textarea"
              />
              <SettingRow
                chave="tests.timeout_minutes"
                label="Timeout dos Testes (minutos)"
                descricao="Tempo limite máximo para cada sessão de teste cego ou benchmark."
                tipo="number"
                min="1"
              />
              <SettingRow
                chave="tests.reports_dir"
                label="Diretório dos Relatórios"
                descricao="Caminho relativo ou absoluto onde os relatórios de auditoria de testes são gravados."
                tipo="text"
              />
              <SettingRow
                chave="tests.health_check"
                label="Health Check Automatizado"
                descricao="Dispara checagem periódica de saúde de dependências e binários de agentes."
                tipo="bool"
              />
            </div>
          </div>
        </Show>

        {/* ─────────────────────────────────────────────────────────────
            ABA REUNIÕES & AUTO-HEALING
           ───────────────────────────────────────────────────────────── */}
        <Show when={abaAtiva() === "reunioes"}>
          <div class="space-y-6 bg-transparent">
            <div class="pb-1 border-b border-zinc-800/40">
              <h2 class="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <Users size={15} class="text-zinc-400" />
                Salas de Reunião & Auto-Healing de Falhas
              </h2>
              <p class="text-xs text-zinc-400 mt-0.5">
                Governança para reuniões autônomas entre múltiplos agentes e recuperação automática de erros.
              </p>
            </div>

            <div class="divide-y divide-zinc-800/40">
              <SettingRow
                chave="healing.enabled"
                label="Auto-Cura / Healing de Falhas"
                descricao="Ao encontrar erros de execução ou sintaxe, dispara rotina de reparação imediata."
                tipo="bool"
              />
              <SettingRow
                chave="healing.max_retries"
                label="Máximo de Tentativas de Auto-Healing"
                descricao="Número de vezes que o sistema tentará consertar um agente antes de registrar falha definitiva."
                tipo="number"
                min="0"
              />
              <SettingRow
                chave="meeting.moderator"
                label="Agente Moderador da Reunião"
                descricao="Agente responsável por abrir a pauta, coordenar as falas e encerrar a sessão."
                tipo="text"
              />
              <SettingRow
                chave="meeting.max_minutes"
                label="Duração Máxima da Reunião (minutos)"
                descricao="Tempo limite após o qual a reunião é finalizada compulsoriamente gerando a ata."
                tipo="number"
                min="1"
              />
              <SettingRow
                chave="meeting.max_turns"
                label="Máximo de Turnos por Reunião"
                descricao="Quantidade máxima de mensagens trocadas entre agentes em uma mesma sessão."
                tipo="number"
                min="1"
              />
              <SettingRow
                chave="meeting.per_agent_usd"
                label="Orçamento por Agente na Reunião (USD)"
                descricao="Limite de custo de inferência alocado para cada participante durante a reunião."
                tipo="number"
                step="0.1"
                min="0"
              />
              <SettingRow
                chave="meeting.ata_model_rotation"
                label="Modelos para Síntese da Ata"
                descricao="Rotação de modelos utilizados para transcrever e resumir a ata final da reunião (1 por linha)."
                tipo="textarea"
              />
            </div>
          </div>
        </Show>

        {/* ─────────────────────────────────────────────────────────────
            ABA FERRAMENTAS DO WORKSPACE (TOOLS & MCP)
           ───────────────────────────────────────────────────────────── */}
        <Show when={abaAtiva() === "ferramentas"}>
          <div class="space-y-6 bg-transparent">
            <div class="flex items-center justify-between pb-1 border-b border-zinc-800/40">
              <div>
                <h2 class="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                  <Wrench size={15} class="text-zinc-400" />
                  Ferramentas & Integrações (Tools)
                </h2>
                <p class="text-xs text-zinc-400 mt-0.5">
                  Catálogo de ferramentas disponíveis em .opencorp/tools/ com especificações e permissões de execução.
                </p>
              </div>
              <Button size="xs" variant="ghost" loading={carregandoTools()} onClick={carregarTools}>
                <RefreshCw size={12} class="mr-1" /> Atualizar
              </Button>
            </div>

            <div class="divide-y divide-zinc-800/40">
              <For each={toolsLista()}>
                {(t: any) => {
                  const spec = t.spec || {};
                  return (
                    <div class="py-3.5 space-y-2 bg-transparent">
                      <div class="flex items-center justify-between gap-2 flex-wrap">
                        <div class="flex items-center gap-2">
                          <span class="font-mono text-xs font-semibold text-zinc-200">{t.id}</span>
                          <Show when={spec.titulo}>
                            <span class="text-xs text-zinc-400">· {spec.titulo}</span>
                          </Show>
                        </div>
                        <div class="flex items-center gap-1.5">
                          <Show when={spec.handler?.tipo}>
                            <span class="px-1.5 py-0.2 rounded text-[10px] font-mono text-cyan-400 bg-cyan-950/40 border border-cyan-800/40">
                              handler: {spec.handler.tipo}
                            </span>
                          </Show>
                          <Show when={spec.approval}>
                            <span class={`px-1.5 py-0.2 rounded text-[10px] font-mono border ${
                              spec.approval === "nunca"
                                ? "text-emerald-400 bg-emerald-950/40 border-emerald-800/40"
                                : "text-amber-400 bg-amber-950/40 border-amber-800/40"
                            }`}>
                              approval: {spec.approval}
                            </span>
                          </Show>
                        </div>
                      </div>

                      <Show when={spec.descricao}>
                        <p class="text-[11px] text-zinc-400">{spec.descricao}</p>
                      </Show>

                      <details class="text-[11px] text-zinc-500">
                        <summary class="cursor-pointer hover:text-zinc-300 transition-colors">
                          Ver especificação técnica JSON
                        </summary>
                        <pre class="mt-2 p-2.5 rounded-md bg-zinc-900/60 border border-zinc-800/60 font-mono text-[10px] text-zinc-300 overflow-x-auto">
                          {JSON.stringify(spec, null, 2)}
                        </pre>
                      </details>
                    </div>
                  );
                }}
              </For>

              <Show when={toolsLista().length === 0}>
                <div class="py-8 text-center text-xs text-zinc-500">
                  Nenhuma ferramenta customizada registrada em .opencorp/tools/.
                </div>
              </Show>
            </div>
          </div>
        </Show>

        {/* ─────────────────────────────────────────────────────────────
            ABA GERAL & OPERACIONAL
           ───────────────────────────────────────────────────────────── */}
        <Show when={abaAtiva() === "geral"}>
          <div class="space-y-6 bg-transparent">
            <div class="pb-1 border-b border-zinc-800/40">
              <h2 class="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <Settings size={15} class="text-zinc-400" />
                Parâmetros Gerais, Nuvem & Operacional
              </h2>
              <p class="text-xs text-zinc-400 mt-0.5">
                Sincronização em nuvem, tema da interface e timeouts operacionais do sistema.
              </p>
            </div>

            <div class="divide-y divide-zinc-800/40">
              <SettingRow
                chave="cloud.enabled"
                label="Sincronização em Nuvem / Backup"
                descricao="Ativa rotinas de backup e sincronização dos dados da empresa."
                tipo="bool"
              />
              <SettingRow
                chave="cloud.mode"
                label="Modo de Nuvem"
                descricao="Estratégia de backup e contingência remota."
                tipo="select"
                opcoes={[
                  { valor: "backup-local", label: "Backup Local (Sem Nuvem)" },
                  { valor: "backup-nuvem", label: "Backup em Nuvem" },
                  { valor: "mirror-remoto", label: "Mirror Remoto Contínuo" },
                ]}
              />
              <SettingRow
                chave="cloud.targets"
                label="Alvos de Sincronização Remota"
                descricao="Lista de endpoints ou destinos remotos de backup (1 por linha)."
                tipo="textarea"
              />
              <SettingRow
                chave="ui.theme"
                label="Tema da Interface Web"
                descricao="Aparência visual do painel OpenCorp."
                tipo="select"
                opcoes={[
                  { valor: "dark", label: "Escuro (Dark)" },
                  { valor: "light", label: "Claro (Light)" },
                ]}
              />
              <SettingRow
                chave="ui.verbose"
                label="Modo Verboso / Detalhado"
                descricao="Emite detalhes estendidos nos logs do servidor e no console do navegador."
                tipo="bool"
              />
            </div>

            <div class="pt-4 border-t border-zinc-800/40 space-y-3">
              <span class="text-xs font-semibold text-zinc-300 uppercase tracking-wider block">
                Timeouts e Proteções Globais
              </span>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div class="p-3 rounded-lg bg-zinc-900/30 border border-zinc-800/60 space-y-1">
                  <span class="text-zinc-200 font-medium block">Fast-Fail de Stream (35s)</span>
                  <p class="text-[11px] text-zinc-400 leading-relaxed">
                    Encerra requisições de stream que congelarem por mais de 35 segundos sem gerar novos tokens.
                  </p>
                </div>

                <div class="p-3 rounded-lg bg-zinc-900/30 border border-zinc-800/60 space-y-1">
                  <span class="text-zinc-200 font-medium block">Watchdog Global (20 min)</span>
                  <p class="text-[11px] text-zinc-400 leading-relaxed">
                    Teto máximo absoluto de segurança para qualquer turno de agente autônomo.
                  </p>
                </div>
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div class="p-3 rounded-lg bg-zinc-900/30 border border-zinc-800/60 space-y-1">
                <span class="text-zinc-200 font-medium block">Fast-Fail de Stream (35s)</span>
                <p class="text-[11px] text-zinc-400 leading-relaxed">
                  Encerra requisições de stream que congelarem por mais de 35 segundos sem gerar novos tokens.
                </p>
              </div>

              <div class="p-3 rounded-lg bg-zinc-900/30 border border-zinc-800/60 space-y-1">
                <span class="text-zinc-200 font-medium block">Watchdog Global (20 min)</span>
                <p class="text-[11px] text-zinc-400 leading-relaxed">
                  Teto máximo absoluto de segurança para qualquer turno de agente autônomo.
                </p>
              </div>

              <div class="p-3 rounded-lg bg-zinc-900/30 border border-zinc-800/60 space-y-1">
                <span class="text-zinc-200 font-medium block">Diretório de Configurações</span>
                <p class="text-[11px] font-mono text-zinc-400">~/.opencorp</p>
              </div>

              <div class="p-3 rounded-lg bg-zinc-900/30 border border-zinc-800/60 space-y-1">
                <span class="text-zinc-200 font-medium block">Banco de Dados Ledger</span>
                <p class="text-[11px] font-mono text-zinc-400">registries/corp.db</p>
              </div>
            </div>
          </div>
        </Show>
      </div>

      <EngineAuthModal
        open={Boolean(motorSelecionadoAuth())}
        onClose={() => setMotorSelecionadoAuth(null)}
        motor={motorSelecionadoAuth()}
        onSuccess={carregarStatusMotores}
        onGoToKeysTab={() => setAbaAtiva("chaves")}
      />
    </div>
  );
};
