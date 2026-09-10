/**
 * Testes de contrato do frontend — matam as classes de bug "botão morto"
 * (rodarFlowHub, renderAgendaForm nunca expostos) e "rota fora do /doc".
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(dirname(new URL(import.meta.url).pathname), "..");

function lerTs(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...lerTs(caminho));
    else if (nome.endsWith(".ts") || nome.endsWith(".tsx")) saida.push(readFileSync(caminho, "utf8"));
  }
  return saida;
}

describe("Contrato — handlers inline sempre expostos", () => {
  const fontes = lerTs(join(RAIZ, "src", "web"));
  const html = readFileSync(join(RAIZ, "web-dist", "index.html"), "utf8");

  it.todo("web-dist/index.html é gerado — validação roda no src (build sincroniza)");

  // coleta handlers globais definidos: g.X = / window.__X = / (window as ...).__X =
  const definidos = new Set<string>();
  for (const fonte of fontes) {
    for (const m of fonte.matchAll(/\bg\.(\w+)\s*=/g)) definidos.add(m[1]!);
    for (const m of fonte.matchAll(/\.__(\w+)\s*=/g)) definidos.add(`__${m[1]}`);
    for (const m of fonte.matchAll(/window\.(\w+)\s*=/g)) definidos.add(m[1]!);
  }
  // funções exportadas das views usáveis como handler central (expostas via exporGlobais)
  for (const fonte of fontes) {
    for (const m of fonte.matchAll(/export (?:async )?function (\w+)/g)) definidos.add(m[1]!);
  }

  // coleta handlers referenciados em atributos inline (nos .ts e no index.html)
  const REFERENCIAS = /\bon(?:click|change|input|submit|keydown|blur)\s*=\s*"([^"]+)"/g;
  const referenciados = new Set<string>();
  for (const fonte of [...fontes, html]) {
    for (const m of fonte.matchAll(REFERENCIAS)) {
      const corpo = m[1]!;
      for (const stmt of corpo.split(";")) {
        // só identificadores livres (não métodos: exclui o que vem depois de ponto)
        const chamada = /(?<![\w.$])([A-Za-z_$][\w$]*)\s*\(/.exec(stmt.trim());
        if (chamada && !["event", "window", "this", "document", "setTimeout", "navigator", "function", "if", "true", "Number", "String", "Boolean", "parseInt", "parseFloat", "encodeURIComponent", "decodeURIComponent", "JSON"].includes(chamada[1]!)) {
          referenciados.add(chamada[1]!);
        }
      }
    }
  }

  it("todo handler inline referenciado está definido em window", () => {
    const mortos = [...referenciados].filter((nome) => !definidos.has(nome));
    expect(
      mortos,
      `handlers inline sem definição (clique = ReferenceError): ${mortos.join(", ")}`,
    ).toEqual([]);
  });

  it("conhece pelo menos os componentes View críticos (regressão SolidJS)", () => {
    // Após migração Svelte→SolidJS, handlers inline onclick="..." não existem mais.
    // A regressão equivalente é verificar que os componentes críticos são exportados.
    const todosOsFontes = fontes.join("\n");
    const viewsCriticos = ["FluxosView", "HomeView", "SecretarioView", "TasksView"];
    for (const view of viewsCriticos) {
      expect(
        todosOsFontes.includes(`export const ${view}`),
        `componente ${view} não encontrado como export no src/web/`,
      ).toBe(true);
    }
  });
});

describe("Contrato — rotas chamadas pelo frontend existem no ROUTES (/doc)", () => {
  const server = readFileSync(join(RAIZ, "src", "server", "index.ts"), "utf8");
  const blocoRotas = /const ROUTES[^=]*= \[([\s\S]*?)\];/.exec(server)?.[1] ?? "";
  const padroes: Array<{ method: string; path: string }> = [];
  for (const m of blocoRotas.matchAll(/method:\s*"(\w+)",\s*path:\s*"([^"]+)"/g)) {
    padroes.push({ method: m[1]!, path: m[2]! });
  }

  it("ROUTES tem ao menos as rotas críticas", () => {
    const criticas = ["/health", "/tasks", "/schedules", "/flows", "/historico", "/secretario/conversa/stream", "/schedules/:id/runs"];
    for (const critica of criticas) {
      expect(padroes.some((p) => p.path === critica), `rota ${critica} ausente do ROUTES`).toBe(true);
    }
  });

  it("toda rota literal chamada pelo frontend está no ROUTES", () => {
    const fontes = lerTs(join(RAIZ, "src", "web"));
    const chamadas = new Set<string>();
    for (const fonte of fontes) {
      // api('/x'), q('/x'), api<...>('/x...') — só literais estáticos (sem concat/template)
      for (const m of fonte.matchAll(/(?:\bapi|\bq)(?:<[^>]*>)?\(\s*['"`](\/[^'"`?]*)/g)) {
        chamadas.add(m[1]!);
      }
    }
    const casa = (rota: string): boolean =>
      padroes.some((p) => {
        const regex = new RegExp("^" + p.path.replace(/:[^/]+/g, "[^/]+") + "$");
        return regex.test(rota);
      });
    const fora: string[] = [];
    for (const rota of chamadas) {
      // rotas especiais não-REST
      if (["/doc", "/events"].includes(rota)) continue;
      // paths concatenados dinamicamente (ex: '/flows/' + id) terminam em "/" — não verificáveis estaticamente
      if (rota.endsWith("/")) continue;
      if (!casa(rota)) fora.push(rota);
    }
    expect(fora, `rotas chamadas pelo front ausentes do ROUTES: ${fora.join(", ")}`).toEqual([]);
  });
});
