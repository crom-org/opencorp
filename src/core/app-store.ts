import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { AppError } from "./errors.js";
import { eventBus } from "./event-bus.js";
import { writeFileAtomic, mkdirRecursive } from "../utils/fs-safe.js";

export const widgetSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  tipo: z.enum(["metrica", "tabela", "kanban", "grafico", "formulario", "markdown", "lista_tarefas"]),
  titulo: z.string().min(1),
  fonte: z
    .object({
      rota: z.string().optional(),
      campo_valor: z.string().optional(),
      rotulo_campo: z.string().optional(),
    })
    .default({}),
  acao: z
    .object({
      tipo: z.enum(["flow", "task_move", "post_rota"]),
      flow: z.string().optional(),
      entrada: z.string().optional(),
      rota: z.string().optional(),
      campos: z.array(z.object({ nome: z.string(), rotulo: z.string().optional() })).optional(),
    })
    .optional(),
  texto: z.string().optional(),
});

export const paginaSchema = z.object({
  titulo: z.string().min(1),
  widgets: z.array(widgetSchema).default([]),
});

export const appSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "use kebab-case para o id do app"),
  titulo: z.string().min(1),
  paginas: z.array(paginaSchema).min(1),
});

export type Widget = z.infer<typeof widgetSchema>;
export type PaginaApp = z.infer<typeof paginaSchema>;
export type AppSpec = z.infer<typeof appSchema>;

export interface MiniAppInfo {
  id: string;
  titulo: string;
  descricao?: string;
  icone?: string;
  categoria?: string;
  tipo: "miniapp" | "spec";
  entryUrl: string;
  widgets?: number;
  modificadoEm?: string;
  padrao?: "app" | "chat";
}

export class AppStore {
  dir(wsPath: string): string {
    return join(wsPath, ".opencorp", "apps");
  }

  dirWorkspaceApps(wsPath: string): string {
    return join(wsPath, "apps");
  }

  caminho(wsPath: string, id: string): string {
    return join(this.dir(wsPath), `${id}.json`);
  }

  validarTexto(texto: string, onde: string): AppSpec {
    let bruto: unknown;
    try {
      bruto = JSON.parse(texto);
    } catch (erro) {
      throw new AppError(`${onde}: JSON inválido — ${erro instanceof Error ? erro.message : String(erro)}`);
    }
    const r = appSchema.safeParse(bruto);
    if (!r.success) {
      const detalhe = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new AppError(`${onde}: spec inválido — ${detalhe}`);
    }
    return r.data;
  }

  async criar(wsPath: string, id: string, titulo: string): Promise<AppSpec> {
    const app: AppSpec = {
      id,
      titulo,
      paginas: [{ titulo, widgets: [] }],
    };
    await this.salvar(wsPath, app);
    return app;
  }

  async salvar(wsPath: string, app: AppSpec): Promise<void> {
    const valido = this.validarTexto(JSON.stringify(app), "spec");
    await mkdirRecursive(this.dir(wsPath));
    await writeFileAtomic(this.caminho(wsPath, valido.id), `${JSON.stringify(valido, null, 2)}\n`);
    eventBus.emit("app.salvo", { app: valido.id });
  }

  /**
   * Lista todos os mini-apps do workspace (<workspace>/apps/) e specs declarativos (.opencorp/apps/)
   */
  listar(wsPath: string, wsId?: string): MiniAppInfo[] {
    const saida: MiniAppInfo[] = [];

    // 1. Mini-apps dentro de <workspace>/apps/<id>/
    const wsAppsDir = this.dirWorkspaceApps(wsPath);
    if (existsSync(wsAppsDir)) {
      try {
        const pastas = readdirSync(wsAppsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
        for (const p of pastas) {
          const appId = p.name;
          const pastaApp = join(wsAppsDir, appId);
          const metaPath = join(pastaApp, "app.json");
          const indexPath = join(pastaApp, "index.html");

          if (existsSync(indexPath) || existsSync(metaPath)) {
            let meta: any = {};
            if (existsSync(metaPath)) {
              try {
                meta = JSON.parse(readFileSync(metaPath, "utf8"));
              } catch {}
            }

            const wsQuery = wsId ? `?workspace=${encodeURIComponent(wsId)}` : "";
            saida.push({
              id: appId,
              titulo: meta.titulo || appId.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
              descricao: meta.descricao || "Mini-aplicação autônoma do workspace",
              icone: meta.icone || "Layout",
              categoria: meta.categoria || "Ferramenta",
              tipo: "miniapp",
              entryUrl: `/api/apps/${encodeURIComponent(appId)}/view${wsQuery}`,
              padrao: meta.padrao === "chat" ? "chat" : "app",
            });
          }
        }
      } catch {}
    }

    // 2. Specs declarativos legados em .opencorp/apps/*.json
    const dir = this.dir(wsPath);
    if (existsSync(dir)) {
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
        try {
          const app = this.validarTexto(readFileSync(join(dir, f), "utf8"), f);
          if (!saida.some((x) => x.id === app.id)) {
            saida.push({
              id: app.id,
              titulo: app.titulo,
              descricao: `Painel declarativo com ${app.paginas.reduce((n, p) => n + p.widgets.length, 0)} widgets`,
              icone: "BarChart2",
              categoria: "Painel",
              tipo: "spec",
              entryUrl: `/apps/${encodeURIComponent(app.id)}`,
              widgets: app.paginas.reduce((n, p) => n + p.widgets.length, 0),
              padrao: "app",
            });
          }
        } catch {
          continue;
        }
      }
    }

    return saida.sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Cria um novo mini-app com arquivos reais dentro de <workspace>/apps/<id>/
   */
  async criarMiniApp(
    wsPath: string,
    id: string,
    titulo: string,
    descricao?: string,
    htmlInicial?: string
  ): Promise<MiniAppInfo> {
    const wsAppsDir = this.dirWorkspaceApps(wsPath);
    const pastaApp = join(wsAppsDir, id);
    await mkdirRecursive(pastaApp);

    const meta = {
      id,
      titulo,
      descricao: descricao || "Mini-aplicação criada por IA",
      icone: "Layout",
      categoria: "Workspace",
      entry: "index.html",
      padrao: "app",
      criadoEm: new Date().toISOString(),
    };

    await writeFileAtomic(join(pastaApp, "app.json"), `${JSON.stringify(meta, null, 2)}\n`);

    const htmlPadrao = htmlInicial || `<!DOCTYPE html>
<html lang="pt-BR" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${titulo}</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-zinc-950 text-zinc-100 min-h-screen p-6 font-sans">
  <div class="max-w-4xl mx-auto space-y-6">
    <header class="border-b border-zinc-800 pb-4 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-white">${titulo}</h1>
        <p class="text-xs text-zinc-400 mt-1">${descricao || "Painel autônomo conectado ao workspace"}</p>
      </div>
      <span class="px-2.5 py-1 rounded-full text-xs font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        ● Online
      </span>
    </header>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-4" id="cards-metricas">
      <div class="p-4 rounded-xl bg-zinc-900 border border-zinc-800">
        <span class="text-xs text-zinc-400">Status do Workspace</span>
        <div class="text-xl font-bold text-emerald-400 mt-1">Operacional</div>
      </div>
      <div class="p-4 rounded-xl bg-zinc-900 border border-zinc-800">
        <span class="text-xs text-zinc-400">App ID</span>
        <div class="text-base font-mono text-zinc-200 mt-1 truncate">${id}</div>
      </div>
      <div class="p-4 rounded-xl bg-zinc-900 border border-zinc-800">
        <span class="text-xs text-zinc-400">Edição com IA</span>
        <div class="text-sm text-zinc-300 mt-1">Disponível no chat ao lado</div>
      </div>
    </div>

    <div class="p-5 rounded-2xl bg-zinc-900/60 border border-zinc-800/80">
      <h2 class="text-sm font-semibold text-zinc-200 mb-2">Instruções para o Assistente de IA:</h2>
      <p class="text-xs text-zinc-400 leading-relaxed">
        Você pode pedir para a IA modificar este arquivo (<code>apps/${id}/index.html</code>) a qualquer momento no chat de edição. Adicione tabelas, gráficos, formulários de consulta ou integrações diretas com os endpoints do OpenCorp!
      </p>
    </div>
  </div>
</body>
</html>`;

    await writeFileAtomic(join(pastaApp, "index.html"), htmlPadrao);
    eventBus.emit("app.salvo", { app: id });

    return {
      id,
      titulo,
      descricao: meta.descricao,
      icone: meta.icone,
      categoria: meta.categoria,
      tipo: "miniapp",
      entryUrl: `/api/apps/${encodeURIComponent(id)}/view`,
      padrao: "app",
    };
  }


  obter(wsPath: string, id: string): AppSpec {
    const path = this.caminho(wsPath, id);
    if (!existsSync(path)) {
      const e = new AppError(`app "${id}" não encontrado — veja "opencorp app list"`);
      (e as { status?: number }).status = 404;
      throw e;
    }
    return this.validarTexto(readFileSync(path, "utf8"), path);
  }

  async excluir(wsPath: string, id: string): Promise<void> {
    this.obter(wsPath, id);
    const { unlink } = await import("node:fs/promises");
    await unlink(this.caminho(wsPath, id));
    eventBus.emit("app.excluido", { app: id });
  }

  /** Specs de exemplo prontos para uso */
  seeds(): Record<string, AppSpec> {
    return {
      "painel-tarefas": {
        id: "painel-tarefas",
        titulo: "Painel de Tarefas",
        paginas: [
          {
            titulo: "Visão geral",
            widgets: [
              { id: "total", tipo: "metrica", titulo: "Tasks totais", fonte: { rota: "/tasks" } },
              { id: "kanban", tipo: "kanban", titulo: "Quadro", fonte: { rota: "/tasks" } },
              { id: "feed", tipo: "tabela", titulo: "Tasks recentes", fonte: { rota: "/tasks", rotulo_campo: "titulo", campo_valor: "coluna" } },
            ],
          },
        ],
      },
      "custos": {
        id: "custos",
        titulo: "Custos",
        paginas: [
          {
            titulo: "Orçamento",
            widgets: [
              { id: "status", tipo: "tabela", titulo: "Status do budget", fonte: { rota: "/budget/status" } },
              { id: "aprovacoes", tipo: "metrica", titulo: "Aprovações pendentes", fonte: { rota: "/approvals" } },
            ],
          },
        ],
      },
    };
  }
}
