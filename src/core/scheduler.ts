import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { mkdirRecursive } from "../utils/fs-safe.js";
import { opencorpHome } from "../utils/paths.js";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { openSync } from "node:fs";
import { SchedulerError } from "./errors.js";
import { SettingsStore } from "./settings-store.js";

export type Agenda =
  | { tipo: "cron"; valor: string }
  | { tipo: "intervalo_min"; valor: number }
  | { tipo: "data_unica"; valor: string };

export interface Job {
  id: string;
  nome: string;
  agenda: Agenda;
  args: string[];
  workspace: string;
  ativo: boolean;
  graca_min: number;
  ultima_exec: string | null;
  proxima_exec: string | null;
  criado_em: string;
}

export interface OpcoesScheduler {
  homeDir?: string;
  agora?: () => Date;
  executar?: (job: Job) => Promise<string>;
  binPath?: string;
  reconciliar?: () => Promise<string[]>;
}

interface LinhaJob {
  id: string;
  nome: string;
  agenda_tipo: string;
  agenda_valor: string;
  args: string;
  workspace: string;
  ativo: number;
  graca_min: number;
  ultima_exec: string | null;
  proxima_exec: string | null;
  criado_em: string;
}

// ── parser cron (5 campos: min hora dom mês dow; suporta * , - / ) ──

function campoCron(spec: string, min: number, max: number, onde: string): (v: number) => boolean {
  if (spec === "*") return () => true;
  const valores = new Set<number>();
  for (const parte of spec.split(",")) {
    const m = /^(?:(\d+)(?:-(\d+))?|\*)(?:\/(\d+))?$/.exec(parte);
    if (!m) throw new SchedulerError(`cron inválido (${onde}): "${parte}"`);
    const passo = m[3] ? Number(m[3]) : 1;
    if (passo < 1) throw new SchedulerError(`cron inválido (${onde}): passo ${passo}`);
    const ini = m[1] === undefined ? min : Number(m[1]);
    const fim = m[1] === undefined ? max : m[2] === undefined ? ini : Number(m[2]);
    if (ini < min || fim > max || ini > fim) {
      throw new SchedulerError(`cron inválido (${onde}): faixa ${ini}-${fim} fora de ${min}-${max}`);
    }
    for (let v = ini; v <= fim; v += passo) valores.add(v);
  }
  return (v) => valores.has(v);
}

export function validarCron(expr: string): void {
  const campos = expr.trim().split(/\s+/);
  if (campos.length !== 5) throw new SchedulerError(`cron precisa de 5 campos: "${expr}"`);
  campoCron(campos[0]!, 0, 59, "minuto");
  campoCron(campos[1]!, 0, 23, "hora");
  campoCron(campos[2]!, 1, 31, "dia-do-mês");
  campoCron(campos[3]!, 1, 12, "mês");
  campoCron(campos[4]!, 0, 6, "dia-da-semana");
}

export function proximoCron(expr: string, de: Date): Date {
  validarCron(expr);
  const [mm, hh, dom, mes, dow] = expr.trim().split(/\s+/).map((s, i) => {
    const faixas: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
    return campoCron(s, faixas[i]![0], faixas[i]![1], ["minuto", "hora", "dia-do-mês", "mês", "dia-da-semana"][i]!);
  });
  const t = new Date(de.getTime());
  t.setSeconds(0, 0);
  for (let i = 0; i < 527040; i++) {
    t.setMinutes(t.getMinutes() + 1);
    if (mm(t.getMinutes()) && hh(t.getHours()) && dom(t.getDate()) && mes(t.getMonth() + 1) && dow(t.getDay())) {
      return new Date(t.getTime());
    }
  }
  throw new SchedulerError(`cron "${expr}" não tem ocorrência em ~1 ano`);
}

function gerarId(): string {
  return `sch-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Gatilho do ledger unificado: se o job roda um `agent run`, ele deve se
 * auto-declarar como ativação "cron" de origem <jobId> (retorna o valor do
 * flag --gatilho; vazio quando o job não é agent run).
 */
export function argsComGatilhoCron(job: { id: string; args: string[] }): string {
  return job.args[0] === "agent" && job.args[1] === "run" ? `cron:${job.id}` : "";
}

export function parseQuandoDataUnica(quando: string, agora: Date = new Date()): string {
  const q = quando.trim();
  const mOffset = /^\+(\d+)([mhd])$/i.exec(q);
  if (mOffset) {
    const qtd = parseInt(mOffset[1]!, 10);
    const unidade = mOffset[2]!.toLowerCase();
    const mult = unidade === "m" ? 60_000 : unidade === "h" ? 3600_000 : 86400_000;
    return new Date(agora.getTime() + qtd * mult).toISOString();
  }

  const mHora = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(q);
  if (mHora) {
    const hora = parseInt(mHora[1]!, 10);
    const min = parseInt(mHora[2]!, 10);
    const seg = mHora[3] ? parseInt(mHora[3], 10) : 0;
    const alvo = new Date(agora);
    alvo.setHours(hora, min, seg, 0);
    if (alvo.getTime() <= agora.getTime()) {
      alvo.setDate(alvo.getDate() + 1);
    }
    return alvo.toISOString();
  }

  const mAmanha = /^amanh[aã]\s+(\d{1,2}):(\d{2})$/i.exec(q);
  if (mAmanha) {
    const hora = parseInt(mAmanha[1]!, 10);
    const min = parseInt(mAmanha[2]!, 10);
    const alvo = new Date(agora);
    alvo.setDate(alvo.getDate() + 1);
    alvo.setHours(hora, min, 0, 0);
    return alvo.toISOString();
  }

  const d = new Date(q);
  if (!isNaN(d.getTime())) return d.toISOString();
  throw new SchedulerError(`formato de agendamento não reconhecido: "${quando}". Use "14:30", "+30m", "+2h", "amanha 09:00", ou ISO`);
}

export function parseAgendaTask(opts: {
  quando?: string;
  at?: string;
  cron?: string;
  agendar?: string;
  repete?: string;
  repetir?: string;
  intervaloMin?: number;
}): { agenda: Agenda; descricao: string } | null {
  const cronExpr = (opts.cron || opts.agendar)?.trim();
  const repeteExpr = (opts.repete || opts.repetir)?.trim().toLowerCase();
  const quandoExpr = opts.quando || opts.at;

  if (cronExpr) {
    return {
      agenda: { tipo: "cron", valor: cronExpr },
      descricao: `Cron: "${cronExpr}"`,
    };
  }

  if (opts.intervaloMin && Number(opts.intervaloMin) > 0) {
    const min = Number(opts.intervaloMin);
    return {
      agenda: { tipo: "intervalo_min", valor: min },
      descricao: `A cada ${min} min`,
    };
  }

  if (repeteExpr) {
    if (repeteExpr === "diario" || repeteExpr === "diária" || repeteExpr === "daily") {
      let hora = 9;
      let min = 0;
      if (quandoExpr) {
        const m = /^(\d{1,2}):(\d{2})$/.exec(quandoExpr.trim());
        if (m) {
          hora = parseInt(m[1]!, 10);
          min = parseInt(m[2]!, 10);
        }
      }
      return {
        agenda: { tipo: "cron", valor: `${min} ${hora} * * *` },
        descricao: `Diariamente às ${String(hora).padStart(2, "0")}:${String(min).padStart(2, "0")}`,
      };
    }
    if (repeteExpr === "horario" || repeteExpr === "hourly") {
      return {
        agenda: { tipo: "intervalo_min", valor: 60 },
        descricao: `A cada hora (60 min)`,
      };
    }
    if (repeteExpr === "semanal" || repeteExpr === "weekly") {
      return {
        agenda: { tipo: "cron", valor: "0 9 * * 1" },
        descricao: `Semanalmente (toda segunda às 09:00)`,
      };
    }
    const mMin = /^(\d+)m$/i.exec(repeteExpr);
    if (mMin) {
      const val = parseInt(mMin[1]!, 10);
      return {
        agenda: { tipo: "intervalo_min", valor: val },
        descricao: `A cada ${val} min`,
      };
    }
    const mHora = /^(\d+)h$/i.exec(repeteExpr);
    if (mHora) {
      const val = parseInt(mHora[1]!, 10) * 60;
      return {
        agenda: { tipo: "intervalo_min", valor: val },
        descricao: `A cada ${parseInt(mHora[1]!, 10)} hora(s)`,
      };
    }
    const num = parseInt(repeteExpr, 10);
    if (!isNaN(num) && num > 0) {
      return {
        agenda: { tipo: "intervalo_min", valor: num },
        descricao: `A cada ${num} min`,
      };
    }
    throw new SchedulerError(`formato de repetição inválido: "${repeteExpr}". Use "diario", "semanal", "30m", "2h" ou número de minutos`);
  }

  if (quandoExpr) {
    const iso = parseQuandoDataUnica(quandoExpr);
    return {
      agenda: { tipo: "data_unica", valor: iso },
      descricao: `Data única: ${iso.slice(0, 16).replace("T", " ")}`,
    };
  }

  return null;
}

export class Scheduler {
  private readonly homeDir: string;
  private readonly agora: () => Date;
  private readonly executarFn: (job: Job) => Promise<string>;
  private readonly reconciliarFn: (() => Promise<string[]>) | null;
  private db: Database.Database | null = null;
  private timer: NodeJS.Timeout | null = null;
  private keepAlive: NodeJS.Timeout | null = null;

  constructor(opcoes: OpcoesScheduler = {}) {
    this.homeDir = opcoes.homeDir ?? opencorpHome();
    this.agora = opcoes.agora ?? (() => new Date());
    this.executarFn =
      opcoes.executar ??
      (async (job) => this.executarSpawn(job));
    this.reconciliarFn = opcoes.reconciliar ?? null;
  }

  private async banco(): Promise<Database.Database> {
    if (this.db) return this.db;
    const caminho = resolve(this.homeDir, ".opencorp", "scheduler.db");
    await mkdirRecursive(dirname(caminho));
    const db = new Database(caminho);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        agenda_tipo TEXT NOT NULL,
        agenda_valor TEXT NOT NULL,
        args TEXT NOT NULL,
        workspace TEXT NOT NULL DEFAULT '',
        ativo INTEGER NOT NULL DEFAULT 1,
        graca_min INTEGER NOT NULL DEFAULT 5,
        ultima_exec TEXT,
        proxima_exec TEXT,
        criado_em TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS job_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        job_nome TEXT NOT NULL DEFAULT '',
        workspace TEXT NOT NULL DEFAULT '',
        iniciado_em TEXT NOT NULL,
        fim_em TEXT,
        resultado TEXT NOT NULL DEFAULT '',
        erro TEXT,
        pulado INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs (job_id, iniciado_em);
    `);
    this.db = db;
    return db;
  }

  private linhaParaJob(l: LinhaJob): Job {
    const agenda: Agenda =
      l.agenda_tipo === "cron"
        ? { tipo: "cron", valor: l.agenda_valor }
        : l.agenda_tipo === "data_unica"
          ? { tipo: "data_unica", valor: l.agenda_valor }
          : { tipo: "intervalo_min", valor: Number(l.agenda_valor) };
    return {
      id: l.id,
      nome: l.nome,
      agenda,
      args: JSON.parse(l.args) as string[],
      workspace: l.workspace,
      ativo: l.ativo === 1,
      graca_min: l.graca_min,
      ultima_exec: l.ultima_exec,
      proxima_exec: l.proxima_exec,
      criado_em: l.criado_em,
    };
  }

  private calcularProxima(agenda: Agenda, de: Date): Date {
    if (agenda.tipo === "cron") return proximoCron(agenda.valor, de);
    if (agenda.tipo === "intervalo_min") {
      if (agenda.valor < 1) throw new SchedulerError("intervalo_min deve ser >= 1");
      return new Date(de.getTime() + agenda.valor * 60_000);
    }
    const data = new Date(agenda.valor);
    if (Number.isNaN(data.getTime())) throw new SchedulerError(`data_unica inválida: "${agenda.valor}"`);
    return data;
  }

  private validarAgenda(agenda: Agenda): void {
    if (agenda.tipo === "cron") validarCron(agenda.valor);
    if (agenda.tipo === "intervalo_min" && agenda.valor < 1) throw new SchedulerError("intervalo_min deve ser >= 1");
    if (agenda.tipo === "data_unica" && Number.isNaN(new Date(agenda.valor).getTime())) {
      throw new SchedulerError(`data_unica inválida: "${agenda.valor}"`);
    }
  }

  /**
   * Validação de alto sinal no core: barra o footgun "job que nunca rodaria"
   * (12 jobs foram criados com `agent run --ordem`, flag inexistente, e morriam em silêncio).
   * A whitelist completa de comandos é validada na API (entrada de usuário real).
   */
  private validarArgsJob(args: string[]): void {
    if (args[0] === "agent" && args.includes("--ordem")) {
      throw new SchedulerError(
        'agent run usa ordem POSICIONAL: ["agent","run","<agente>","<ordem>"] — a flag --ordem não existe',
      );
    }
    // ordem splitada: "agent run <agente> <ordem>" deve ter EXATAMENTE 4 elementos —
    // mais que isso significa que a ordem (com espaços) não foi quotada e virou N argumentos
    // (job "ciclo-melhoria" rodou 47 argumentos e falhou em silêncio antes do log de stderr)
    if (args[0] === "agent" && args[1] === "run" && args.length > 4) {
      throw new SchedulerError(
        `ordem com espaços deve vir QUOTADA em --args (ex.: "agent run ${args[2]} \\"sua ordem aqui\\"") — recebi ${args.length} argumentos`,
      );
    }
  }

  /** Registra uma execução/pulo no histórico de runs (observabilidade do pulso) */
  private async registrarRun(
    job: Job,
    dados: { resultado?: string; erro?: string; pulado?: boolean },
  ): Promise<void> {
    try {
      (await this.banco())
        .prepare(
          `INSERT INTO job_runs (job_id, job_nome, workspace, iniciado_em, fim_em, resultado, erro, pulado)
           VALUES (@job_id, @job_nome, @workspace, @iniciado_em, @fim_em, @resultado, @erro, @pulado)`,
        )
        .run({
          job_id: job.id,
          job_nome: job.nome,
          workspace: job.workspace,
          iniciado_em: this.agora().toISOString(),
          fim_em: this.agora().toISOString(),
          resultado: dados.resultado ?? "",
          erro: dados.erro ?? null,
          pulado: dados.pulado ? 1 : 0,
        });
    } catch {
      /* histórico nunca quebra a execução */
    }
  }

  /** Histórico de execuções de um job (mais recente primeiro) */
  async listarRuns(jobId: string, limite = 20): Promise<unknown[]> {
    return (await this.banco())
      .prepare("SELECT * FROM job_runs WHERE job_id = ? ORDER BY id DESC LIMIT ?")
      .all(jobId, limite);
  }

  async criar(
    dados: { nome: string; agenda: Agenda; args: string[]; workspace?: string; graca_min?: number },
  ): Promise<Job> {
    if (dados.nome.trim().length === 0) throw new SchedulerError('nome obrigatório: schedule create --nome "..."');
    if (!Array.isArray(dados.args) || dados.args.length === 0) {
      throw new SchedulerError("args obrigatório — comando opencorp a executar");
    }
    this.validarAgenda(dados.agenda);
    this.validarArgsJob(dados.args);
    const agora = this.agora();
    const job: LinhaJob = {
      id: gerarId(),
      nome: dados.nome.trim(),
      agenda_tipo: dados.agenda.tipo,
      agenda_valor: String(dados.agenda.valor),
      args: JSON.stringify(dados.args),
      workspace: dados.workspace ?? "",
      ativo: 1,
      graca_min: dados.graca_min ?? 5,
      ultima_exec: null,
      proxima_exec: this.calcularProxima(dados.agenda, agora).toISOString(),
      criado_em: agora.toISOString(),
    };
    (await this.banco())
      .prepare(
        `INSERT INTO jobs (id, nome, agenda_tipo, agenda_valor, args, workspace, ativo, graca_min, ultima_exec, proxima_exec, criado_em)
         VALUES (@id, @nome, @agenda_tipo, @agenda_valor, @args, @workspace, @ativo, @graca_min, @ultima_exec, @proxima_exec, @criado_em)`,
      )
      .run(job);
    return this.linhaParaJob(job);
  }

  async listar(somenteAtivos = false): Promise<Job[]> {
    const linhas = (somenteAtivos
      ? (await this.banco()).prepare("SELECT * FROM jobs WHERE ativo = 1 ORDER BY proxima_exec").all()
      : (await this.banco()).prepare("SELECT * FROM jobs ORDER BY criado_em, id").all()) as LinhaJob[];
    return linhas.map((l) => this.linhaParaJob(l));
  }

  async obter(id: string): Promise<Job> {
    const l = (await this.banco()).prepare("SELECT * FROM jobs WHERE id = ?").get(id) as LinhaJob | undefined;
    if (!l) {
      const erro = new SchedulerError(`job "${id}" não encontrado — veja "opencorp schedule list"`);
      (erro as { status?: number }).status = 404;
      throw erro;
    }
    return this.linhaParaJob(l);
  }

  async pausar(id: string): Promise<Job> {
    (await this.banco()).prepare("UPDATE jobs SET ativo = 0 WHERE id = ?").run(id);
    return this.obter(id);
  }

  /**
   * Edita um job existente (PLANO-WEB-CRUD B1). Campos ausentes são preservados.
   * Mudou agenda → recalcula proxima_exec. Valida com as mesmas regras da criação.
   */
  async atualizar(
    id: string,
    dados: { nome?: string; agenda?: Agenda; args?: string[]; graca_min?: number },
  ): Promise<Job> {
    const atual = await this.obter(id);
    const nome = dados.nome !== undefined ? dados.nome.trim() : atual.nome;
    if (nome.length === 0) throw new SchedulerError("nome não pode ficar vazio");
    const agenda = dados.agenda ?? atual.agenda;
    this.validarAgenda(agenda);
    const args = dados.args ?? atual.args;
    if (!Array.isArray(args) || args.length === 0) throw new SchedulerError("args obrigatório — comando opencorp a executar");
    this.validarArgsJob(args);
    const proxima = this.calcularProxima(agenda, this.agora()).toISOString();
    (await this.banco())
      .prepare("UPDATE jobs SET nome = ?, agenda_tipo = ?, agenda_valor = ?, args = ?, graca_min = ?, proxima_exec = ? WHERE id = ?")
      .run(nome, agenda.tipo, String(agenda.valor), JSON.stringify(args), dados.graca_min ?? atual.graca_min, proxima, id);
    return this.obter(id);
  }

  async retomar(id: string): Promise<Job> {
    (await this.banco()).prepare("UPDATE jobs SET ativo = 1 WHERE id = ?").run(id);
    const job = await this.obter(id);
    const proxima = this.calcularProxima(job.agenda, this.agora()).toISOString();
    (await this.banco()).prepare("UPDATE jobs SET proxima_exec = ? WHERE id = ?").run(proxima, id);
    return this.obter(id);
  }

  async excluir(id: string): Promise<void> {
    this.obter(id);
    (await this.banco()).prepare("DELETE FROM jobs WHERE id = ?").run(id);
  }

  private async executarSpawn(job: Job): Promise<string> {
    const bin = resolve(import.meta.dirname ?? ".", "..", "..", "bin", "opencorp.mjs");
    const args = ["--workspace", job.workspace, ...job.args].filter((a) => a.length > 0);
    // Gatilho no ledger unificado (PLANO-UNIFICACAO): todo agent run disparado
    // pelo scheduler se auto-declara como ativação "cron" de origem <jobId>.
    const extras = argsComGatilhoCron(job);
    const final = extras ? [...args, "--gatilho", extras] : args;
    // stderr/stdout do filho vão para log por job — spawn quebrado deixa rastro (não some em silêncio)
    const logDir = join(this.homeDir, "logs");
    await mkdirRecursive(logDir);
    const logFd = openSync(join(logDir, `job-${job.id}.log`), "a");

    const execPath = job.args[0] === "node" ? process.execPath : process.execPath;
    const cmdArgs = job.args[0] === "node" ? job.args.slice(1) : [bin, ...final];

    const wsDir = isAbsolute(job.workspace)
      ? job.workspace
      : join(this.homeDir, "workspaces", job.workspace);

    // Overlap Guard: previne disparar nova instância se a anterior ainda está em execução
    try {
      const db = await this.banco();
      const ultima = db.prepare("SELECT resultado FROM job_runs WHERE job_id = ? ORDER BY id DESC LIMIT 1").get(job.id) as { resultado?: string } | undefined;
      if (ultima?.resultado?.startsWith("spawn pid ")) {
        const pidAnterior = parseInt(ultima.resultado.slice("spawn pid ".length), 10);
        if (pidAnterior > 0) {
          try {
            process.kill(pidAnterior, 0);
            return `ignorado: processo anterior ainda ativo (pid ${pidAnterior})`;
          } catch {
            // PID não está mais vivo, prossegue normalmente
          }
        }
      }
    } catch {
      // Best-effort check
    }

    const filho = spawn(execPath, cmdArgs, {
      cwd: wsDir,
      env: { ...process.env, OPENCORP_HOME: this.homeDir, OPENCORP_WORKSPACE: wsDir },
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    filho.on("error", (err) => {
      console.error(`[scheduler] erro no spawn do job ${job.id} (${job.nome}):`, err.message);
    });
    filho.unref();
    return `spawn pid ${filho.pid ?? 0}`;
  }

  /** Config de catch-up das settings (default seguro se settings indisponível) */
  private async cfgCatchUp(): Promise<{ catch_up: boolean; catch_up_max_min: number }> {
    try {
      const { settings } = await new SettingsStore({ homeDir: this.homeDir }).resolve();
      return { catch_up: settings.scheduler.catch_up, catch_up_max_min: settings.scheduler.catch_up_max_min };
    } catch {
      return { catch_up: false, catch_up_max_min: 60 };
    }
  }

  /**
   * Reaper de zumbis: toda execução "executando" cujo pid não está mais vivo é
   * marcada "falhou" (evita runs pendurados 10h+ quando o opencode morre/hanga).
   * Percorre os workspaces do WorkspaceManager reaproveitando a reconciliação
   * já existente no SessionManager.
   */
  private async reapearZombies(): Promise<string[]> {
    if (this.reconciliarFn) {
      try {
        return await this.reconciliarFn();
      } catch (erro) {
        console.error("[scheduler] reaper de zumbis falhou:", erro instanceof Error ? erro.message : erro);
        return [];
      }
    }
    try {
      const [{ SessionManager }, { WorkspaceManager }] = await Promise.all([
        import("./session-manager.js"),
        import("./workspace-manager.js"),
      ]);
      const sessoes = new SessionManager({ homeDir: this.homeDir });
      const workspaces = new WorkspaceManager({ homeDir: this.homeDir, cwd: this.homeDir });
      const reconciliados: string[] = [];
      for (const ws of await workspaces.listar()) {
        if (!ws.existe) continue;
        try {
          reconciliados.push(...(await sessoes.reconciliarZombies(ws.path)));
        } catch {
          /* workspace sem registries/corp.db — segue */
        }
      }
      return reconciliados;
    } catch (erro) {
      console.error("[scheduler] reaper de zumbis falhou:", erro instanceof Error ? erro.message : erro);
      return [];
    }
  }

  /** Um passo do loop: reape zumbis, executa jobs vencidos e recalcula próximas execuções. */
  async tick(): Promise<{ executados: string[]; pulados: string[]; reconciliados: string[] }> {
    const reconciliados = await this.reapearZombies();
    if (reconciliados.length > 0) {
      console.log(`[scheduler] reaper: ${reconciliados.length} execução(ões) zumbi(s) marcada(s) como falhou: ${reconciliados.join(", ")}`);
    }
    const agora = this.agora();
    const executados: string[] = [];
    const pulados: string[] = [];
    for (const job of await this.listar(true)) {
      if (!job.proxima_exec) continue;
      const prevista = new Date(job.proxima_exec);
      if (prevista.getTime() > agora.getTime()) continue;
      const atrasoMin = (agora.getTime() - prevista.getTime()) / 60_000;
      if (atrasoMin > job.graca_min) {
        // catch-up: settings.scheduler.catch_up executa atrasado dentro da janela catch_up_max_min
        const cfg = await this.cfgCatchUp();
        const executarAtrasado = cfg.catch_up && atrasoMin <= cfg.catch_up_max_min;
        if (!executarAtrasado) {
          // pular com CLAIM atômico: só quem vencer o UPDATE reagenda (sem corrida entre daemons)
          // data_unica vencida desativa — evita loop eterno de skip
          const desativarSkip = job.agenda.tipo === "data_unica";
          const proximaSkip = desativarSkip ? null : this.calcularProxima(job.agenda, agora).toISOString();
          const claimSkip = (await this.banco())
            .prepare("UPDATE jobs SET proxima_exec = ?, ativo = ? WHERE id = ? AND proxima_exec = ?")
            .run(proximaSkip, desativarSkip ? 0 : 1, job.id, job.proxima_exec);
          if (claimSkip.changes === 1) {
            pulados.push(job.id);
            await this.registrarRun(job, { erro: `pulado: atraso de ${Math.round(atrasoMin)}min > graça de ${job.graca_min}min`, pulado: true });
          }
          continue;
        }
        await this.registrarRun(job, { resultado: `catch-up: executando atrasado (${Math.round(atrasoMin)}min atraso, dentro da janela de ${cfg.catch_up_max_min}min)` });
      }
      // CLAIM atômico ANTES de executar: o UPDATE casa só se proxima_exec ainda é a prevista —
      // com dois daemons, apenas um ganha o direito de executar (sem execução dupla)
      const desativar = job.agenda.tipo === "data_unica";
      const proxima = desativar ? null : this.calcularProxima(job.agenda, agora).toISOString();
      const claim = (await this.banco())
        .prepare("UPDATE jobs SET ultima_exec = ?, proxima_exec = ?, ativo = ? WHERE id = ? AND proxima_exec = ?")
        .run(agora.toISOString(), proxima, desativar ? 0 : 1, job.id, job.proxima_exec);
      if (claim.changes !== 1) continue; // outro daemon/processo já assumiu este tick
      try {
        const resultado = await this.executarFn(job);
        await this.registrarRun(job, { resultado });
      } catch (erro) {
        const msgErro = erro instanceof Error ? erro.message : String(erro);
        console.error(`[scheduler] falha ao executar job ${job.id} (${job.nome}): ${msgErro}`);
        await this.registrarRun(job, { erro: msgErro });
        try {
          const { NotificationStore } = await import("./notification-store.js");
          const notifs = new NotificationStore();
          await notifs.adicionar(job.workspace || process.cwd(), {
            tipo: "erro",
            titulo: `Falha no agendamento: ${job.nome}`,
            corpo: `O job "${job.nome}" falhou ao executar: ${msgErro.slice(0, 240)}`,
          });
        } catch {
          /* best-effort notification */
        }
      }
      executados.push(job.id);
      // Stagger leve (250ms) entre spawns no mesmo tick para diluir pico de concorrência
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { executados, pulados, reconciliados };
  }

  async runNow(id: string): Promise<{ job: Job; resultado: string }> {
    const job = await this.obter(id);
    const agora = this.agora();
    const resultado = await this.executarFn(job);
    await this.registrarRun(job, { resultado: resultado + " (run-now)" });

    let proxima: string | null = null;
    let ativo = job.ativo ? 1 : 0;

    if (job.agenda.tipo === "data_unica") {
      // Data única já foi executada manualmente: conclui e desativa
      proxima = null;
      ativo = 0;
    } else if (job.agenda.tipo === "intervalo_min") {
      // Intervalo recomeça a contar o próximo ciclo a partir da execução adiantada
      proxima = new Date(agora.getTime() + job.agenda.valor * 60_000).toISOString();
    } else if (job.agenda.tipo === "cron") {
      // Para cron: se foi adiantado antes do horário previsto, o próximo disparo
      // avança para o ciclo subsequente, evitando execução dupla no mesmo ciclo
      const base =
        job.proxima_exec && new Date(job.proxima_exec).getTime() > agora.getTime()
          ? new Date(job.proxima_exec)
          : agora;
      proxima = proximoCron(job.agenda.valor, base).toISOString();
    }

    (await this.banco())
      .prepare("UPDATE jobs SET ultima_exec = ?, proxima_exec = ?, ativo = ? WHERE id = ?")
      .run(agora.toISOString(), proxima, ativo, id);

    return { job: await this.obter(id), resultado };
  }

  iniciar(intervaloSeg = 30, manterVivo = false): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((erro) => {
        // tick falho nunca mais fica invisível (antes: .catch(() => undefined))
        console.error("[scheduler] erro no tick:", erro instanceof Error ? erro.message : erro);
      });
    }, intervaloSeg * 1000);
    if (manterVivo) {
      this.keepAlive = setInterval(() => undefined, 60_000);
    } else {
      this.timer.unref?.();
    }
  }

  parar(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.keepAlive) {
      clearInterval(this.keepAlive);
      this.keepAlive = null;
    }
  }
}
