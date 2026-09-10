import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { ComponentError } from "./errors.js";
import { mkdirRecursive, writeFileAtomic } from "../utils/fs-safe.js";
import { opencorpHome } from "../utils/paths.js";

// ── Schema ─────────────────────────────────────────────────────────

export const componenteSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "use kebab-case para o id do componente"),
  nome: z.string().min(1),
  descricao: z.string().default(""),
  runtime: z.enum(["bash", "node", "python"]).default("node"),
  codigo: z.string().min(1, "código do componente não pode ser vazio"),
  schema_entrada: z.record(z.string(), z.unknown()).optional(),
  schema_saida: z.record(z.string(), z.unknown()).optional(),
  autor: z.string().default("opencorp"),
  versao: z.string().default("1.0.0"),
  tags: z.array(z.string()).default([]),
  builtin: z.boolean().default(false),
});

export type Componente = z.infer<typeof componenteSchema>;

export interface ComponenteResumo {
  id: string;
  nome: string;
  descricao: string;
  runtime: string;
  autor: string;
  versao: string;
  tags: string[];
  builtin: boolean;
}

export interface ResultadoTeste {
  ok: boolean;
  saida: string;
  json?: unknown;
  duracao_ms: number;
  erro?: string;
}

// ── ComponentStore ────────────────────────────────────────────────

export class ComponentStore {
  private readonly homeDir: string;

  constructor(opts: { homeDir?: string } = {}) {
    this.homeDir = opts.homeDir ?? opencorpHome();
  }

  /** Diretório de componentes do workspace */
  private dir(wsPath: string): string {
    return join(wsPath, ".opencorp", "components");
  }

  /** Diretório global de componentes compartilhados */
  private dirGlobal(): string {
    return join(this.homeDir, ".opencorp", "shared-components");
  }

  /** Caminho do arquivo de um componente */
  caminho(wsPath: string, id: string): string {
    return join(this.dir(wsPath), `${id}.json`);
  }

  // ── CRUD ─────────────────────────────────────────────────────

  async criar(wsPath: string, dados: unknown): Promise<Componente> {
    const parsed = componenteSchema.safeParse(dados);
    if (!parsed.success) {
      const erros = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new ComponentError(`componente inválido: ${erros}`);
    }
    const comp = parsed.data;
    const dir = this.dir(wsPath);
    await mkdirRecursive(dir);
    const caminho = join(dir, `${comp.id}.json`);
    if (existsSync(caminho)) {
      throw new ComponentError(`componente "${comp.id}" já existe — use atualizar() ou passe sobrescrever=true`);
    }
    await writeFileAtomic(caminho, JSON.stringify(comp, null, 2));
    return comp;
  }

  async atualizar(wsPath: string, id: string, dados: unknown): Promise<Componente> {
    const caminho = this.caminho(wsPath, id);
    if (!existsSync(caminho)) {
      throw new ComponentError(`componente "${id}" não encontrado`);
    }
    const existente = await this.obter(wsPath, id);
    const merged = { ...existente, ...(typeof dados === "object" && dados !== null ? dados : {}), id };
    const parsed = componenteSchema.safeParse(merged);
    if (!parsed.success) {
      const erros = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new ComponentError(`componente inválido: ${erros}`);
    }
    await writeFileAtomic(caminho, JSON.stringify(parsed.data, null, 2));
    return parsed.data;
  }

  async obter(wsPath: string, id: string): Promise<Componente> {
    const caminho = this.caminho(wsPath, id);
    if (!existsSync(caminho)) {
      throw new ComponentError(`componente "${id}" não encontrado`);
    }
    const raw = readFileSync(caminho, "utf8");
    const parsed = componenteSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new ComponentError(`componente "${id}" corrompido: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  async listar(wsPath: string): Promise<ComponenteResumo[]> {
    const dir = this.dir(wsPath);
    if (!existsSync(dir)) return [];
    const saida: ComponenteResumo[] = [];
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      try {
        const raw = JSON.parse(readFileSync(join(dir, f), "utf8"));
        const parsed = componenteSchema.safeParse(raw);
        if (!parsed.success) continue;
        const c = parsed.data;
        saida.push({
          id: c.id,
          nome: c.nome,
          descricao: c.descricao,
          runtime: c.runtime,
          autor: c.autor,
          versao: c.versao,
          tags: c.tags,
          builtin: c.builtin,
        });
      } catch {
        continue;
      }
    }
    return saida.sort((a, b) => a.id.localeCompare(b.id));
  }

  async excluir(wsPath: string, id: string): Promise<void> {
    const caminho = this.caminho(wsPath, id);
    if (!existsSync(caminho)) {
      throw new ComponentError(`componente "${id}" não encontrado`);
    }
    const { unlinkSync } = await import("node:fs");
    unlinkSync(caminho);
  }

  // ── Execução de Teste ───────────────────────────────────────

  async testar(wsPath: string, id: string, entrada: string): Promise<ResultadoTeste> {
    const comp = await this.obter(wsPath, id);
    const inicio = Date.now();

    try {
      const { execFile } = await import("node:child_process");
      const execFileAsync = promisify(execFile);
      const runtimeCmd =
        comp.runtime === "python" ? "python3" :
        comp.runtime === "bash" ? "bash" :
        "node";

      const flag = comp.runtime === "bash" ? "-c" : "-e";
      const res = await execFileAsync(runtimeCmd, [flag, comp.codigo], {
        cwd: wsPath,
        timeout: 30000,
        env: {
          ...process.env,
          OPENCORP_ENTRADA: entrada,
          OPENCORP_INPUT: entrada,
          OPENCORP_COMPONENT_ID: id,
          OPENCORP_WORKSPACE_DIR: wsPath,
        },
      });

      const saida = (res.stdout || "").trim();
      const duracao_ms = Date.now() - inicio;

      let json: unknown;
      try {
        json = JSON.parse(saida);
      } catch {
        // não é JSON, tudo bem
      }

      return { ok: true, saida, json, duracao_ms };
    } catch (erro) {
      const duracao_ms = Date.now() - inicio;
      const msg = erro instanceof Error ? erro.message : String(erro);
      return { ok: false, saida: "", duracao_ms, erro: msg };
    }
  }

  // ── Registry Compartilhado ──────────────────────────────────

  async publicar(wsPath: string, id: string): Promise<string> {
    const comp = await this.obter(wsPath, id);
    const dirGlobal = this.dirGlobal();
    await mkdirRecursive(dirGlobal);
    const destino = join(dirGlobal, `${id}.json`);
    await writeFileAtomic(destino, JSON.stringify(comp, null, 2));
    return destino;
  }

  async instalar(wsPath: string, id: string): Promise<Componente> {
    const camGlobal = join(this.dirGlobal(), `${id}.json`);
    if (!existsSync(camGlobal)) {
      throw new ComponentError(`componente compartilhado "${id}" não encontrado em ${this.dirGlobal()}`);
    }
    const raw = readFileSync(camGlobal, "utf8");
    const parsed = componenteSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new ComponentError(`componente compartilhado "${id}" corrompido`);
    }
    const dir = this.dir(wsPath);
    await mkdirRecursive(dir);
    const destino = join(dir, `${id}.json`);
    await writeFileAtomic(destino, JSON.stringify(parsed.data, null, 2));
    return parsed.data;
  }

  async listarGlobais(): Promise<ComponenteResumo[]> {
    const dir = this.dirGlobal();
    if (!existsSync(dir)) return [];
    const saida: ComponenteResumo[] = [];
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      try {
        const raw = JSON.parse(readFileSync(join(dir, f), "utf8"));
        const parsed = componenteSchema.safeParse(raw);
        if (!parsed.success) continue;
        const c = parsed.data;
        saida.push({
          id: c.id,
          nome: c.nome,
          descricao: c.descricao,
          runtime: c.runtime,
          autor: c.autor,
          versao: c.versao,
          tags: c.tags,
          builtin: c.builtin,
        });
      } catch {
        continue;
      }
    }
    return saida.sort((a, b) => a.id.localeCompare(b.id));
  }

  // ── Exportar / Importar ─────────────────────────────────────

  async exportar(wsPath: string, id: string): Promise<{ version: number; component: Componente; exported_at: string }> {
    const comp = await this.obter(wsPath, id);
    return { version: 1, component: comp, exported_at: new Date().toISOString() };
  }

  async importar(wsPath: string, dados: unknown, opts?: { sobrescrever?: boolean }): Promise<Componente> {
    let raw: unknown = dados;
    if (typeof raw === "string") {
      try { raw = JSON.parse(raw); } catch { throw new ComponentError("JSON inválido para importação de componente"); }
    }
    // Aceita envelope { component: ... } ou objeto direto
    if (typeof raw === "object" && raw !== null && "component" in (raw as Record<string, unknown>)) {
      raw = (raw as Record<string, unknown>).component;
    }
    const parsed = componenteSchema.safeParse(raw);
    if (!parsed.success) {
      const erros = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new ComponentError(`componente inválido para importação: ${erros}`);
    }
    const comp = parsed.data;
    const dir = this.dir(wsPath);
    await mkdirRecursive(dir);
    const caminho = join(dir, `${comp.id}.json`);
    if (existsSync(caminho) && !opts?.sobrescrever) {
      throw new ComponentError(`componente "${comp.id}" já existe — use sobrescrever=true`);
    }
    await writeFileAtomic(caminho, JSON.stringify(comp, null, 2));
    return comp;
  }
}
