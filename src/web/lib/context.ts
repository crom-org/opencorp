import { createSignal } from "solid-js";
import { showToast } from "../ui/Toast";

export interface WorkspaceInfo {
  id: string;
  path: string;
  criado_em?: string;
}

const TOKEN_KEY = "oc-token";
const WS_KEY = "oc-ws";

const [token, setTokenSignal] = createSignal<string>(localStorage.getItem(TOKEN_KEY) || "");
const [wsAtivo, setWsAtivoSignal] = createSignal<string>(localStorage.getItem(WS_KEY) || "");
const [workspaces, setWorkspacesSignal] = createSignal<WorkspaceInfo[]>([]);
const [sseConnected, setSseConnected] = createSignal(false);
const [notificacoesNaoLidas, setNotificacoesNaoLidas] = createSignal(0);
const [autenticado, setAutenticado] = createSignal(true); // default true para servidores sem token
const [sidebarMobileAberta, setSidebarMobileAberta] = createSignal(false);

export { token, wsAtivo, workspaces, sseConnected, notificacoesNaoLidas, autenticado, setAutenticado, sidebarMobileAberta, setSidebarMobileAberta };


export function setToken(novoToken: string) {
  setTokenSignal(novoToken);
  if (novoToken) {
    localStorage.setItem(TOKEN_KEY, novoToken);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function setWsAtivo(novoWs: string) {
  setWsAtivoSignal(novoWs);
  if (novoWs) {
    localStorage.setItem(WS_KEY, novoWs);
  } else {
    localStorage.removeItem(WS_KEY);
  }
}

export function setWorkspaces(lista: WorkspaceInfo[]) {
  setWorkspacesSignal(lista);
}

export function setSseStatus(status: boolean) {
  setSseConnected(status);
}

export function setBadgeNotificacoes(count: number) {
  setNotificacoesNaoLidas(count);
}

export function headers(): Record<string, string> {
  const t = token();
  const base: Record<string, string> = { "content-type": "application/json" };
  if (t) base["Authorization"] = `Bearer ${t}`;
  return base;
}

export async function fetchApi<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const ws = wsAtivo();
  const semWs = path.includes("workspace=") || path.includes("all=1");
  const url = ws && !semWs
    ? path + (path.includes("?") ? "&" : "?") + "workspace=" + encodeURIComponent(ws)
    : path;

  let res: Response;
  try {
    const isStream = path.startsWith("/secretario/conversa");
    const timeoutMs = (!opts.method || opts.method === "GET") ? 15000 : (isStream ? undefined : 30000);
    const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;
    res = await fetch(url, { ...opts, headers: headers(), ...(signal ? { signal } : {}) });
  } catch (err: any) {
    showToast("Sem conexão com o servidor", "erro");
    throw err;
  }

  if (res.status === 401) {
    setAutenticado(false);
    showToast("Sessão expirada. Faça login novamente.", "aviso");
    throw new Error("401");
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j.erro) msg = j.erro;
    } catch {}
    throw new Error(msg);
  }

  const tipo = res.headers.get("content-type") || "";
  if (tipo.includes("application/json")) {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}

export async function carregarWorkspaces(): Promise<WorkspaceInfo[]> {
  try {
    const lista = await fetchApi<WorkspaceInfo[]>("/workspaces");
    setWorkspaces(lista);
    if (lista.length === 0) {
      setWsAtivo("");
    } else if (wsAtivo() && !lista.some((w) => w.id === wsAtivo())) {
      setWsAtivo("");
    }
    return lista;
  } catch {
    return [];
  }
}

// Inicializar SSE
let eventSource: EventSource | null = null;

export function conectarSSE() {
  if (eventSource) {
    try { eventSource.close(); } catch {}
  }
  const t = token();
  const url = t ? `/events?token=${encodeURIComponent(t)}` : "/events";
  eventSource = new EventSource(url);

  eventSource.onopen = () => {
    setSseStatus(true);
  };

  eventSource.onerror = () => {
    setSseStatus(false);
  };

  eventSource.addEventListener("notificacao", (e) => {
    try {
      const data = JSON.parse(e.data);
      setBadgeNotificacoes(data.nao_lidas ?? (notificacoesNaoLidas() + 1));
      showToast(`Alerta: ${data.resumo || "Nova notificação recebida"}`, "info");
    } catch {}
  });

  eventSource.addEventListener("run-fim", (e) => {
    try {
      const data = JSON.parse(e.data);
      showToast(`Execução ${data.agente || "agente"} finalizada (${data.status})`, data.status === "concluido" ? "sucesso" : "aviso");
    } catch {}
  });

  eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data && data.tipo === "secretario.mensagem") {
        window.dispatchEvent(new CustomEvent("secretario:mensagem", { detail: data }));
      }
    } catch {}
  };
}
