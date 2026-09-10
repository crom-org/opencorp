import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { FlowError } from "./errors.js";
import { RegistryStore, type MetaRegistro } from "./registry-store.js";
import { eventBus } from "./event-bus.js";
import { SessionManager, type OpcoesRun, type ResultadoRun } from "./session-manager.js";
import { mkdirRecursive, writeFileAtomic } from "../utils/fs-safe.js";
import { opencorpHome } from "../utils/paths.js";

import { sincronizarFluxoParaScheduler, removerJobDoScheduler, sincronizarJobsParaFluxos } from "./scheduler-flow-bridge.js";

export const nosFlowSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, "use kebab-case para o id do nó"),
  // "fanout"/"review"/"debate": fusão team×fluxo (PLANO-WEB-CRUD F) — padrões do
  // antigo team-orchestrator viram nós do grafo, com contexto fluindo igual aos demais.
  // "script"/"reuniao": nós de lógica avançada e governança inspirados no n8n.
  tipo: z.enum([
    "manual",
    "agente",
    "saida",
    "condicao",
    "webhook",
    "task_create",
    "registro",
    "decisao",
    "fanout",
    "review",
    "debate",
    "script",
    "reuniao",
    "loop",
    "cron",
    "componente",
    "subflow",
    "http_request",
    "delay",
  ]),
  config: z.record(z.string(), z.unknown()).default({}),
  pos: z.object({ x: z.number(), y: z.number() }).optional(),
});

export const arestaFlowSchema = z.object({
  de: z.string().min(1),
  para: z.string().min(1),
  rotulo: z.string().optional(),
  condicao: z.string().optional(),
});

export const flowSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "use kebab-case para o id do flow"),
  nome: z.string().min(1),
  nos: z.array(nosFlowSchema).min(1),
  arestas: z.array(arestaFlowSchema).default([]),
});

export type NoFlow = z.infer<typeof nosFlowSchema>;
export type ArestaFlow = z.infer<typeof arestaFlowSchema>;
export type Flow = z.infer<typeof flowSchema>;

export interface FlowExport {
  version: number;
  exported_at: string;
  flow: Flow;
}

export interface NoExecInfo {
  id: string;
  tipo: string;
  status: "ok" | "falhou" | "nao-executado";
  exec_id: string | null;
}

export interface SessaoFlow {
  rodar(opcoes: OpcoesRun): Promise<ResultadoRun>;
}

export interface FlowStoreOptions {
  homeDir?: string;
  cwd?: string;
  sessoes?: SessaoFlow;
  agora?: () => Date;
}

function msg(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

function gerarId(prefixo: string): string {
  return `${prefixo}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export class FlowStore {
  private readonly homeDir: string;
  private readonly sessoes: SessaoFlow;
  private readonly registros = new RegistryStore();
  private readonly agora: () => Date;

  constructor(opts: FlowStoreOptions = {}) {
    this.homeDir = opts.homeDir ?? opencorpHome();
    this.sessoes = opts.sessoes ?? new SessionManager({ homeDir: this.homeDir, cwd: opts.cwd });
    this.agora = opts.agora ?? (() => new Date());
  }

  dir(wsPath: string): string {
    return join(wsPath, ".opencorp", "flows");
  }

  caminho(wsPath: string, id: string): string {
    return join(this.dir(wsPath), `${id}.json`);
  }

  async criar(wsPath: string, idBruto: string, nome: string): Promise<Flow> {
    const id = validarIdFlow(idBruto);
    const destino = this.caminho(wsPath, id);
    if (existsSync(destino)) {
      throw new FlowError(`flow "${id}" já existe (${destino})`);
    }
    if (nome.trim().length === 0) {
      throw new FlowError("nome obrigatório: use --nome \"<nome do flow>\"");
    }
    const flow: Flow = {
      id,
      nome: nome.trim(),
      nos: [{ id: "gatilho", tipo: "manual", config: {} }],
      arestas: [],
    };
    await this.salvar(wsPath, flow);
    return flow;
  }

  /** POST com grafo completo (editor da web): 409 se id existe + validação semântica do grafo */
  async salvarComId(wsPath: string, bruto: { id: string; nome: string; nos: Flow["nos"]; arestas: Flow["arestas"] }): Promise<Flow> {
    const id = validarIdFlow(bruto.id);
    if (existsSync(this.caminho(wsPath, id))) {
      throw new FlowError(`flow "${id}" já existe (${this.caminho(wsPath, id)})`);
    }
    if (bruto.nome.trim().length === 0) {
      throw new FlowError("nome obrigatório: informe --nome ou nome no corpo");
    }
    const flow: Flow = {
      id,
      nome: bruto.nome.trim(),
      nos: bruto.nos,
      arestas: bruto.arestas,
    };
    await this.salvar(wsPath, flow);
    return flow;
  }

  async listar(wsPath: string): Promise<{
    id: string;
    nome: string;
    nos: number;
    arestas: number;
    gatilhos: Array<{ tipo: string; detalhe?: string }>;
    temLoop: boolean;
  }[]> {
    try {
      await sincronizarJobsParaFluxos(this.homeDir);
    } catch {
      /* não bloqueia listagem */
    }
    const dir = this.dir(wsPath);
    if (!existsSync(dir)) return [];
    const saida: {
      id: string;
      nome: string;
      nos: number;
      arestas: number;
      gatilhos: Array<{ tipo: string; detalhe?: string }>;
      temLoop: boolean;
    }[] = [];
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      try {
        const flow = this.validarTexto(readFileSync(join(dir, f), "utf8"), join(dir, f));
        const gatilhos = flow.nos
          .filter((n) => n.tipo === "cron" || n.tipo === "webhook" || n.tipo === "manual")
          .map((n) => ({
            tipo: n.tipo,
            detalhe: (n.config as any)?.expressao_cron || (n.config as any)?.url || undefined,
          }));
        const temLoop = flow.nos.some((n) => n.tipo === "loop");
        saida.push({
          id: flow.id,
          nome: flow.nome,
          nos: flow.nos.length,
          arestas: flow.arestas.length,
          gatilhos,
          temLoop,
        });
      } catch {
        continue;
      }
    }
    return saida.sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Lista todos os nós webhook de todos os flows, incluindo a URL
   * determinística para trigger: POST /flows/:flowId/webhook
   */
  async listarWebhooks(wsPath: string, baseUrl?: string): Promise<{
    flow_id: string;
    flow_nome: string;
    no_id: string;
    url: string;
    metodo: string;
    config_url?: string;
  }[]> {
    const dir = this.dir(wsPath);
    if (!existsSync(dir)) return [];
    const saida: {
      flow_id: string;
      flow_nome: string;
      no_id: string;
      url: string;
      metodo: string;
      config_url?: string;
    }[] = [];
    const base = baseUrl ?? "";
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      try {
        const flow = this.validarTexto(readFileSync(join(dir, f), "utf8"), join(dir, f));
        for (const no of flow.nos.filter((n) => n.tipo === "webhook")) {
          const config = no.config as { url?: string; metodo?: string };
          saida.push({
            flow_id: flow.id,
            flow_nome: flow.nome,
            no_id: no.id,
            url: `${base}/flows/${encodeURIComponent(flow.id)}/webhook`,
            metodo: "POST",
            config_url: config.url,
          });
        }
      } catch {
        continue;
      }
    }
    return saida;
  }

  async obter(wsPath: string, id: string): Promise<Flow> {
    const path = this.caminho(wsPath, id);
    if (!existsSync(path)) {
      throw new FlowError(`flow "${id}" não encontrado — veja "opencorp flow list"`);
    }
    return this.validarTexto(readFileSync(path, "utf8"), path);
  }

  validarTexto(texto: string, origem?: string): Flow {
    let json: unknown;
    try {
      json = JSON.parse(texto);
    } catch (erro) {
      throw new FlowError(`JSON inválido${origem ? ` em ${origem}` : ""}: ${msg(erro)}`);
    }
    const parsed = flowSchema.safeParse(json);
    if (!parsed.success) {
      const iss = parsed.error.issues[0]!;
      const campo = iss.path.join(".") || "(raiz)";
      throw new FlowError(`flow inválido${origem ? ` (${origem})` : ""} → campo "${campo}": ${iss.message}`);
    }
    const flow = parsed.data;
    this.validarSemantica(flow, origem);
    return flow;
  }

  private validarSemantica(flow: Flow, origem?: string): void {
    const onde = (_d: string) => (origem ? ` (${origem})` : ` (flow "${flow.id}")`);
    const ids = flow.nos.map((n) => n.id);
    if (new Set(ids).size !== ids.length) {
      throw new FlowError(`flow inválido${onde("")}: ids de nó duplicados`);
    }
    const porId = new Map(flow.nos.map((n) => [n.id, n]));
    for (const a of flow.arestas) {
      if (!porId.has(a.de)) {
        throw new FlowError(`flow inválido${onde("")}: aresta parte de nó inexistente "${a.de}"`);
      }
      if (!porId.has(a.para)) {
        throw new FlowError(`flow inválido${onde("")}: aresta aponta para nó inexistente "${a.para}"`);
      }
    }
    const gatilhos = flow.nos.filter((n) => n.tipo === "manual" || n.tipo === "cron" || n.tipo === "webhook");
    if (gatilhos.length === 0) {
      throw new FlowError(
        `flow inválido${onde("")}: exige pelo menos 1 nó gatilho ("manual", "cron" ou "webhook")`,
      );
    }
    for (const no of flow.nos) {
      const config = (no.config ?? {}) as Record<string, unknown>;
      if (no.tipo === "agente") {
        if (typeof config.agente !== "string" || config.agente.length === 0) {
          throw new FlowError(`flow inválido${onde("")}: nó "agente" "${no.id}" precisa de config.agente`);
        }
        if (typeof config.ordem !== "string" || config.ordem.length === 0) {
          throw new FlowError(`flow inválido${onde("")}: nó "agente" "${no.id}" precisa de config.ordem`);
        }
      }
      if (no.tipo === "saida") {
        const registro = config.registro;
        if (typeof registro !== "string" || registro.split("/").length !== 2 || registro.split("/")[0]!.length === 0 || registro.split("/")[1]!.length === 0) {
          throw new FlowError(
            `flow inválido${onde("")}: nó "saida" "${no.id}" precisa de config.registro no formato "categoria/id" (ex.: "documentos/relatorios")`,
          );
        }
      }
      if (no.tipo === "webhook") {
        if (typeof config.url !== "string" || config.url.length === 0) {
          throw new FlowError(`flow inválido${onde("")}: nó "webhook" "${no.id}" precisa de config.url`);
        }
      }
      // ── nós da fusão team×fluxo (PLANO-WEB-CRUD F1/F2) ──
      const passoValido = (p: unknown): p is { agente: string; ordem: string } =>
        !!p && typeof p === "object" && typeof (p as { agente?: unknown }).agente === "string" && (p as { agente: string }).agente.length > 0 &&
        typeof (p as { ordem?: unknown }).ordem === "string" && (p as { ordem: string }).ordem.length > 0;
      if (no.tipo === "fanout") {
        const paralelos = config.paralelos;
        if (!Array.isArray(paralelos) || paralelos.length < 2 || !paralelos.every(passoValido)) {
          throw new FlowError(`flow inválido${onde("")}: nó "fanout" "${no.id}" precisa de config.paralelos com 2+ passos {agente, ordem}`);
        }
        if (config.sintese !== undefined && !passoValido(config.sintese)) {
          throw new FlowError(`flow inválido${onde("")}: nó "fanout" "${no.id}" tem config.sintese inválido (use {agente, ordem})`);
        }
      }
      if (no.tipo === "review") {
        if (!passoValido(config.executor) || !passoValido(config.revisor)) {
          throw new FlowError(`flow inválido${onde("")}: nó "review" "${no.id}" precisa de config.executor e config.revisor ({agente, ordem})`);
        }
        if (config.turnos !== undefined && (typeof config.turnos !== "number" || config.turnos < 1 || config.turnos > 5)) {
          throw new FlowError(`flow inválido${onde("")}: nó "review" "${no.id}" tem config.turnos fora de 1..5`);
        }
      }
      if (no.tipo === "debate") {
        const proponentes = config.proponentes;
        if (!Array.isArray(proponentes) || proponentes.length < 2 || !proponentes.every(passoValido)) {
          throw new FlowError(`flow inválido${onde("")}: nó "debate" "${no.id}" precisa de config.proponentes com 2+ passos {agente, ordem}`);
        }
        if (!passoValido(config.moderador) && !(config.moderador && typeof config.moderador === "object" && typeof (config.moderador as { agente?: unknown }).agente === "string")) {
          throw new FlowError(`flow inválido${onde("")}: nó "debate" "${no.id}" precisa de config.moderador {agente}`);
        }
      }
      if (no.tipo === "condicao") {
        for (const campo of ["chave", "entao", "senao"] as const) {
          if (typeof config[campo] !== "string" || (config[campo] as string).length === 0) {
            throw new FlowError(
              `flow inválido${onde("")}: nó "condicao" "${no.id}" precisa de config.${campo}${campo === "chave" ? "" : " (id de nó)"}`,
            );
          }
        }
        for (const campo of ["entao", "senao"] as const) {
          if (!porId.has(config[campo] as string)) {
            throw new FlowError(
              `flow inválido${onde("")}: nó "condicao" "${no.id}" → config.${campo} aponta para nó inexistente "${config[campo]}"`,
            );
          }
        }
      }
      if (no.tipo === "task_create") {
        if (typeof config.titulo !== "string" || config.titulo.length === 0) {
          throw new FlowError(`flow inválido${onde("")}: nó "task_create" "${no.id}" precisa de config.titulo`);
        }
        const coluna = config.coluna as string | undefined;
        if (coluna !== undefined && !/^[a-z0-9][a-z0-9_-]*$/.test(coluna)) {
          throw new FlowError(`flow inválido${onde("")}: nó "task_create" "${no.id}" — coluna inválida "${coluna}"`);
        }
      }
      if (no.tipo === "registro") {
        const categoria = config.categoria as string | undefined;
        if (typeof categoria !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(categoria)) {
          throw new FlowError(
            `flow inválido${onde("")}: nó "registro" "${no.id}" precisa de config.categoria (ex.: "documentos")`,
          );
        }
        if (config.id !== undefined && typeof config.id !== "string") {
          throw new FlowError(`flow inválido${onde("")}: nó "registro" "${no.id}" — config.id deve ser string`);
        }
      }
      if (no.tipo === "decisao") {
        if (typeof config.agente !== "string" || config.agente.length === 0) {
          throw new FlowError(`flow inválido${onde("")}: nó "decisao" "${no.id}" precisa de config.agente`);
        }
        if (typeof config.pergunta !== "string" || config.pergunta.length === 0) {
          throw new FlowError(`flow inválido${onde("")}: nó "decisao" "${no.id}" precisa de config.pergunta`);
        }
        const opcoes = config.opcoes;
        if (
          !Array.isArray(opcoes) ||
          opcoes.length < 2 ||
          !opcoes.every((o) => typeof (o as { rotulo?: unknown }).rotulo === "string" && typeof (o as { proximo?: unknown }).proximo === "string")
        ) {
          throw new FlowError(
            `flow inválido${onde("")}: nó "decisao" "${no.id}" precisa de config.opcoes = [{rotulo, proximo}] (≥2)`,
          );
        }
        for (const o of opcoes as { rotulo: string; proximo: string }[]) {
          if (!porId.has(o.proximo)) {
            throw new FlowError(
              `flow inválido${onde("")}: nó "decisao" "${no.id}" → opção "${o.rotulo}" aponta para nó inexistente "${o.proximo}"`,
            );
          }
        }
      }
      if (no.tipo === "loop") {
        const maxIter = typeof config.max_iteracoes === "number" ? config.max_iteracoes : 5;
        if (maxIter < 1 || maxIter > 100) {
          throw new FlowError(`flow inválido${onde("")}: nó "loop" "${no.id}" precisa de config.max_iteracoes entre 1 e 100`);
        }
        if (config.retornar_para && !porId.has(config.retornar_para as string)) {
          throw new FlowError(`flow inválido${onde("")}: nó "loop" "${no.id}" aponta para retornar_para inexistente "${config.retornar_para}"`);
        }
        if (config.saida_final && !porId.has(config.saida_final as string)) {
          throw new FlowError(`flow inválido${onde("")}: nó "loop" "${no.id}" aponta para saida_final inexistente "${config.saida_final}"`);
        }
      }
      if (no.tipo === "cron") {
        if (typeof config.expressao_cron !== "string" || config.expressao_cron.trim().length === 0) {
          throw new FlowError(`flow inválido${onde("")}: nó "cron" "${no.id}" precisa de config.expressao_cron`);
        }
      }
      if (no.tipo === "subflow") {
        if (typeof config.flow_id !== "string" || config.flow_id.trim().length === 0) {
          throw new FlowError(`flow inválido${onde("")}: nó "subflow" "${no.id}" precisa de config.flow_id`);
        }
        if (config.flow_id.trim() === flow.id) {
          throw new FlowError(`flow inválido${onde("")}: nó "subflow" "${no.id}" não pode invocar a si mesmo (recursão circular direta)`);
        }
      }
      if (no.tipo === "http_request") {
        if (typeof config.url !== "string" || config.url.trim().length === 0) {
          throw new FlowError(`flow inválido${onde("")}: nó "http_request" "${no.id}" precisa de config.url`);
        }
      }
      if (no.tipo === "delay") {
        const seg = Number(config.segundos);
        if (Number.isNaN(seg) || seg < 1 || seg > 3600) {
          throw new FlowError(`flow inválido${onde("")}: nó "delay" "${no.id}" precisa de config.segundos entre 1 e 3600`);
        }
      }
    }
    // Suporte completo a múltiplas saídas por nó (bifurcação / execução paralela estilo n8n).
    // Qualquer nó pode ter múltiplas arestas de saída.
    const adjacentes = new Map<string, string[]>();
    for (const no of flow.nos) {
      const lista: string[] = flow.arestas.filter((a) => a.de === no.id).map((a) => a.para);
      if (no.tipo === "condicao") {
        lista.push((no.config.entao as string) ?? "", (no.config.senao as string) ?? "");
      }
      if (no.tipo === "decisao") {
        for (const o of (no.config.opcoes as { proximo: string }[] | undefined) ?? []) {
          lista.push(o.proximo);
        }
      }
      if (no.tipo === "loop") {
        const ret = no.config.retornar_para as string | undefined;
        const saida = no.config.saida_final as string | undefined;
        if (ret) lista.push(ret);
        if (saida) lista.push(saida);
      }
      adjacentes.set(no.id, lista.filter((x) => x.length > 0));
    }
    const nosDeControle = new Set(flow.nos.filter((n) => n.tipo === "loop").map((n) => n.id));
    const emVisita = new Set<string>();
    const visitados = new Set<string>();
    const caminho: string[] = [];
    const dfs = (noId: string): void => {
      if (emVisita.has(noId)) {
        const inicio = caminho.indexOf(noId);
        const ciclo = [...caminho.slice(inicio), noId];
        const temControle = ciclo.some((id) => nosDeControle.has(id));
        if (!temControle) {
          throw new FlowError(`flow inválido${onde("")}: ciclo detectado — ${ciclo.join(" → ")}`);
        }
        return;
      }
      if (visitados.has(noId)) return;
      emVisita.add(noId);
      caminho.push(noId);
      for (const prox of adjacentes.get(noId) ?? []) dfs(prox);
      emVisita.delete(noId);
      caminho.pop();
      visitados.add(noId);
    };
    dfs(flow.nos[0]!.id);
  }

  async salvar(wsPath: string, flow: Flow): Promise<void> {
    this.validarTexto(JSON.stringify(flow), `flow "${flow.id}" (salvar)`);
    this.validarSemantica(flow, " (salvar)");
    await mkdirRecursive(this.dir(wsPath));
    await writeFileAtomic(
      this.caminho(wsPath, flow.id),
      `${JSON.stringify(flow, null, 2)}\n`,
    );
    try {
      await sincronizarFluxoParaScheduler(wsPath, flow, this.homeDir);
    } catch {
      /* não interrompe salvar */
    }
  }

  async deletar(wsPath: string, id: string): Promise<void> {
    const path = this.caminho(wsPath, id);
    if (!existsSync(path)) {
      throw new FlowError(`flow "${id}" não encontrado`);
    }
    const { rm } = await import("node:fs/promises");
    await rm(path, { force: true });
    try {
      await removerJobDoScheduler(wsPath, id, this.homeDir);
    } catch {
      /* não interrompe exclusão */
    }
  }

  textoAtual(wsPath: string, id: string): string {
    const path = this.caminho(wsPath, id);
    if (!existsSync(path)) {
      throw new FlowError(`flow "${id}" não encontrado`);
    }
    return readFileSync(path, "utf8");
  }

  async exportar(wsPath: string, id: string): Promise<FlowExport> {
    const flow = await this.obter(wsPath, id);
    return {
      version: 1,
      exported_at: this.agora().toISOString(),
      flow,
    };
  }

  async exportarJson(wsPath: string, id: string): Promise<string> {
    const exp = await this.exportar(wsPath, id);
    return `${JSON.stringify(exp, null, 2)}\n`;
  }

  async importar(
    wsPath: string,
    dados: unknown,
    opts: { sobrescrever?: boolean; novoId?: string } = {},
  ): Promise<Flow> {
    let bruto = dados;
    if (typeof dados === "string") {
      try {
        bruto = JSON.parse(dados);
      } catch (err) {
        throw new FlowError(`JSON inválido para importação de flow: ${msg(err)}`);
      }
    }
    const flowObj =
      bruto && typeof bruto === "object" && "flow" in bruto
        ? (bruto as { flow: unknown }).flow
        : bruto;

    if (!flowObj || typeof flowObj !== "object") {
      throw new FlowError("Dados de importação inválidos: esperado objeto flow");
    }

    const flowClone = { ...(flowObj as Record<string, unknown>) };
    if (opts.novoId) {
      flowClone.id = opts.novoId;
    }

    const parsed = flowSchema.safeParse(flowClone);
    if (!parsed.success) {
      const iss = parsed.error.issues[0]!;
      const campo = iss.path.join(".") || "(raiz)";
      throw new FlowError(`flow importado inválido → campo "${campo}": ${iss.message}`);
    }

    const flow = parsed.data;
    const path = this.caminho(wsPath, flow.id);
    if (existsSync(path) && !opts.sobrescrever) {
      throw new FlowError(`flow "${flow.id}" já existe — use sobrescrever para substituir`, { exitCode: 1 });
    }

    this.validarSemantica(flow, `flow importado "${flow.id}"`);
    await this.salvar(wsPath, flow);
    return flow;
  }

  async executar(
    wsPath: string,
    flowId: string,
    opts: { entrada?: string; model?: string; execId?: string; retomar?: boolean } = {},
  ): Promise<{ execId: string; status: "concluido" | "falhou"; nos: NoExecInfo[]; contextoFinal: string }> {
    const flow = await this.obter(wsPath, flowId);
    await this.registros.garantirCategorias(wsPath);
    const retomando = opts.retomar && opts.execId
      ? await this.estadoParaRetomar(wsPath, flowId, opts.execId)
      : null;
    const entrada = retomando ? retomando.entrada : (opts.entrada ?? "");
    const execId = retomando ? (opts.execId as string) : (opts.execId ?? gerarId("exec"));
    const nosInfo: NoExecInfo[] = retomando ? retomando.nosInfo : flow.nos.map((n) => ({
      id: n.id,
      tipo: n.tipo,
      status: "nao-executado",
      exec_id: null,
    }));
    const marcarNo = async (noId: string, status: NoExecInfo["status"], exec_id: string | null = null): Promise<void> => {
      const info = nosInfo.find((n) => n.id === noId)!;
      info.status = status;
      info.exec_id = exec_id;
      const meta = await this.registros.lerMeta(wsPath, "execucoes", execId);
      const extras = (meta.extras ?? {}) as Record<string, unknown>;
      extras.nos = nosInfo;
      meta.extras = extras;
      await this.registros.salvarMeta(wsPath, "execucoes", execId, meta);
    };

    if (retomando) {
      // Flow durável: retoma no MESMO exec — nós "ok" do run anterior não re-executam
      await this.registros.anexarEvento(wsPath, "execucoes", execId, {
        ts: this.agora().toISOString(),
        por: `flow:${flowId}`,
        evento: "retomado",
        no: retomando.noId,
        resumo: `retomada do nó "${retomando.noId}" (nós anteriores preservados)`,
      });
      eventBus.emit("flow-retomada", { flow: flowId, exec_id: execId, no: retomando.noId });
    } else {
      await this.registros.criar(wsPath, {
        categoria: "execucoes",
        id: execId,
        descricao: `Flow "${flowId}" (${flow.nome}) — entrada: ${entrada.slice(0, 120)}`,
        criadoPor: `flow:${flowId}`,
        tags: ["flow", `flow:${flowId}`],
        tipo: "flow",
        eventoInicial: {
          evento: "iniciado",
          resumo: `flow ${flowId} · ${flow.nos.length} nó(s) · entrada: ${entrada.slice(0, 120)}`,
        },
        extras: {
          status: "executando",
          tipo: "flow",
          flow: flowId,
          nome: flow.nome,
          entrada,
          nos: nosInfo,
          contexto_final: "",
        },
      });
      eventBus.emit("flow-inicio", { flow: flowId, exec_id: execId, entrada });
    }

    void this.registros.eventoAuditoria(wsPath, {
      por: `flow:${flowId}`,
      evento: "flow_iniciado",
      flow_id: flowId,
      exec_id: execId,
      resumo: `flow "${flowId}" (${flow.nome}) iniciado`,
      entrada: entrada.slice(0, 300),
    }).catch(() => undefined);

    let contexto = retomando ? retomando.contexto : stripAnsi(entrada);
    let status: "concluido" | "falhou" = "concluido";
    let motivo: string | null = null;
    let noFalha: string | null = null;
    let noAnterior: NoFlow | undefined = undefined;
    const saidasPorNo: Record<string, string> = {};

    const filaNos: Array<{ no: NoFlow; contexto: string; noAnterior?: NoFlow }> = [];
    const inicial = retomando
      ? porId(flow, retomando.noId)
      : (flow.nos.find((n) => n.tipo === "manual") ||
         flow.nos.find((n) => n.tipo === "cron") ||
         flow.nos.find((n) => n.tipo === "webhook") ||
         flow.nos[0]);
    if (inicial) {
      filaNos.push({ no: inicial, contexto, noAnterior: undefined });
    }
    const iteracoesPorNo: Record<string, number> = {};
    const sessoesPorNo: Record<string, string> = {};
    let totalPassos = 0;
    const TETO_SEGURANCA_PASSOS = 100;

    try {
      while (filaNos.length > 0) {
        const item = filaNos.shift()!;
        const no = item.no;
        contexto = item.contexto;
        noAnterior = item.noAnterior;

        totalPassos++;
        if (totalPassos > TETO_SEGURANCA_PASSOS) {
          throw new FlowError(`teto de segurança atingido (${TETO_SEGURANCA_PASSOS} passos) — loop infinito interrompido`);
        }

        const voltaAtual = (iteracoesPorNo[no.id] || 0) + 1;
        iteracoesPorNo[no.id] = voltaAtual;

        // Se o nó não é do tipo loop e já ultrapassou o teto padrão sem estar num loop declarado
        const tetoNo = typeof (no.config as any)?.max_iteracoes === "number" ? (no.config as any).max_iteracoes : 10;
        if (no.tipo !== "loop" && voltaAtual > tetoNo) {
          continue;
        }

        if (no.tipo === "manual" || no.tipo === "cron") {
          contexto = entrada || (no.tipo === "cron" ? `Gatilho Cron acionado em ${this.agora().toISOString()}` : entrada);
          saidasPorNo[no.id] = contexto;
          await marcarNo(no.id, "ok");
        } else if (no.tipo === "loop") {
          const config = no.config as {
            max_iteracoes?: number;
            condicao_parada?: string;
            retornar_para?: string;
            saida_final?: string;
          };
          const teto = Math.max(1, config.max_iteracoes ?? 5);
          const parouPorCondicao = Boolean(config.condicao_parada && contexto.includes(config.condicao_parada));
          const atingiuTeto = voltaAtual >= teto;
          const encerrar = parouPorCondicao || atingiuTeto;
          const tsIteracao = this.agora();

          await marcarNo(no.id, "ok");
          saidasPorNo[no.id] = contexto;
          // Histórico indexado por iteração — ex.: saidasPorNo["loop-revisao#2"]
          saidasPorNo[`${no.id}#${voltaAtual}`] = contexto;
          eventBus.emit("flow-no", {
            flow: flowId,
            no: no.id,
            status: "ok",
            volta: voltaAtual,
            teto,
            encerrado: encerrar,
          });

          // ── Journal: persistir snapshot de cada iteração do loop ──
          await this.registros.anexarEvento(wsPath, "execucoes", execId, {
            ts: tsIteracao.toISOString(),
            por: `flow:${flowId}`,
            evento: "loop-iteracao",
            no: no.id,
            volta: voltaAtual,
            teto,
            encerrado: encerrar,
            motivo_encerramento: parouPorCondicao ? "condicao_parada" : atingiuTeto ? "teto_atingido" : null,
            contexto_preview: contexto.slice(0, 500),
            resumo: `loop "${no.id}" volta ${voltaAtual}/${teto}${encerrar ? " (encerrado)" : ""}`,
          });

          if (encerrar) {
            if (config.saida_final) {
              const prox = porId(flow, config.saida_final);
              if (prox) filaNos.push({ no: prox, contexto, noAnterior: no });
            }
          } else {
            if (config.retornar_para) {
              const prox = porId(flow, config.retornar_para);
              if (prox) filaNos.push({ no: prox, contexto, noAnterior: no });
            }
          }
          continue;
        } else if (no.tipo === "agente") {
          const config = no.config as {
            agente: string;
            ordem: string;
            resposta_arquivo?: string;
            session_mode?: "nova" | "reaproveitar";
          };
          // Interpolação estilo n8n ($json, {{$input}}, {{$node["id"]}}, {{entrada}})
          let ordemBase = config.ordem
            .replaceAll("{{entrada}}", contexto)
            .replaceAll("{{$input}}", contexto)
            .replaceAll("{{json}}", contexto);

          for (const [nid, saidaN] of Object.entries(saidasPorNo)) {
            ordemBase = ordemBase
              .replaceAll(`{{$node["${nid}"]}}`, saidaN)
              .replaceAll(`{{$node['${nid}']}}`, saidaN)
              .replaceAll(`{{no.${nid}}}`, saidaN);
          }

          // Se a ordem não referenciou explicitamente {{entrada}} e temos contexto do nó anterior,
          // injeta o contexto do nó anterior para que o agente saiba que está encadeado
          if (
            contexto &&
            contexto.trim() &&
            !config.ordem.includes("{{entrada}}") &&
            !config.ordem.includes("{{$input}}") &&
            noAnterior
          ) {
            ordemBase = `${ordemBase}\n\n[Contexto do nó anterior (${noAnterior.id} - ${noAnterior.tipo})]:\n${contexto}`;
          }

          // contrato de resposta por ARQUIVO: a resposta limpa fica no sandbox
          const arquivoResposta = config.resposta_arquivo ?? "";
          const ordem = arquivoResposta
            ? `${ordemBase}\n\n[contrato de resposta] Salve sua resposta final completa em sandbox/${arquivoResposta} e responda no terminal apenas "ok".`
            : ordemBase;

          let sessionId: string | undefined = undefined;
          if (config.session_mode === "reaproveitar") {
            if (!sessoesPorNo[no.id]) {
              sessoesPorNo[no.id] = `sess-${flowId}-${no.id}-${Date.now().toString(36)}`;
            }
            sessionId = sessoesPorNo[no.id];
          }

          let resultado: ResultadoRun;
          try {
            resultado = await this.sessoes.rodar({
              agente: config.agente,
              ordem,
              model: opts.model,
              session: sessionId,
              workspaceDir: wsPath,
              referencias: [execId],
              tipo: "flow-no",
              tags: [`flow:${flowId}`, `no:${no.id}`],
              gatilho: { tipo: "dependencia", origem: `flow:${flowId}/${no.id}` },
            });
          } catch (erro) {
            await marcarNo(no.id, "falhou", null);
            throw new FlowError(`nó "${no.id}" (agente) falhou: ${msg(erro)}`);
          }
          if (resultado.exit_code !== 0) {
            eventBus.emit("flow-no", { flow: flowId, no: no.id, status: "falhou", exec_id: resultado.id });
            await marcarNo(no.id, "falhou", resultado.id);
            throw new FlowError(
              `nó "${no.id}" (agente ${config.agente}) falhou — exec ${resultado.id}, exit ${resultado.exit_code}`,
            );
          }
          let contextoNovo = limparCaptura(resultado.captura ?? "");
          if (arquivoResposta) {
            const caminhoResposta = join(wsPath, "sandbox", arquivoResposta);
            if (existsSync(caminhoResposta)) {
              const doArquivo = readFileSync(caminhoResposta, "utf8").trim();
              if (doArquivo.length > 0) contextoNovo = stripAnsi(doArquivo);
            }
          }
          contexto = contextoNovo;
          eventBus.emit("flow-no", { flow: flowId, no: no.id, status: "ok", exec_id: resultado.id });
          await marcarNo(no.id, "ok", resultado.id);
        } else if (no.tipo === "fanout" || no.tipo === "review" || no.tipo === "debate") {
          // ── nós da fusão team×fluxo (PLANO-WEB-CRUD F1): padrões de coordenação
          // como nós do grafo — versões CONTEXTUAIS (não criam kanban; contexto flui)
          const rodarPasso = async (agente: string, ordem: string, sufixo: string): Promise<string> => {
            const r = await this.sessoes.rodar({
              agente,
              ordem,
              model: opts.model,
              workspaceDir: wsPath,
              referencias: [execId],
              tipo: "flow-no",
              tags: [`flow:${flowId}`, `no:${no.id}`],
              gatilho: { tipo: "dependencia", origem: `flow:${flowId}/${no.id}${sufixo}` },
            });
            if (r.exit_code !== 0) {
              throw new FlowError(`passo "${agente}" falhou — exec ${r.id}, exit ${r.exit_code}`);
            }
            return limparCaptura(r.captura ?? "");
          };
          const falharNo = async (erro: unknown): Promise<never> => {
            eventBus.emit("flow-no", { flow: flowId, no: no.id, status: "falhou" });
            await marcarNo(no.id, "falhou", null);
            throw new FlowError(`nó "${no.id}" (${no.tipo}) falhou: ${msg(erro)}`);
          };
          if (no.tipo === "fanout") {
            const config = no.config as { paralelos: Array<{ agente: string; ordem: string }>; sintese?: { agente: string; ordem: string } };
            try {
              const rodados = await Promise.allSettled(
                config.paralelos.map((p, i) =>
                  rodarPasso(p.agente, p.ordem.replaceAll("{{entrada}}", contexto), `/p${i + 1}`).then((s) => `### ${p.agente}\n${s}`),
                ),
              );
              const falhas = rodados.filter((r) => r.status === "rejected");
              if (falhas.length) throw (falhas[0] as PromiseRejectedResult).reason;
              const bruto = rodados.map((r) => (r as PromiseFulfilledResult<string>).value).join("\n\n");
              contexto = config.sintese
                ? await rodarPasso(config.sintese.agente, config.sintese.ordem.replaceAll("{{entrada}}", bruto), "/sintese")
                : bruto;
              eventBus.emit("flow-no", { flow: flowId, no: no.id, status: "ok" });
              await marcarNo(no.id, "ok");
            } catch (erro) {
              await falharNo(erro);
            }
          } else if (no.tipo === "review") {
            const config = no.config as { executor: { agente: string; ordem: string }; revisor: { agente: string; ordem: string }; turnos?: number };
            const turnos = Math.min(Math.max(Math.round(config.turnos ?? 2), 1), 5);
            try {
              let ajustes = "";
              let aprovado = false;
              for (let t = 1; t <= turnos && !aprovado; t++) {
                const ordemExec = config.executor.ordem
                  .replaceAll("{{entrada}}", contexto)
                  .replaceAll("{{ajustes}}", ajustes || "(primeira rodada — sem ajustes)");
                const saidaExecutor = await rodarPasso(config.executor.agente, ordemExec, `/t${t}/exec`);
                const respostaRevisor = await rodarPasso(
                  config.revisor.agente,
                  `${config.revisor.ordem.replaceAll("{{entrada}}", saidaExecutor)}\n\n[contrato de revisão] Responda NA PRIMEIRA LINHA exatamente "APROVADO" ou "AJUSTES: <o que corrigir>".`,
                  `/t${t}/rev`,
                );
                if (stripAnsi(respostaRevisor).split("\n")[0]?.trim().toUpperCase().startsWith("APROVADO")) {
                  aprovado = true;
                  contexto = saidaExecutor;
                } else {
                  ajustes = respostaRevisor;
                }
              }
              if (!aprovado) throw new FlowError(`revisor não aprovou após ${turnos} turno(s) — escala humano`);
              eventBus.emit("flow-no", { flow: flowId, no: no.id, status: "ok" });
              await marcarNo(no.id, "ok");
            } catch (erro) {
              await falharNo(erro);
            }
          } else {
            // debate
            const config = no.config as { proponentes: Array<{ agente: string; ordem: string }>; moderador: { agente: string } };
            try {
              const propostas = await Promise.all(
                config.proponentes.map((p, i) =>
                  rodarPasso(p.agente, p.ordem.replaceAll("{{entrada}}", contexto), `/prop${i + 1}`).then((s) => `### proposta ${p.agente}\n${s}`),
                ),
              );
              contexto = await rodarPasso(
                config.moderador.agente,
                `Propostas dos proponentes:\n\n${propostas.join("\n\n")}\n\n[contrato de moderação] Decida e responda começando com "DECISÃO: <escolha>" seguida da justificativa curta.`,
                "/moderador",
              );
              eventBus.emit("flow-no", { flow: flowId, no: no.id, status: "ok" });
              await marcarNo(no.id, "ok");
            } catch (erro) {
              await falharNo(erro);
            }
          }
        } else if (no.tipo === "saida") {
          const config = no.config as { registro: string };
          const [categoria, registroId] = config.registro.split("/") as [string, string];
          await this.registros.garantirRegistro(wsPath, {
            categoria,
            id: registroId,
            descricao: `saída do flow "${flowId}" (${flow.nome})`,
            criadoPor: `flow:${flowId}`,
          });
          await this.registros.appendConteudo(
            wsPath,
            categoria,
            registroId,
            `[${this.agora().toISOString()}] contexto do nó de saída:\n${contexto}\n\n`,
          );
          await marcarNo(no.id, "ok");
        } else if (no.tipo === "webhook") {
          const config = no.config as { url: string; metodo?: string; corpo?: string; headers?: Record<string, string> };
          const metodo = (config.metodo ?? "POST").toUpperCase();
          const corpo = metodo === "GET" || metodo === "HEAD" ? undefined : (config.corpo ?? "").replaceAll("{{entrada}}", contexto);
          let resposta = "";
          let ultimoErro: unknown = null;
          let sucesso = false;
          for (let tentativa = 0; tentativa < 3; tentativa++) {
            try {
              const resp = await fetch(config.url, {
                method: metodo,
                headers: { "content-type": "application/json", ...(config.headers ?? {}) },
                body: corpo,
              });
              resposta = (await resp.text()).slice(0, 4096);
              ultimoErro = null;
              sucesso = resp.ok;
              if (!resp.ok) ultimoErro = new FlowError(`HTTP ${resp.status}: ${resposta.slice(0, 120)}`);
              break;
            } catch (erro) {
              ultimoErro = erro;
              if (tentativa < 2) await new Promise((r) => setTimeout(r, 1000 * 2 ** tentativa));
            }
          }
          if (!sucesso) {
            await marcarNo(no.id, "falhou", null);
            throw new FlowError(`nó "${no.id}" (webhook) falhou: ${msg(ultimoErro)}`);
          }
          contexto = resposta;
          eventBus.emit("flow-no", { flow: flowId, no: no.id, status: "ok" });
          await marcarNo(no.id, "ok", null);
        } else if (no.tipo === "condicao") {
          const config = no.config as { chave: string; entao: string; senao: string };
          const casou = contexto.includes(config.chave);
          await marcarNo(no.id, "ok");
          saidasPorNo[no.id] = contexto;
          const proxId = casou ? config.entao : config.senao;
          const prox = porId(flow, proxId);
          if (prox) filaNos.push({ no: prox, contexto, noAnterior: no });
          continue;
        } else if (no.tipo === "task_create") {
          const config = no.config as { titulo: string; descricao?: string; prioridade?: string; responsavel?: string; coluna?: string };
          const { TaskStore } = await import("./task-store.js");
          const board = new TaskStore({ agora: this.agora });
          const prioridade = (config.prioridade === "alta" || config.prioridade === "baixa" ? config.prioridade : "media") as "alta" | "media" | "baixa";
          const tituloInterpolado = stripAnsi(config.titulo.replaceAll("{{entrada}}", contexto));
          // título curto: primeira linha significativa (títulos longos quebram o board)
          const tituloLimpo = tituloInterpolado.length > 90
            ? (tituloInterpolado.split("\n").map((l) => l.trim()).find((l) => l.length > 12) ?? tituloInterpolado).slice(0, 90)
            : tituloInterpolado;
          const task = await board.criar(
            wsPath,
            {
              titulo: tituloLimpo,
              descricao: stripAnsi((config.descricao ?? "").replaceAll("{{entrada}}", contexto)).slice(0, 600),
              prioridade,
              ...(config.responsavel ? { responsavel: config.responsavel } : {}),
              ...(config.coluna ? { coluna: config.coluna } : {}),
            },
            `flow:${flowId}`,
          );
          contexto = `${task.id} — ${task.titulo}`;
          eventBus.emit("flow-no", { flow: flowId, no: no.id, status: "ok", task: task.id });
          await marcarNo(no.id, "ok");
        } else if (no.tipo === "registro") {
          const config = no.config as { categoria: string; id?: string; titulo?: string };
          const categoria = config.categoria;
          const base = (config.id ?? `${flowId}-${no.id}`).replaceAll("{{entrada}}", "").slice(0, 80);
          const ts = this.agora().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
          const registroId = `${base.toLowerCase().replace(/[^a-z0-9._-]/g, "-")}-${ts}`;
          const titulo = (config.titulo ?? `registro do flow "${flowId}"`).replaceAll("{{entrada}}", contexto).slice(0, 140);
          await this.registros.garantirCategorias(wsPath);
          await this.registros.criar(wsPath, {
            categoria,
            id: registroId,
            descricao: titulo,
            criadoPor: `flow:${flowId}`,
            eventoInicial: { evento: "criado", resumo: `registro gerado pelo flow "${flowId}" (nó ${no.id})` },
          });
          await this.registros.appendConteudo(wsPath, categoria, registroId, `${contexto}\n`);
          // anexa o caminho ao contexto — nós seguintes sabem onde ficou o registro
          contexto = `${contexto}\n\n[registrado em]: ${categoria}/${registroId}`;
          eventBus.emit("flow-no", { flow: flowId, no: no.id, status: "ok", registro: registroId });
          await marcarNo(no.id, "ok");
        } else if (no.tipo === "decisao") {
          const config = no.config as { agente: string; pergunta: string; opcoes: { rotulo: string; proximo: string }[] };
          const rotulos = config.opcoes.map((o) => o.rotulo);
          const ordem = `${config.pergunta.replaceAll("{{entrada}}", contexto)}

[contexto]
${contexto.slice(0, 2000)}

[contrato — RÍGIDO]
Responda APENAS uma linha com o rótulo exato da sua decisão, sem nada além dele. Rótulos válidos (copie literal, sem aspas):
${rotulos.map((r) => `- ${r}`).join("\n")}`;
          let escolha: string | null = null;
          try {
            const resultado = await this.sessoes.rodar({
              agente: config.agente,
              ordem,
              model: opts.model,
              workspaceDir: wsPath,
              referencias: [execId],
              tipo: "flow-decisao",
              tags: [`flow:${flowId}`, `no:${no.id}`, "decisao"],
              gatilho: { tipo: "dependencia", origem: `flow:${flowId}/${no.id}` },
            });
            if (resultado.exit_code !== 0) {
              throw new FlowError(`exit ${resultado.exit_code}`);
            }
            const captura = limparCaptura(resultado.captura ?? "");
            escolha = rotulos.find((r) => captura.includes(r)) ?? null;
          } catch (erro) {
            await marcarNo(no.id, "falhou", null);
            throw new FlowError(`nó "${no.id}" (decisao) falhou: ${msg(erro)}`);
          }
          if (!escolha) {
            await marcarNo(no.id, "falhou", null);
            throw new FlowError(
              `nó "${no.id}" (decisao): resposta não correspondeu a nenhum rótulo válido (${rotulos.join(", ")})`,
            );
          }
          const proximoConfig = config.opcoes?.find((o) => o.rotulo === escolha)?.proximo;
          const arestaRotulo = flow.arestas.find(
            (a) => a.de === no.id && (a.rotulo === escolha || a.condicao === escolha),
          );
          const proximoAlvo = arestaRotulo ? arestaRotulo.para : proximoConfig;

          // decisão ANEXA ao contexto (não sobrescreve) — nós seguintes
          // (registro/saída) precisam da substância, não só do rótulo
          contexto = `${contexto}\n\n[decisão (${no.id})]: ${escolha}`;
          eventBus.emit("flow-no", { flow: flowId, no: no.id, status: "ok", decisao: escolha });
          await marcarNo(no.id, "ok");
          saidasPorNo[no.id] = contexto;
          if (proximoAlvo) {
            const prox = porId(flow, proximoAlvo);
            if (prox) filaNos.push({ no: prox, contexto, noAnterior: no });
          }
          continue;
        } else if (no.tipo === "script" || no.tipo === "componente") {
          // Nó de Execução de Script / Componente Modular do Workspace (estilo n8n Code/Custom Component)
          const config = no.config as {
            comando?: string;
            arquivo?: string;
            codigo?: string;
            componente_id?: string;
            runtime?: "bash" | "node" | "python";
            timeout_ms?: number;
          };
          const { execFile, exec } = await import("node:child_process");
          const { promisify } = await import("node:util");
          const execAsync = promisify(exec);
          const execFileAsync = promisify(execFile);

          let saidaScript = "";
          const timeout = Math.min(config.timeout_ms || 60000, 300000);

          try {
            if (config.componente_id) {
              const { ComponentStore } = await import("./component-store.js");
              const compStore = new ComponentStore();
              const res = await compStore.testar(wsPath, config.componente_id, contexto);
              if (!res.ok) {
                throw new FlowError(`componente "${config.componente_id}" falhou: ${res.erro}`);
              }
              saidaScript = res.saida;
            } else if (config.codigo) {
              const runtime = config.runtime || "node";
              const flag = runtime === "bash" ? "-c" : "-e";
              const cmd = runtime === "python" ? "python3" : runtime === "bash" ? "bash" : "node";
              const res = await execFileAsync(cmd, [flag, config.codigo], {
                cwd: wsPath,
                timeout,
                env: {
                  ...process.env,
                  OPENCORP_ENTRADA: contexto,
                  OPENCORP_INPUT: contexto,
                  OPENCORP_FLOW_ID: flowId,
                  OPENCORP_NODE_ID: no.id,
                  OPENCORP_WORKSPACE_DIR: wsPath,
                },
              });
              saidaScript = (res.stdout || res.stderr || "").trim();
            } else if (config.arquivo) {
              const caminhoAbsoluto = resolve(wsPath, config.arquivo);
              const wsPathAbsoluto = resolve(wsPath);
              if (!caminhoAbsoluto.startsWith(wsPathAbsoluto)) {
                throw new FlowError(`Acesso negado: o arquivo "${config.arquivo}" está fora do workspace`);
              }
              if (!existsSync(caminhoAbsoluto)) {
                throw new FlowError(`Arquivo de script/componente não encontrado no workspace: ${config.arquivo}`);
              }
              const runtime =
                config.runtime ||
                (config.arquivo.endsWith(".py")
                  ? "python3"
                  : config.arquivo.endsWith(".js") || config.arquivo.endsWith(".mjs")
                  ? "node"
                  : "bash");
              const res = await execFileAsync(runtime, [caminhoAbsoluto], {
                cwd: wsPath,
                timeout,
                env: {
                  ...process.env,
                  OPENCORP_ENTRADA: contexto,
                  OPENCORP_INPUT: contexto,
                  OPENCORP_FLOW_ID: flowId,
                  OPENCORP_NODE_ID: no.id,
                  OPENCORP_WORKSPACE_DIR: wsPath,
                },
              });
              saidaScript = (res.stdout || res.stderr || "").trim();
            } else if (config.comando) {
              const comandoInterpolado = config.comando.replaceAll("{{entrada}}", contexto).replaceAll("{{$input}}", contexto);
              const res = await execAsync(comandoInterpolado, {
                cwd: wsPath,
                timeout,
                env: {
                  ...process.env,
                  OPENCORP_ENTRADA: contexto,
                  OPENCORP_INPUT: contexto,
                  OPENCORP_FLOW_ID: flowId,
                  OPENCORP_NODE_ID: no.id,
                  OPENCORP_WORKSPACE_DIR: wsPath,
                },
              });
              saidaScript = (res.stdout || res.stderr || "").trim();
            } else {
              throw new FlowError(`Nó ${no.tipo} "${no.id}" requer 'componente_id', 'codigo', 'arquivo' ou 'comando' configurado`);
            }

            // ── JSON I/O estruturada: tentar parsear stdout como JSON ──
            let saidaFinal = saidaScript || contexto;
            let saidaJson: unknown = undefined;
            if (saidaScript) {
              try {
                saidaJson = JSON.parse(saidaScript);
                // Se parseia como JSON, preservar a saída estruturada e usar
                // o campo "output" como contexto de texto, se existir
                if (typeof saidaJson === "object" && saidaJson !== null && "output" in (saidaJson as Record<string, unknown>)) {
                  saidaFinal = String((saidaJson as Record<string, unknown>).output);
                }
              } catch {
                // stdout não é JSON — usar como texto puro (comportamento padrão)
              }
            }
            contexto = saidaFinal;
            // Armazenar saída completa (JSON quando disponível) para interpolação
            saidasPorNo[no.id] = saidaJson !== undefined ? JSON.stringify(saidaJson) : contexto;
            eventBus.emit("flow-no", { flow: flowId, no: no.id, status: "ok", json: saidaJson !== undefined });
            await marcarNo(no.id, "ok");
          } catch (erro) {
            await marcarNo(no.id, "falhou", null);
            throw new FlowError(`nó "${no.id}" (${no.tipo}) falhou: ${msg(erro)}`);
          }
        } else if (no.tipo === "reuniao") {
          // Nó de Convocação e Execução de Reunião de Diretoria / Agentes
          const config = no.config as { pauta: string; agentes?: string[] | string; model?: string };
          const pautaInterpolada = (config.pauta || "Reunião de alinhamento e deliberação").replaceAll("{{entrada}}", contexto);
          const listaAgentes = Array.isArray(config.agentes)
            ? config.agentes.join(",")
            : typeof config.agentes === "string" && config.agentes.length > 0
            ? config.agentes
            : "editor,critico-site";

          try {
            const { MeetingManager } = await import("./meeting-manager.js");
            const mm = new MeetingManager({ homeDir: this.homeDir, sessoes: this.sessoes as never });
            const salaId = `reu-${flowId}-${no.id}-${Date.now().toString(36)}`;
            const sala = await mm.iniciar({
              id: salaId,
              pauta: pautaInterpolada,
              agentes: listaAgentes,
              model: config.model,
              workspaceDir: wsPath,
            });
            const ata = sala.ata || (sala as any).resultado || `Reunião ${salaId} concluída.`;
            contexto = `${contexto}\n\n[parecer da reunião (${salaId})]:\n${ata}`;
            eventBus.emit("flow-no", { flow: flowId, no: no.id, status: "ok", reuniao: salaId });
            await marcarNo(no.id, "ok");
          } catch (erro) {
            await marcarNo(no.id, "falhou", null);
            throw new FlowError(`nó "${no.id}" (reuniao) falhou: ${msg(erro)}`);
          }
        } else if (no.tipo === "subflow") {
          // Nó de Execução de Sub-Fluxo (Pipeline Modular estilo n8n Execute Workflow)
          const config = no.config as { flow_id: string; entrada?: string };
          const subFlowId = (config.flow_id || "").trim();
          if (!subFlowId) {
            await marcarNo(no.id, "falhou", null);
            throw new FlowError(`nó "${no.id}" (subflow) requer 'flow_id' configurado`);
          }
          const subEntrada = config.entrada
            ? config.entrada.replaceAll("{{entrada}}", contexto).replaceAll("{{$input}}", contexto)
            : contexto;
          try {
            const subRes = await this.executar(wsPath, subFlowId, {
              entrada: subEntrada,
              model: opts.model,
            });
            contexto = subRes.contextoFinal || subEntrada;
            eventBus.emit("flow-no", {
              flow: flowId,
              no: no.id,
              status: subRes.status === "concluido" ? "ok" : "falhou",
              subflow: subFlowId,
              sub_exec_id: subRes.execId,
            });
            await marcarNo(no.id, subRes.status === "concluido" ? "ok" : "falhou", subRes.execId);
            if (subRes.status === "falhou") {
              throw new FlowError(`subflow "${subFlowId}" falhou`);
            }
          } catch (erro) {
            await marcarNo(no.id, "falhou", null);
            throw new FlowError(`nó "${no.id}" (subflow "${subFlowId}") falhou: ${msg(erro)}`);
          }
        } else if (no.tipo === "http_request") {
          // Nó de Requisição HTTP Externa (Webhook / REST API / Outgoing Call)
          const config = no.config as {
            url: string;
            metodo?: string;
            headers?: Record<string, string>;
            corpo?: string;
            timeout_ms?: number;
          };
          const urlInterpolada = config.url
            .replaceAll("{{entrada}}", encodeURIComponent(contexto))
            .replaceAll("{{$input}}", encodeURIComponent(contexto));
          const metodo = (config.metodo || "GET").toUpperCase();
          const corpoInterpolado = config.corpo
            ? config.corpo.replaceAll("{{entrada}}", contexto).replaceAll("{{$input}}", contexto)
            : metodo !== "GET" && metodo !== "HEAD"
            ? contexto
            : undefined;

          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), config.timeout_ms || 30000);
            const res = await fetch(urlInterpolada, {
              method: metodo,
              headers: { "content-type": "application/json", ...(config.headers || {}) },
              body: corpoInterpolado,
              signal: controller.signal,
            });
            clearTimeout(timer);
            const textoResp = await res.text();
            contexto = textoResp;
            eventBus.emit("flow-no", {
              flow: flowId,
              no: no.id,
              status: res.ok ? "ok" : "falhou",
              status_code: res.status,
            });
            await marcarNo(no.id, res.ok ? "ok" : "falhou");
            if (!res.ok && res.status >= 400) {
              throw new FlowError(`HTTP ${res.status}: ${textoResp.slice(0, 200)}`);
            }
          } catch (erro) {
            await marcarNo(no.id, "falhou", null);
            throw new FlowError(`nó "${no.id}" (http_request) falhou: ${msg(erro)}`);
          }
        } else if (no.tipo === "delay") {
          // Nó de Aguardar / Delay / Pausa temporizada (ex: Wait 30s)
          const config = no.config as { segundos?: number };
          const seg = Math.min(Math.max(Number(config.segundos) || 1, 1), 3600);
          await new Promise((r) => setTimeout(r, seg * 1000));
          eventBus.emit("flow-no", { flow: flowId, no: no.id, status: "ok", delay_seg: seg });
          await marcarNo(no.id, "ok");
        }
        saidasPorNo[no.id] = contexto;
        noAnterior = no;
        const saidas = flow.arestas.filter((a) => a.de === no.id);
        for (const s of saidas) {
          const prox = porId(flow, s.para);
          if (prox) filaNos.push({ no: prox, contexto, noAnterior: no });
        }
      }
    } catch (erro) {
      status = "falhou";
      motivo = msg(erro);
      if (erro instanceof FlowError) noFalha = null;
    }

    if (motivo !== null) {
      const meta = await this.registros.lerMeta(wsPath, "execucoes", execId);
      const extras = (meta.extras ?? {}) as Record<string, unknown>;
      extras.status = status;
      extras.nos = nosInfo;
      extras.contexto_final = contexto;
      extras.motivo = motivo;
      extras.no_falha = noFalha;
      meta.extras = extras;
      await this.registros.salvarMeta(wsPath, "execucoes", execId, meta);
    } else {
      const meta = await this.registros.lerMeta(wsPath, "execucoes", execId);
      const extras = (meta.extras ?? {}) as Record<string, unknown>;
      extras.status = status;
      extras.nos = nosInfo;
      extras.contexto_final = contexto;
      meta.extras = extras;
      await this.registros.salvarMeta(wsPath, "execucoes", execId, meta);
    }

    eventBus.emit("flow-fim", { flow: flowId, exec_id: execId, status, motivo });
    await this.registros.garantirRegistro(wsPath, {
      categoria: "flows",
      id: flowId,
      descricao: `execuções do flow "${flowId}" (${flow.nome})`,
      criadoPor: `flow:${flowId}`,
    });
    await this.registros.anexarEvento(wsPath, "flows", flowId, {
      ts: this.agora().toISOString(),
      por: `flow:${flowId}`,
      evento: "execucao",
      exec_id: execId,
      status,
      entrada: entrada.slice(0, 200),
      nos: nosInfo,
      contexto_final: contexto.slice(0, 500),
      motivo,
      resumo: `flow ${flowId} ${status}${motivo ? ` (${motivo})` : ""}`,
    });

    await this.registros.eventoAuditoria(wsPath, {
      por: `flow:${flowId}`,
      evento: status === "concluido" ? "flow_concluido" : "flow_falhou",
      flow_id: flowId,
      exec_id: execId,
      status,
      motivo,
      resumo: `flow ${flowId} ${status}${motivo ? ` (${motivo})` : ""}`,
    }).catch(() => undefined);

    if (status === "falhou") {
      const noAlvo = nosInfo.find((n) => n.status === "falhou");
      throw new FlowError(
        `flow "${flowId}" interrompido no nó "${noAlvo?.id ?? "?"}" (${noAlvo?.tipo ?? "?"}): ${motivo ?? "falha"} — nós seguintes não executaram (exec ${execId})`,
      );
    }
    return { execId, status, nos: nosInfo, contextoFinal: contexto };
  }

  /**
   * Estado de retomada de uma execução falha (flow durável): o 1º nó não-ok
   * e o contexto final do run anterior — nós "ok" NÃO re-executam.
   */
  private async estadoParaRetomar(
    wsPath: string,
    flowId: string,
    execId: string,
  ): Promise<{ nosInfo: NoExecInfo[]; contexto: string; noId: string; entrada: string }> {
    let meta: MetaRegistro;
    try {
      meta = await this.registros.lerMeta(wsPath, "execucoes", execId);
    } catch {
      throw new FlowError(`execução "${execId}" não encontrada — veja "opencorp flow status ${flowId}"`);
    }
    const extras = (meta.extras ?? {}) as Record<string, unknown>;
    if (extras.tipo !== "flow" || extras.flow !== flowId) {
      throw new FlowError(`execução "${execId}" não pertence ao flow "${flowId}"`);
    }
    if (extras.status !== "falhou") {
      throw new FlowError(`execução "${execId}" está "${String(extras.status)}" — só execuções falhas podem ser retomadas`);
    }
    const nosInfo = (extras.nos as NoExecInfo[] | undefined) ?? [];
    const pendente = nosInfo.find((n) => n.status !== "ok");
    if (!pendente) {
      throw new FlowError(`execução "${execId}" não tem nós pendentes para retomar`);
    }
    return {
      nosInfo,
      contexto: String(extras.contexto_final ?? ""),
      noId: pendente.id,
      entrada: String(extras.entrada ?? ""),
    };
  }

  async ultimaExecucao(wsPath: string, flowId: string): Promise<{ execId: string; status: string; nos: NoExecInfo[]; contextoFinal: string; em: string } | null> {
    const registros = await this.registros.listar(wsPath, "execucoes");
    for (const meta of [...registros].sort((a, b) => b.criado_em.localeCompare(a.criado_em))) {
      const extras = (meta.extras ?? {}) as Record<string, unknown>;
      if (extras.tipo !== "flow" || extras.flow !== flowId) continue;
      return {
        execId: meta.id,
        status: String(extras.status ?? "?"),
        nos: (extras.nos as NoExecInfo[]) ?? [],
        contextoFinal: String(extras.contexto_final ?? ""),
        em: meta.atualizado_em,
      };
    }
    return null;
  }

  async listarExecucoes(
    wsPath: string,
    flowId: string,
    limite = 30,
  ): Promise<Array<{ execId: string; status: string; nos: NoExecInfo[]; contextoFinal: string; em: string; criadoEm: string; entrada?: string }>> {
    const registros = await this.registros.listar(wsPath, "execucoes");
    const lista = [];
    for (const meta of [...registros].sort((a, b) => b.criado_em.localeCompare(a.criado_em))) {
      const extras = (meta.extras ?? {}) as Record<string, unknown>;
      if (extras.tipo !== "flow" || extras.flow !== flowId) continue;
      lista.push({
        execId: meta.id,
        status: String(extras.status ?? "?"),
        nos: (extras.nos as NoExecInfo[]) ?? [],
        contextoFinal: String(extras.contexto_final ?? ""),
        em: meta.atualizado_em,
        criadoEm: meta.criado_em,
        entrada: typeof extras.entrada === "string" ? extras.entrada : undefined,
      });
      if (lista.length >= limite) break;
    }
    return lista;
  }
}

function porId(flow: Flow, id: string): NoFlow | undefined {
  return flow.nos.find((n) => n.id === id);
}

/** Remove códigos ANSI/escape de terminal (transcripts de exec chegam coloridos) */
function stripAnsi(texto: string): string {
  return texto
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/[\u0000-\u0008\u000b-\u001f]/g, "");
}

/**
 * Limpa a captura de terminal de um `agent run`: remove linhas de status
 * (prompts, setas, erros de tool, rodapés do opencorp) e devolve o corpo
 * textual que o agente produziu — usado como contexto entre nós.
 */
function limparCaptura(texto: string): string {
  const limpas = stripAnsi(texto)
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      if (t.length === 0) return true;
      if (/^(> |✗ |→ |← |\$ |Index:|\[opencorp\]|\[flow |node:|Error:|at |err_|^---$|^\+\+\+$|^@@ )/.test(t)) return false;
      if (/^((Invalid Tool|File not found|The arguments provided)|[0-9]+ \||\.\.\.)/.test(t)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return limpas.length > 0 ? limpas : stripAnsi(texto).trim().slice(0, 2000);
}

function validarIdFlow(id: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 64) {
    throw new FlowError(
      `id de flow inválido: "${id}" — use kebab-case (letras minúsculas, números e hífens; máx 64)`,
    );
  }
  return id;
}
