import { test, expect } from "@playwright/test";
import { logado, seederEmpresaBasica, api, esperarNavegacao, esperarElementoTexto } from "./helpers.js";

const views = [
  { hash: "home", titulo: "Informações importantes" },
  { hash: "tasks", titulo: "Tasks" },
  { hash: "fluxos", titulo: "Fluxos" },
  { hash: "historico", titulo: "Histórico" },
  { hash: "secretario", titulo: "Secretário" },
  { hash: "apps", titulo: "Apps" },
];

test.describe("Navegação Sidebar", () => {
  test.beforeEach(async ({ page }) => {
    logado(page, "test-e2e");
    await seederEmpresaBasica(api(page), "test-e2e");
  });

  for (const view of views) {
    test(`clicar em ${view.titulo} muda hash para #/${view.hash} e renderiza título`, async ({ page }) => {
      await page.goto("/");
      await esperarNavegacao(page, "home");
      // Clica no item da sidebar
      const navItem = page.locator(`.nav-item[data-view="${view.hash}"]`);
      await navItem.click();
      // Aguarda navegação
      await page.waitForURL(`**/#/${view.hash}`);
      // Verifica se o título da view aparece
      await esperarElementoTexto(page, view.titulo);
      // Verifica se a view está ativa
      const viewEl = page.locator(`#view-${view.hash}`);
      await expect(viewEl).toHaveClass(/active/);
    });
  }

  test("Reuniões saiu do navbar (P-13) mas a rota #/reunioes continua funcionando como aba do Secretário", async ({ page }) => {
    await page.goto("/");
    await esperarNavegacao(page, "home");
    await expect(page.locator('.nav-item[data-view="reunioes"]')).toHaveCount(0);
    await page.evaluate(() => { window.location.hash = "#/reunioes"; });
    await page.waitForURL("**/#/reunioes");
    await esperarElementoTexto(page, "Reuniões");
    // Reuniões vive DENTRO da página do Secretário (aba) — PLANO-WEB-CRUD D
    await expect(page.locator("#view-secretario")).toHaveClass(/active/);
  });

  test("botão recolher esconde labels do navbar e persiste após reload (P-14)", async ({ page }) => {
    await page.goto("/");
    await esperarNavegacao(page, "home");
    await expect(page.locator("body")).not.toHaveClass(/sidebar-colapsada/);

    await page.click("#sidebar-collapse-btn");
    await expect(page.locator("body")).toHaveClass(/sidebar-colapsada/);
    await expect(page.locator(".nav-label").first()).toBeHidden();
    await expect(page.locator("#nav-icon-tasks")).toBeVisible();

    // Persistência: recarrega e o estado colapsado volta
    await page.reload();
    await esperarNavegacao(page, "home");
    await expect(page.locator("body")).toHaveClass(/sidebar-colapsada/);

    // Volta ao normal
    await page.click("#sidebar-collapse-btn");
    await expect(page.locator("body")).not.toHaveClass(/sidebar-colapsada/);
    await expect(page.locator(".nav-label").first()).toBeVisible();
  });
});
