/**
 * @deprecated Este módulo está deprecado. Webhooks agora são nós do tipo "webhook"
 * dentro de um Flow (flow-store.ts). Este arquivo é mantido apenas para backward
 * compatibility com hooks existentes. Não crie novos hooks — use flows com nó webhook.
 * Veja: POST /flows/:id/webhook
 */
import { randomBytes, createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic, mkdirRecursive } from "../utils/fs-safe.js";
import { HookError } from "./errors.js";
import { TaskStore } from "./task-store.js";
import { eventBus } from "./event-bus.js";
import type { Gatilho } from "../schemas/gatilho.js";

export type AlvoHook =
  | { tipo: "task_create"; titulo: string; descricao?: string; coluna?: string; prioridade?: string; responsavel?: string }
  | { tipo: "task_run"; task_id: string; instrucao_adicional?: string }
  | { tipo: "agent_run"; agente: string; ordem: string }
  | { tipo: "flow_run"; flow: string; entrada?: string }
  | { tipo: "webhook_out"; url: string; metodo?: string; corpo?: string; headers?: Record<string, string> }
  | { tipo: "pre_publish"; minimo_chars?: number; proibir_scripts?: boolean; checar_duplicidade?: boolean };

export interface HookAuth {
  tipo: "token" | "hmac_sha256" | "nenhuma";
  secret?: string;
}

export interface Hook {
  id: string;
  nome: string;
  token: string;
  auth?: HookAuth;
  exige_aprovacao?: boolean;
  reenvio_urls?: string[];
  metodos: string[];
  respond: "imediato" | "final";
  dedup_seg: number;
  ativo: boolean;
  alvo: AlvoHook;
  workspace: string;
  criado_em: string;
}

export interface PayloadHook {
  corpo: Record<string, unknown>;
  query: Record<string, string>;
}

export interface ExecutoresHook {
  agentRun?: (agente: string, ordem: string, wsPath: string, gatilho?: Gatilho) => Promise<{ id: string; captura?: string }>;
  flowRun?: (flow: string, entrada: string, wsPath: string) => Promise<{ id: string; captura?: string }>;
}

export interface OpcoesHookStore {
  agora?: () => Date;
  executores?: ExecutoresHook;
}

interface TriggerDef {
  id: string;
  quando: { evento: string };
  filtro?: { campo: string; valor: string };
  alvo: AlvoHook;
  workspace?: string;
}

function msg(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/** Substitui {{caminho.ponto}} pelo valor no payload; {{payload}} = JSON completo */
export function substituirTemplate(texto: string, payload: PayloadHook): string {
  const get = (caminho: string): string => {
    if (caminho === "payload") return JSON.stringify(payload.corpo);
    if (caminho === "query") return JSON.stringify(payload.query);

    let partes = caminho.split(".");
    let raiz: unknown = payload.corpo;

    if (partes[0] === "payload") {
      partes = partes.slice(1);
    } else if (partes[0] === "query") {
      raiz = payload.query;
      partes = partes.slice(1);
    }

    if (partes.length === 0) {
      return typeof raiz === "object" ? JSON.stringify(raiz) : String(raiz ?? "");
    }

    let no: unknown = raiz;
    for (const parte of partes) {
      if (no && typeof no === "object" && parte in (no as Record<string, unknown>)) {
        no = (no as Record<string, unknown>)[parte];
      } else {
        const q = payload.query[caminho] ?? payload.query[parte];
        return q ?? "";
      }
    }
    return no === undefined || no === null ? "" : typeof no === "object" ? JSON.stringify(no) : String(no);
  };
  return texto.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, caminho: string) => get(caminho));
}

export class HookStore {
  private readonly agora: () => Date;
  private readonly executores: ExecutoresHook;
  private readonly ultimosHashes = new Map<string, { hash: string; em: number }>();

  constructor(opcoes: OpcoesHookStore = {}) {
    this.agora = opcoes.agora ?? (() => new Date());
    this.executores = opcoes.executores ?? {};
  }

  dir(wsPath: string): string {
    return join(wsPath, ".opencorp", "hooks");
  }

  caminho(wsPath: string, id: string): string {
    return join(this.dir(wsPath), `${id}.json`);
  }

  private validarAlvo(alvo: AlvoHook): void {
    if (!alvo || typeof alvo !== "object") throw new HookError("alvo obrigatório");
    switch (alvo.tipo) {
      case "task_create":
        if (typeof alvo.titulo !== "string" || alvo.titulo.length === 0) {
          throw new HookError('alvo task_create precisa de --titulo (aceita {{campo}})');
        }
        break;
      case "task_run":
        if (!alvo.task_id) {
          throw new HookError("alvo task_run precisa de --task-id");
        }
        break;
      case "agent_run":
        if (!alvo.agente) throw new HookError("alvo agent_run precisa de --agente");
        if (!alvo.ordem) throw new HookError("alvo agent_run precisa de --ordem (aceita {{campo}})");
        break;
      case "flow_run":
        if (!alvo.flow) throw new HookError("alvo flow_run precisa de --flow");
        break;
      case "webhook_out":
        if (!alvo.url) throw new HookError("alvo webhook_out precisa de --url");
        break;
      default:
        throw new HookError(`tipo de alvo inválido: ${(alvo as { tipo?: string }).tipo}`);
    }
  }

  async criar(
    wsPath: string,
    workspace: string,
    dados: {
      nome: string;
      alvo: AlvoHook;
      respond?: "imediato" | "final";
      dedup_seg?: number;
      metodos?: string[];
      token?: string;
      auth?: HookAuth;
      exige_aprovacao?: boolean;
      reenvio_urls?: string[];
    },
  ): Promise<Hook> {
    if (dados.nome.trim().length === 0) throw new HookError('nome obrigatório: hook create --nome "..."');
    this.validarAlvo(dados.alvo);
    await mkdirRecursive(this.dir(wsPath));
    const token = dados.token || `hk_${randomBytes(16).toString("hex")}`;
    const hook: Hook = {
      id: `hook-${randomBytes(4).toString("hex")}`,
      nome: dados.nome.trim(),
      token,
      auth: dados.auth ?? { tipo: "token", secret: token },
      exige_aprovacao: dados.exige_aprovacao ?? false,
      reenvio_urls: dados.reenvio_urls ?? [],
      metodos: dados.metodos ?? ["POST"],
      respond: dados.respond ?? "imediato",
      dedup_seg: dados.dedup_seg ?? 60,
      ativo: true,
      alvo: dados.alvo,
      workspace,
      criado_em: this.agora().toISOString(),
    };
    await writeFileAtomic(this.caminho(wsPath, hook.id), `${JSON.stringify(hook, null, 2)}\n`);
    return hook;
  }

  listar(wsPath: string): Hook[] {
    const dir = this.dir(wsPath);
    if (!existsSync(dir)) return [];
    const saida: Hook[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      try {
        saida.push(JSON.parse(readFileSync(join(dir, f), "utf8")) as Hook);
      } catch {
        continue;
      }
    }
    return saida.sort((a, b) => a.id.localeCompare(b.id));
  }

  obter(wsPath: string, id: string): Hook {
    const path = this.caminho(wsPath, id);
    if (!existsSync(path)) {
      const erro = new HookError(`hook "${id}" não encontrado — veja "opencorp hook list"`);
      (erro as { status?: number }).status = 404;
      throw erro;
    }
    return JSON.parse(readFileSync(path, "utf8")) as Hook;
  }

  async excluir(wsPath: string, id: string): Promise<void> {
    this.obter(wsPath, id);
    const { unlink } = await import("node:fs/promises");
    await unlink(this.caminho(wsPath, id));
  }

  private dedupChave(wsPath: string, id: string): string {
    return `${wsPath}::${id}`;
  }

  private aplicarDedup(wsPath: string, id: string, payload: PayloadHook, janelaSeg: number): void {
    if (janelaSeg <= 0) return;
    const hash = createHash("sha256").update(JSON.stringify(payload.corpo)).digest("hex");
    const chave = this.dedupChave(wsPath, id);
    const anterior = this.ultimosHashes.get(chave);
    const agoraMs = this.agora().getTime();
    if (anterior && anterior.hash === hash && agoraMs - anterior.em < janelaSeg * 1000) {
      const erro = new HookError(`payload duplicado para o hook "${id}" na janela de ${janelaSeg}s`);
      (erro as { status?: number }).status = 409;
      throw erro;
    }
    this.ultimosHashes.set(chave, { hash, em: agoraMs });
  }

  /** Reenvia automaticamente para outras URLs em cascata se configurado (fan-out / relay) */
  private dispararReenvios(hook: Hook, payload: PayloadHook): void {
    if (!hook.reenvio_urls || hook.reenvio_urls.length === 0) return;
    for (const url of hook.reenvio_urls) {
      const u = url.trim();
      if (!u.startsWith("http://") && !u.startsWith("https://")) continue;
      fetch(u, {
        method: "POST",
        headers: { "content-type": "application/json", "x-opencorp-hook-id": hook.id },
        body: JSON.stringify(payload.corpo),
      }).catch((err) => {
        console.error(`[hook ${hook.id}] falha ao reenviar para ${u}:`, err instanceof Error ? err.message : err);
      });
    }
  }

  /** Executa o alvo do hook. NÃO aplica dedup nem auth — quem chama decide. */
  async executar(wsPath: string, hook: Hook, payload: PayloadHook): Promise<{ exec_id: string | null; resultado: string }> {
    const alvo = hook.alvo;
    if (alvo.tipo === "task_create") {
      const titulo = substituirTemplate(alvo.titulo, payload);
      const descricao = alvo.descricao ? substituirTemplate(alvo.descricao, payload) : undefined;
      const t = await new TaskStore().criar(wsPath, {
        titulo,
        descricao,
        coluna: (alvo as any).coluna ?? "backlog",
        prioridade: (alvo as any).prioridade ?? "media",
        responsavel: alvo.responsavel ? substituirTemplate(alvo.responsavel, payload) : undefined,
      }, `hook:${hook.id}`);
      eventBus.emit("hook.executado", { hook: hook.id, alvo: alvo.tipo, task: t.id });
      return { exec_id: t.id, resultado: `task ${t.id} criada: ${titulo}` };
    }
    if (alvo.tipo === "task_run") {
      const taskStore = new TaskStore();
      const task = await taskStore.obter(wsPath, alvo.task_id);
      if (!task) throw new HookError(`task "${alvo.task_id}" não encontrada`);
      const instrucaoAdicional = alvo.instrucao_adicional
        ? substituirTemplate(alvo.instrucao_adicional, payload)
        : "";
      const ordemFinal = [
        `Executar task ${task.id}: ${task.titulo}`,
        task.descricao ? `Descrição:
${task.descricao}` : null,
        instrucaoAdicional ? `Instrução do Webhook:
${instrucaoAdicional}` : null,
        `Contexto do Gatilho Webhook (${hook.nome}):`,
        `- Payload: ${JSON.stringify(payload.corpo)}`,
        `- Query: ${JSON.stringify(payload.query)}`,
      ].filter(Boolean).join("\n\n");

      const agente = (task.responsavel ?? "executor-padrao").replace(/^agente:/, "");
      if (!this.executores.agentRun) throw new HookError("execução de agente não disponível neste contexto (use o servidor)");
      const r = await this.executores.agentRun(agente, ordemFinal, wsPath, {
        tipo: "webhook",
        origem: `hook:${hook.id}:task:${task.id}`,
      });
      eventBus.emit("hook.executado", { hook: hook.id, alvo: alvo.tipo, task: task.id, exec: r.id });
      return { exec_id: r.id, resultado: r.captura?.trim() ?? "" };
    }
    if (alvo.tipo === "agent_run") {
      if (!this.executores.agentRun) throw new HookError("execução de agente não disponível neste contexto (use o servidor)");
      const ordem = substituirTemplate(alvo.ordem, payload);
      // Gatilho enriquecido com tipo "webhook" e contexto
      const r = await this.executores.agentRun(alvo.agente, ordem, wsPath, {
        tipo: "webhook",
        origem: `hook:${hook.id}`,
      });
      eventBus.emit("hook.executado", { hook: hook.id, alvo: alvo.tipo, exec: r.id });
      return { exec_id: r.id, resultado: r.captura?.trim() ?? "" };
    }
    if (alvo.tipo === "flow_run") {
      if (!this.executores.flowRun) throw new HookError("execução de flow não disponível neste contexto (use o servidor)");
      const entrada = substituirTemplate(alvo.entrada ?? "", payload);
      const r = await this.executores.flowRun(alvo.flow, entrada, wsPath);
      eventBus.emit("hook.executado", { hook: hook.id, alvo: alvo.tipo, exec: r.id });
      return { exec_id: r.id, resultado: r.captura?.trim() ?? "" };
    }
    if (alvo.tipo === "pre_publish") {
      const { validarPrePublicacao } = await import("./pre-publish.js");
      const validacao = await validarPrePublicacao(wsPath, {
        titulo: payload.corpo.titulo ? String(payload.corpo.titulo) : undefined,
        slug: payload.corpo.slug ? String(payload.corpo.slug) : undefined,
        conteudo: String(payload.corpo.conteudo || payload.corpo.content || ""),
        tipo: (payload.corpo.tipo as any) || "post",
        minimoChars: alvo.minimo_chars,
        proibirScriptsSoltos: alvo.proibir_scripts,
        checarDuplicidade: alvo.checar_duplicidade,
      });
      if (!validacao.valido) {
        throw new HookError(`Validação pré-publicação falhou: ${validacao.erros.join("; ")}`);
      }
      eventBus.emit("hook.executado", { hook: hook.id, alvo: "pre_publish", valido: true });
      return {
        exec_id: null,
        resultado: "Aprovado: conteúdo atende aos requisitos editoriais e de segurança.",
      };
    }
    // webhook_out
    const url = substituirTemplate(alvo.url, payload);
    const metodo = (alvo.metodo ?? "POST").toUpperCase();
    const corpo = alvo.corpo === undefined ? JSON.stringify(payload.corpo) : substituirTemplate(alvo.corpo, payload);
    let ultimoErro: unknown = null;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      try {
        const resp = await fetch(url, {
          method: metodo,
          headers: { "content-type": "application/json", ...(alvo.headers ?? {}) },
          body: metodo === "GET" || metodo === "HEAD" ? undefined : corpo,
        });
        const texto = (await resp.text()).slice(0, 4096);
        eventBus.emit("hook.executado", { hook: hook.id, alvo: "webhook_out", status: resp.status });
        return { exec_id: null, resultado: `HTTP ${resp.status}: ${texto}` };
      } catch (erro) {
        ultimoErro = erro;
        if (tentativa < 2) {
          await new Promise((r) => setTimeout(r, 1000 * 2 ** tentativa));
        }
      }
    }
    throw new HookError(`webhook_out falhou após 3 tentativas: ${msg(ultimoErro)}`);
  }

  /** Disparo completo: dedup + auth + HITL check + execução + forwarding */
  async disparar(wsPath: string, hook: Hook, payload: PayloadHook): Promise<{ exec_id: string | null; resultado: string }> {
    if (!hook.ativo) {
      const inativo = new HookError(`hook "${hook.id}" está inativo`);
      (inativo as { status?: number }).status = 409;
      throw inativo;
    }
    this.aplicarDedup(wsPath, hook.id, payload, hook.dedup_seg);
    eventBus.emit("hook.disparo", { hook: hook.id, workspace: hook.workspace });

    // Dispara reenvios externos se houver
    this.dispararReenvios(hook, payload);

    // Trava de Aprovação Humana Obrigatória (HITL)
    if (hook.exige_aprovacao) {
      const { ApprovalsStore } = await import("./approvals-store.js");
      const approvals = new ApprovalsStore();

      let ordemDescricao = "";
      let agenteAlvo = "executor-padrao";
      if (hook.alvo.tipo === "agent_run") {
        ordemDescricao = substituirTemplate(hook.alvo.ordem, payload);
        agenteAlvo = hook.alvo.agente;
      } else if (hook.alvo.tipo === "task_run") {
        ordemDescricao = `Executar task ${hook.alvo.task_id} via webhook com payload: ${JSON.stringify(payload.corpo)}`;
      } else if (hook.alvo.tipo === "task_create") {
        ordemDescricao = `Criar task: ${substituirTemplate(hook.alvo.titulo, payload)}`;
      } else if (hook.alvo.tipo === "flow_run") {
        ordemDescricao = `Executar fluxo ${hook.alvo.flow} com entrada: ${substituirTemplate(hook.alvo.entrada ?? "", payload)}`;
      } else if (hook.alvo.tipo === "webhook_out") {
        ordemDescricao = `Disparar webhook out para ${hook.alvo.url}`;
        agenteAlvo = "webhook";
      } else {
        ordemDescricao = "Validação pré-publicação";
        agenteAlvo = "revisor";
      }

      const p = await approvals.criar(wsPath, {
        ordem: ordemDescricao,
        agente: agenteAlvo,
        modelo: "padrão",
        padrao: `hook:${hook.id}`,
        origem: "pre-voo",
        motivo_guard: `Gatilho do Webhook "${hook.nome}" (${hook.id}) configurado para exigir aprovação humana prévia`,
        workspace_id: hook.workspace,
        workspace_path: wsPath,
        exec_id: `hook-${hook.id}-${Date.now()}`,
      });
      eventBus.emit("hook.aguardando_aprovacao", { hook: hook.id, pendencia_id: p.id });

      return {
        exec_id: p.id,
        resultado: `Webhook recebido e retido para aprovação humana (pendência ${p.id}). Aprove em /approvals para executar.`,
      };
    }

    return this.executar(wsPath, hook, payload);
  }
}

// ── Triggers declarativos (evento interno → alvo) ──

export type { TriggerDef };

export class TriggersStore {
  private cache: { triggers: TriggerDef[]; mtime: number } | null = null;

  dir(homeDir: string): string {
    return join(homeDir, ".opencorp", "triggers");
  }

  listar(homeDir: string, forcar = false): TriggerDef[] {
    const dir = this.dir(homeDir);
    if (!existsSync(dir)) return [];
    let mtime = 0;
    try {
      mtime = statSync(dir).mtimeMs;
    } catch {
      mtime = 0;
    }
    if (!forcar && this.cache && this.cache.mtime === mtime) return this.cache.triggers;
    const triggers: TriggerDef[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      try {
        const def = JSON.parse(readFileSync(join(dir, f), "utf8")) as TriggerDef;
        if (def.id && def.quando?.evento && def.alvo) triggers.push(def);
      } catch {
        continue;
      }
    }
    this.cache = { triggers, mtime };
    return triggers;
  }

  /** Avalia um evento contra os triggers; devolve os casados.
   *  Se o evento carrega `workspace` e o trigger declara `workspace`, exigimos
   *  igualdade — sem isso, um trigger por empresa dispararia em TODAS as
   *  empresas sempre que qualquer task com o mesmo título fosse criada. */
  casar(homeDir: string, evento: string, dados: Record<string, unknown>): TriggerDef[] {
    return this.listar(homeDir, false).filter((t) => {
      if (t.quando.evento !== evento) return false;
      if (t.workspace && dados.workspace !== undefined && dados.workspace !== t.workspace) return false;
      if (t.filtro) {
        const valor = String(dados[t.filtro.campo] ?? "");
        return valor === t.filtro.valor;
      }
      return true;
    });
  }

  async criar(homeDir: string, def: Omit<TriggerDef, "id"> & { id?: string }): Promise<TriggerDef> {
    if (!def.quando?.evento) throw new HookError("trigger precisa de quando.evento");
    this.validarAlvo(def.alvo);
    const completo: TriggerDef = { ...def, id: def.id ?? `trg-${randomBytes(3).toString("hex")}` };
    await mkdirRecursive(this.dir(homeDir));
    await writeFileAtomic(join(this.dir(homeDir), `${completo.id}.json`), `${JSON.stringify(completo, null, 2)}\n`);
    this.cache = null;
    return completo;
  }

  async excluir(homeDir: string, id: string): Promise<void> {
    const { unlink } = await import("node:fs/promises");
    await unlink(join(this.dir(homeDir), `${id}.json`));
    this.cache = null;
  }

  private validarAlvo(alvo: AlvoHook): void {
    if (!alvo?.tipo) throw new HookError("trigger precisa de alvo com tipo");
  }
}
