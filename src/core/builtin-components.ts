/**
 * Componentes pré-construídos (builtin) para integrações com apps externos.
 * Cada componente é um script Node.js que lê OPENCORP_ENTRADA como JSON
 * e emite JSON em stdout com o resultado.
 *
 * Para usar, o componente precisa de secrets configurados no workspace
 * (ex.: SLACK_WEBHOOK_URL, DISCORD_WEBHOOK_URL, GITHUB_TOKEN).
 */

import type { Componente } from "./component-store.js";

// ── Slack ─────────────────────────────────────────────────────────

const slackMessage: Componente = {
  id: "slack-message",
  nome: "Slack — Enviar Mensagem",
  descricao: "Envia mensagem para um canal Slack via Incoming Webhook. Entrada: JSON { texto, canal?, webhook_url? }. Usa SLACK_WEBHOOK_URL como fallback.",
  runtime: "node",
  codigo: `
const entrada = JSON.parse(process.env.OPENCORP_ENTRADA || '{}');
const url = entrada.webhook_url || process.env.SLACK_WEBHOOK_URL;
if (!url) { console.log(JSON.stringify({ output: "erro: SLACK_WEBHOOK_URL não configurado", ok: false })); process.exit(0); }
const corpo = JSON.stringify({ text: entrada.texto || entrada.message || process.env.OPENCORP_ENTRADA });
fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo })
  .then(r => r.text().then(t => console.log(JSON.stringify({ output: 'mensagem enviada ao Slack', ok: r.ok, status: r.status, resposta: t }))))
  .catch(e => console.log(JSON.stringify({ output: 'erro ao enviar ao Slack: ' + e.message, ok: false })));
`.trim(),
  autor: "opencorp",
  versao: "1.0.0",
  tags: ["slack", "mensagem", "integração"],
  builtin: true,
  schema_entrada: { texto: "string", webhook_url: "string (opcional)" },
  schema_saida: { output: "string", ok: "boolean", status: "number" },
};

// ── Discord ───────────────────────────────────────────────────────

const discordMessage: Componente = {
  id: "discord-message",
  nome: "Discord — Enviar Mensagem",
  descricao: "Envia mensagem para canal Discord via Webhook. Entrada: JSON { texto, webhook_url? }. Usa DISCORD_WEBHOOK_URL como fallback.",
  runtime: "node",
  codigo: `
const entrada = JSON.parse(process.env.OPENCORP_ENTRADA || '{}');
const url = entrada.webhook_url || process.env.DISCORD_WEBHOOK_URL;
if (!url) { console.log(JSON.stringify({ output: "erro: DISCORD_WEBHOOK_URL não configurado", ok: false })); process.exit(0); }
const corpo = JSON.stringify({ content: entrada.texto || entrada.message || process.env.OPENCORP_ENTRADA });
fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo })
  .then(r => r.text().then(t => console.log(JSON.stringify({ output: 'mensagem enviada ao Discord', ok: r.ok, status: r.status }))))
  .catch(e => console.log(JSON.stringify({ output: 'erro ao enviar ao Discord: ' + e.message, ok: false })));
`.trim(),
  autor: "opencorp",
  versao: "1.0.0",
  tags: ["discord", "mensagem", "integração"],
  builtin: true,
  schema_entrada: { texto: "string", webhook_url: "string (opcional)" },
  schema_saida: { output: "string", ok: "boolean" },
};

// ── GitHub ─────────────────────────────────────────────────────────

const githubIssue: Componente = {
  id: "github-issue",
  nome: "GitHub — Criar Issue",
  descricao: "Cria issue no GitHub via API. Entrada: JSON { repo, titulo, corpo?, labels? }. Usa GITHUB_TOKEN do env.",
  runtime: "node",
  codigo: `
const entrada = JSON.parse(process.env.OPENCORP_ENTRADA || '{}');
const token = process.env.GITHUB_TOKEN;
if (!token) { console.log(JSON.stringify({ output: "erro: GITHUB_TOKEN não configurado", ok: false })); process.exit(0); }
if (!entrada.repo || !entrada.titulo) { console.log(JSON.stringify({ output: "erro: repo e titulo são obrigatórios", ok: false })); process.exit(0); }
const corpo = JSON.stringify({ title: entrada.titulo, body: entrada.corpo || '', labels: entrada.labels || [] });
fetch('https://api.github.com/repos/' + entrada.repo + '/issues', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github+json' },
  body: corpo
})
  .then(r => r.json().then(j => console.log(JSON.stringify({ output: 'issue #' + (j.number || '?') + ' criada', ok: r.ok, url: j.html_url || '', numero: j.number }))))
  .catch(e => console.log(JSON.stringify({ output: 'erro ao criar issue: ' + e.message, ok: false })));
`.trim(),
  autor: "opencorp",
  versao: "1.0.0",
  tags: ["github", "issue", "integração"],
  builtin: true,
  schema_entrada: { repo: "string (owner/repo)", titulo: "string", corpo: "string (opcional)", labels: "string[] (opcional)" },
  schema_saida: { output: "string", ok: "boolean", url: "string", numero: "number" },
};

// ── Google Sheets ──────────────────────────────────────────────────

const googleSheetsAppend: Componente = {
  id: "google-sheets-append",
  nome: "Google Sheets — Adicionar Linha",
  descricao: "Adiciona linha a uma planilha Google Sheets via API. Entrada: JSON { spreadsheet_id, sheet, valores[] }. Usa GOOGLE_SERVICE_ACCOUNT_KEY.",
  runtime: "node",
  codigo: `
const entrada = JSON.parse(process.env.OPENCORP_ENTRADA || '{}');
const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
if (!key || !entrada.spreadsheet_id) {
  console.log(JSON.stringify({ output: "erro: GOOGLE_SERVICE_ACCOUNT_KEY e spreadsheet_id obrigatórios", ok: false }));
  process.exit(0);
}
// Simplificado: usa API pública com API key (para demo; produção usa service account OAuth)
const sheet = entrada.sheet || 'Sheet1';
const valores = entrada.valores || [entrada.texto || process.env.OPENCORP_ENTRADA];
const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + entrada.spreadsheet_id + '/values/' + sheet + ':append?valueInputOption=USER_ENTERED&key=' + key;
const corpo = JSON.stringify({ values: [Array.isArray(valores) ? valores : [valores]] });
fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo })
  .then(r => r.json().then(j => console.log(JSON.stringify({ output: 'linha adicionada', ok: r.ok, updates: j.updates }))))
  .catch(e => console.log(JSON.stringify({ output: 'erro ao escrever na planilha: ' + e.message, ok: false })));
`.trim(),
  autor: "opencorp",
  versao: "1.0.0",
  tags: ["google", "sheets", "planilha", "integração"],
  builtin: true,
  schema_entrada: { spreadsheet_id: "string", sheet: "string (opcional)", valores: "any[]" },
  schema_saida: { output: "string", ok: "boolean" },
};

// ── HTTP Request ───────────────────────────────────────────────────

const httpRequest: Componente = {
  id: "http-request",
  nome: "HTTP — Requisição Genérica",
  descricao: "Faz requisição HTTP arbitrária. Entrada: JSON { url, metodo?, headers?, corpo? }. Retorna status e body.",
  runtime: "node",
  codigo: `
const entrada = JSON.parse(process.env.OPENCORP_ENTRADA || '{}');
if (!entrada.url) { console.log(JSON.stringify({ output: "erro: url obrigatória", ok: false })); process.exit(0); }
const metodo = (entrada.metodo || 'GET').toUpperCase();
const opts = { method: metodo, headers: entrada.headers || {} };
if (metodo !== 'GET' && metodo !== 'HEAD' && entrada.corpo) {
  opts.body = typeof entrada.corpo === 'string' ? entrada.corpo : JSON.stringify(entrada.corpo);
  if (!opts.headers['Content-Type'] && !opts.headers['content-type']) opts.headers['Content-Type'] = 'application/json';
}
fetch(entrada.url, opts)
  .then(r => r.text().then(t => {
    let json; try { json = JSON.parse(t); } catch {}
    console.log(JSON.stringify({ output: t.slice(0, 2000), ok: r.ok, status: r.status, json }));
  }))
  .catch(e => console.log(JSON.stringify({ output: 'erro HTTP: ' + e.message, ok: false })));
`.trim(),
  autor: "opencorp",
  versao: "1.0.0",
  tags: ["http", "api", "request", "integração"],
  builtin: true,
  schema_entrada: { url: "string", metodo: "string (opcional)", headers: "object (opcional)", corpo: "any (opcional)" },
  schema_saida: { output: "string", ok: "boolean", status: "number", json: "any" },
};

// ── Email ──────────────────────────────────────────────────────────

const emailSend: Componente = {
  id: "email-send",
  nome: "Email — Enviar via SMTP",
  descricao: "Envia e-mail via SMTP. Entrada: JSON { para, assunto, corpo }. Configura SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS via env/secrets.",
  runtime: "node",
  codigo: `
const net = require('net');
const entrada = JSON.parse(process.env.OPENCORP_ENTRADA || '{}');
const host = process.env.SMTP_HOST; const port = parseInt(process.env.SMTP_PORT || '587');
const user = process.env.SMTP_USER; const pass = process.env.SMTP_PASS;
if (!host || !user || !entrada.para) {
  console.log(JSON.stringify({ output: "erro: configure SMTP_HOST, SMTP_USER e entrada.para", ok: false }));
  process.exit(0);
}
// Envio simplificado via SMTP raw (sem TLS — para demo; produção deve usar nodemailer)
const sock = net.connect(port, host);
let buf = ''; let step = 0;
const cmds = [
  'EHLO opencorp\\r\\n',
  'AUTH LOGIN\\r\\n',
  Buffer.from(user).toString('base64') + '\\r\\n',
  Buffer.from(pass || '').toString('base64') + '\\r\\n',
  'MAIL FROM:<' + user + '>\\r\\n',
  'RCPT TO:<' + entrada.para + '>\\r\\n',
  'DATA\\r\\n',
  'From: ' + user + '\\r\\nTo: ' + entrada.para + '\\r\\nSubject: ' + (entrada.assunto || 'Notificação OpenCorp') + '\\r\\n\\r\\n' + (entrada.corpo || entrada.texto || '') + '\\r\\n.\\r\\n',
  'QUIT\\r\\n'
];
sock.on('data', () => { if (step < cmds.length) sock.write(cmds[step++]); });
sock.on('end', () => console.log(JSON.stringify({ output: 'e-mail enviado para ' + entrada.para, ok: true })));
sock.on('error', e => console.log(JSON.stringify({ output: 'erro SMTP: ' + e.message, ok: false })));
setTimeout(() => { sock.destroy(); console.log(JSON.stringify({ output: 'timeout SMTP', ok: false })); }, 15000);
`.trim(),
  autor: "opencorp",
  versao: "1.0.0",
  tags: ["email", "smtp", "integração"],
  builtin: true,
  schema_entrada: { para: "string", assunto: "string (opcional)", corpo: "string" },
  schema_saida: { output: "string", ok: "boolean" },
};

// ── Registro ───────────────────────────────────────────────────────

export const BUILTIN_COMPONENTS: Componente[] = [
  slackMessage,
  discordMessage,
  githubIssue,
  googleSheetsAppend,
  httpRequest,
  emailSend,
];

/**
 * Garante que os componentes builtin estejam disponíveis no workspace.
 * Não sobrescreve se já existirem (permite customização pelo usuário).
 */
export async function registrarBuiltins(wsPath: string, store: { criar: (wsPath: string, dados: unknown) => Promise<unknown> }): Promise<number> {
  let registrados = 0;
  for (const comp of BUILTIN_COMPONENTS) {
    try {
      await store.criar(wsPath, comp);
      registrados++;
    } catch {
      // já existe — ok
    }
  }
  return registrados;
}
