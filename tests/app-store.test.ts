import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError, AppStore } from "../src/core/app-store.js";

const raizes: string[] = [];

afterAll(async () => {
  await Promise.all(raizes.map((r) => rm(r, { recursive: true, force: true })));
});

let wsPath = "";
let store: AppStore;

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), "opencorp-app-"));
  raizes.push(home);
  const { WorkspaceManager } = await import("../src/core/workspace-manager.js");
  const ws = await new WorkspaceManager({ homeDir: home, cwd: home }).criar("corp-app");
  wsPath = ws.path;
  store = new AppStore();
});

describe("AppStore — CRUD e validação", () => {
  it("cria app vazio, lista e obtém", async () => {
    const a = await store.criar(wsPath, "painel", "Meu Painel");
    expect(a.id).toBe("painel");
    expect(a.paginas).toHaveLength(1);
    expect(store.listar(wsPath)[0]).toMatchObject({ id: "painel", titulo: "Meu Painel", widgets: 0 });
    expect(store.obter(wsPath, "painel").titulo).toBe("Meu Painel");
  });

  it("recusa id fora do kebab-case e widget com tipo inválido", async () => {
    await expect(store.salvar(wsPath, { id: "Id Ruim", titulo: "x", paginas: [{ titulo: "p", widgets: [] }] })).rejects.toThrow(AppError);
    await expect(
      store.salvar(wsPath, {
        id: "ok-id",
        titulo: "x",
        paginas: [{ titulo: "p", widgets: [{ id: "w1", tipo: "dashbord" as "metrica", titulo: "w", fonte: {} }] }],
      }),
    ).rejects.toThrow(AppError);
  });

  it("salva spec completo com widgets e preserva dados", async () => {
    await store.salvar(wsPath, {
      id: "painel",
      titulo: "Painel",
      paginas: [
        {
          titulo: "Geral",
          widgets: [
            { id: "m1", tipo: "metrica", titulo: "Tasks", fonte: { rota: "/tasks" } },
            { id: "k1", tipo: "kanban", titulo: "Quadro", fonte: { rota: "/tasks" } },
            { id: "g1", tipo: "grafico", titulo: "Por coluna", fonte: { rota: "/tasks", rotulo_campo: "coluna", campo_valor: "prioridade" } },
            { id: "f1", tipo: "formulario", titulo: "Nova task", fonte: { rota: "/tasks" }, acao: { tipo: "post_rota", campos: [{ nome: "titulo" }] } },
            { id: "md1", tipo: "markdown", titulo: "Ajuda", fonte: {}, texto: "# Como usar" },
          ],
        },
      ],
    });
    const spec = store.obter(wsPath, "painel");
    expect(spec.paginas[0]!.widgets).toHaveLength(5);
    expect(store.listar(wsPath)[0]!.widgets).toBe(5);
  });

  it("obter inexistente → 404; excluir remove", async () => {
    try {
      store.obter(wsPath, "fantasma");
      expect.unreachable();
    } catch (e) {
      expect((e as { status?: number }).status).toBe(404);
    }
    await store.criar(wsPath, "tmp", "T");
    await store.excluir(wsPath, "tmp");
    expect(store.listar(wsPath)).toEqual([]);
  });

  it("seeds são válidos e instaláveis", async () => {
    const seeds = store.seeds();
    expect(Object.keys(seeds)).toEqual(expect.arrayContaining(["painel-tarefas", "custos"]));
    for (const seed of Object.values(seeds)) {
      await store.salvar(wsPath, seed);
      store.obter(wsPath, seed.id); // valida
    }
    expect(store.listar(wsPath)).toHaveLength(2);
  });
});
