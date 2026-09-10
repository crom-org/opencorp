#!/usr/bin/env node
const [nodeMajor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 20) {
  console.error(`erro: o OpenCorp requer Node.js >= 20. Versão atual: ${process.version}`);
  console.error("Configure seu ambiente/PATH para usar a versão correta do Node (ex: Node v20 ou v22 via nvm).");
  process.exit(1);
}
import { accessSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const entry = join(aqui, "..", "dist", "cli", "index.js");

try {
  accessSync(entry);
} catch {
  console.error("erro: build não encontrado (dist/cli/index.js).");
  console.error('Rode "npm run build" e tente novamente.');
  process.exit(1);
}

try {
  const mod = await import(pathToFileURL(entry).href);
  if (typeof mod.main !== "function") {
    console.error('erro: build inválido (main ausente em dist/cli/index.js). Rode "npm run build".');
    process.exit(1);
  }
  await mod.main(process.argv);
} catch (err) {
  console.error(
    `erro inesperado ao iniciar o opencorp: ${err && typeof err === "object" && "message" in err ? err.message : String(err)}`,
  );
  process.exit(1);
}
