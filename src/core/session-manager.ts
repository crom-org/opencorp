import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { execa } from "execa";
import type { Agente } from "../schemas/agent.js";
import { AgentStore } from "./agent-store.js";
import { SessionError } from "./errors.js";
import { OpenCodeBridge } from "./opencode-bridge.js";
import { RegistryStore, type MetaRegistro } from "./registry-store.js";
import { eventBus } from "./event-bus.js";
import { WorkspaceManager } from "./workspace-manager.js";
import { ApprovalsStore } from "./approvals-store.js";
import { BudgetManager } from "./budget-manager.js";
import { avaliar, casaPadrao } from "./security-guard.js";
import { parseSecurityPolicyTexto } from "../schemas/security-policy.js";
import { gatilhoSchema, type Gatilho } from "../schemas/gatilho.js";
import { mkdirRecursive } from "../utils/fs-safe.js";
import { opencorpHome, resolvePath } from "../utils/paths.js";
import { envOpencodeIsolado } from "./opencode-server.js";
import { SettingsStore } from "./settings-store.js";
import { engineRegistry } from "./engines/index.js";

export type StatusExecucao = "executando" | "concluido" | "falhou" | "cancelado" | "hitl_pendente";

export interface OpcoesRun {
  agente: string;
  ordem?: string;
  file?: string;
  model?: string;
  /** Motor de execução explicitamente solicitado para esta ordem (sobrescreve frontmatter e sistema) */
  engine?: string;
  /** Alias para engine */
  harness?: string;
  session?: string;
  title?: string;
  workspaceId?: string;
  workspaceDir?: string;
  pularGuard?: boolean;
  tags?: string[];
  referencias?: string[];
  tipo?: string;
  execId?: string;
  /** teto de execução em ms — watchdog HITL-aware mata o opencode (SIGTERM→SIGKILL) e finaliza "falhou" */
  timeoutMs?: number;
  /** intervalo de checagem do watchdog em ms (padrão 30s) — knob de teste */
  watchdogIntervalMs?: number;
  /** graça SIGTERM→SIGKILL do watchdog em ms (padrão 5s) — knob de teste */
  watchdogGracaMs?: number;
  /** uso interno (retry de rotação de modelo e motor): marca este run como retry de outra execução */
  retryDe?: {
    de_modelo: string;
    de_harness?: string;
    de_exec: string;
    tentativas?: number;
    modelosTentados?: string[];
    motoresTentados?: string[];
  };
  /**
   * Gatilho da execução (PLANO-UNIFICACAO): quem chamou e por quê — cron, menção, nó de flow,
   * passo de team, turno de reunião, evento ou manual. Vai para extras, ledger (corp.db) e eventos.
   */
  gatilho?: Gatilho;
}

export interface ResultadoRun extends RegistroExecucao {
  captura: string;
  custo_usd: number | null;
}

export interface RegistroExecucao {
  id: string;
  agente: string;
  modelo: string;
  ordem: string;
  inicio: string;
  fim: string | null;
  status: StatusExecucao;
  exit_code: number | null;
  duracao_ms: number | null;
  pid: number | null;
  log: string;
  gatilho?: Gatilho;
}

export interface ResumoExecucao {
  id: string;
  agente: string;
  modelo: string;
  status: StatusExecucao;
  inicio: string;
  duracao_ms: number | null;
  exit_code: number | null;
  gatilho?: Gatilho;
}

function msg(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

export function gerarIdExecucao(prefixo = "exec"): string {
  return gerarId(prefixo);
}

function gerarId(prefixo: string): string {
  const agora = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const ts = `${agora.getFullYear()}${p2(agora.getMonth() + 1)}${p2(agora.getDate())}-${p2(agora.getHours())}${p2(agora.getMinutes())}${p2(agora.getSeconds())}`;
  return `${prefixo}-${ts}-${randomUUID().slice(0, 4)}`;
}

export const PADRAO_ERRO_MODELO =
  /usage limit|Cannot connect to API|AI_APICallError|rate limit|free-models-per-day|quota|429|overloaded|resource exhausted|unavailable for free|model not found|not available|Provider not found|from --model flag|insufficient balance|payment_required|402|credit balance|temporarily unavailable|Provider returned error|requires more credits|can only afford|billing_not_active|exceeded.*quota|insufficient.?credits|add (?:more )?credits|exceed.*credits|in-flight requests|database is locked|sqlite_busy/i;

export const PADRAO_ERRO_CREDITOS =
  /requires more credits|can only afford|insufficient balance|payment_required|402|credit balance|billing_not_active|exceeded.*quota|insufficient.?credits|add (?:more )?credits|exceed.*credits/i;

export function ehModeloGratuito(modelo: string): boolean {
  const m = modelo.trim().toLowerCase();
  if (m.endsWith(":free")) return true;
  if (m.startsWith("opencode-go/")) return true;
  if (m.startsWith("antigravity/")) return true;
  if (m.startsWith("claude-code/")) return true;
  if (m.includes("free")) return true;
  return false;
}

export const MODELOS_ROTACAO_PADRAO = [
  "opencode-go/glm-5.3-flash",
  "openrouter/meta-llama/llama-3.3-70b-instruct",
  "opencode/nemotron-3.5-lightning-free",
  "opencode/nemotron-3-ultra-free",
  "opencode-go/minimax-m3",
  "opencode-go/deepseek-v4-flash",
  "openrouter/google/gemini-2.5-flash",
];

const TETO_RUN_PADRAO_MIN = 20;
const ENV_TETO_RUN_MIN = "OPENCORP_RUN_TIMEOUT_MIN";

export async function tetoRunPadraoMs(homeDir?: string): Promise<number | undefined> {
  const env = process.env[ENV_TETO_RUN_MIN];
  if (env !== undefined && env.trim() !== "") {
    const n = Number(env.trim());
    if (Number.isFinite(n)) {
      if (n <= 0) return undefined;
      return Math.round(n * 60_000);
    }
  }
  try {
    const { settings } = await new SettingsStore({ homeDir }).resolve();
    const runs = (settings as unknown as { runs?: { timeout_min?: number } }).runs;
    if (typeof runs?.timeout_min === "number" && runs.timeout_min > 0) {
      return Math.round(runs.timeout_min * 60_000);
    }
  } catch {
    /* settings indisponível — cai no padrão */
  }
  return TETO_RUN_PADRAO_MIN * 60_000;
}

export function proximoModeloRotacao(lista: string[], modeloFalho: string): string | null {
  const limpa = lista.map((m) => m.trim()).filter((m) => m.length > 0);
  if (limpa.length === 0) return null;
  const idx = limpa.indexOf(modeloFalho);
  if (idx === -1) return limpa[0] !== modeloFalho ? limpa[0]! : null;
  const proximo = limpa[(idx + 1) % limpa.length]!;
  return proximo !== modeloFalho ? proximo : null;
}

export async function obterListaRotacaoCompleta(
  agenteStore?: AgentStore,
  wsPath?: string,
  agenteId?: string,
  homeDir?: string,
): Promise<string[]> {
  const lista: string[] = [];
  if (agenteStore && wsPath && agenteId) {
    try {
      const ag = await agenteStore.carregar(wsPath, agenteId);
      const rot = ag.frontmatter.rotation || ag.frontmatter.model_fallback;
      if (Array.isArray(rot)) {
        for (const m of rot) {
          const s = String(m).trim();
          if (s && !lista.includes(s)) lista.push(s);
        }
      }
    } catch {}
  }
  let globalLista = MODELOS_ROTACAO_PADRAO;
  try {
    const r = await new SettingsStore({ homeDir, cwd: wsPath ?? homeDir }).resolve();
    const configurada = [...r.origens.entries()].some(
      ([chave, origem]) => chave.startsWith("tests.rotation") && origem !== "default",
    );
    if (configurada && r.settings.tests.rotation.length > 0) {
      globalLista = [...r.settings.tests.rotation];
    }
    const defOrigem = r.origens.get("default_model");
    if (defOrigem && defOrigem !== "default" && r.settings.default_model && typeof r.settings.default_model === "string") {
      const def = r.settings.default_model.trim();
      if (def && !globalLista.includes(def)) {
        globalLista.push(def);
      }
    }
  } catch {}

  for (const m of globalLista) {
    const s = String(m).trim();
    if (s && !lista.includes(s)) lista.push(s);
  }
  return lista;
}

export const MODELOS_ROTACAO_POR_HARNESS: Record<string, string[]> = {
  antigravity: [
    "google/gemini-3.8-flash-high",
    "google/gemini-3.7-flash-high",
    "google/gemini-3.1-pro-high",
    "claude-sonnet-4-6",
  ],
  copilot: [
    "github/gpt-4o",
    "github/claude-3.5-sonnet",
    "github/o3-mini",
  ],
  opencode: [
    "opencode/nemotron-3-ultra-free",
    "opencode/nemotron-3.5-lightning-free",
    "opencode/big-pickle",
  ],
  "claude-code": [
    "claude-3-7-sonnet-20250219",
    "claude-3-5-sonnet-20241022",
  ],
};

export const HARNESS_FALLBACK_PADRAO = [
  "antigravity",
  "copilot",
  "opencode",
];

export async function obterCadeiaHarness(
  agenteStore?: AgentStore,
  wsPath?: string,
  agenteId?: string,
  homeDir?: string,
): Promise<string[]> {
  const cadeia: string[] = [];
  if (agenteStore && wsPath && agenteId) {
    try {
      const ag = await agenteStore.carregar(wsPath, agenteId);
      const hPrimary = ag.frontmatter.harness || (ag.frontmatter as any).engine;
      if (hPrimary) cadeia.push(hPrimary);
      const hFallbacks = ag.frontmatter.harness_fallback || (ag.frontmatter as any).engine_fallback;
      if (Array.isArray(hFallbacks)) {
        for (const h of hFallbacks) {
          const s = String(h).trim();
          if (s && !cadeia.includes(s)) cadeia.push(s);
        }
      }
    } catch {}
  }

  // Fallback padrão do sistema e runner.json
  try {
    const rPath = join(homeDir || process.env.HOME || "", ".opencorp", "runner.json");
    if (existsSync(rPath)) {
      const rJson = JSON.parse(readFileSync(rPath, "utf8")) as { engine?: string; harness_fallback?: string[] };
      if (rJson.engine && !cadeia.includes(rJson.engine.trim())) {
        cadeia.push(rJson.engine.trim());
      }
      if (Array.isArray(rJson.harness_fallback)) {
        for (const h of rJson.harness_fallback) {
          const s = String(h).trim();
          if (s && !cadeia.includes(s)) cadeia.push(s);
        }
      }
    }
  } catch {}

  for (const h of HARNESS_FALLBACK_PADRAO) {
    if (!cadeia.includes(h)) cadeia.push(h);
  }
  return cadeia;
}

export async function obterListaRotacaoPorHarness(
  harness: string,
  agenteStore?: AgentStore,
  wsPath?: string,
  agenteId?: string,
  _homeDir?: string,
): Promise<string[]> {
  const lista: string[] = [];
  if (agenteStore && wsPath && agenteId) {
    try {
      const ag = await agenteStore.carregar(wsPath, agenteId);
      const rot = ag.frontmatter.rotation || (ag.frontmatter as any).model_fallback;
      if (Array.isArray(rot)) {
        for (const m of rot) {
          const s = String(m).trim();
          if (s && !lista.includes(s)) lista.push(s);
        }
      }
    } catch {}
  }

  const padraoHarness = MODELOS_ROTACAO_POR_HARNESS[harness] || [];
  for (const m of padraoHarness) {
    const s = String(m).trim();
    if (s && !lista.includes(s)) lista.push(s);
  }

  return lista;
}

function sufixarRetry(origem: string, modelo: string): string {
  const sufixo = ` · retry:${modelo}`.slice(0, 200);
  return origem.slice(0, Math.max(0, 200 - sufixo.length)) + sufixo;
}

export interface OpcoesWatchdogRun {
  tetoMs: number;
  pid?: number | null;
  intervaloMs?: number;
  gracaKillMs?: number;
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
  obterStatus?: () => Promise<string | undefined>;
  matar?: (sinal: "SIGTERM" | "SIGKILL") => void;
  aoEstourar?: (decorridoMs: number) => void | Promise<void>;
}

export class WatchdogRun {
  private readonly opcoes: OpcoesWatchdogRun;
  private readonly intervalo: number;
  private inicioEfetivo: number;
  private pausaDesde: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private disparou = false;
  private morteEmAndamento: Promise<void> | null = null;

  constructor(opcoes: OpcoesWatchdogRun) {
    this.opcoes = opcoes;
    this.intervalo = Math.max(1, opcoes.intervaloMs ?? 30_000);
    this.inicioEfetivo = opcoes.agora ? opcoes.agora() : Date.now();
  }

  get estourou(): boolean {
    return this.disparou;
  }

  /** Promise da sequência SIGTERM→espera→SIGKILL→aoEstourar (null se ainda não disparou). */
  get quandoMorto(): Promise<void> | null {
    return this.morteEmAndamento;
  }

  iniciar(): void {
    if (this.timer || this.disparou) return;
    this.timer = setInterval(() => {
      void this.verificar().catch(() => undefined);
    }, this.intervalo);
    this.timer.unref?.();
  }

  parar(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Um passo de verificação; @returns true se o teto estourou e a sequência de kill foi acionada. */
  async verificar(): Promise<boolean> {
    if (this.disparou) return false;
    const agoraMs = this.opcoes.agora ? this.opcoes.agora() : Date.now();
    let status: string | undefined;
    try {
      status = await this.opcoes.obterStatus?.();
    } catch {
      status = undefined;
    }
    if (status === "hitl_pendente") {
      this.pausaDesde ??= agoraMs;
      return false;
    }
    if (this.pausaDesde !== null) {
      this.inicioEfetivo += agoraMs - this.pausaDesde;
      this.pausaDesde = null;
    }
    if (status !== undefined && status !== "executando") {
      this.parar();
      return false;
    }
    if (this.opcoes.tetoMs <= 0 || agoraMs - this.inicioEfetivo < this.opcoes.tetoMs) return false;
    this.disparou = true;
    this.parar();
    this.morteEmAndamento = this.executarMorte(agoraMs - this.inicioEfetivo);
    await this.morteEmAndamento;
    return true;
  }

  private async executarMorte(decorridoMs: number): Promise<void> {
    const matar =
      this.opcoes.matar ??
      ((sinal: "SIGTERM" | "SIGKILL") => {
        const pid = this.opcoes.pid;
        if (!pid) return;
        try {
          process.kill(pid, sinal);
        } catch {
          /* processo já morreu */
        }
      });
    matar("SIGTERM");
    const graca = Math.max(0, this.opcoes.gracaKillMs ?? 5_000);
    const dormir = this.opcoes.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    if (graca > 0) await dormir(graca);
    matar("SIGKILL");
    await this.opcoes.aoEstourar?.(decorridoMs);
  }
}

export class SessionManager {
  private readonly homeDir: string;
  private readonly workspaces: WorkspaceManager;
  private readonly agentes: AgentStore;
  private readonly registros = new RegistryStore();
  private readonly approvals = new ApprovalsStore();
  private readonly bridge = new OpenCodeBridge();
  private readonly processosAtivos = new Map<string, ReturnType<typeof execa>>();

  constructor(opts: { homeDir?: string; cwd?: string; templatesDir?: string } = {}) {
    this.homeDir = opts.homeDir ?? opencorpHome();
    this.workspaces = new WorkspaceManager(opts);
    this.agentes = new AgentStore({ templatesDir: opts.templatesDir });
  }

  async cancelar(wsPath: string, execId: string): Promise<boolean> {
    const child = this.processosAtivos.get(execId);
    let matou = false;
    if (child) {
      try {
        child.kill("SIGTERM");
        setTimeout(() => {
          try { child.kill("SIGKILL"); } catch {}
        }, 2000);
        matou = true;
      } catch {}
      this.processosAtivos.delete(execId);
    } else {
      try {
        const meta = await this.registros.lerMeta(wsPath, "execucoes", execId);
        const pid = (meta.extras as any)?.pid;
        if (pid && typeof pid === "number") {
          try {
            process.kill(pid, "SIGTERM");
            setTimeout(() => {
              try { process.kill(pid, "SIGKILL"); } catch {}
            }, 2000);
            matou = true;
          } catch {}
        }
      } catch {}
    }

    // Persiste status "cancelado" no registry (meta.json)
    try {
      const meta = await this.registros.lerMeta(wsPath, "execucoes", execId);
      const extras = (meta.extras ?? {}) as Record<string, unknown>;
      const inicio = Date.parse(meta.criado_em);
      const fim = new Date().toISOString();
      const duracao = Number.isFinite(inicio) ? Date.now() - inicio : 0;
      meta.extras = {
        ...extras,
        status: "cancelado",
        fim,
        duracao_ms: (extras.duracao_ms as number | null) ?? duracao,
        pid: null,
      };
      await this.registros.salvarMeta(wsPath, "execucoes", execId, meta);
    } catch {}

    try {
      this.registros.corpDb(wsPath).atualizarStatusExecucao(execId, "cancelado");
    } catch {}

    return matou;
  }

  private carregarPolicy(wsPath: string) {
    const path = join(wsPath, ".opencorp", "security_policy.json");
    if (!existsSync(path)) {
      return parseSecurityPolicyTexto("{}", path);
    }
    return parseSecurityPolicyTexto(readFileSync(path, "utf8"), path);
  }

  /**
   * Grava/atualiza a execução no ledger unificado (corp.db `execucoes`) — a leitura
   * cross-motor do PLANO-UNIFICACAO. Falha de ledger NUNCA quebra a execução
   * (mesma tolerância do job_runs do scheduler).
   */
  private registrarNoLedger(wsPath: string, registro: RegistroExecucao, custoUsd: number | null, erro?: string | null): void {
    try {
      this.registros.corpDb(wsPath).upsertExecucao({
        id: registro.id,
        agente: registro.agente,
        modelo: registro.modelo,
        gatilho_tipo: registro.gatilho?.tipo ?? "manual",
        gatilho_origem: registro.gatilho?.origem ?? "",
        status: registro.status,
        inicio: registro.inicio,
        fim: registro.fim,
        duracao_ms: registro.duracao_ms,
        custo_usd: custoUsd,
        exit_code: registro.exit_code,
        erro: erro ?? (registro as any).erro ?? null,
      });
    } catch {
      /* ledger é índice; os registros (MD/JSON) são a fonte documental */
    }
  }

  async workspaceDe(workspaceId?: string) {
    return this.workspaces.resolver(workspaceId);
  }

  async rodar(opcoes: OpcoesRun): Promise<ResultadoRun> {
    let ws: { path: string; id: string; existe: boolean };
    if (opcoes.workspaceDir) {
      const dir = resolvePath(opcoes.workspaceDir);
      if (!existsSync(join(dir, ".opencorp"))) {
        throw new SessionError(`workspace do subcorp inválido: ${dir} não contém .opencorp/`);
      }
      ws = { path: dir, id: basename(dir), existe: true };
    } else {
      const info = await this.workspaces.resolver(opcoes.workspaceId);
      if (!info.existe) {
        throw new SessionError(`a pasta do workspace "${info.id}" não existe (${info.path})`);
      }
      ws = info;
    }
    const ag = await this.agentes.carregar(ws.path, opcoes.agente);
    // Etapa 5 — guard central: agente desativado não roda em NENHUM gatilho
    // (API, hooks, nós de fluxo fanout/review/debate, reuniões, menções, scheduler, CLI).
    // O erro é logado pelo chamador (nó do fluxo marca "falhou", hook registra, team escreve na task).
    if (ag.frontmatter.ativo === false) {
      throw new SessionError(
        `agente '${opcoes.agente}' está desativado — ative no painel de agentes`,
      );
    }
    let ordem = opcoes.ordem ?? "";
    if (opcoes.file) {
      try {
        ordem = (await readFile(opcoes.file, "utf8")).trim();
      } catch (erro) {
        throw new SessionError(`não foi possível ler --file "${opcoes.file}": ${msg(erro)}`);
      }
    }
    if (ordem.trim().length === 0) {
      throw new SessionError("ordem vazia — informe a instrução (ou use --file)");
    }
    let modelo = opcoes.model ?? ag.frontmatter.model;
    if (!modelo || modelo.trim() === "" || modelo === "padrao" || modelo === "default" || modelo === "sistema") {
      try {
        const s = await new SettingsStore({ homeDir: this.homeDir, cwd: ws.path }).resolve();
        modelo = s.settings.default_model || "openrouter/nvidia/nemotron-3.5-lightning:free";
      } catch {
        modelo = "openrouter/nvidia/nemotron-3.5-lightning:free";
      }
    }

    const policy = this.carregarPolicy(ws.path);
    const acessoTotalGlobal = (policy as any).global_full_access === true || policy.level === "permissive";
    if (!opcoes.pularGuard && !acessoTotalGlobal) {
      const pre = avaliar(ordem, policy, ag.frontmatter.permissions);
      if (pre.acao === "bloqueado") {
        const idBloqueio = gerarId("exec");
        await this.registros.garantirCategorias(ws.path);
        await this.registrarNoLedger(ws.path, {
          id: idBloqueio,
          agente: ag.frontmatter.id,
          modelo,
          ordem,
          inicio: new Date().toISOString(),
          fim: new Date().toISOString(),
          status: "falhou",
          exit_code: 3,
          duracao_ms: 0,
          pid: null,
          log: "",
          gatilho: opcoes.gatilho,
        }, null);
        await this.registros.criar(ws.path, {
          categoria: "execucoes",
          id: idBloqueio,
          descricao: `Ordem: ${ordem.slice(0, 160)}`,
          criadoPor: ag.frontmatter.id,
          tags: ["sessao", "bloqueada"],
          eventoInicial: {
            evento: "bloqueado",
            resumo: `SecurityGuard: ${pre.motivo}`,
          },
          extras: {
            status: "falhou",
            modelo,
            ordem,
            pid: null,
            fim: new Date().toISOString(),
            exit_code: 3,
            duracao_ms: 0,
            log: "",
          },
        });
        await this.registros.eventoAuditoria(ws.path, {
          por: ag.frontmatter.id,
          evento: "bloqueado_pre_voo",
          resumo: pre.motivo,
          padrao: pre.padrao ?? "",
          ordem: ordem.slice(0, 160),
        });
        throw new SessionError(`bloqueado pelo SecurityGuard: ${pre.motivo}`, { exitCode: 3 });
      }
      if (pre.acao === "hitl") {
        const idHitl = gerarId("exec");
        await this.registros.garantirCategorias(ws.path);
        await this.registrarNoLedger(ws.path, {
          id: idHitl,
          agente: ag.frontmatter.id,
          modelo,
          ordem,
          inicio: new Date().toISOString(),
          fim: null,
          status: "hitl_pendente",
          exit_code: null,
          duracao_ms: null,
          pid: null,
          log: "",
          gatilho: opcoes.gatilho,
        }, null);
        await this.registros.criar(ws.path, {
          categoria: "execucoes",
          id: idHitl,
          descricao: `Ordem: ${ordem.slice(0, 160)}`,
          criadoPor: ag.frontmatter.id,
          tags: ["sessao", "hitl"],
          eventoInicial: {
            evento: "hitl_pendente",
            resumo: `SecurityGuard: ${pre.motivo}`,
          },
          extras: {
            status: "hitl_pendente",
            modelo,
            ordem,
            pid: null,
            fim: null,
            exit_code: null,
            duracao_ms: null,
            log: "",
          },
        });
        const pendencia = await this.approvals.criar(ws.path, {
          ordem,
          agente: ag.frontmatter.id,
          modelo,
          padrao: pre.padrao ?? "",
          origem: "pre-voo",
          motivo_guard: pre.motivo,
          workspace_id: ws.id,
          workspace_path: ws.path,
          exec_id: idHitl,
        });
        // Notificação + evento para o Secretário/Notificações aparecerem imediatamente
        try {
          const { NotificationStore } = await import("./notification-store.js");
          const notifs = new NotificationStore();
          await notifs.adicionar(ws.path, {
            titulo: `Permissão necessária: ${ag.frontmatter.id}`,
            corpo: `${ordem.slice(0, 120)} — ${pre.motivo} (toque em Notificações para aprovar)`,
            tipo: "aviso",
            origem: "hitl",
          });
        } catch {}
        try { eventBus.emit("secretario.mensagem", { sessao_id: pendencia.id, fase: "hitl", workspace: ws.id }); } catch {}
        try { eventBus.emit("notificacao.nova", { workspace: ws.id }); } catch {}
        throw new SessionError(
          `HITL: a ordem casa com "${pre.padrao}" e aguarda aprovação humana — pendência ${pendencia.id} (opencorp approvals list)`,
          { exitCode: 5 },
        );
      }
    }

    const budget = new BudgetManager({ homeDir: this.homeDir });
    const orcamento = await budget.podeExecutar(ws.path, ag.frontmatter.id);
    if (!orcamento.ok) {
      throw new SessionError(`recusada pelo BudgetManager: ${orcamento.motivo}`, { exitCode: 4 });
    }

    await this.registros.garantirCategorias(ws.path);

    const id = opcoes.execId ?? gerarId("exec");
    const logRelativo = `logs/${id}.log`;
    const logPath = join(ws.path, logRelativo);
    await mkdirRecursive(join(ws.path, "logs"));
    const inicio = new Date();
    const registro: RegistroExecucao = {
      id,
      agente: ag.frontmatter.id,
      modelo,
      ordem,
      inicio: inicio.toISOString(),
      fim: null,
      status: "executando",
      exit_code: null,
      duracao_ms: null,
      pid: null,
      log: logRelativo,
      gatilho: opcoes.gatilho,
    };

    await this.registros.criar(ws.path, {
      categoria: "execucoes",
      id,
      descricao: `Ordem: ${ordem.slice(0, 160)}`,
      criadoPor: registro.agente,
      tags: ["sessao", ...(opcoes.tags ?? []), ...(opcoes.retryDe ? ["retry"] : [])],
      referencias: opcoes.referencias,
      eventoInicial: {
        evento: "iniciado",
        resumo: `ordem: ${ordem.slice(0, 160)} · modelo: ${modelo}${opcoes.gatilho ? ` · gatilho: ${opcoes.gatilho.tipo}:${opcoes.gatilho.origem}` : ""}`,
      },
      extras: {
        status: "executando",
        modelo,
        ordem,
        pid: null,
        fim: null,
        exit_code: null,
        duracao_ms: null,
        log: logRelativo,
        ...(opcoes.tipo ? { tipo: opcoes.tipo } : {}),
        ...(opcoes.gatilho ? { gatilho: opcoes.gatilho } : {}),
        ...(opcoes.retryDe ? { retry: opcoes.retryDe } : {}),
      },
    });
    this.registrarNoLedger(ws.path, registro, null);
    // evento unificado da primitiva Execução (PLANO-UNIFICACAO Etapa 5):
    // qualquer consumidor casa "execução iniciada por gatilho X" sem conhecer o motor
    eventBus.emit("exec.iniciada", {
      exec_id: id,
      agente: registro.agente,
      modelo,
      workspace: ws.id,
      ...(opcoes.gatilho ? { gatilho: opcoes.gatilho } : { gatilho: { tipo: "manual", origem: "" } }),
    });
    eventBus.emit("sessao-inicio", {
      exec_id: id,
      agente: registro.agente,
      modelo,
      ...(opcoes.gatilho ? { gatilho: opcoes.gatilho } : {}),
    });

    await this.bridge.sincronizarAgente(ws.path, ag.frontmatter, ag.corpo);

    // Resolução do Harness Ativo (prioridade: frontmatter do agente > runner.json ativo > padrão opencode)
    let runnerConfigEngine = "opencode";
    try {
      const rPath = join(this.homeDir, ".opencorp", "runner.json");
      if (existsSync(rPath)) {
        const rJson = JSON.parse(readFileSync(rPath, "utf8")) as { engine?: string };
        if (rJson.engine && typeof rJson.engine === "string") {
          runnerConfigEngine = rJson.engine.trim();
        }
      }
    } catch {}

    let harnessEscolhido =
      opcoes.engine ||
      opcoes.harness ||
      ag.frontmatter.harness ||
      (ag.frontmatter as any).engine ||
      runnerConfigEngine ||
      "opencode";
    let modeloEfetivo = modelo;

    if (modeloEfetivo.startsWith("opencode/") && modeloEfetivo.indexOf("/", "opencode/".length) !== -1) {
      harnessEscolhido = "opencode";
      modeloEfetivo = modeloEfetivo.slice("opencode/".length);
    } else if (modeloEfetivo.startsWith("claude-code/")) {
      harnessEscolhido = "claude-code";
      modeloEfetivo = modeloEfetivo.slice("claude-code/".length);
    } else if (modeloEfetivo.startsWith("antigravity/")) {
      harnessEscolhido = "antigravity";
      modeloEfetivo = modeloEfetivo.slice("antigravity/".length);
    } else if (modeloEfetivo.startsWith("crom-agente/") || modeloEfetivo.startsWith("crom/")) {
      harnessEscolhido = "crom-agente";
      modeloEfetivo = modeloEfetivo.replace(/^(crom-agente|crom)\//, "");
    } else if (modeloEfetivo.startsWith("cursor/")) {
      harnessEscolhido = "cursor";
      modeloEfetivo = modeloEfetivo.slice("cursor/".length);
    } else if (modeloEfetivo.startsWith("copilot/")) {
      harnessEscolhido = "copilot";
      modeloEfetivo = modeloEfetivo.slice("copilot/".length);
    } else if (modeloEfetivo.startsWith("codex/")) {
      harnessEscolhido = "codex";
      modeloEfetivo = modeloEfetivo.slice("codex/".length);
    } else if (modeloEfetivo.startsWith("aider/")) {
      harnessEscolhido = "aider";
      modeloEfetivo = modeloEfetivo.slice("aider/".length);
    }

    const driver = engineRegistry.resolveDriver(harnessEscolhido);
    let runnerBin: string;
    let args: string[];
    let execEnv: Record<string, string>;
    let execCwd = ws.path;

    if (driver.id === "opencode") {
      // Normalização automática de modelos legados openrouter/ para modelos suportados pelo binário opencode
      if (
        modeloEfetivo === "openrouter/nvidia/nemotron-3.5-lightning:free" ||
        modeloEfetivo === "nvidia/nemotron-3.5-lightning:free"
      ) {
        modeloEfetivo = "opencode-go/glm-5.3-flash";
      } else if (
        modeloEfetivo === "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free" ||
        modeloEfetivo === "nvidia/nemotron-3-ultra-550b-a55b:free"
      ) {
        modeloEfetivo = "opencode/nemotron-3-ultra-free";
      } else if (
        modeloEfetivo === "openrouter/minimax/minimax-m3:free" ||
        modeloEfetivo === "minimax/minimax-m3:free"
      ) {
        modeloEfetivo = "opencode-go/minimax-m3";
      } else if (modeloEfetivo === "openrouter/z-ai/glm-5.2:free") {
        modeloEfetivo = "opencode-go/glm-5.3-flash";
      }

      args = [
        "run",
        "--auto",
        "--agent",
        ag.frontmatter.id,
        "--model",
        modeloEfetivo,
        "--dir",
        ws.path,
      ];
      if (opcoes.session) args.push("--session", opcoes.session);
      if (opcoes.title) args.push("--title", opcoes.title);
      args.push(ordem);

      runnerBin = "opencode";
      const managedBin = join(this.homeDir, ".opencorp", "bin", "opencode");
      if (existsSync(managedBin)) {
        runnerBin = managedBin;
      } else {
        try {
          const rPath = join(this.homeDir, ".opencorp", "runner.json");
          if (existsSync(rPath)) {
            const rJson = JSON.parse(readFileSync(rPath, "utf8")) as { binary_path?: string };
            if (typeof rJson.binary_path === "string" && rJson.binary_path.trim().length > 0) {
              runnerBin = rJson.binary_path.trim();
            }
          }
        } catch {}
      }
      execEnv = envOpencodeIsolado(this.homeDir, ws.id, ws.path) as Record<string, string>;
    } else {
      const prep = await driver.prepareExecution({
        workspaceId: ws.id,
        workspacePath: ws.path,
        sessionId: id,
        agentId: ag.frontmatter.id,
        model: modeloEfetivo,
        prompt: ordem,
        homeDir: this.homeDir,
      });
      runnerBin = prep.binary;
      args = prep.args;
      execEnv = prep.env;
      execCwd = prep.cwd;
    }

    let child: ReturnType<typeof execa>;
    try {
      child = execa(runnerBin, args, {
        cwd: execCwd,
        env: execEnv,
        buffer: false,
        reject: false,
        stdin: "ignore",
      });
    } catch (erro) {
      const falha = `não foi possível iniciar o runner (${runnerBin}): ${msg(erro)} — ele está no PATH? (rode "opencorp doctor")`;
      (registro as any).erro = falha;
      await this.finalizar(ws, registro, ag.frontmatter, "falhou", null, Date.now() - inicio.getTime(), falha, "", null);
      throw new SessionError(falha);
    }
    this.processosAtivos.set(id, child);
    if (child.pid) {
      registro.pid = child.pid;
      const meta = await this.registros.lerMeta(ws.path, "execucoes", id);
      await this.salvarExtras(ws.path, meta, registro);
    }

    const logStream = createWriteStream(logPath, { flags: "a" });
    logStream.write(
      `# sessão ${id}\n# agente: ${registro.agente} · modelo: ${modelo} · workspace: ${ws.id}\n# ordem: ${ordem}\n\n`,
    );
    const captura: string[] = [];
    const teeing = async (stream: AsyncIterable<unknown> | null | undefined) => {
      if (!stream) return;
      for await (const chunk of stream) {
        const texto = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
        captura.push(texto);
        logStream.write(texto);
        process.stdout.write(texto);
      }
    };

    let mortePorTimeout = false;
    const tetoMs = opcoes.timeoutMs ?? 0;
    const watchdog =
      tetoMs > 0 && child.pid
        ? new WatchdogRun({
            tetoMs,
            pid: child.pid,
            ...(opcoes.watchdogIntervalMs ? { intervaloMs: opcoes.watchdogIntervalMs } : {}),
            ...(opcoes.watchdogGracaMs !== undefined ? { gracaKillMs: opcoes.watchdogGracaMs } : {}),
            obterStatus: async () => {
              try {
                const meta = await this.registros.lerMeta(ws.path, "execucoes", id);
                return ((meta.extras ?? {}) as Record<string, unknown>).status as string | undefined;
              } catch {
                return undefined;
              }
            },
            aoEstourar: async (decorrido) => {
              mortePorTimeout = true;
              const mensagem = `timeout de ${Math.round(tetoMs / 1000)}s excedido — opencode morto (modelo travado?)`;
              registro.status = "falhou";
              (registro as any).erro = mensagem;
              registro.exit_code = null;
              registro.duracao_ms = decorrido;
              registro.fim = new Date().toISOString();
              await this.finalizar(ws, registro, null, "falhou", null, decorrido, mensagem, captura.join(""), null);
            },
          })
        : null;
    watchdog?.iniciar();

    const resolverAposTimeout = async (): Promise<ResultadoRun> => {
      const morte = watchdog?.quandoMorto;
      if (morte) await morte;
      const retry = await this.tentarRetry(ws, opcoes, registro, captura.join(""));
      if (retry) return retry;
      return { ...registro, captura: captura.join(""), custo_usd: null };
    };

    let resultado;
    try {
      await Promise.all([teeing(child.stdout), teeing(child.stderr)]);
      resultado = await child;
    } catch (erro) {
      logStream.end();
      watchdog?.parar();
      if (watchdog?.estourou || mortePorTimeout) {
        return await resolverAposTimeout();
      }
      const falha = `não foi possível executar o runner (${runnerBin}): ${msg(erro)} — ele está no PATH? (rode "opencorp doctor")`;
      (registro as any).erro = falha;
      await this.finalizar(ws, registro, ag.frontmatter, "falhou", null, Date.now() - inicio.getTime(), falha, captura.join(""), null);
      throw new SessionError(falha);
    }
    watchdog?.parar();
    logStream.end();

    if (watchdog?.estourou || mortePorTimeout) {
      return await resolverAposTimeout();
    }

    const fim = new Date();
    const duracao = fim.getTime() - inicio.getTime();
    const res = resultado as unknown as { exitCode?: number | null; killed?: boolean; timedOut?: boolean };
    const status: StatusExecucao = res.killed
      ? "cancelado"
      : res.exitCode === 0
        ? "concluido"
        : "falhou";
    registro.fim = fim.toISOString();
    registro.status = status;
    registro.exit_code = res.exitCode ?? null;
    registro.duracao_ms = duracao;

    const textoCaptura = captura.join("");

    // Se falhou (erro de modelo ou de motor), tenta retry com rotação de modelo ou rotação de motor
    if (status === "falhou") {
      const retry = await this.tentarRetry(ws, opcoes, registro, textoCaptura);
      if (retry) return retry;
    }

    if (status === "falhou") {
      let resumoErro = "";
      const matchErro = /(?:Error|erro|Rate limit|Quota|Exception|status code \d+)[:\s]+([^\n\r]+)/i.exec(textoCaptura);
      if (matchErro) {
        resumoErro = matchErro[0].trim();
      } else {
        const linhas = textoCaptura.trim().split("\n").filter((l) => l.trim() && !l.startsWith(">") && !l.startsWith("#"));
        resumoErro = linhas[linhas.length - 1] || `Processo encerrou com exit code ${registro.exit_code}`;
      }
      (registro as any).erro = resumoErro;
    }

    const custo = budget.estimarCusto(
      await budget.carregar(ws.path),
      modelo,
      duracao,
      textoCaptura,
    );
    const consumo = await budget.registrarConsumo(ws.path, ag.frontmatter.id, custo, {
      modelo,
      duracao_ms: duracao,
    });
    if (consumo.aviso80) {
      console.log(
        `\n[opencorp] ⚠ aviso: consumo atingiu 80% do orçamento (${ag.frontmatter.id} ou workspace) — veja "opencorp budget status"`,
      );
    }
    await this.finalizar(
      ws,
      registro,
      ag.frontmatter,
      status,
      registro.exit_code,
      duracao,
      textoCaptura.slice(0, 400),
      textoCaptura,
      custo,
    );

    if (!opcoes.pularGuard) {
      const posHitl = policy.hitl_patterns.find((padrao) => casaPadrao(padrao, textoCaptura));
      if (posHitl) {
        const pendencia = await this.approvals.criar(ws.path, {
          ordem,
          agente: ag.frontmatter.id,
          modelo,
          padrao: posHitl,
          origem: "pos-voo",
          motivo_guard: `transcript da sessão contém o padrão de HITL "${posHitl}" — requer revisão humana`,
          workspace_id: ws.id,
          workspace_path: ws.path,
          exec_id: registro.id,
        });
        await this.registros.anexarEvento(ws.path, "execucoes", registro.id, {
          ts: new Date().toISOString(),
          por: "security-guard",
          evento: "hitl_pos_voo",
          padrao: posHitl,
          resumo: `pendência ${pendencia.id} criada para revisão humana`,
        });
        throw new SessionError(
          `HITL pós-voo: o transcript contém "${posHitl}" — pendência ${pendencia.id} criada para revisão humana (exit 5)`,
          { exitCode: 5 },
        );
      }
      const posBloq = policy.blocklist.find((padrao) => casaPadrao(padrao, textoCaptura));
      if (posBloq) {
        await this.registros.eventoAuditoria(ws.path, {
          por: ag.frontmatter.id,
          evento: "padrao_bloqueado_pos_voo",
          resumo: `transcript contém padrão da blocklist "${posBloq}" — execução já ocorreu dentro do opencode; registrada para auditoria`,
          padrao: posBloq,
          ordem: ordem.slice(0, 160),
        });
        await this.registros.anexarEvento(ws.path, "execucoes", registro.id, {
          ts: new Date().toISOString(),
          por: "security-guard",
          evento: "violacao_pos_voo",
          padrao: posBloq,
          resumo: "transcript contém padrão da blocklist — auditoria (a sessão já tinha corrido)",
        });
        console.log(
          `\n[opencorp] ⚠ auditoria: o transcript contém o padrão de blocklist "${posBloq}" — evento registrado em .opencorp/registries/logs/audit-log`,
        );
      }
    }
    if (status === "falhou") {
      const retry = await this.tentarRetry(ws, opcoes, registro, textoCaptura);
      if (retry) return retry;
    }
    return { ...registro, captura: textoCaptura, custo_usd: custo };
  }

  /**
   * Retry com rotabilidade de modelo e de harness:
   * 1. Se foi erro de modelo/cota e há modelos disponíveis para o motor atual, rotaciona o modelo.
   * 2. Se os modelos do motor se esgotaram ou o motor falhou (crash, processo abortado, erro do binário),
   *    rotaciona para o próximo motor da cadeia de harness (agente ou padrão do sistema).
   */
  private async tentarRetry(
    ws: { path: string; id: string },
    opcoes: OpcoesRun,
    registro: RegistroExecucao,
    captura: string,
  ): Promise<ResultadoRun | null> {
    if (opcoes.retryDe) return null;
    if (registro.status === "hitl_pendente") return null;
    if (!PADRAO_ERRO_MODELO.test(captura)) return null;

    const falhaCreditos = PADRAO_ERRO_CREDITOS.test(captura);
    let lista = await obterListaRotacaoCompleta(this.agentes, ws.path, opcoes.agente, this.homeDir);
    if (falhaCreditos) {
      lista = lista.filter((m) => ehModeloGratuito(m));
    }
    const proximoModelo = proximoModeloRotacao(lista, registro.modelo);
    if (!proximoModelo || proximoModelo === registro.modelo) return null;

    const idRetry = gerarId("exec");
    try {
      await this.registros.anexarEvento(ws.path, "execucoes", registro.id, {
        ts: new Date().toISOString(),
        por: "opencorp",
        evento: "retry_modelo",
        resumo: `falha de modelo/API (${registro.modelo}) — 1 retry com ${proximoModelo}${falhaCreditos ? " (filtrando apenas gratuitos)" : ""} → ${idRetry}`,
      });
    } catch {
      /* journal best-effort */
    }

    return this.rodar({
      ...opcoes,
      model: proximoModelo,
      execId: idRetry,
      retryDe: {
        de_modelo: registro.modelo,
        de_exec: registro.id,
      },
      gatilho: opcoes.gatilho
        ? { ...opcoes.gatilho, origem: sufixarRetry(opcoes.gatilho.origem, proximoModelo) }
        : undefined,
    });
  }

  /**
   * Lista de rotação completa (agente + fallbacks globais/workspace).
   * Retorna o próximo modelo que ainda não foi tentado nesta cadeia de execução.
   * Quando apenasGratuitos for true (ex.: cota/créditos esgotados), prioriza modelos gratuitos.
   * Só retorna null se todos os modelos disponíveis já tiverem falhado.
   */
  public async proximoModeloDaRotacao(
    modeloFalho: string,
    wsPath?: string,
    agenteId?: string,
    modelosJaTentados: string[] = [],
    apenasGratuitos: boolean = false,
  ): Promise<string | null> {
    const lista = await obterListaRotacaoCompleta(this.agentes, wsPath, agenteId, this.homeDir);
    const tentados = new Set([...modelosJaTentados, modeloFalho]);
    const naoTentados = lista.filter((m) => !tentados.has(m));
    if (apenasGratuitos) {
      const gratuitos = naoTentados.filter((m) => ehModeloGratuito(m));
      if (gratuitos.length > 0) return gratuitos[0]!;
    }
    return naoTentados[0] ?? null;
  }

  async listarExecucoes(wsPath: string, filtro?: { agente?: string }): Promise<ResumoExecucao[]> {
    const metas = await this.registros.listar(wsPath, "execucoes");
    const filtradas = metas.filter((meta) => !filtro?.agente || meta.criado_por === filtro.agente);
    for (const meta of filtradas) {
      await this.reconciliarZombie(wsPath, meta);
    }
    return filtradas
      .map((meta) => this.paraResumo(meta))
      .sort((a, b) => b.inicio.localeCompare(a.inicio));
  }

  /** execução "executando" cujo processo morreu sem finalizar → marca status final (zombie) */
  async reconciliarZombie(wsPath: string, meta: MetaRegistro): Promise<void> {
    const extras = (meta.extras ?? {}) as Record<string, unknown>;
    if (extras.status !== "executando") return;
    const pid = extras.pid as number | null;
    if (!pid) {
      // Sem pid (ex.: processo falhou ao iniciar ou mention sem fork): se já passou 60s do início, é zumbi
      const inicio = Date.parse(meta.criado_em);
      if (Number.isFinite(inicio) && Date.now() - inicio < 60_000) return;
      const registro = await this.paraRegistro(meta);
      registro.status = "falhou";
      registro.fim = new Date().toISOString();
      registro.duracao_ms = Number.isFinite(inicio) ? Date.now() - inicio : 0;
      registro.exit_code = null;
      await this.finalizar(
        { path: wsPath, id: "" },
        registro,
        null,
        "falhou",
        null,
        registro.duracao_ms,
        `zombie: registro "executando" sem pid há >60s — processo morreu sem finalizar (reaper) — reconciliado em ${registro.fim}`,
        "",
        null,
      );
      meta.extras = { ...extras, status: "falhou", duracao_ms: registro.duracao_ms, fim: registro.fim, pid: null };
      return;
    }
    let viva = true;
    try {
      process.kill(pid, 0);
    } catch {
      viva = false;
    }
    if (viva) return;
    const inicio = Date.parse(meta.criado_em);
    const duracao = Number.isFinite(inicio) ? Date.now() - inicio : 0;
    const registro = await this.paraRegistro(meta);
    registro.status = "falhou";
    registro.fim = new Date().toISOString();
    registro.duracao_ms = duracao;
    registro.exit_code = null;
    await this.finalizar(
      { path: wsPath, id: "" },
      registro,
      null,
      "falhou",
      null,
      duracao,
      `zombie: processo (pid ${pid}) morreu sem finalizar (reaper) — reconciliado em ${registro.fim}`,
      "",
      null,
    );
    meta.extras = { ...extras, status: "falhou", duracao_ms: duracao, fim: registro.fim, pid: null };
  }

  async reconciliarZombieSeNecessario(wsPath: string, execId: string): Promise<MetaRegistro | null> {
    try {
      const meta = await this.registros.lerMeta(wsPath, "execucoes", execId);
      if ((meta.extras as any)?.status === "executando") {
        await this.reconciliarZombie(wsPath, meta);
      }
      return meta;
    } catch {
      return null;
    }
  }

  async caminhoLog(wsPath: string, id: string): Promise<string> {
    const logPath = join(wsPath, "logs", `${id}.log`);
    if (!existsSync(logPath)) {
      throw new SessionError(`log não encontrado para a sessão "${id}" (${logPath})`);
    }
    return logPath;
  }

  /**
   * Anti-stale: reconcilia TODAS as execuções "executando" cujo processo já
   * morreu sem finalizar (zombies). @returns ids que foram reconciliados.
   */
  async reconciliarZombies(wsPath: string): Promise<string[]> {
    const metas = await this.registros.listar(wsPath, "execucoes");
    const reconciliados: string[] = [];
    for (const meta of metas) {
      const extras = (meta.extras ?? {}) as Record<string, unknown>;
      if (extras.status !== "executando") continue;
      await this.reconciliarZombie(wsPath, meta);
      const depois = (meta.extras ?? {}) as Record<string, unknown>;
      if (depois.status === "falhou") reconciliados.push(meta.id);
    }
    return reconciliados;
  }

  async logDe(wsPath: string, id: string): Promise<string> {
    return readFile(await this.caminhoLog(wsPath, id), "utf8");
  }

  async transcriptDe(wsPath: string, id: string): Promise<string> {
    const registro = await this.registros.obter(wsPath, "chats", id);
    return registro.conteudo ?? "";
  }

  async matar(wsPath: string, id: string): Promise<void> {
    let meta: MetaRegistro;
    try {
      meta = await this.registros.lerMeta(wsPath, "execucoes", id);
    } catch {
      throw new SessionError(`sessão "${id}" não encontrada (.opencorp/registries/execucoes)`);
    }
    const extras = (meta.extras ?? {}) as Record<string, unknown>;
    if (extras.status !== "executando") {
      throw new SessionError(
        `sessão "${id}" não está em execução (status: ${String(extras.status ?? "desconhecido")})`,
      );
    }
    const pid = extras.pid as number | null;
    if (!pid) {
      throw new SessionError(`sessão "${id}" não tem pid registrado — não é possível matar`);
    }
    let viva = true;
    try {
      process.kill(pid, 0);
    } catch {
      viva = false;
    }
    if (!viva) {
      throw new SessionError(`o processo da sessão "${id}" (pid ${pid}) não está mais vivo`);
    }
    try {
      process.kill(pid, "SIGTERM");
    } catch (erro) {
      throw new SessionError(`não foi possível matar o pid ${pid}: ${msg(erro)}`);
    }
    const registro = await this.paraRegistro(meta);
    registro.status = "cancelado";
    registro.fim = new Date().toISOString();
    registro.duracao_ms = Date.now() - Date.parse(registro.inicio);
    await this.finalizar(
      { path: wsPath, id: "" },
      registro,
      null,
      "cancelado",
      null,
      registro.duracao_ms,
      "cancelada via session kill",
      "",
      null,
    );
  }

  private paraResumo(meta: MetaRegistro): ResumoExecucao {
    const extras = (meta.extras ?? {}) as Record<string, unknown>;
    return {
      id: meta.id,
      agente: meta.criado_por,
      modelo: String(extras.modelo ?? "-"),
      status: (extras.status as StatusExecucao) ?? "executando",
      inicio: meta.criado_em,
      duracao_ms: (extras.duracao_ms as number | null) ?? null,
      exit_code: (extras.exit_code as number | null) ?? null,
      ...(extras.gatilho ? { gatilho: gatilhoSchema.parse(extras.gatilho) } : {}),
    };
  }

  private async paraRegistro(meta: MetaRegistro): Promise<RegistroExecucao> {
    const extras = (meta.extras ?? {}) as Record<string, unknown>;
    return {
      id: meta.id,
      agente: meta.criado_por,
      modelo: String(extras.modelo ?? "-"),
      ordem: String(extras.ordem ?? ""),
      inicio: meta.criado_em,
      fim: (extras.fim as string | null) ?? null,
      status: (extras.status as StatusExecucao) ?? "executando",
      exit_code: (extras.exit_code as number | null) ?? null,
      duracao_ms: (extras.duracao_ms as number | null) ?? null,
      pid: (extras.pid as number | null) ?? null,
      log: String(extras.log ?? `logs/${meta.id}.log`),
      ...(extras.gatilho ? { gatilho: gatilhoSchema.parse(extras.gatilho) } : {}),
    };
  }

  private async salvarExtras(wsPath: string, meta: MetaRegistro, registro: RegistroExecucao): Promise<void> {
    meta.extras = {
      ...(meta.extras ?? {}),
      status: registro.status,
      modelo: registro.modelo,
      ordem: registro.ordem,
      pid: registro.pid,
      fim: registro.fim,
      exit_code: registro.exit_code,
      duracao_ms: registro.duracao_ms,
      log: registro.log,
      ...(registro.gatilho ? { gatilho: registro.gatilho } : {}),
    };
    await this.registros.salvarMeta(wsPath, "execucoes", registro.id, meta);
  }

  private async finalizar(
    ws: { path: string; id: string },
    registro: RegistroExecucao,
    agente: Agente | null,
    status: StatusExecucao,
    exitCode: number | null,
    duracaoMs: number,
    resumo: string,
    captura: string,
    custoUsd: number | null = null,
  ): Promise<void> {
    this.processosAtivos.delete(registro.id);
    registro.status = status;
    registro.exit_code = exitCode;
    registro.duracao_ms = duracaoMs;
    registro.fim = registro.fim ?? new Date().toISOString();
    eventBus.emit("sessao-fim", {
      exec_id: registro.id,
      agente: registro.agente,
      status,
      exit_code: exitCode,
      duracao_ms: duracaoMs,
      ...(registro.gatilho ? { gatilho: registro.gatilho } : {}),
    });
    await this.registros.anexarEvento(ws.path, "execucoes", registro.id, {
      ts: new Date().toISOString(),
      por: "opencorp",
      evento: "finalizado",
      status,
      exit_code: exitCode,
      duracao_ms: duracaoMs,
      resumo,
    });
    const meta = await this.registros.lerMeta(ws.path, "execucoes", registro.id);
    await this.salvarExtras(ws.path, meta, registro);
    const erroDesc =
      (registro as any).erro ||
      (status === "falhou"
        ? (resumo && resumo.trim() ? resumo : `Processo encerrou com falha (exit code ${exitCode ?? "desconhecido"})`)
        : null);
    (registro as any).erro = erroDesc;
    this.registrarNoLedger(ws.path, registro, custoUsd, erroDesc);

    // Notificação automática de falha de execução/modelo
    if (status === "falhou") {
      try {
        const { NotificationStore } = await import("./notification-store.js");
        const notifs = new NotificationStore();
        const motivo = erroDesc || `Processo encerrou com falha (exit ${exitCode})`;
        await notifs.adicionar(ws.path, {
          tipo: "erro",
          titulo: `Falha na execução: @${registro.agente}`,
          corpo: `A execução ${registro.id} (@${registro.agente}) falhou no modelo ${registro.modelo}.\nMotivo: ${motivo.slice(0, 240)}`,
        });
        eventBus.emit("notificacao", {
          workspace: ws.id,
          tipo: "erro",
          titulo: `Falha: @${registro.agente}`,
          corpo: motivo.slice(0, 240),
        });
      } catch {
        /* best-effort notification */
      }
    }
    await this.registros.registrarSessao(ws.path, {
      id: registro.id,
      agente: registro.agente,
      modelo: registro.modelo,
      inicio: registro.inicio,
      fim: registro.fim,
      custo_usd: custoUsd,
      status: registro.status,
    });
    if (captura !== "" || agente !== null) {
      await this.registros.garantirRegistro(ws.path, {
        categoria: "chats",
        id: registro.id,
        descricao: `transcript da sessão ${registro.id} (${registro.agente} · ${registro.modelo})`,
        criadoPor: registro.agente,
        tags: ["sessao", "transcript"],
        conteudo: captura,
      });
    }
  }

}
