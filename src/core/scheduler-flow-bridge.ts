import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { opencorpHome } from "../utils/paths.js";
import { mkdirRecursive, writeFileAtomic } from "../utils/fs-safe.js";
import type { Flow } from "./flow-store.js";

export interface SincronizacaoResultado {
  totalJobs: number;
  criados: number;
  atualizados: number;
  workspacesAfetados: string[];
}

function normalizarId(nome: string): string {
  return nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * Converte jobs do scheduler.db para Flows em cada workspace correspondente,
 * garantindo que toda automação/rotina periódica apareça como Fluxo visual no Studio.
 */
export async function sincronizarJobsParaFluxos(homeDir: string = opencorpHome()): Promise<SincronizacaoResultado> {
  const dbPath = resolve(homeDir, ".opencorp", "scheduler.db");
  if (!existsSync(dbPath)) {
    return { totalJobs: 0, criados: 0, atualizados: 0, workspacesAfetados: [] };
  }

  let db: Database.Database;
  try {
    db = new Database(dbPath);
  } catch {
    return { totalJobs: 0, criados: 0, atualizados: 0, workspacesAfetados: [] };
  }

  let jobs: any[] = [];
  try {
    jobs = db.prepare("SELECT * FROM jobs WHERE ativo = 1").all();
  } catch {
    db.close();
    return { totalJobs: 0, criados: 0, atualizados: 0, workspacesAfetados: [] };
  }
  db.close();

  let criados = 0;
  let atualizados = 0;
  const workspacesSet = new Set<string>();

  for (const job of jobs) {
    if (!job.workspace) continue;
    const wsDir = resolve(homeDir, ".opencorp", "workspaces", job.workspace);
    if (!existsSync(wsDir)) continue;

    workspacesSet.add(job.workspace);
    const flowsDir = join(wsDir, ".opencorp", "flows");
    await mkdirRecursive(flowsDir);

    const flowId = normalizarId(job.nome || job.id);
    const flowPath = join(flowsDir, `${flowId}.json`);

    // Parse args
    let args: string[] = [];
    try {
      args = JSON.parse(job.args);
    } catch {
      args = [String(job.args)];
    }

    // Cron expression
    const cronExpr = job.agenda_tipo === "cron" ? job.agenda_valor : "* * * * *";

    // Detectar tipo de execução
    let noExec: any;
    if (args[0] === "agent" && args[1] === "run") {
      const agente = args[2] || "executor-padrao";
      const ordem = args.slice(3).join(" ") || "Executar ciclo periódico do agente";
      noExec = {
        id: "executar-agente",
        tipo: "agente",
        config: {
          agente,
          ordem,
        },
        pos: { x: 300, y: 120 },
      };
    } else if (args[0] === "meeting" && args[1] === "iniciar") {
      let pauta = "Reunião Periódica Agendada";
      const pautaIdx = args.indexOf("--pauta");
      if (pautaIdx !== -1 && args[pautaIdx + 1]) {
        pauta = args[pautaIdx + 1];
      }
      noExec = {
        id: "executar-reuniao",
        tipo: "reuniao",
        config: {
          pauta,
          agentes: ["ceo-documentos", "editor", "executor-padrao"],
        },
        pos: { x: 300, y: 120 },
      };
    } else {
      const comando = args.join(" ");
      noExec = {
        id: "executar-script",
        tipo: "script",
        config: {
          comando,
          timeout_ms: 120000,
        },
        pos: { x: 300, y: 120 },
      };
    }

    const flowObj: Flow = {
      id: flowId,
      nome: job.nome || flowId,
      nos: [
        {
          id: "gatilho-cron",
          tipo: "cron",
          config: {
            expressao_cron: cronExpr,
            job_id: job.id,
            job_nome: job.nome,
          },
          pos: { x: 60, y: 120 },
        },
        noExec,
        {
          id: "saida",
          tipo: "saida",
          config: {
            registro: "execucoes/resultado",
          },
          pos: { x: 540, y: 120 },
        },
      ],
      arestas: [
        { de: "gatilho-cron", para: noExec.id },
        { de: noExec.id, para: "saida" },
      ],
    };

    if (existsSync(flowPath)) {
      try {
        const existente = JSON.parse(readFileSync(flowPath, "utf-8"));
        const temCron = existente.nos?.some((n: any) => n.tipo === "cron");
        const saidaValida = existente.nos?.some((n: any) => n.tipo === "saida" && typeof n.config?.registro === "string" && n.config.registro.includes("/"));
        if (!temCron || !saidaValida) {
          await writeFileAtomic(flowPath, JSON.stringify(flowObj, null, 2));
          atualizados++;
        }
      } catch {
        await writeFileAtomic(flowPath, JSON.stringify(flowObj, null, 2));
        atualizados++;
      }
    } else {
      await writeFileAtomic(flowPath, JSON.stringify(flowObj, null, 2));
      criados++;
    }
  }

  return {
    totalJobs: jobs.length,
    criados,
    atualizados,
    workspacesAfetados: Array.from(workspacesSet),
  };
}

/**
 * Quando um Flow com nó de gatilho cron é salvo ou atualizado na interface,
 * sincroniza com o scheduler.db para que o daemon de background execute-o.
 */
export async function sincronizarFluxoParaScheduler(
  wsPath: string,
  flow: Flow,
  homeDir: string = opencorpHome()
): Promise<void> {
  const cronNo = flow.nos.find((n) => n.tipo === "cron");
  const wsNome = basename(wsPath);
  const dbPath = resolve(homeDir, ".opencorp", "scheduler.db");
  if (!existsSync(dbPath)) return;

  let db: Database.Database;
  try {
    db = new Database(dbPath);
  } catch {
    return;
  }

  try {
    const jobId = (cronNo?.config as any)?.job_id || `sch-${flow.id}`;
    const expressaoCron = (cronNo?.config as any)?.expressao_cron;

    if (!cronNo || !expressaoCron) {
      // Se não tem cron, desativa qualquer job associado a este flow
      db.prepare("UPDATE jobs SET ativo = 0 WHERE (id = ? OR nome = ?) AND workspace = ?").run(jobId, flow.id, wsNome);
      return;
    }

    // Identifica o que executar
    const scriptNo = flow.nos.find((n) => n.tipo === "script");
    const agenteNo = flow.nos.find((n) => n.tipo === "agente");
    let args: string[];

    if (scriptNo && (scriptNo.config as any)?.comando) {
      args = String((scriptNo.config as any).comando).split(" ");
    } else if (agenteNo && (agenteNo.config as any)?.agente) {
      args = ["agent", "run", String((agenteNo.config as any).agente), String((agenteNo.config as any).ordem || "")];
    } else {
      args = ["flow", "run", flow.id, "--workspace", wsNome];
    }

    const existente = db.prepare("SELECT id FROM jobs WHERE id = ? OR (nome = ? AND workspace = ?)").get(jobId, flow.id, wsNome) as { id: string } | undefined;

    if (existente) {
      db.prepare(
        "UPDATE jobs SET agenda_tipo = 'cron', agenda_valor = ?, args = ?, ativo = 1, nome = ? WHERE id = ?"
      ).run(expressaoCron, JSON.stringify(args), flow.nome || flow.id, existente.id);
    } else {
      const agora = new Date().toISOString();
      db.prepare(
        `INSERT INTO jobs (id, nome, agenda_tipo, agenda_valor, args, workspace, ativo, graca_min, ultima_exec, proxima_exec, criado_em)
         VALUES (@id, @nome, 'cron', @agenda_valor, @args, @workspace, 1, 5, null, @proxima_exec, @criado_em)`
      ).run({
        id: jobId,
        nome: flow.nome || flow.id,
        agenda_valor: expressaoCron,
        args: JSON.stringify(args),
        workspace: wsNome,
        proxima_exec: agora,
        criado_em: agora,
      });
    }
  } catch (err) {
    console.error("[scheduler-flow-bridge] erro ao sincronizar fluxo para scheduler:", err);
  } finally {
    db.close();
  }
}

/**
 * Remove job associado ao excluir flow.
 */
export async function removerJobDoScheduler(
  wsPath: string,
  flowId: string,
  homeDir: string = opencorpHome()
): Promise<void> {
  const wsNome = basename(wsPath);
  const dbPath = resolve(homeDir, ".opencorp", "scheduler.db");
  if (!existsSync(dbPath)) return;

  try {
    const db = new Database(dbPath);
    db.prepare("UPDATE jobs SET ativo = 0 WHERE (nome = ? OR id = ?) AND workspace = ?").run(flowId, `sch-${flowId}`, wsNome);
    db.close();
  } catch {
    // Silencioso em cleanup
  }
}
