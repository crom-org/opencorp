import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Command } from "commander";
import { ComponentStore } from "../../core/component-store.js";
import { registrarBuiltins } from "../../core/builtin-components.js";
import { WorkspaceManager } from "../../core/workspace-manager.js";

function reportar(erro: unknown): void {
  if (erro instanceof Error) {
    const exitCode = (erro as { exitCode?: number }).exitCode;
    console.error(`erro: ${erro.message}`);
    process.exitCode = exitCode ?? 1;
    return;
  }
  console.error(`erro inesperado: ${String(erro)}`);
  process.exitCode = 1;
}

async function comErros(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (erro) {
    reportar(erro);
  }
}

export function registerComponentCommand(program: Command): void {
  const manager = new WorkspaceManager();
  const store = new ComponentStore();

  function wsDe(opts: { workspace?: string }): string | undefined {
    return opts.workspace ?? (program.opts() as { workspace?: string }).workspace;
  }

  const comp = program
    .command("component")
    .description("gerencia componentes reutilizáveis do marketplace (scripts Node/Python/Bash para fluxos)");

  comp
    .command("list")
    .description("lista os componentes do marketplace no workspace")
    .action((opts: { workspace?: string }) =>
      comErros(async () => {
        const ws = await manager.resolver(wsDe(opts));
        await registrarBuiltins(ws.path, store);
        const lista = await store.listar(ws.path);
        if (lista.length === 0) {
          console.log("nenhum componente cadastrado no workspace");
          return;
        }
        console.log(`Componentes (${lista.length}):`);
        for (const c of lista) {
          const builtinBadge = c.builtin ? " [builtin]" : "";
          console.log(`  - ${c.id.padEnd(24)} ${c.runtime.padEnd(8)} v${c.versao}${builtinBadge} — ${c.nome}`);
          if (c.descricao) console.log(`      ${c.descricao}`);
        }
      }),
    );

  comp
    .command("get <id>")
    .description("exibe os detalhes e o código de um componente")
    .action((id: string, opts: { workspace?: string }) =>
      comErros(async () => {
        const ws = await manager.resolver(wsDe(opts));
        const c = await store.obter(ws.path, id);
        console.log(JSON.stringify(c, null, 2));
      }),
    );

  comp
    .command("create <id>")
    .description("cria um novo componente reutilizável")
    .requiredOption("--nome <nome>", "nome amigável do componente")
    .option("--runtime <runtime>", "runtime do script: node, python, bash", "node")
    .option("--codigo <codigo>", "código do componente em linha")
    .option("--arquivo <arquivo>", "caminho de arquivo contendo o código do componente")
    .option("--descricao <descricao>", "descrição do que o componente faz", "")
    .option("--tags <tags>", "tags separadas por vírgula")
    .action(
      (
        id: string,
        opts: {
          nome: string;
          runtime: "node" | "bash" | "python";
          codigo?: string;
          arquivo?: string;
          descricao?: string;
          tags?: string;
          workspace?: string;
        },
      ) =>
        comErros(async () => {
          const ws = await manager.resolver(wsDe(opts));
          let codigo = opts.codigo;
          if (opts.arquivo) {
            codigo = await readFile(resolve(ws.path, opts.arquivo), "utf8");
          }
          if (!codigo) {
            codigo = opts.runtime === "bash" ? 'echo "{\\"output\\": \\"$OPENCORP_INPUT\\"}"' : 'console.log(JSON.stringify({ output: process.env.OPENCORP_INPUT || "" }));';
          }
          const tags = opts.tags ? opts.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
          const criado = await store.criar(ws.path, {
            id,
            nome: opts.nome,
            descricao: opts.descricao ?? "",
            runtime: opts.runtime,
            codigo,
            tags,
          });
          console.log(`ok: componente "${criado.id}" criado em ${store.caminho(ws.path, criado.id)}`);
        }),
    );

  comp
    .command("test <id>")
    .description("executa um teste do componente passando payload de entrada")
    .option("--entrada <entrada>", "string ou JSON de entrada para o teste", "{}")
    .action((id: string, opts: { entrada: string; workspace?: string }) =>
      comErros(async () => {
        const ws = await manager.resolver(wsDe(opts));
        console.log(`testando componente "${id}" com entrada: ${opts.entrada}`);
        const res = await store.testar(ws.path, id, opts.entrada);
        if (!res.ok) {
          console.error(`falha na execução (${res.duracao_ms}ms): ${res.erro}`);
          process.exitCode = 1;
          return;
        }
        console.log(`sucesso (${res.duracao_ms}ms)`);
        console.log("saída bruta:");
        console.log(res.saida);
        if (res.json !== undefined) {
          console.log("JSON estruturado:", JSON.stringify(res.json, null, 2));
        }
      }),
    );

  comp
    .command("publish <id>")
    .description("publica componente local para o diretório global compartilhado (~/.opencorp/shared-components)")
    .action((id: string, opts: { workspace?: string }) =>
      comErros(async () => {
        const ws = await manager.resolver(wsDe(opts));
        const destino = await store.publicar(ws.path, id);
        console.log(`ok: componente "${id}" publicado com sucesso em ${destino}`);
      }),
    );

  comp
    .command("install <id>")
    .description("instala componente do repositório compartilhado global no workspace")
    .action((id: string, opts: { workspace?: string }) =>
      comErros(async () => {
        const ws = await manager.resolver(wsDe(opts));
        const comp = await store.instalar(ws.path, id);
        console.log(`ok: componente "${comp.id}" instalado em ${store.caminho(ws.path, comp.id)}`);
      }),
    );

  comp
    .command("shared")
    .description("lista componentes disponíveis no diretório global compartilhado")
    .action(() =>
      comErros(async () => {
        const globais = await store.listarGlobais();
        if (globais.length === 0) {
          console.log("nenhum componente no diretório compartilhado global");
          return;
        }
        console.log(`Componentes Globais Compartilhados (${globais.length}):`);
        for (const c of globais) {
          console.log(`  - ${c.id.padEnd(24)} ${c.runtime.padEnd(8)} v${c.versao} — ${c.nome}`);
          if (c.descricao) console.log(`      ${c.descricao}`);
        }
      }),
    );

  comp
    .command("export <id>")
    .description("exporta a definição de um componente para JSON")
    .option("--saida <arquivo>", "caminho de arquivo para salvar o JSON")
    .action((id: string, opts: { saida?: string; workspace?: string }) =>
      comErros(async () => {
        const ws = await manager.resolver(wsDe(opts));
        const envelope = await store.exportar(ws.path, id);
        const jsonStr = JSON.stringify(envelope, null, 2);
        if (opts.saida) {
          await writeFile(resolve(ws.path, opts.saida), jsonStr, "utf8");
          console.log(`ok: componente exportado para ${opts.saida}`);
        } else {
          console.log(jsonStr);
        }
      }),
    );

  comp
    .command("import <arquivo>")
    .description("importa a definição de um componente a partir de arquivo JSON")
    .option("--sobrescrever", "sobrescreve se o componente já existir")
    .action((arquivo: string, opts: { sobrescrever?: boolean; workspace?: string }) =>
      comErros(async () => {
        const ws = await manager.resolver(wsDe(opts));
        const bruto = await readFile(resolve(ws.path, arquivo), "utf8");
        const comp = await store.importar(ws.path, bruto, { sobrescrever: opts.sobrescrever });
        console.log(`ok: componente "${comp.id}" importado com sucesso em ${store.caminho(ws.path, comp.id)}`);
      }),
    );

  comp
    .command("delete <id>")
    .description("remove um componente do workspace")
    .action((id: string, opts: { workspace?: string }) =>
      comErros(async () => {
        const ws = await manager.resolver(wsDe(opts));
        await store.excluir(ws.path, id);
        console.log(`ok: componente "${id}" removido com sucesso`);
      }),
    );
}
