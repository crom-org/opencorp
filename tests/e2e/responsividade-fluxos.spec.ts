import { test, expect } from "@playwright/test";
import { logado, seederEmpresaBasica, api } from "./helpers.js";
import { join } from "node:path";

const artifactDir = "/home/j/.gemini/antigravity-ide/brain/0aa920af-1aee-41cb-a1e9-55c3e70c5802";

test.describe("Auditoria Visual & Responsividade do Studio de Fluxos", () => {
  test.beforeEach(async ({ page }) => {
    logado(page, "test-e2e");
    await seederEmpresaBasica(api(page), "test-e2e");
    await page.goto("/fluxos");

    await api(page).post("/flows", {
      headers: { authorization: "Bearer test-e2e", "content-type": "application/json" },
      data: {
        id: "flow-resp-test",
        nome: "Pipeline Responsivo",
        descricao: "Esteira para validação de responsividade",
        nos: [
          { id: "inicio", tipo: "manual", config: {} },
          { id: "comp", tipo: "componente", config: { componente_id: "slack-message" } },
        ],
        arestas: [{ id: "a1", de: "inicio", para: "comp" }],
      },
    });
  });

  test("Desktop (1280x800) — Toolbar completa, Canvas n8n-style e Split-view", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/fluxos");

    const btnAbrir = page.locator('button:has-text("Abrir Canvas")').first();
    await expect(btnAbrir).toBeVisible();
    await btnAbrir.click();

    // Toolbar desktop deve ter todos os botões e split view
    await expect(page.locator("button:has-text('Chat')")).toBeVisible();
    await expect(page.locator("button:has-text('Lado a Lado')")).toBeVisible();
    await expect(page.locator("button:has-text('Canvas')")).toBeVisible();
    await expect(page.locator("button:has-text('Executar')")).toBeVisible();

    const nodeComp = page.locator('[data-node-id="comp"]');
    await expect(nodeComp).toBeVisible();

    // Captura screenshot Desktop Canvas
    await page.screenshot({ path: join(artifactDir, "desktop_1280_canvas.png") });

    // Abre o NDV clicando no nó de componente
    await nodeComp.click();
    const ndvPanel = page.locator('.ndv-panel');
    await expect(ndvPanel).toBeVisible();

    // Captura screenshot Desktop com NDV aberto
    await page.screenshot({ path: join(artifactDir, "desktop_1280_ndv.png") });
  });

  test("Tablet (768x1024) — Layout adaptativo de toolbar e canvas", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/fluxos");

    const btnAbrir = page.locator('button:has-text("Abrir Canvas")').first();
    await expect(btnAbrir).toBeVisible();
    await btnAbrir.click();

    // No tablet, verifica que o canvas e toolbar renderizam sem quebrar layout
    await expect(page.locator("button:has-text('Executar')")).toBeVisible();
    await expect(page.locator("button:has-text('Adicionar Node')")).toBeVisible();

    // Captura screenshot Tablet
    await page.screenshot({ path: join(artifactDir, "tablet_768_canvas.png") });
  });

  test("Mobile (375x667) — Drawer mobile, toolbar colapsada, canvas móvel e NDV drawer", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/fluxos");

    const btnAbrir = page.locator('button:has-text("Abrir Canvas")').first();
    await expect(btnAbrir).toBeVisible();
    await btnAbrir.click();

    // No mobile, verifica adaptação do studio
    await expect(page.locator("button:has-text('Executar')")).toBeVisible();

    // Captura screenshot Mobile Studio Canvas
    await page.screenshot({ path: join(artifactDir, "mobile_375_studio.png") });

    // Clica no nó inicial para inspecionar NDV responsivo
    const nodeInicio = page.locator('[data-node-id="inicio"]');
    await expect(nodeInicio).toBeVisible();
    await nodeInicio.click();

    const ndvPanel = page.locator('.ndv-panel');
    await expect(ndvPanel).toBeVisible();

    const box = await ndvPanel.boundingBox();
    // Valida que o NDV está inteiramente dentro da tela de 375px (x >= 0 e x + width <= 375)
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(375);
    }

    // Captura screenshot Mobile com NDV aberto
    await page.screenshot({ path: join(artifactDir, "mobile_375_ndv.png") });
  });
});
