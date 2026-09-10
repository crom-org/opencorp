import { existsSync, readdirSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { RegistryError } from "./errors.js";
import { CorpDb } from "./corp-db.js";
import { mkdirRecursive, writeFileAtomic } from "../utils/fs-safe.js";
import { eventBus } from "./event-bus.js";

export const CATEGORIAS_PADRAO = [
  "chats",
  "documentos",
  "execucoes",
  "agentes",
  "custos",
  "logs",
] as const;

export const CATEGORIA_CUSTOM = "custom";

export interface Permissoes {
  leitura: string[];
  escrita: string[];
  modificacao_meta: string[];
}

export interface MetaRegistro {
  id: string;
  categoria: string;
  descricao: string;
  criado_por: string;
  criado_em: string;
  atualizado_em: string;
  permissoes: Permissoes;
  tags: string[];
  referencias: string[];
  extras?: Record<string, unknown>;
}

export interface EventoJournal {
  ts: string;
  por: string;
  evento: string;
  resumo: string;
  [campo: string]: unknown;
}

export interface RegistroCompleto {
  meta: MetaRegistro;
  journal: EventoJournal[];
  conteudo?: string;
}

export interface OpcoesCriar {
  categoria: string;
  id: string;
  descricao: string;
  criadoPor: string;
  permLeitura?: string[];
  permEscrita?: string[];
  agentesCEO?: string[];
  conteudo?: string;
  dados?: unknown;
  tags?: string[];
  referencias?: string[];
  tipo?: string;
  extras?: Record<string, unknown>;
  eventoInicial?: { evento: string; resumo: string };
}

export interface OpcoesAtualizar {
  conteudo?: string;
  dados?: unknown;
  descricao?: string;
}

export interface OpcoesPerms {
  leitura?: string[];
  escrita?: string[];
  meta?: string[];
}

function msg(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

export class RegistryStore {
  private readonly dbPorWorkspace = new Map<string, CorpDb>();

  raiz(wsPath: string): string {
    return join(wsPath, ".opencorp", "registries");
  }

  catDir(wsPath: string, categoria: string): string {
    return join(this.raiz(wsPath), categoria);
  }

  registroDir(wsPath: string, categoria: string, id: string): string {
    return join(this.catDir(wsPath, categoria), id);
  }

  async garantirCategorias(wsPath: string): Promise<string[]> {
    const cats = [...CATEGORIAS_PADRAO, CATEGORIA_CUSTOM];
    for (const c of cats) {
      await mkdirRecursive(join(this.raiz(wsPath), c));
    }
    return cats;
  }

  private validarCamino(categoria: string, id: string): void {
    const ok = (s: string) => /^[a-z0-9][a-z0-9._-]*$/.test(s) && s.length <= 96;
    if (!ok(categoria)) {
      throw new RegistryError(
        `categoria inválida: "${categoria}" — use letras minúsculas, números, ponto, hífen ou underscore`,
      );
    }
    if (!ok(id)) {
      throw new RegistryError(
        `id de registro inválido: "${id}" — use letras minúsculas, números, ponto, hífen ou underscore`,
      );
    }
  }

  private db(wsPath: string): CorpDb {
    const caminho = CorpDb.caminho(wsPath);
    let db = this.dbPorWorkspace.get(caminho);
    if (!db) {
      db = new CorpDb(caminho);
      this.dbPorWorkspace.set(caminho, db);
    }
    return db;
  }

  /** Acesso ao índice SQLite do workspace (corp.db) — p/ persistência de sessões/mensagens fora das categorias */
  corpDb(wsPath: string): CorpDb {
    return this.db(wsPath);
  }

  existe(wsPath: string, categoria: string, id: string): boolean {
    return existsSync(join(this.registroDir(wsPath, categoria, id), "meta.json"));
  }

  async garantirRegistro(
    wsPath: string,
    opts: Omit<OpcoesCriar, "eventoInicial"> & { descricao: string },
  ): Promise<MetaRegistro> {
    if (this.existe(wsPath, opts.categoria, opts.id)) {
      return this.lerMeta(wsPath, opts.categoria, opts.id);
    }
    try {
      return await this.criar(wsPath, opts);
    } catch (err) {
      if (err instanceof RegistryError && /já existe/i.test(err.message)) {
        for (let i = 0; i < 10; i++) {
          try {
            return await this.lerMeta(wsPath, opts.categoria, opts.id);
          } catch {
            await new Promise((r) => setTimeout(r, 50));
          }
        }
      }
      throw err;
    }
  }

  async criar(wsPath: string, opts: OpcoesCriar): Promise<MetaRegistro> {
    this.validarCamino(opts.categoria, opts.id);
    if (opts.descricao === undefined || opts.descricao.trim().length === 0) {
      throw new RegistryError(
        `descrição obrigatória: passe -d "<descrição clara>" ao criar "${opts.categoria}/${opts.id}"`,
      );
    }
    const dir = this.registroDir(wsPath, opts.categoria, opts.id);
    if (existsSync(dir)) {
      throw new RegistryError(
        `registro "${opts.categoria}/${opts.id}" já existe (${dir}) — ids precisam ser únicos na categoria`,
      );
    }
    const ceos = opts.agentesCEO ?? [];
    const agora = new Date().toISOString();
    const meta: MetaRegistro = {
      id: opts.id,
      categoria: opts.categoria,
      descricao: opts.descricao.trim(),
      criado_por: opts.criadoPor,
      criado_em: agora,
      atualizado_em: agora,
      permissoes: {
        leitura: opts.permLeitura ?? ["*"],
        escrita: dedupe([opts.criadoPor, ...ceos]),
        modificacao_meta: dedupe([...ceos]),
      },
      tags: opts.tags ?? [],
      referencias: opts.referencias ?? [],
    };
    if (opts.tipo) meta.extras = { ...(meta.extras ?? {}), tipo: opts.tipo };
    if (opts.extras) meta.extras = opts.extras;

    await mkdirRecursive(dir);
    await writeFileAtomic(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
    await this.anexarEvento(wsPath, opts.categoria, opts.id, {
      ts: agora,
      por: opts.criadoPor,
      evento: opts.eventoInicial?.evento ?? "criado",
      resumo: opts.eventoInicial?.resumo ?? opts.descricao.trim(),
    });
    if (opts.conteudo !== undefined) {
      await writeFileAtomic(join(dir, "conteudo.md"), opts.conteudo);
    } else if (opts.dados !== undefined) {
      await writeFileAtomic(join(dir, "dados.json"), `${JSON.stringify(opts.dados, null, 2)}\n`);
    }
    await mkdirRecursive(join(this.raiz(wsPath), opts.categoria));
    this.db(wsPath).upsertRegistro({
      id: meta.id,
      categoria: meta.categoria,
      descricao: meta.descricao,
      criado_por: meta.criado_por,
      criado_em: meta.criado_em,
      atualizado_em: meta.atualizado_em,
      tags: meta.tags.join(","),
      conteudo: opts.conteudo ?? (opts.dados !== undefined ? JSON.stringify(opts.dados) : ""),
    });
    eventBus.emit("doc.criado", {
      doc_id: meta.id,
      categoria: meta.categoria,
      descricao: meta.descricao,
      criado_por: meta.criado_por,
      ws_path: wsPath,
      workspace: wsPath.split("/").pop() || "padrao",
      caminho: opts.conteudo !== undefined ? join(dir, "conteudo.md") : join(dir, "dados.json"),
    });
    eventBus.emit("registro.criado", {
      id: meta.id,
      categoria: meta.categoria,
      criado_por: meta.criado_por,
      ws_path: wsPath,
      workspace: wsPath.split("/").pop() || "padrao",
    });
    return meta;
  }

  async lerMeta(wsPath: string, categoria: string, id: string): Promise<MetaRegistro> {
    const path = join(this.registroDir(wsPath, categoria, id), "meta.json");
    if (!existsSync(path)) {
      throw new RegistryError(
        `registro "${categoria}/${id}" não encontrado em ${this.catDir(wsPath, categoria)}`,
      );
    }
    try {
      return JSON.parse(await readFile(path, "utf8")) as MetaRegistro;
    } catch (erro) {
      throw new RegistryError(`meta.json inválido em ${path}: ${msg(erro)}`, { exitCode: 2 });
    }
  }

  async salvarMeta(wsPath: string, categoria: string, id: string, meta: MetaRegistro): Promise<void> {
    meta.atualizado_em = new Date().toISOString();
    await writeFileAtomic(
      join(this.registroDir(wsPath, categoria, id), "meta.json"),
      `${JSON.stringify(meta, null, 2)}\n`,
    );
  }

  async anexarEvento(
    wsPath: string,
    categoria: string,
    id: string,
    evento: EventoJournal,
  ): Promise<void> {
    const dir = this.registroDir(wsPath, categoria, id);
    await mkdirRecursive(dir);
    await appendFile(join(dir, "journal.jsonl"), `${JSON.stringify(evento)}\n`, "utf8");
    this.db(wsPath).inserirEvento({
      registro_id: id,
      categoria,
      ts: String(evento.ts),
      por: String(evento.por ?? ""),
      evento: String(evento.evento ?? ""),
      resumo: String(evento.resumo ?? ""),
    });
  }

  async lerJournal(wsPath: string, categoria: string, id: string): Promise<EventoJournal[]> {
    const path = join(this.registroDir(wsPath, categoria, id), "journal.jsonl");
    if (!existsSync(path)) return [];
    const bruto = await readFile(path, "utf8");
    const eventos: EventoJournal[] = [];
    for (const linha of bruto.split("\n")) {
      if (linha.trim().length === 0) continue;
      try {
        eventos.push(JSON.parse(linha) as EventoJournal);
      } catch {
        eventos.push({ ts: "", por: "", evento: "corrompido", resumo: linha.slice(0, 160) });
      }
    }
    return eventos;
  }

  async obter(wsPath: string, categoria: string, id: string): Promise<RegistroCompleto> {
    const meta = await this.lerMeta(wsPath, categoria, id);
    const dir = this.registroDir(wsPath, categoria, id);
    const journal = await this.lerJournal(wsPath, categoria, id);
    let conteudo: string | undefined;
    const conteudoPath = join(dir, "conteudo.md");
    const dadosPath = join(dir, "dados.json");
    if (existsSync(conteudoPath)) conteudo = await readFile(conteudoPath, "utf8");
    else if (existsSync(dadosPath)) conteudo = await readFile(dadosPath, "utf8");
    return { meta, journal, conteudo };
  }

  private exigirEscrita(meta: MetaRegistro, por: string): void {
    if (por === "humano") return;
    if (!meta.permissoes.escrita.includes(por)) {
      throw new RegistryError(
        `bloqueado: agente "${por}" não tem permissão de escrita em "${meta.categoria}/${meta.id}" (escrita: ${meta.permissoes.escrita.join(", ") || "ninguém"})`,
        { exitCode: 3 },
      );
    }
  }

  private exigirMeta(meta: MetaRegistro, por: string): void {
    if (por === "humano") return;
    if (!meta.permissoes.modificacao_meta.includes(por)) {
      throw new RegistryError(
        `bloqueado: agente "${por}" não pode modificar meta de "${meta.categoria}/${meta.id}" (modificacao_meta: ${meta.permissoes.modificacao_meta.join(", ") || "ninguém"})`,
        { exitCode: 3 },
      );
    }
  }

  async eventoAuditoria(
    wsPath: string,
    ev: { por: string; evento: string; resumo: string } & Record<string, unknown>,
  ): Promise<void> {
    await this.garantirRegistro(wsPath, {
      categoria: "logs",
      id: "audit-log",
      descricao: "eventos de auditoria: permissões negadas, bloqueios e violações do RegistryStore",
      criadoPor: "opencorp",
    });
    await this.anexarEvento(wsPath, "logs", "audit-log", {
      ts: new Date().toISOString(),
      ...ev,
    });
  }

  private async registrarAuditoria(
    wsPath: string,
    acao: string,
    meta: MetaRegistro,
    por: string,
  ): Promise<void> {
    await this.eventoAuditoria(wsPath, {
      por,
      evento: "acesso_negado",
      acao,
      registro: `${meta.categoria}/${meta.id}`,
      resumo: `"${por}" tentou ${acao} em "${meta.categoria}/${meta.id}" sem permissão`,
    });
  }

  async atualizar(
    wsPath: string,
    categoria: string,
    id: string,
    por: string,
    opts: OpcoesAtualizar,
  ): Promise<MetaRegistro> {
    let meta = await this.lerMeta(wsPath, categoria, id);
    try {
      this.exigirEscrita(meta, por);
    } catch (erro) {
      await this.registrarAuditoria(wsPath, "update", meta, por);
      throw erro;
    }
    if (opts.descricao !== undefined && opts.descricao.trim().length === 0) {
      throw new RegistryError("descrição nova não pode ser vazia");
    }
    if (opts.conteudo === undefined && opts.dados === undefined && opts.descricao === undefined) {
      throw new RegistryError(
        `nada a atualizar em "${categoria}/${id}" — use --conteudo, --conteudo-arquivo ou --descricao`,
      );
    }
    const dir = this.registroDir(wsPath, categoria, id);
    let conteudoIndex = "";
    if (opts.conteudo !== undefined) {
      await writeFileAtomic(join(dir, "conteudo.md"), opts.conteudo);
      conteudoIndex = opts.conteudo;
    } else if (opts.dados !== undefined) {
      await writeFileAtomic(join(dir, "dados.json"), `${JSON.stringify(opts.dados, null, 2)}\n`);
      conteudoIndex = JSON.stringify(opts.dados);
    }
    if (opts.descricao !== undefined) meta.descricao = opts.descricao.trim();
    await this.salvarMeta(wsPath, categoria, id, meta);
    await this.anexarEvento(wsPath, categoria, id, {
      ts: new Date().toISOString(),
      por,
      evento: "modificado",
      resumo: opts.descricao !== undefined ? `descrição: ${meta.descricao.slice(0, 120)}` : "conteúdo atualizado",
    });
    this.db(wsPath).upsertRegistro({
      id: meta.id,
      categoria: meta.categoria,
      descricao: meta.descricao,
      criado_por: meta.criado_por,
      criado_em: meta.criado_em,
      atualizado_em: meta.atualizado_em,
      tags: meta.tags.join(","),
      conteudo: conteudoIndex || (await this.lerConteudoIndexavel(wsPath, categoria, id)),
    });
    return meta;
  }

  async anotar(
    wsPath: string,
    categoria: string,
    id: string,
    por: string,
    anotacao: string,
  ): Promise<void> {
    const meta = await this.lerMeta(wsPath, categoria, id);
    try {
      this.exigirEscrita(meta, por);
    } catch (erro) {
      await this.registrarAuditoria(wsPath, "log", meta, por);
      throw erro;
    }
    if (anotacao.trim().length === 0) {
      throw new RegistryError("anotação vazia — informe o texto a anexar no journal");
    }
    await this.anexarEvento(wsPath, categoria, id, {
      ts: new Date().toISOString(),
      por,
      evento: "anotacao",
      resumo: anotacao.trim(),
    });
  }

  async perms(
    wsPath: string,
    categoria: string,
    id: string,
    por: string,
    patch: OpcoesPerms,
  ): Promise<MetaRegistro> {
    const meta = await this.lerMeta(wsPath, categoria, id);
    try {
      this.exigirMeta(meta, por);
    } catch (erro) {
      await this.registrarAuditoria(wsPath, "perms", meta, por);
      throw erro;
    }
    const mudancas: string[] = [];
    if (patch.leitura) {
      meta.permissoes.leitura = patch.leitura;
      mudancas.push(`leitura=[${patch.leitura.join(", ")}]`);
    }
    if (patch.escrita) {
      meta.permissoes.escrita = patch.escrita;
      mudancas.push(`escrita=[${patch.escrita.join(", ")}]`);
    }
    if (patch.meta) {
      meta.permissoes.modificacao_meta = patch.meta;
      mudancas.push(`modificacao_meta=[${patch.meta.join(", ")}]`);
    }
    if (mudancas.length === 0) {
      throw new RegistryError(
        `nada a mudar — use --leitura, --escrita ou --meta em "${categoria}/${id}"`,
      );
    }
    await this.salvarMeta(wsPath, categoria, id, meta);
    await this.anexarEvento(wsPath, categoria, id, {
      ts: new Date().toISOString(),
      por,
      evento: "permissoes",
      resumo: mudancas.join(" · "),
    });
    return meta;
  }

  private async lerConteudoIndexavel(wsPath: string, categoria: string, id: string): Promise<string> {
    const dir = this.registroDir(wsPath, categoria, id);
    const conteudoPath = join(dir, "conteudo.md");
    const dadosPath = join(dir, "dados.json");
    if (existsSync(conteudoPath)) return readFile(conteudoPath, "utf8");
    if (existsSync(dadosPath)) return readFile(dadosPath, "utf8");
    return "";
  }

  async appendConteudo(wsPath: string, categoria: string, id: string, texto: string): Promise<void> {
    const dir = this.registroDir(wsPath, categoria, id);
    await mkdirRecursive(dir);
    await appendFile(join(dir, "conteudo.md"), texto, "utf8");
    const meta = await this.lerMeta(wsPath, categoria, id);
    this.db(wsPath).upsertRegistro({
      id: meta.id,
      categoria: meta.categoria,
      descricao: meta.descricao,
      criado_por: meta.criado_por,
      criado_em: meta.criado_em,
      atualizado_em: meta.atualizado_em,
      tags: meta.tags.join(","),
      conteudo: await this.lerConteudoIndexavel(wsPath, categoria, id),
    });
    eventBus.emit("doc.atualizado", {
      doc_id: meta.id,
      categoria: meta.categoria,
      ws_path: wsPath,
      workspace: wsPath.split("/").pop() || "padrao",
      caminho: join(dir, "conteudo.md"),
    });
  }

  async listarCategorias(wsPath: string): Promise<{ categoria: string; registros: MetaRegistro[] }[]> {
    const raiz = this.raiz(wsPath);
    if (!existsSync(raiz)) return [];
    const saida: { categoria: string; registros: MetaRegistro[] }[] = [];
    for (const entrada of readdirSync(raiz, { withFileTypes: true })) {
      if (!entrada.isDirectory()) continue;
      const registros = await this.listar(wsPath, entrada.name);
      saida.push({ categoria: entrada.name, registros });
    }
    return saida.sort((a, b) => a.categoria.localeCompare(b.categoria));
  }

  async listar(wsPath: string, categoria: string): Promise<MetaRegistro[]> {
    const dir = this.catDir(wsPath, categoria);
    if (!existsSync(dir)) return [];
    const metas: MetaRegistro[] = [];
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      if (!entrada.isDirectory()) continue;
      try {
        metas.push(await this.lerMeta(wsPath, categoria, entrada.name));
      } catch {
        continue;
      }
    }
    return metas.sort((a, b) => a.id.localeCompare(b.id));
  }

  async buscar(wsPath: string, termo: string): Promise<{ categoria: string; id: string; descricao: string }[]> {
    if (termo.trim().length === 0) {
      throw new RegistryError("termo de busca vazio — informe o texto a procurar");
    }
    return this.db(wsPath).buscar(termo.trim());
  }

  async registrarSessao(
    wsPath: string,
    s: { id: string; agente: string; modelo: string; inicio: string; fim: string | null; custo_usd: number | null; status: string },
  ): Promise<void> {
    this.db(wsPath).upsertSessao(s);
  }

  async reindexar(wsPath: string): Promise<{ registros: number; eventos: number; sessoes: number }> {
    this.db(wsPath).limpar();
    const db = this.db(wsPath);
    let registros = 0;
    let eventos = 0;
    const raiz = this.raiz(wsPath);
    if (existsSync(raiz)) {
      for (const categoria of readdirSync(raiz, { withFileTypes: true })) {
        if (!categoria.isDirectory()) continue;
        const catDir = join(raiz, categoria.name);
        for (const id of readdirSync(catDir, { withFileTypes: true })) {
          if (!id.isDirectory()) continue;
          const metaPath = join(catDir, id.name, "meta.json");
          if (!existsSync(metaPath)) continue;
          try {
            const meta = JSON.parse(await readFile(metaPath, "utf8")) as MetaRegistro;
            const conteudo = await this.lerConteudoIndexavel(wsPath, categoria.name, id.name);
            db.upsertRegistro({
              id: meta.id,
              categoria: meta.categoria,
              descricao: meta.descricao,
              criado_por: meta.criado_por,
              criado_em: meta.criado_em,
              atualizado_em: meta.atualizado_em,
              tags: meta.tags.join(","),
              conteudo,
            });
            registros += 1;
            const journal = await this.lerJournal(wsPath, categoria.name, id.name);
            for (const ev of journal) {
              db.inserirEvento({
                registro_id: meta.id,
                categoria: meta.categoria,
                ts: String(ev.ts ?? ""),
                por: String(ev.por ?? ""),
                evento: String(ev.evento ?? ""),
                resumo: String(ev.resumo ?? ""),
              });
              eventos += 1;
            }
          } catch {
            continue;
          }
        }
      }
    }
    const sessoes = await this.reindexarSessoes(wsPath);
    return { registros, eventos, sessoes };
  }

  async reindexarSessoes(wsPath: string): Promise<number> {
    const db = this.db(wsPath);
    const execucoes = await this.listar(wsPath, "execucoes");
    for (const meta of execucoes) {
      const extras = (meta.extras ?? {}) as Record<string, unknown>;
      db.upsertSessao({
        id: meta.id,
        agente: meta.criado_por,
        modelo: String(extras.modelo ?? ""),
        inicio: meta.criado_em,
        fim: (extras.fim as string | null) ?? null,
        custo_usd: (extras.custo_usd as number | null) ?? null,
        status: String(extras.status ?? ""),
      });
    }
    return execucoes.length;
  }

  fechar(): void {
    for (const db of this.dbPorWorkspace.values()) db.fechar();
    this.dbPorWorkspace.clear();
  }
}

function dedupe(valores: string[]): string[] {
  return [...new Set(valores)];
}
