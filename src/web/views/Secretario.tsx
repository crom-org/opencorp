import { type Component, createSignal, onMount, onCleanup, createEffect, For, Show } from "solid-js";
import {
  Plus,
  History,
  Bot,
  Sparkles,
  AlertCircle,
  Users,
  ArrowDown,
  Cpu,
  X,
  Check,
  Play,
  RefreshCw,
  Zap,
  Settings2,
} from "lucide-solid";
import { useNavigate } from "@solidjs/router";
import { UniversalChat } from "../components/chat/UniversalChat";
import type { ChatMensagem, PromptFilaItem } from "../components/chat/types";
import type { Anexo } from "../components/chat/PromptInput";
import { HistoricoModal, type SessaoResumo } from "../components/chat/HistoricoModal";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { showToast } from "../ui/Toast";
import { fetchApi, wsAtivo, headers } from "../lib/context";

function reconciliarMensagens(antigas: ChatMensagem[], novas: ChatMensagem[]): ChatMensagem[] {
  if (!antigas || antigas.length === 0) return novas;
  if (!novas || novas.length === 0) return [];

  const resultado: ChatMensagem[] = [];
  for (let i = 0; i < novas.length; i++) {
    const n = novas[i];
    const a = antigas[i];

    if (
      a &&
      a.role === n.role &&
      a.content === n.content &&
      a.pensamento === n.pensamento &&
      a.concluida === n.concluida &&
      a.hitl?.id === n.hitl?.id &&
      (a.passos?.length ?? 0) === (n.passos?.length ?? 0) &&
      (a.acoes?.length ?? 0) === (n.acoes?.length ?? 0)
    ) {
      // Preserva a referência original da mensagem antiga: SolidJS não remonta o DOM
      resultado.push(a);
    } else {
      resultado.push(n);
    }
  }
  return resultado;
}

export const SecretarioView: Component = () => {
  const navigate = useNavigate();
  const [sessoes, setSessoes] = createSignal<SessaoResumo[]>([]);
  const sessaoInicial = () => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("sessao") || localStorage.getItem("opencorp_secretario_sessao") || null;
    } catch {
      return null;
    }
  };
  const [sessaoAtivaId, setSessaoAtivaIdRaw] = createSignal<string | null>(sessaoInicial());
  const setSessaoAtivaId = (id: string | null) => {
    setSessaoAtivaIdRaw(id);
    try {
      if (id) {
        localStorage.setItem("opencorp_secretario_sessao", id);
        const url = new URL(window.location.href);
        url.searchParams.set("sessao", id);
        window.history.replaceState({}, "", url.toString());
      } else {
        localStorage.removeItem("opencorp_secretario_sessao");
        const url = new URL(window.location.href);
        url.searchParams.delete("sessao");
        window.history.replaceState({}, "", url.toString());
      }
    } catch {}
  };
  const [mensagens, setMensagens] = createSignal<ChatMensagem[]>([]);
  const [inputValor, setInputValor] = createSignal("");
  const [anexos, setAnexos] = createSignal<Anexo[]>([]);
  const [filaPrompts, setFilaPrompts] = createSignal<PromptFilaItem[]>([]);
  let processandoFila = false;
  const [agente, setAgente] = createSignal<string>("secretario-exec");
  const [carregando, setCarregando] = createSignal(false);
  const [historicoAberto, setHistoricoAberto] = createSignal(false);
  const [decorridoSegundos, setDecorridoSegundos] = createSignal(0);
  const [mostrarBotaoFim, setMostrarBotaoFim] = createSignal(false);

  // Configuração lateral de Agente, Motor e Modelo
  const [configLateralAberta, setConfigLateralAberta] = createSignal(false);
  const [listaAgentes, setListaAgentes] = createSignal<Array<{ id: string; role: string; model: string; harness?: string; engine?: string; rotation?: string[] }>>([]);
  const [listaMotores, setListaMotores] = createSignal<Array<{ id: string; name: string; installed: boolean; version?: string }>>([]);
  const [agenteConfig, setAgenteConfig] = createSignal<string>("secretario-exec");
  const [motorConfig, setMotorConfig] = createSignal<string>("opencode");
  const [modeloConfig, setModeloConfig] = createSignal<string>("");
  const [rotacaoConfig, setRotacaoConfig] = createSignal<string>("");
  const [testandoMotor, setTestandoMotor] = createSignal(false);
  const [resultadoTeste, setResultadoTeste] = createSignal<{ ok: boolean; msg: string; latencyMs?: number } | null>(null);
  const [salvandoConfig, setSalvandoConfig] = createSignal(false);

  const modelosSugeridos: Record<string, string[]> = {
    antigravity: [
      "google/gemini-3.8-flash-high",
      "google/gemini-3.7-flash-high",
      "google/gemini-3.1-pro-high",
      "claude-sonnet-4-6",
    ],
    copilot: [
      "github/gpt-4o",
      "github/claude-3.5-sonnet",
      "github/o3-mini",
    ],
    opencode: [
      "opencode-go/glm-5.3-flash",
      "opencode-go/glm-5.3",
      "opencode/nemotron-3-ultra-free",
      "opencode/nemotron-3.5-lightning-free",
      "opencode/big-pickle",
    ],
    "claude-code": [
      "claude-3-7-sonnet-20250219",
      "claude-3-5-sonnet-20241022",
    ],
    cursor: ["cursor-fast", "cursor-small"],
    "crom-agente": ["crom-default"],
  };

  const carregarAgentesEMotores = async () => {
    try {
      const resAg = await fetchApi(`/agents?workspace=${encodeURIComponent(wsAtivo())}`);
      if (resAg.ok) {
        const ags = await resAg.json();
        if (Array.isArray(ags)) setListaAgentes(ags);
      }
    } catch {}

    try {
      const resMot = await fetchApi("/engines");
      if (resMot.ok) {
        const mots = await resMot.json();
        if (Array.isArray(mots)) setListaMotores(mots);
      }
    } catch {}
  };

  const abrirPainelLateral = async () => {
    await carregarAgentesEMotores();
    const agAtual = agente();
    setAgenteConfig(agAtual);
    const enc = listaAgentes().find((a) => a.id === agAtual);
    if (enc) {
      setMotorConfig(enc.harness || (enc as any).engine || "opencode");
      setModeloConfig(enc.model || "");
      const rot = enc.rotation || (enc as any).model_fallback || [];
      setRotacaoConfig(Array.isArray(rot) ? rot.join("\n") : "");
    }
    setResultadoTeste(null);
    setConfigLateralAberta(true);
  };

  const aoMudarAgenteConfig = (agId: string) => {
    setAgenteConfig(agId);
    setResultadoTeste(null);
    const enc = listaAgentes().find((a) => a.id === agId);
    if (enc) {
      setMotorConfig(enc.harness || (enc as any).engine || "opencode");
      setModeloConfig(enc.model || "");
      const rot = enc.rotation || (enc as any).model_fallback || [];
      setRotacaoConfig(Array.isArray(rot) ? rot.join("\n") : "");
    }
  };

  const aoMudarMotorConfig = (motId: string) => {
    setMotorConfig(motId);
    setResultadoTeste(null);
    const sug = modelosSugeridos[motId];
    if (sug && sug.length > 0 && !modeloConfig().trim()) {
      setModeloConfig(sug[0]!);
    }
  };

  const testarMotorConexao = async () => {
    setTestandoMotor(true);
    setResultadoTeste(null);
    const t0 = Date.now();
    try {
      const agId = agenteConfig();
      const motId = motorConfig();
      if (agId === "secretario-exec" || agId === "secretario") {
        const [motorRes, statusRes] = await Promise.all([
          fetchApi<any>(`/api/motores/${encodeURIComponent(motId)}/test`, { method: "POST" }).catch(() => null),
          fetchApi<{ rodando?: boolean; porta?: number }>("/secretario/status").catch(() => null),
        ]);
        const t = Date.now() - t0;
        const motorOk = motorRes?.ok || motorRes?.health?.healthy;
        const secOk = statusRes?.rodando;
        if (motorOk && secOk) {
          const statusTxt = motorRes?.health?.statusText || "OK";
          setResultadoTeste({ ok: true, msg: `Motor "${motId}" ativo (${statusTxt}) · Secretário rodando na porta ${statusRes.porta} (${t}ms).`, latencyMs: t });
          showToast(`Motor ${motId} verificado com sucesso!`, "sucesso");
        } else {
          const partes: string[] = [];
          if (!motorOk) partes.push(`Motor "${motId}" não respondeu`);
          if (!secOk) partes.push("Secretário (OpenCode) não está rodando");
          setResultadoTeste({ ok: false, msg: partes.join(" · ") + ` (${t}ms)`, latencyMs: t });
        }
      } else {
        await fetchApi(`/agents/${encodeURIComponent(agId)}/run?workspace=${encodeURIComponent(wsAtivo())}`, {
          method: "POST",
          body: JSON.stringify({
            ordem: "ping de verificação de motor",
            engine: motId,
            model: modeloConfig().trim() || undefined,
          }),
        });
        const t = Date.now() - t0;
        setResultadoTeste({
          ok: true,
          msg: `Motor "${motId}" ativo e respondendo (${t}ms).`,
          latencyMs: t,
        });
        showToast(`Motor ${motId} verificado com sucesso!`, "sucesso");
      }
    } catch (e: any) {
      setResultadoTeste({
        ok: false,
        msg: `Falha ao acionar motor: ${e?.message || e}`,
        latencyMs: Date.now() - t0,
      });
    } finally {
      setTestandoMotor(false);
    }
  };

  const salvarConfigLateral = async () => {
    setSalvandoConfig(true);
    try {
      const rot = rotacaoConfig()
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await fetchApi(`/agents/${encodeURIComponent(agenteConfig())}?workspace=${encodeURIComponent(wsAtivo())}`, {
        method: "PUT",
        body: JSON.stringify({
          harness: motorConfig(),
          model: modeloConfig().trim() || undefined,
          rotation: rot,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.erro || `Erro HTTP ${res.status}`);
      }

      setAgente(agenteConfig() as any);
      await carregarAgentesEMotores();
      showToast(`Agente @${agenteConfig()} atualizado com motor ${motorConfig()}!`, "sucesso");
      setConfigLateralAberta(false);
    } catch (e: any) {
      showToast(`Erro ao salvar: ${e?.message || e}`, "erro");
    } finally {
      setSalvandoConfig(false);
    }
  };

  let textareaRef: HTMLTextAreaElement | undefined;
  let abortController: AbortController | null = null;
  let timerInterval: any = null;

  // Canal de sincronização instantânea entre abas/guias gêmeas do navegador
  let syncChannel: BroadcastChannel | null = null;
  if (typeof window !== "undefined" && "BroadcastChannel" in window) {
    try {
      syncChannel = new BroadcastChannel("opencorp_chat_sync");
    } catch {}
  }

  const SUGESTOES = [
    "O que aconteceu hoje?",
    "Como está o board de tasks?",
    "Qual o custo acumulado de LLM hoje?",
    "Rodar auditoria rápida do site",
  ];

  const scrollFim = (_forcar = false) => {};


  const carregarSessoes = async () => {
    try {
      const status = await fetchApi<{ rodando?: boolean }>("/secretario/status").catch(() => null);
      if (status && !status.rodando) {
        await fetchApi("/secretario/start", { method: "POST" }).catch(() => null);
      }
      const listaRaw = await fetchApi<any[]>("/secretario/sessoes");
      const lista: SessaoResumo[] = (listaRaw || []).map((s) => ({
        id: s.id,
        titulo: s.titulo_real || s.title || s.titulo || `Conversa ${s.id.slice(0, 8)}`,
        criado_em: s.time?.created || s.created || s.criado_em,
        atualizado_em: s.time?.updated || s.updated || s.atualizado_em,
        mensagens_count: s.summary?.files,
      }));
      setSessoes(lista);
      const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
      const urlSessaoId = params?.get("sessao");
      const ativa = urlSessaoId || sessaoAtivaId();
      if (ativa && lista.some((s) => s.id === ativa)) {
        selecionarSessao(ativa);
      } else if (lista.length > 0 && !sessaoAtivaId()) {
        selecionarSessao(lista[0].id);
      }
    } catch (err) {
      console.error("Erro ao carregar sessões do secretário:", err);
    }
  };

  let monitorTimeout: any = null;
  let streamingAtivo = false;

  const pararMonitoramento = () => {
    if (monitorTimeout) {
      clearTimeout(monitorTimeout);
      monitorTimeout = null;
    }
  };

  const retomarMonitoramento = (sessaoId: string) => {
    pararMonitoramento();
    setCarregando(true);
    let tentativasSemMudanca = 0;
    let ultimoHash = "";

    if (!timerInterval) {
      timerInterval = setInterval(() => {
        setDecorridoSegundos((s) => s + 1);
      }, 1000);
    }

    const tick = async () => {
      if (sessaoAtivaId() !== sessaoId) {
        pararMonitoramento();
        setCarregando(false);
        if (timerInterval) {
          clearInterval(timerInterval);
          timerInterval = null;
        }
        return;
      }
      if (streamingAtivo) {
        monitorTimeout = setTimeout(tick, 1000);
        return;
      }
      try {
        const msgs = await fetchApi<ChatMensagem[]>(`/secretario/sessoes/${encodeURIComponent(sessaoId)}/mensagens`);
        if (streamingAtivo) {
          monitorTimeout = setTimeout(tick, 1000);
          return;
        }
        if (!Array.isArray(msgs)) {
          monitorTimeout = setTimeout(tick, 1000);
          return;
        }

        const ult = msgs[msgs.length - 1];
        // Hash de mudança para re-renderização
        const hash = msgs.length + ":" + (ult?.content?.length ?? 0) + ":" + (ult?.pensamento?.length ?? 0) + ":" + (ult?.acoes?.length ?? 0) + ":" + (ult?.passos?.length ?? 0) + ":" + ult?.concluida;
        if (hash !== ultimoHash) {
          ultimoHash = hash;
          tentativasSemMudanca = 0;
          setMensagens((prev) => reconciliarMensagens(prev, msgs));
          setTimeout(() => scrollFim(false), 30);
        } else {
          tentativasSemMudanca++;
        }

        // Se a última mensagem for do assistente e estiver concluída, encerra monitoramento
        if (ult && ult.role === "assistant" && ult.concluida === true) {
          pararMonitoramento();
          setCarregando(false);
          if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
          }
          return;
        }

        // Se o backend não reportar a sessão como executando e a mensagem for do usuário ou já concluída
        const sessaoOcupadaNoTick = sessoes().find((s) => s.id === sessaoId && (s as any).executando);
        if (!sessaoOcupadaNoTick && ult && (ult.concluida === true || ult.role === "user")) {
          tentativasSemMudanca++;
          if (tentativasSemMudanca >= 2) {
            pararMonitoramento();
            setCarregando(false);
            if (timerInterval) {
              clearInterval(timerInterval);
              timerInterval = null;
            }
            return;
          }
        }

        if (tentativasSemMudanca > 1800) { // ~30 minutos sem nenhuma alteração
          const sessaoOcupada = sessoes().find((s) => s.id === sessaoId && (s as any).executando);
          if (sessaoOcupada || (ult && ult.role === "assistant" && ult.concluida === false)) {
            tentativasSemMudanca = 0;
            monitorTimeout = setTimeout(tick, 1500);
            return;
          }
          setMensagens((prev) => {
            const u = prev[prev.length - 1];
            if (u && u.role === "assistant") {
              return [...prev.slice(0, -1), { ...u, concluida: true }];
            }
            return prev;
          });
          pararMonitoramento();
          setCarregando(false);
          if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
          }
          return;
        }
      } catch {
        // ignora erros pontuais de conexão
      }
      monitorTimeout = setTimeout(tick, 1000);
    };

    // Primeiro tick imediato, depois a cada 1s
    tick();
  };

  const selecionarSessao = async (id: string) => {
    pararMonitoramento();
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    setSessaoAtivaId(id);
    try {
      const msgs = await fetchApi<ChatMensagem[]>(`/secretario/sessoes/${encodeURIComponent(id)}/mensagens`);
      const lista = Array.isArray(msgs) ? msgs : [];
      setMensagens((prev) => reconciliarMensagens(prev, lista));
      setTimeout(() => scrollFim(true), 50);

      const ult = lista[lista.length - 1];
      const sessaoOcupada = sessoes().find((s) => s.id === id && (s as any).executando);
      const emAndamento = Boolean(sessaoOcupada) || (ult && ult.role === "assistant" && ult.concluida === false);

      if (emAndamento) {
        setCarregando(true);
        const criadoMs = ult?.criado_em ? new Date(ult.criado_em).getTime() : Date.now();
        const decorridoInicial = Math.max(0, Math.floor((Date.now() - criadoMs) / 1000));
        setDecorridoSegundos(decorridoInicial);

        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(() => {
          setDecorridoSegundos((s) => s + 1);
        }, 1000);
        retomarMonitoramento(id);
      } else {
        setCarregando(false);
        if (timerInterval) {
          clearInterval(timerInterval);
          timerInterval = null;
        }
      }
    } catch {
      setMensagens([]);
      setCarregando(false);
    }
  };

  const novaConversa = () => {
    pararMonitoramento();
    if (abortController) {
      abortController.abort();
      setCarregando(false);
    }
    setSessaoAtivaId(null);
    setMensagens([]);
    setInputValor("");
    setAnexos([]);
    showToast("Nova conversa iniciada", "info");
  };

  const excluirSessao = async (id: string) => {
    try {
      await fetchApi(`/secretario/sessoes/${encodeURIComponent(id)}`, { method: "DELETE" });
      setSessoes((prev) => prev.filter((s) => s.id !== id));
      if (sessaoAtivaId() === id) {
        novaConversa();
      }
      showToast("Conversa excluída", "sucesso");
    } catch {
      showToast("Falha ao excluir conversa", "erro");
    }
  };

  const pararStream = () => {
    const sid = sessaoAtivaId();
    if (sid) {
      void fetchApi(`/sessions/${encodeURIComponent(sid)}/abort`, { method: "POST" }).catch(() => null);
      void fetchApi(`/secretario/sessoes/${encodeURIComponent(sid)}/abort`, { method: "POST" }).catch(() => null);
    }
    pararMonitoramento();
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    setCarregando(false);
    setMensagens((prev) => {
      const ult = prev[prev.length - 1];
      if (ult && ult.role === "assistant" && ult.concluida === false) {
        return [...prev.slice(0, -1), { ...ult, concluida: true, content: ult.content || "(interrompido pelo usuário)" }];
      }
      return prev;
    });
    showToast("Agente interrompido com sucesso", "aviso");
  };

  const editarPrompt = async (indice: number) => {
    const m = mensagens()[indice];
    if (!m || m.role !== "user") return;

    pararMonitoramento();
    if (carregando()) {
      pararStream();
    }

    const textoPrompt = m.content || "";
    const indiceGlobal = m.indice_global !== undefined ? m.indice_global : indice;

    // 1. Restaura texto no input e foca imediatamente
    setInputValor(textoPrompt);
    const elTextarea = textareaRef || (document.getElementById("chat-input") as HTMLTextAreaElement | null);
    if (elTextarea) {
      textareaRef = elTextarea;
      elTextarea.value = textoPrompt;
      elTextarea.focus();
      const len = textoPrompt.length;
      try {
        elTextarea.setSelectionRange(len, len);
      } catch {}
      elTextarea.style.height = "auto";
      const scrollH = elTextarea.scrollHeight;
      const novaAltura = Math.max(38, Math.min(scrollH, 220));
      elTextarea.style.height = `${novaAltura}px`;
      elTextarea.style.overflowY = scrollH > 220 ? "auto" : "hidden";
      elTextarea.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    // 2. Trunca no backend se houver sessão ativa usando o índice global correto
    const sid = sessaoAtivaId();
    if (sid) {
      try {
        await fetchApi(`/secretario/sessoes/${encodeURIComponent(sid)}/truncar`, {
          method: "POST",
          body: JSON.stringify({ manter_ate: indiceGlobal }),
        });
      } catch (err: any) {
        showToast("Falha ao truncar no servidor: " + err.message, "aviso");
      }
    }

    // 3. Trunca mensagens localmente (mantém anteriores a este turno)
    ultimoHash = "";
    setMensagens((prev) => prev.slice(0, indice));

    showToast("Prompt restaurado para edição!", "sucesso");
  };

  const adicionarFila = (texto: string, anexosRecebidos?: Anexo[]) => {
    const item: PromptFilaItem = {
      id: `flw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      texto,
      anexos: anexosRecebidos,
      criadoEm: Date.now(),
    };
    setFilaPrompts((prev) => [...prev, item]);
  };

  const removerFila = (id: string) => {
    setFilaPrompts((prev) => prev.filter((i) => i.id !== id));
    showToast("Prompt removido da fila", "info");
  };

  const editarFila = (id: string) => {
    const item = filaPrompts().find((i) => i.id === id);
    if (!item) return;
    setFilaPrompts((prev) => prev.filter((i) => i.id !== id));
    setInputValor(item.texto);
    if (item.anexos) setAnexos(item.anexos);
    const elTextarea = textareaRef || (document.getElementById("chat-input") as HTMLTextAreaElement | null);
    if (elTextarea) {
      textareaRef = elTextarea;
      elTextarea.value = item.texto;
      elTextarea.focus();
      const len = item.texto.length;
      try {
        elTextarea.setSelectionRange(len, len);
      } catch {}
      elTextarea.style.height = "auto";
      const scrollH = elTextarea.scrollHeight;
      const novaAltura = Math.max(38, Math.min(scrollH, 220));
      elTextarea.style.height = `${novaAltura}px`;
      elTextarea.style.overflowY = scrollH > 220 ? "auto" : "hidden";
      elTextarea.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    showToast("Prompt devolvido para edição!", "sucesso");
  };

  const adiantarFila = async (id: string) => {
    const item = filaPrompts().find((i) => i.id === id);
    if (!item) return;
    setFilaPrompts((prev) => prev.filter((i) => i.id !== id));
    if (carregando()) {
      pararStream();
      await new Promise((r) => setTimeout(r, 250));
    }
    setInputValor(item.texto);
    if (item.anexos) setAnexos(item.anexos);
    showToast("Adiantando prompt da fila...", "info");
    await enviarMensagem();
  };

  // Disparo sequencial automático quando o turno atual do assistente terminar
  createEffect(() => {
    const estaCarregando = carregando();
    const fila = filaPrompts();
    if (!estaCarregando && fila.length > 0 && !processandoFila) {
      processandoFila = true;
      const proximo = fila[0];
      setFilaPrompts((prev) => prev.slice(1));
      setTimeout(async () => {
        setInputValor(proximo.texto);
        if (proximo.anexos) setAnexos(proximo.anexos);
        await enviarMensagem();
        processandoFila = false;
      }, 350);
    }
  });

  const enviarMensagem = async () => {
    pararMonitoramento();
    const texto = inputValor().trim();
    const imgs = anexos().map((a) => a.url);
    if (!texto && imgs.length === 0) return;

    // Se havia mensagem do assistente pendente, fecha antes do novo envio
    setMensagens((prev) => {
      const ult = prev[prev.length - 1];
      if (ult && ult.role === "assistant" && ult.concluida === false) {
        return [...prev.slice(0, -1), { ...ult, concluida: true }];
      }
      return prev;
    });

    const sid = sessaoAtivaId();

    // Adiciona mensagem do usuário
    const msgUsuario: ChatMensagem = {
      role: "user",
      content: texto,
      imagens: imgs.length > 0 ? imgs : undefined,
    };

    // Mensagem inicial do assistente com indicador de carregando
    const msgAssistente: ChatMensagem = {
      role: "assistant",
      content: "",
      pensamento: "",
      concluida: false,
      acoes: [],
    };

    setMensagens((prev) => [...prev, msgUsuario, msgAssistente]);
    setInputValor("");
    setAnexos([]);
    setCarregando(true);
    streamingAtivo = true;
    setDecorridoSegundos(0);

    if (sid) {
      try { syncChannel?.postMessage({ tipo: "mensagem_enviada", sessao_id: sid }); } catch {}
    }

    setTimeout(scrollFim, 30);

    timerInterval = setInterval(() => {
      setDecorridoSegundos((s) => s + 1);
    }, 1000);

    abortController = new AbortController();

    try {
      const urlStream = sid
        ? `/secretario/conversa/stream?sessao=${encodeURIComponent(sid)}&workspace=${encodeURIComponent(wsAtivo())}`
        : `/secretario/conversa/stream?workspace=${encodeURIComponent(wsAtivo())}`;

      const corpoEnvio: any = {
        mensagem: texto,
        prompt: texto,
        agente: agente(),
        imagens: imgs,
      };
      if (sid) corpoEnvio.sessao_id = sid;

      const resp = await fetch(urlStream, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(corpoEnvio),
        signal: abortController.signal,
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("Stream indisponível");

      let buffer = "";
      let currentEvent = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const linhas = buffer.split("\n");
        buffer = linhas.pop() ?? "";

        for (const linha of linhas) {
          const trimmed = linha.trim();

          // SSE: "event: <tipo>"
          if (trimmed.startsWith("event: ")) {
            currentEvent = trimmed.slice(7).trim();
            continue;
          }

          // SSE: "data: <json>"
          if (!trimmed.startsWith("data: ")) {
            // Linha vazia = fim do evento SSE (reset)
            if (trimmed === "") currentEvent = "";
            continue;
          }

          const jsonStr = trimmed.slice(6).trim();
          if (jsonStr === "[DONE]") continue;

          try {
            const payload = JSON.parse(jsonStr);
            const evtType = currentEvent || payload.tipo || "";

            // Atualizar sessaoAtivaId com o ID real do servidor
            if (evtType === "inicio" && payload.sessao_id) {
              setSessaoAtivaId(payload.sessao_id);
              try { syncChannel?.postMessage({ tipo: "mensagem_enviada", sessao_id: payload.sessao_id }); } catch {}
            }

            setMensagens((prev) => {
              const ultIdx = prev.length - 1;
              if (ultIdx < 0) return prev;
              const assistente = { ...prev[ultIdx] };

              if (evtType === "status" || evtType === "fallback_modelo") {
                if (payload.aviso) {
                  showToast(payload.aviso, "aviso");
                  const passos = [...(assistente.passos || [])];
                  passos.push({
                    tipo: "texto",
                    texto: `\n> [Aviso] *${payload.aviso}*\n\n`,
                  });
                  assistente.passos = passos;
                }
              } else if (evtType === "passos" && Array.isArray(payload.passos)) {
                // payload.passos é a ordem cronológica fiel gerada pelo backend (pensamento -> acao -> pensamento -> texto)
                assistente.passos = payload.passos;

                const textoPassos = payload.passos
                  .filter((p: any) => p.tipo === "texto")
                  .map((p: any) => p.texto || "")
                  .join("\n\n");
                if (textoPassos) {
                  assistente.content = textoPassos;
                }
              } else if (evtType === "delta") {
                let deltaTxt = payload.delta || payload.texto || "";
                if (deltaTxt.includes("<think>") || deltaTxt.includes("</think>")) {
                  const thinkMatch = /<think>([\s\S]*?)(?:<\/think>|$)/i.exec(deltaTxt);
                  if (thinkMatch) {
                    const pTxt = thinkMatch[1] ?? "";
                    assistente.pensamento = (assistente.pensamento || "") + pTxt;
                    deltaTxt = deltaTxt.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "");
                  }
                }
                if (deltaTxt) {
                  assistente.content += deltaTxt;
                  const passos = [...(assistente.passos || [])];
                  const ultP = passos[passos.length - 1];
                  if (ultP && ultP.tipo === "texto") {
                    if (!ultP.texto?.endsWith(deltaTxt)) {
                      ultP.texto = (ultP.texto || "") + deltaTxt;
                    }
                  } else {
                    passos.push({ tipo: "texto", texto: deltaTxt });
                  }
                  assistente.passos = passos;
                }
              } else if (evtType === "pensamento") {
                const deltaTxt = payload.delta || payload.pensamento || payload.texto || "";
                if (deltaTxt) {
                  assistente.pensamento = (assistente.pensamento || "") + deltaTxt;
                  const passos = [...(assistente.passos || [])];
                  const ultP = passos[passos.length - 1];
                  // Anexa ao ÚLTIMO passo de pensamento ativo, ou cria novo passo sem agrupar tudo no primeiro
                  if (ultP && ultP.tipo === "pensamento") {
                    if (!ultP.texto?.endsWith(deltaTxt)) {
                      ultP.texto = (ultP.texto || "") + deltaTxt;
                    }
                  } else {
                    passos.push({ tipo: "pensamento", texto: deltaTxt });
                  }
                  assistente.passos = passos;
                }
              } else if (evtType === "acao") {
                const passos = [...(assistente.passos || [])];
                if (Array.isArray(payload.itens) && payload.itens.length > 0) {
                  for (const item of payload.itens) {
                    passos.push({
                      tipo: "acao",
                      ferramenta: item.ferramenta || item.tool || "ferramenta",
                      resumo: item.resumo || item.summary || "executando...",
                      sucesso: item.sucesso !== false,
                    });
                  }
                } else if (payload.ferramenta) {
                  passos.push({
                    tipo: "acao",
                    ferramenta: payload.ferramenta,
                    resumo: payload.resumo || "executando...",
                    sucesso: payload.sucesso !== false,
                  });
                }
                assistente.passos = passos;
              } else if (evtType === "hitl") {
                assistente.hitl = payload.hitl || payload;
              } else if (evtType === "fim") {
                assistente.concluida = true;
                if (payload.resposta && !assistente.content) {
                  assistente.content = payload.resposta;
                }
              } else if (evtType === "erro") {
                assistente.concluida = true;
                const msgErro = payload.erro || payload.mensagem || "Erro desconhecido";
                showToast(`Erro no Secretário: ${msgErro}`, "erro");
                assistente.content = assistente.content
                  ? `${assistente.content}\n\n> **Erro no Secretário**: ${msgErro}`
                  : `> **Erro no Secretário**: ${msgErro}`;
              }

              return [...prev.slice(0, ultIdx), assistente];
            });

            scrollFim(false);
          } catch {}

          currentEvent = "";
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        showToast("Erro na comunicação com o modelo: " + err.message, "erro");
        setMensagens((prev) => {
          const ultIdx = prev.length - 1;
          if (ultIdx < 0) return prev;
          const assistente = { ...prev[ultIdx], concluida: true, content: prev[ultIdx].content || `(erro: ${err.message})` };
          return [...prev.slice(0, ultIdx), assistente];
        });
      }
    } finally {
      streamingAtivo = false;
      abortController = null;
      void carregarSessoes();
      const sidFinal = sessaoAtivaId();
      if (sidFinal) {
        try { syncChannel?.postMessage({ tipo: "mensagem_concluida", sessao_id: sidFinal }); } catch {}
        void fetchApi<ChatMensagem[]>(`/secretario/sessoes/${encodeURIComponent(sidFinal)}/mensagens`)
          .then((msgsFinais) => {
            if (Array.isArray(msgsFinais) && msgsFinais.length > 0) {
              setMensagens((prev) => reconciliarMensagens(prev, msgsFinais));
              const ult = msgsFinais[msgsFinais.length - 1];
              if (ult && (ult.concluida === false || ult.role === "user")) {
                retomarMonitoramento(sidFinal);
                return;
              }
            }
            if (timerInterval) {
              clearInterval(timerInterval);
              timerInterval = null;
            }
            setCarregando(false);
          })
          .catch(() => {
            if (timerInterval) {
              clearInterval(timerInterval);
              timerInterval = null;
            }
            setCarregando(false);
          });
      } else {
        if (timerInterval) {
          clearInterval(timerInterval);
          timerInterval = null;
        }
        setCarregando(false);
      }
    }
  };

  const aprovarHitl = async (hitlId: string) => {
    try {
      await fetchApi(`/secretario/hitl/${encodeURIComponent(hitlId)}/aprovar`, { method: "POST" });
      showToast("Ação autorizada com sucesso", "sucesso");
      setMensagens((prev) =>
        prev.map((m) => (m.hitl?.id === hitlId ? { ...m, hitl: undefined } : m))
      );
    } catch (err: any) {
      showToast("Erro ao aprovar ação: " + err.message, "erro");
    }
  };

  const rejeitarHitl = async (hitlId: string, motivo: string) => {
    try {
      await fetchApi(`/secretario/hitl/${encodeURIComponent(hitlId)}/rejeitar`, {
        method: "POST",
        body: JSON.stringify({ motivo }),
      });
      showToast("Ação rejeitada", "info");
      setMensagens((prev) =>
        prev.map((m) => (m.hitl?.id === hitlId ? { ...m, hitl: undefined } : m))
      );
    } catch (err: any) {
      showToast("Erro ao rejeitar ação: " + err.message, "erro");
    }
  };

  onMount(() => {
    void carregarSessoes();
    void carregarAgentesEMotores();

    // Sincronização entre abas gêmeas via BroadcastChannel
    if (syncChannel) {
      syncChannel.onmessage = (ev) => {
        const d = ev.data;
        if (!d) return;
        if (d.sessao_id && d.sessao_id === sessaoAtivaId()) {
          if (!streamingAtivo) {
            retomarMonitoramento(d.sessao_id);
          }
        } else if (d.tipo === "nova_sessao" || d.tipo === "sessao_deletada") {
          void carregarSessoes();
        }
      };
    }

    // Ao focar na aba, recarrega mensagens caso tenham chegado da outra guia
    const onFoco = () => {
      const sid = sessaoAtivaId();
      if (sid && !streamingAtivo) {
        void fetchApi<ChatMensagem[]>(`/secretario/sessoes/${encodeURIComponent(sid)}/mensagens`)
          .then((msgs) => {
            if (Array.isArray(msgs) && msgs.length > 0) {
              setMensagens((prev) => reconciliarMensagens(prev, msgs));
              const ult = msgs[msgs.length - 1];
              if (ult && (ult.concluida === false || ult.role === "user")) {
                retomarMonitoramento(sid);
              }
            }
          })
          .catch(() => null);
      }
    };
    window.addEventListener("focus", onFoco);

    // Evento SSE do servidor disparado por outra aba ou processo
    const onSseSecretario = (e: Event) => {
      const d = (e as CustomEvent).detail;
      const sid = d?.dados?.sessao_id || d?.sessao_id;
      if (sid && sid === sessaoAtivaId() && !streamingAtivo) {
        retomarMonitoramento(sid);
      }
    };
    window.addEventListener("secretario:mensagem", onSseSecretario);

    onCleanup(() => {
      window.removeEventListener("focus", onFoco);
      window.removeEventListener("secretario:mensagem", onSseSecretario);
      if (syncChannel) {
        try { syncChannel.close(); } catch {}
      }
    });
  });

  createEffect(() => {
    void wsAtivo();
    void carregarSessoes();
    void carregarAgentesEMotores();
  });

  onCleanup(() => {
    pararMonitoramento();
    if (abortController) abortController.abort();
    if (timerInterval) clearInterval(timerInterval);
  });

  const decorridoFmt = () => {
    const s = decorridoSegundos();
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  return (
    <div class="flex flex-col h-full w-full overflow-hidden bg-zinc-950 relative">
      <UniversalChat
        mensagens={mensagens()}
        carregando={carregando()}
        agente={{
          id: agente(),
          nome: agente(),
          modelo: modeloConfig() || "opencode-go/glm-5.3-flash",
          status: carregando() ? "executando" : undefined,
        }}
        decorridoFmt={decorridoFmt()}
        podeEnviarPrompt={true}
        valorPrompt={inputValor()}
        onValorPromptChange={setInputValor}
        refTextarea={(el) => {
          textareaRef = el;
        }}
        onEnviarPrompt={async (texto, anexosRecebidos) => {
          if (anexosRecebidos) setAnexos(anexosRecebidos);
          setInputValor(texto);
          await enviarMensagem();
        }}
        onEditarPrompt={editarPrompt}
        filaPrompts={filaPrompts()}
        onAdicionarFila={adicionarFila}
        onRemoverFila={removerFila}
        onEditarFila={editarFila}
        onAdiantarFila={adiantarFila}
        onAprovarHitl={aprovarHitl}
        onRejeitarHitl={rejeitarHitl}
        onNovaSessao={novaConversa}
        onAbrirHistorico={() => setHistoricoAberto(true)}
        onAbrirConfiguracoes={abrirPainelLateral}
        onParar={pararStream}
        sugestoesRapidas={SUGESTOES.map((s) => ({ rotulo: s, prompt: s }))}
        iframeConfig={{
          habilitado: true,
          aberto: false,
        }}
      />

      {/* Modal Popup de Histórico */}
      <HistoricoModal
        open={historicoAberto()}
        onOpenChange={setHistoricoAberto}
        sessoes={sessoes()}
        sessaoAtivaId={sessaoAtivaId()}
        onSelecionarSessao={selecionarSessao}
        onNovaConversa={novaConversa}
        onExcluirSessao={excluirSessao}
      />

      {/* Drawer Lateral de Configuração de Agente / Motor / Modelo */}
      <Show when={configLateralAberta()}>
        <div
          class="fixed inset-0 bg-black/60 z-40 backdrop-blur-xs transition-opacity"
          onClick={() => setConfigLateralAberta(false)}
        />
        <aside
          data-testid="drawer-lateral-config"
          class="fixed inset-y-0 right-0 w-80 sm:w-96 bg-zinc-950/95 border-l border-zinc-800/80 shadow-2xl z-50 flex flex-col backdrop-blur-md animate-in slide-in-from-right duration-200"
        >
          {/* Header do Drawer */}
          <div class="h-12 px-4 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-900/40 select-none">
            <div class="flex items-center gap-2">
              <Cpu size={16} class="text-emerald-400" />
              <span class="font-semibold text-sm text-zinc-100">Configurar Motor & Modelo</span>
            </div>
            <IconButton
              size="sm"
              variant="ghost"
              onClick={() => setConfigLateralAberta(false)}
              title="Fechar painel"
            >
              <X size={15} />
            </IconButton>
          </div>

          {/* Conteúdo rolável */}
          <div class="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin text-xs">
            {/* Escolha do Agente */}
            <div class="space-y-1.5">
              <label class="font-medium text-zinc-300 block">Agente do Workspace</label>
              <select
                class="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500/80 cursor-pointer"
                value={agenteConfig()}
                onChange={(e) => aoMudarAgenteConfig(e.currentTarget.value)}
              >
                <For each={listaAgentes()}>
                  {(ag) => (
                    <option value={ag.id}>
                      {ag.id} — {ag.role || ag.id} ({ag.harness || (ag as any).engine || "opencode"})
                    </option>
                  )}
                </For>
              </select>
              <p class="text-[11px] text-zinc-500">
                Selecione o agente que deseja inspecionar ou direcionar as ordens do chat.
              </p>
            </div>

            {/* Escolha do Motor de Execução */}
            <div class="space-y-2">
              <label class="font-medium text-zinc-300 block">Motor de Execução (Harness)</label>
              <div class="grid grid-cols-1 gap-2">
                <For
                  each={[
                    {
                      id: "opencode",
                      nome: "OpenCode Engine",
                      desc: "Daemon e CLI nativos do OpenCode",
                      alias: "opencode",
                    },
                    {
                      id: "antigravity",
                      nome: "Google Antigravity (AGY)",
                      desc: "CLI isolada com suporte a skills e MCP",
                      alias: "agy",
                    },
                    {
                      id: "copilot",
                      nome: "GitHub Copilot CLI",
                      desc: "Runtime autônomo com tokens PAT/OAuth",
                      alias: "copilot",
                    },
                    {
                      id: "claude-code",
                      nome: "Claude Code CLI",
                      desc: "Motor Anthropic CLI para tarefas de código",
                      alias: "claude",
                    },
                  ]}
                >
                  {(mot) => {
                    const ativo = () => motorConfig() === mot.id;
                    const inst = () => {
                      const enc = listaMotores().find((m) => m.id === mot.id);
                      return enc ? enc.installed : true;
                    };
                    return (
                      <button
                        type="button"
                        onClick={() => aoMudarMotorConfig(mot.id)}
                        class={`p-2.5 rounded-lg border text-left transition-all cursor-pointer flex items-start justify-between ${
                          ativo()
                            ? "bg-emerald-950/30 border-emerald-500/80 text-emerald-200 shadow-sm"
                            : "bg-zinc-900/60 border-zinc-800/80 hover:bg-zinc-850 hover:border-zinc-700 text-zinc-300"
                        }`}
                      >
                        <div class="space-y-0.5">
                          <div class="flex items-center gap-1.5 font-medium">
                            <span>{mot.nome}</span>
                            <span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400">
                              {mot.alias}
                            </span>
                          </div>
                          <div class="text-[11px] text-zinc-400 leading-tight">{mot.desc}</div>
                        </div>
                        <div class="flex items-center gap-1">
                          <span
                            class={`h-2 w-2 rounded-full ${
                              inst() ? "bg-emerald-400" : "bg-zinc-600"
                            }`}
                            title={inst() ? "Motor instalado" : "Não detectado"}
                          />
                          <Show when={ativo()}>
                            <Check size={14} class="text-emerald-400 ml-1" />
                          </Show>
                        </div>
                      </button>
                    );
                  }}
                </For>
              </div>
            </div>

            {/* Modelo Principal */}
            <div class="space-y-1.5">
              <label class="font-medium text-zinc-300 block">Modelo Principal</label>
              <input
                type="text"
                class="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-emerald-500/80"
                placeholder="ex.: google/gemini-3.8-flash-high ou gpt-4o"
                value={modeloConfig()}
                onInput={(e) => setModeloConfig(e.currentTarget.value)}
              />

              {/* Sugestões Rápidas de Modelos */}
              <div class="flex flex-wrap gap-1 pt-1">
                <For each={modelosSugeridos[motorConfig()] || []}>
                  {(mod) => (
                    <button
                      type="button"
                      onClick={() => setModeloConfig(mod)}
                      class="px-2 py-0.5 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-[10px] font-mono text-zinc-300 border border-zinc-700/60 cursor-pointer transition-colors"
                    >
                      {mod.split("/").pop()}
                    </button>
                  )}
                </For>
              </div>
            </div>

            {/* Rotação e Fallback de Modelos */}
            <div class="space-y-1.5">
              <label class="font-medium text-zinc-300 block">
                Rotação / Fallback de Modelos
              </label>
              <textarea
                rows={3}
                class="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-emerald-500/80 scrollbar-thin resize-none"
                placeholder="1 modelo por linha para rotação de fallback"
                value={rotacaoConfig()}
                onInput={(e) => setRotacaoConfig(e.currentTarget.value)}
              />
              <p class="text-[11px] text-zinc-500">
                Modelos acionados automaticamente caso o principal atinja limites de quota ou erro.
              </p>
            </div>

            {/* Área de Teste de Conexão */}
            <div class="pt-2 border-t border-zinc-800/80 space-y-2">
              <div class="flex items-center justify-between">
                <span class="font-medium text-zinc-300">Diagnóstico de Conectividade</span>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={testarMotorConexao}
                  disabled={testandoMotor()}
                >
                  <Show when={testandoMotor()} fallback={<Play size={12} class="mr-1 text-emerald-400" />}>
                    <RefreshCw size={12} class="mr-1 animate-spin text-emerald-400" />
                  </Show>
                  {testandoMotor() ? "Testando..." : "Testar Conexão"}
                </Button>
              </div>

              <Show when={resultadoTeste()}>
                <div
                  class={`p-2.5 rounded-lg border text-xs flex items-start gap-2 ${
                    resultadoTeste()!.ok
                      ? "bg-emerald-950/20 border-emerald-800/60 text-emerald-300"
                      : "bg-rose-950/20 border-rose-800/60 text-rose-300"
                  }`}
                >
                  <Show
                    when={resultadoTeste()!.ok}
                    fallback={<AlertCircle size={15} class="shrink-0 mt-0.5 text-rose-400" />}
                  >
                    <Check size={15} class="shrink-0 mt-0.5 text-emerald-400" />
                  </Show>
                  <div class="space-y-0.5">
                    <p class="font-medium">{resultadoTeste()!.msg}</p>
                    <Show when={resultadoTeste()!.latencyMs !== undefined}>
                      <p class="text-[10px] text-zinc-400 font-mono">
                        Latência: {resultadoTeste()!.latencyMs}ms
                      </p>
                    </Show>
                  </div>
                </div>
              </Show>
            </div>
          </div>

          {/* Rodapé de Ações */}
          <div class="p-3 border-t border-zinc-800/80 flex items-center justify-between gap-2 bg-zinc-900/60">
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setConfigLateralAberta(false)}
            >
              Cancelar
            </Button>
            <div class="flex items-center gap-1.5">
              <Button
                size="xs"
                variant="secondary"
                onClick={() => {
                  setAgente(agenteConfig() as any);
                  showToast(`Secretário direcionado para @${agenteConfig()}`, "info");
                  setConfigLateralAberta(false);
                }}
                title="Apenas direciona o chat atual para este agente"
              >
                Aplicar ao Chat
              </Button>
              <Button
                size="xs"
                variant="primary"
                onClick={salvarConfigLateral}
                disabled={salvandoConfig()}
              >
                <Show when={salvandoConfig()} fallback={<Check size={13} class="mr-1" />}>
                  <RefreshCw size={13} class="mr-1 animate-spin" />
                </Show>
                {salvandoConfig() ? "Salvando..." : "Salvar no Agente"}
              </Button>
            </div>
          </div>
        </aside>
      </Show>
    </div>
  );
};
