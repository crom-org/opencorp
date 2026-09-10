import { type Component, createSignal, createEffect, onMount, onCleanup, For, Show } from "solid-js";
import {
  DollarSign,
  Bot,
  CheckSquare,
  MessageSquare,
  AlertCircle,
  ExternalLink,
  PlayCircle,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  ArrowRight,
  Terminal,
  Activity,
  ShieldAlert,
  GitBranch,
  Calendar,
  Send,
  Plus,
  Play,
  RotateCcw,
  Check,
  X,
  Clock,
  Timer,
  ListTodo,
  Radio,
  Zap,
  ChevronLeft,
  ChevronRight,
  EyeOff,
} from "lucide-solid";
import { A, useNavigate } from "@solidjs/router";
import { fetchApi, wsAtivo, setWsAtivo, workspaces } from "../lib/context";
import { HomeZeroState } from "../components/HomeZeroState";
import { descreverCron } from "../lib/cron-helper";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { showToast } from "../ui/Toast";

function formatarContagem(ms: number): string {
  if (ms <= 0) return "agora / a qualquer instante";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const seg = s % 60;
  const p2 = (n: number): string => String(n).padStart(2, "0");
  if (d > 0) return `em ${d}d ${p2(h)}h ${p2(m)}m`;
  return `em ${p2(h)}:${p2(m)}:${p2(seg)}`;
}

function formatarDecorrido(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const seg = s % 60;
  const p2 = (n: number): string => String(n).padStart(2, "0");
  if (d > 0) return `+${d}d ${p2(h)}:${p2(m)}:${p2(seg)}`;
  return `+${p2(m)}:${p2(seg)}`;
}

export const HomeView: Component = () => {
  const navigate = useNavigate();
  const [agoraMs, setAgoraMs] = createSignal(Date.now());

  const [metricas, setMetricas] = createSignal<any>({
    custoHoje: "US$ 0.0000",
    custoTeto: "US$ 5.00",
    tasksPendentes: 0,
    tasksVencidas: 0,
    agentesAtivos: 0,
    fluxosAtivos: 0,
    schedulerOk: true,
    secretarioOk: true,
  });

  const [schedules, setSchedules] = createSignal<any[]>([]);
  const [execucoes, setExecucoes] = createSignal<any[]>([]);
  const [executandoAgora, setExecutandoAgora] = createSignal<any | null>(null);
  const [aprovacoes, setAprovacoes] = createSignal<any[]>([]);
  const [tasksEmAberto, setTasksEmAberto] = createSignal<any[]>([]);
  const [todasTasks, setTodasTasks] = createSignal<any[]>([]);
  const [agentes, setAgentes] = createSignal<any[]>([]);
  const [sessoesSecretario, setSessoesSecretario] = createSignal<any[]>([]);
  const [fluxos, setFluxos] = createSignal<any[]>([]);

  const abaInicial = () => {
    try {
      const p = new URLSearchParams(window.location.search).get("aba");
      if (p && ["geral", "aovivo", "secretario", "tasks", "falhas", "agendamentos", "fluxos"].includes(p)) {
        return p as any;
      }
    } catch {}
    return "geral";
  };
  const [abaAtiva, setAbaAtivaRaw] = createSignal<"geral" | "aovivo" | "secretario" | "tasks" | "falhas" | "agendamentos" | "fluxos">(abaInicial());
  const setAbaAtiva = (a: any) => {
    setAbaAtivaRaw(a);
    try {
      const u = new URL(window.location.href);
      if (a === "geral") u.searchParams.delete("aba");
      else u.searchParams.set("aba", a);
      window.history.replaceState({}, "", u.toString());
    } catch {}
  };

  const LISTA_ABAS_CHAVES = ["geral", "aovivo", "secretario", "tasks", "falhas", "agendamentos", "fluxos"] as const;

  const mudarAbaOffset = (delta: number) => {
    const atualIdx = LISTA_ABAS_CHAVES.indexOf(abaAtiva() as any);
    if (atualIdx === -1) return;
    const novoIdx = Math.max(0, Math.min(LISTA_ABAS_CHAVES.length - 1, atualIdx + delta));
    if (novoIdx !== atualIdx) {
      setAbaAtiva(LISTA_ABAS_CHAVES[novoIdx]);
    }
  };

  let touchStartX = 0;
  let touchStartY = 0;
  const onTouchStart = (e: TouchEvent) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const diffX = e.changedTouches[0].screenX - touchStartX;
    const diffY = e.changedTouches[0].screenY - touchStartY;
    // Se movimento horizontal predominante for > 50px, troca de view via swipe
    if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY) * 1.4) {
      if (diffX < 0) {
        mudarAbaOffset(1); // Swipe para a esquerda -> próxima view
      } else {
        mudarAbaOffset(-1); // Swipe para a direita -> view anterior
      }
    }
  };

  // Escuta troca de workspace e recarrega dados imediatamente
  createEffect(() => {
    wsAtivo();
    void carregarDadosHome();
  });

  // Mantém a aba ativa centralizada no swiper de abas
  createEffect(() => {
    const ativa = abaAtiva();
    if (abasRef) {
      const el = abasRef.querySelector(`[data-tab="${ativa}"]`) as HTMLElement;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    }
  });

  const tasksEmAndamento = () => todasTasks().filter((t: any) =>
    t.coluna === "fazendo" || t.coluna === "em_andamento" || t.coluna === "in_progress"
  );

  // Falhas ignoradas (persiste em localStorage)
  const obterFalhasIgnoradas = (): Set<string> => {
    try {
      if (typeof window === "undefined" || !window.localStorage) return new Set<string>();
      const raw = localStorage.getItem("opencorp:falhas_ignoradas");
      return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  };

  const [falhasIgnoradas, setFalhasIgnoradas] = createSignal<Set<string>>(obterFalhasIgnoradas());
  const ignorarFalha = (id: string) => {
    setFalhasIgnoradas((prev) => {
      const base = prev instanceof Set ? prev : new Set<string>();
      const next = new Set<string>(base);
      next.add(id);
      try { localStorage.setItem("opencorp:falhas_ignoradas", JSON.stringify([...next])); } catch {}
      return next;
    });
  };
  const execucoesFalhas = () => {
    const fi = falhasIgnoradas();
    const set = fi instanceof Set ? fi : new Set<string>();
    return execucoes().filter((e: any) => e.status === "falhou" && !set.has(e.id));
  };

  // Ref do container de abas para scroll com setas
  let abasRef: HTMLDivElement | undefined;

  const repetirExecucao = async (exec: any) => {
    try {
      if (exec.gatilho_origem && exec.gatilho_tipo === "cron") {
        await fetchApi(`/schedules/${encodeURIComponent(exec.gatilho_origem)}/run`, { method: "POST" });
        showToast(`Job ${exec.gatilho_origem} redisparado com sucesso!`, "sucesso");
      } else {
        await fetchApi("/agents/run", {
          method: "POST",
          body: JSON.stringify({ agente: exec.agente, ordem: exec.ordem }),
        });
        showToast(`Agente @${exec.agente} acionado novamente!`, "sucesso");
      }
      void carregarDadosHome();
    } catch (err: any) {
      showToast(`Erro ao repetir: ${err.message}`, "erro");
    }
  };

  // Linha de Comando Inline
  const [comando, setComando] = createSignal("");
  const [executandoComando, setExecutandoComando] = createSignal(false);
  const [saidaComando, setSaidaComando] = createSignal<string | null>(null);

  // Modal de Criação de Tarefa Direto na Home
  const [modalNovaTask, setModalNovaTask] = createSignal(false);
  const [novoTitulo, setNovoTitulo] = createSignal("");
  const [novaDescricao, setNovaDescricao] = createSignal("");
  const [novaPrioridade, setNovaPrioridade] = createSignal("media");
  const [novoResponsavel, setNovoResponsavel] = createSignal("");
  const [criandoTask, setCriandoTask] = createSignal(false);

  let ticker1s: any = null;
  let polling5s: any = null;

  const carregarDadosHome = async () => {
    if (!wsAtivo()) return;
    try {
      const [tasks, ags, flows, aprovs, budget, status, jobs, rExecs, sSec] = await Promise.allSettled([
        fetchApi<any[]>("/tasks"),
        fetchApi<any[]>("/agents"),
        fetchApi<any[]>("/flows"),
        fetchApi<any[]>("/approvals"),
        fetchApi<any>("/budget/status"),
        fetchApi<any>("/status"),
        fetchApi<any[]>("/schedules"),
        fetchApi<any[]>("/execucoes?limite=30"),
        fetchApi<any[]>("/secretario/sessoes"),
      ]);

      const getVal = <T>(r: PromiseSettledResult<T>, def: T): T => (r.status === "fulfilled" && r.value != null ? r.value : def);

      const dTasks = Array.isArray(getVal(tasks, [])) ? getVal(tasks, []) : [];
      const dAgentes = Array.isArray(getVal(ags, [])) ? getVal(ags, []) : [];
      const dFlows = Array.isArray(getVal(flows, [])) ? getVal(flows, []) : [];
      const dAprovs = Array.isArray(getVal(aprovs, [])) ? getVal(aprovs, []) : [];
      const dBudget = getVal(budget, null);
      const dStatus = getVal(status, null);
      const dJobs = Array.isArray(getVal(jobs, [])) ? getVal(jobs, []) : [];
      const dExecs = Array.isArray(getVal(rExecs, [])) ? getVal(rExecs, []) : [];

      setTodasTasks(dTasks);
      setAgentes(dAgentes);
      setSchedules(dJobs);
      setExecucoes(dExecs);
      setFluxos(dFlows);
      setSessoesSecretario(Array.isArray(getVal(sSec, [])) ? getVal(sSec, []) : []);

      // Identificar se há algum agente executando agora (background run OU Secretário Executivo)
      const secSessoes = Array.isArray(getVal(sSec, [])) ? getVal(sSec, []) : [];
      const secExec = secSessoes.find((s: any) => s.executando || s.status === "executando") || dStatus?.secretario_executando;
      const emAndamento = dExecs.find((e: any) => e.status === "executando") || (secExec ? {
        id: secExec.id,
        agente: secExec.agent || secExec.agente || "secretario-exec",
        inicio: secExec.time?.updated ? new Date(secExec.time.updated).toISOString() : secExec.inicio || new Date().toISOString(),
        ordem: secExec.titulo_real || secExec.title || secExec.titulo || "Conversa com Secretário Executivo em andamento",
        status: "executando",
        tipo: "secretario",
      } : null);
      setExecutandoAgora(emAndamento || null);

      const hoje = new Date().toISOString().slice(0, 10);
      const vencidas = dTasks.filter(
        (t: any) => t.coluna !== "feito" && t.due && String(t.due).slice(0, 10) < hoje
      ).length;

      // Custo: pega do budget ou calcula das últimas execuções
      let custoStr = "US$ 0.0000";
      if (dBudget?.estado?.workspace_usd_hoje !== undefined) {
        custoStr = `US$ ${Number(dBudget.estado.workspace_usd_hoje).toFixed(4)}`;
      } else {
        const custoExecs = dExecs
          .filter((e: any) => e.custo_usd && e.inicio && String(e.inicio).slice(0, 10) === hoje)
          .reduce((acc: number, e: any) => acc + Number(e.custo_usd || 0), 0);
        if (custoExecs > 0) custoStr = `US$ ${custoExecs.toFixed(4)}`;
      }

      setMetricas({
        custoHoje: custoStr,
        custoTeto: dBudget?.limites?.daily_usd ? `US$ ${Number(dBudget.limites.daily_usd).toFixed(2)}` : "US$ 5.00",
        tasksPendentes: dTasks.filter((t: any) => t.coluna !== "feito").length,
        tasksVencidas: vencidas,
        agentesAtivos: dAgentes.filter((a: any) => a.ativo !== false).length,
        fluxosAtivos: dFlows.length,
        schedulerOk: dStatus?.scheduler ?? true,
        secretarioOk: dStatus?.secretario ?? true,
      });

      // Aprovações pendentes
      setAprovacoes(dAprovs.filter((a: any) => a.status === "pendente"));

      // Tasks em aberto (máx 6)
      setTasksEmAberto(dTasks.filter((t: any) => t.coluna !== "feito").slice(0, 6));
    } catch {}
  };

  const enviarComando = async () => {
    const cmd = comando().trim();
    if (!cmd) return;
    setExecutandoComando(true);
    setSaidaComando(null);

    try {
      if (cmd.startsWith("!")) {
        const bashCmd = cmd.slice(1).trim();
        const res = await fetchApi<any>("/terminal/exec", {
          method: "POST",
          body: JSON.stringify({ comando: bashCmd }),
        });
        setSaidaComando(res?.saida || "Comando executado sem saída.");
        setComando("");
      } else {
        navigate(`/secretario?ordem=${encodeURIComponent(cmd)}`);
      }
    } catch (err: any) {
      setSaidaComando(`Erro: ${err.message}`);
    } finally {
      setExecutandoComando(false);
    }
  };

  const criarNovaTask = async () => {
    const titulo = novoTitulo().trim();
    if (!titulo) {
      showToast("Título é obrigatório", "aviso");
      return;
    }
    setCriandoTask(true);
    try {
      await fetchApi("/tasks", {
        method: "POST",
        body: JSON.stringify({
          titulo,
          descricao: novaDescricao().trim(),
          coluna: "backlog",
          prioridade: novaPrioridade(),
          responsavel: novoResponsavel().trim() || undefined,
        }),
      });

      setNovoTitulo("");
      setNovaDescricao("");
      setModalNovaTask(false);
      showToast("Tarefa criada com sucesso!", "sucesso");
      void carregarDadosHome();
    } catch (err: any) {
      showToast(`Erro ao criar tarefa: ${err.message}`, "erro");
    } finally {
      setCriandoTask(false);
    }
  };

  const responderAprovacao = async (id: string, aprovar: boolean) => {
    try {
      const endpoint = aprovar ? `/approvals/${id}/approve` : `/approvals/${id}/reject`;
      await fetchApi(endpoint, { method: "POST" });
      showToast(aprovar ? "Aprovação concedida com sucesso!" : "Ação rejeitada.", aprovar ? "sucesso" : "aviso");
      void carregarDadosHome();
    } catch (err: any) {
      showToast(`Erro ao responder aprovação: ${err.message}`, "erro");
    }
  };

  const dispararJobAgora = async (id: string) => {
    try {
      await fetchApi(`/schedules/${encodeURIComponent(id)}/run`, { method: "POST" });
      showToast("Execução manual disparada com sucesso!", "sucesso");
      void carregarDadosHome();
    } catch (err: any) {
      showToast(`Erro ao disparar job: ${err.message}`, "erro");
    }
  };

  const extrairAgenteJob = (args: any) => {
    if (Array.isArray(args) && args[0] === "agent" && args[1] === "run") {
      return args[2];
    }
    return "agente";
  };

  // Lista ordenada das próximas rotinas (futuras)
  const jobsASeguir = () => {
    const now = agoraMs();
    return schedules()
      .filter((j: any) => j.ativo !== false && j.proxima_exec)
      .map((j: any) => {
        const diff = new Date(j.proxima_exec).getTime() - now;
        return {
          ...j,
          diffMs: diff,
          agente: extrairAgenteJob(j.args),
        };
      })
      .filter((j: any) => j.diffMs >= -5000) // apenas futuras ou disparando agora
      .sort((a: any, b: any) => a.diffMs - b.diffMs);
  };

  const proximoImediato = () => {
    const lista = jobsASeguir();
    return lista.length > 0 ? lista[0] : null;
  };

  onMount(() => {
    if (wsAtivo()) {
      void carregarDadosHome();
    }

    // 1. Ticker de 1s para o relógio e cronômetros
    ticker1s = setInterval(() => {
      setAgoraMs(Date.now());
    }, 1000);

    // 2. Polling inteligente a cada 5s para sincronizar status sem recarregar tela
    polling5s = setInterval(() => {
      if (wsAtivo()) {
        void carregarDadosHome();
      }
    }, 5000);
  });

  createEffect(() => {
    if (wsAtivo()) {
      void carregarDadosHome();
    }
  });

  onCleanup(() => {
    if (ticker1s) clearInterval(ticker1s);
    if (polling5s) clearInterval(polling5s);
  });

  return (
    <Show when={wsAtivo()} fallback={<HomeZeroState workspaces={workspaces()} />}>
      <div
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        class="h-full w-full overflow-y-auto p-6 space-y-6 scrollbar-thin bg-zinc-950"
      >
      {/* Top Header com Ações Rápidas */}
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-xl font-bold text-zinc-100 tracking-tight">Painel de Operações</h1>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950 border border-emerald-800/80 text-emerald-400">
              {wsAtivo() || "global"}
            </span>
          </div>
          <p class="text-xs text-zinc-400 mt-0.5">
            Visão geral da empresa, saúde dos agentes e controle em tempo real. Deslize ou clique nas abas para navegar.
          </p>
        </div>

        <div class="flex items-center gap-2 flex-wrap">
          <Button size="xs" variant="primary" onClick={() => setModalNovaTask(true)}>
            <Plus size={13} class="mr-1" /> Nova Task
          </Button>
          <Button size="xs" variant="secondary" onClick={() => navigate("/secretario")}>
            <Play size={13} class="mr-1" /> Falar com Secretário
          </Button>
          <Button size="xs" variant="ghost" onClick={carregarDadosHome} title="Atualizar dados">
            <RotateCcw size={13} />
          </Button>
        </div>
      </div>

      {/* Abas da Central de Operações — Swiper Horizontal Touch-Friendly */}
      <div class="relative pb-2 border-b border-zinc-800/80">
        {/* Seta esquerda */}
        <button
          type="button"
          class="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-1 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/80 transition-colors cursor-pointer bg-zinc-950/80 backdrop-blur-xs shadow-md"
          onClick={() => abasRef?.scrollBy({ left: -200, behavior: "smooth" })}
          title="Rolar abas para a esquerda"
        >
          <ChevronLeft size={16} />
        </button>

        {/* Container scroll horizontal com snap */}
        <div
          ref={abasRef}
          class="flex items-center gap-1.5 overflow-x-auto scrollbar-none px-7 scroll-smooth"
          style={{ "-webkit-overflow-scrolling": "touch", "scroll-snap-type": "x proximity" }}
        >
          <For each={[
            { key: "geral", label: "Visão Geral", icon: () => <Activity size={13} class="text-zinc-400" />, badge: null },
            { key: "aovivo", label: "Ao Vivo", icon: () => <Radio size={13} class={executandoAgora() ? "text-emerald-400 animate-pulse" : "text-zinc-400"} />, badge: executandoAgora() ? () => <span class="h-2 w-2 rounded-full bg-emerald-400 animate-ping flex-shrink-0" /> : null },
            { key: "secretario", label: "Secretário", icon: () => <Bot size={13} class="text-purple-400" />, badge: () => <span class="text-[10px] font-mono text-zinc-500">{sessoesSecretario().length}</span> },
            { key: "tasks", label: "Tasks", icon: () => <CheckSquare size={13} class="text-amber-400" />, badge: () => <span class="text-[10px] font-mono text-zinc-500">{tasksEmAndamento().length}</span> },
            { key: "falhas", label: "Falhas", icon: () => <AlertTriangle size={13} class={execucoesFalhas().length > 0 ? "text-rose-400" : "text-zinc-400"} />, badge: execucoesFalhas().length > 0 ? () => <span class="text-[10px] font-mono text-rose-400">{execucoesFalhas().length}</span> : null },
            { key: "agendamentos", label: "Agendamentos", icon: () => <Timer size={13} class="text-emerald-400" />, badge: () => <span class="text-[10px] font-mono text-zinc-500">{schedules().length}</span> },
            { key: "fluxos", label: "Fluxos", icon: () => <GitBranch size={13} class="text-indigo-400" />, badge: () => <span class="text-[10px] font-mono text-zinc-500">{fluxos().length}</span> },
          ] as Array<{ key: string; label: string; icon: () => any; badge: (() => any) | null }>}
          >
            {(tab) => (
              <button
                type="button"
                data-tab={tab.key}
                onClick={() => setAbaAtiva(tab.key as any)}
                class={`flex-shrink-0 whitespace-nowrap px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer text-xs font-medium ${
                  abaAtiva() === tab.key
                    ? "bg-zinc-800 text-zinc-100 font-bold border border-zinc-700 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60"
                }`}
                style={{ "scroll-snap-align": "start" }}
              >
                {tab.icon()}
                <span>{tab.label}</span>
                <Show when={tab.badge}>
                  {tab.badge!()}
                </Show>
              </button>
            )}
          </For>
        </div>

        {/* Seta direita */}
        <button
          type="button"
          class="absolute right-0 top-1/2 -translate-y-1/2 z-10 p-1 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/80 transition-colors cursor-pointer bg-zinc-950/80 backdrop-blur-xs shadow-md"
          onClick={() => abasRef?.scrollBy({ left: 200, behavior: "smooth" })}
          title="Rolar abas para a direita"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <Show when={abaAtiva() === "geral"}>
      {/* CARD 1: EXECUTANDO AGORA (CASO HAJA AGENTE RODANDO) */}
      <Show when={executandoAgora()}>
        {(exec) => (
          <div class="p-4 rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/30 via-zinc-900 to-zinc-900/80 shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div class="flex items-center gap-3.5 min-w-0">
              <div class="h-11 w-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-300 flex-shrink-0">
                <Zap size={22} class="animate-pulse" />
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 animate-pulse font-mono">
                    ● Executando Agora
                  </span>
                  <span class="text-xs font-mono font-bold px-2 py-0.5 rounded bg-black/60 text-zinc-300 border border-zinc-800 flex items-center">
                    <Clock size={11} class="mr-1 inline" /> {formatarDecorrido(agoraMs() - new Date(exec().inicio).getTime())}
                  </span>
                </div>
                <div class="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span class="text-sm font-bold text-zinc-100 font-mono">
                    @{exec().agente}
                  </span>
                  <span class="text-xs text-zinc-400 font-mono">
                    · Gatilho: {exec().gatilho_tipo} ({exec().gatilho_origem || exec().id})
                  </span>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2 flex-shrink-0 self-end sm:self-auto">
              <A
                href={`/historico?run=${encodeURIComponent(exec().id)}`}
                class="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs text-zinc-200 font-medium transition-colors"
              >
                Acompanhar Log →
              </A>
            </div>
          </div>
        )}
      </Show>

      {/* CARD 2: BANNER PRINCIPAL COM TIMER DA PRÓXIMA RONDA OU STATUS */}
      <Show
        when={proximoImediato()}
        fallback={
          <div class="p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/40 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div class="flex items-center gap-3.5 min-w-0">
              <div class="h-11 w-11 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 flex-shrink-0">
                <Clock size={22} />
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    Sistema Autônomo Online
                  </span>
                  <span class="text-xs font-mono px-2 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-800">
                    {schedules().length} agendamentos · {agentes().length} agentes prontos
                  </span>
                </div>
                <p class="text-xs text-zinc-400 mt-1">
                  Scheduler ativo coordenando tarefas, fluxos e rondas periódicas de auditoria.
                </p>
              </div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0 self-end sm:self-auto">
              <Button size="xs" variant="secondary" onClick={() => navigate("/agenda")}>
                <Calendar size={13} class="mr-1" /> Ver Agenda 24h
              </Button>
            </div>
          </div>
        }
      >
        {(job) => {
          const diff = () => job().diffMs;
          const perto = () => diff() > 0 && diff() < 120000;

          return (
            <div
              class={`p-4 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm ${
                perto()
                  ? "bg-gradient-to-r from-amber-950/50 via-zinc-900 to-zinc-900/80 border-amber-500/60 ring-1 ring-amber-500/30"
                  : "bg-gradient-to-r from-emerald-950/40 via-zinc-900 to-zinc-900/60 border-emerald-500/30"
              }`}
            >
              <div class="flex items-center gap-3.5 min-w-0">
                <div
                  class={`h-11 w-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    perto()
                      ? "bg-amber-500/20 border border-amber-500/40 text-amber-300"
                      : "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
                  }`}
                >
                  <Timer size={22} class={perto() ? "animate-spin" : "animate-pulse"} />
                </div>

                <div class="min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span
                      class={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded font-mono ${
                        perto()
                          ? "bg-amber-500/30 text-amber-200 border border-amber-500/50 animate-pulse"
                          : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                      }`}
                    >
                      Próxima Ronda Automática
                    </span>

                    {/* TIMER AO VIVO DE SEGUNDO A SEGUNDO */}
                    <span class="text-xs font-mono font-bold px-2 py-0.5 rounded bg-black/60 text-emerald-300 border border-zinc-800 flex items-center">
                      <Clock size={11} class="mr-1 inline" /> {formatarContagem(diff())}
                    </span>
                  </div>

                  <div class="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span class="text-sm font-bold text-zinc-100 font-mono truncate">
                      {job().nome}
                    </span>
                    <span class="text-xs font-semibold text-emerald-400 font-mono">
                      @{job().agente}
                    </span>
                    <span class="text-[11px] text-zinc-400 font-mono">
                      · Programado para {new Date(job().proxima_exec).toLocaleTimeString("pt-BR")}
                    </span>
                  </div>
                </div>
              </div>

              <div class="flex items-center gap-2 flex-shrink-0 self-end sm:self-auto">
                <Button
                  size="xs"
                  variant="primary"
                  onClick={() => dispararJobAgora(job().id)}
                  title="Disparar este job agora sem esperar o horário"
                >
                  <Play size={12} class="mr-1 fill-current" /> Rodar Agora
                </Button>
                <A href="/agenda" class="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1">
                  Ver Agenda Completa →
                </A>
              </div>
            </div>
          );
        }}
      </Show>

      {/* 5 KPIs de Governança */}
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {/* Custo do Dia */}
        <div class="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80">
          <div class="flex items-center justify-between text-zinc-400 mb-1.5">
            <span class="text-xs font-medium">Custo do Dia</span>
            <DollarSign size={15} class="text-emerald-400" />
          </div>
          <div class="text-xl font-bold text-zinc-100 font-mono">{metricas().custoHoje}</div>
          <div class="text-[10px] text-zinc-500 mt-1">Teto: {metricas().custoTeto}</div>
        </div>

        {/* Tasks em Aberto */}
        <div class="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80">
          <div class="flex items-center justify-between text-zinc-400 mb-1.5">
            <span class="text-xs font-medium">Tasks em Aberto</span>
            <CheckCircle2 size={15} class="text-blue-400" />
          </div>
          <div class="text-xl font-bold text-zinc-100">{metricas().tasksPendentes}</div>
          <div class="text-[10px] text-zinc-500 mt-1">
            <Show when={metricas().tasksVencidas > 0} fallback={<span>No prazo</span>}>
              <span class="text-rose-400 font-medium">{metricas().tasksVencidas} vencida(s)</span>
            </Show>
          </div>
        </div>

        {/* Agentes Ativos */}
        <div class="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80">
          <div class="flex items-center justify-between text-zinc-400 mb-1.5">
            <span class="text-xs font-medium">Agentes Prontos</span>
            <Cpu size={15} class="text-purple-400" />
          </div>
          <div class="text-xl font-bold text-zinc-100">{metricas().agentesAtivos}</div>
          <div class="text-[10px] text-zinc-500 mt-1">Catálogo operacional</div>
        </div>

        {/* Fluxos Ativos */}
        <div class="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80">
          <div class="flex items-center justify-between text-zinc-400 mb-1.5">
            <span class="text-xs font-medium">Fluxos Ativos</span>
            <GitBranch size={15} class="text-amber-400" />
          </div>
          <div class="text-xl font-bold text-zinc-100">{metricas().fluxosAtivos}</div>
          <div class="text-[10px] text-zinc-500 mt-1">Workflows em grafo</div>
        </div>

        {/* Saúde Operacional */}
        <div class="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80">
          <div class="flex items-center justify-between text-zinc-400 mb-1.5">
            <span class="text-xs font-medium">Saúde do Sistema</span>
            <Activity size={15} class="text-emerald-400" />
          </div>
          <div class="flex items-center gap-2 mt-1">
            <span class="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
              <span class="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" /> Scheduler OK
            </span>
          </div>
          <div class="text-[10px] text-zinc-500 mt-1">Rondas 24h ativas</div>
        </div>
      </div>

      {/* Seção 2: Linha de Comando Rápida & Terminal Inline */}
      <div class="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800 space-y-2">
        <div class="flex items-center justify-between">
          <label class="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
            <Terminal size={14} class="text-emerald-400" />
            Comando Rápido ao Secretário ou Terminal Inline
          </label>
          <span class="text-[10px] text-zinc-500">
            Dica: use <code>! comando</code> para rodar bash imediato (ex: <code>! curl ...</code>)
          </span>
        </div>
        <div class="flex items-center gap-2">
          <input
            type="text"
            value={comando()}
            onInput={(e) => setComando(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && enviarComando()}
            placeholder="Digite uma instrução para o Secretário ou ! comando no terminal..."
            class="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-700"
          />
          <Button size="sm" variant="primary" loading={executandoComando()} onClick={enviarComando}>
            <Send size={13} class="mr-1" /> Executar
          </Button>
        </div>

        <Show when={saidaComando()}>
          <div class="mt-2 p-3 rounded-lg bg-black/90 border border-zinc-800/80 text-xs font-mono text-zinc-300 whitespace-pre-wrap max-h-48 overflow-y-auto scrollbar-thin">
            {saidaComando()}
          </div>
        </Show>
      </div>

      {/* Seção 3: Grid de 2 Colunas - A Seguir (Cronômetros ao Vivo) & Feed de Execuções */}
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Coluna 1: A Seguir (Próximas Rondas com Timer em Tempo Real) */}
        <div class="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800 space-y-3">
          <div class="flex items-center justify-between border-b border-zinc-800/80 pb-2">
            <div class="flex items-center gap-2">
              <Clock size={16} class="text-emerald-400" />
              <h2 class="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                A Seguir · Rondas 24h Agendadas
              </h2>
            </div>
            <A href="/agenda" class="text-[11px] text-blue-400 hover:underline flex items-center gap-1">
              Ver todas ({schedules().length}) <ArrowRight size={10} />
            </A>
          </div>

          <div class="space-y-2 max-h-80 overflow-y-auto scrollbar-thin pr-1">
            <For
              each={jobsASeguir().slice(0, 5)}
              fallback={
                <div class="py-8 text-center text-xs text-zinc-500">
                  Nenhuma ronda futura programada.
                </div>
              }
            >
              {(j) => {
                const diff = () => new Date(j.proxima_exec).getTime() - agoraMs();
                const perto = () => diff() > 0 && diff() < 120000;

                return (
                  <div class="p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800 flex items-center justify-between gap-3 text-xs">
                    <div class="flex items-center gap-2.5 min-w-0">
                      <span class="h-2 w-2 rounded-full bg-emerald-400 flex-shrink-0" />
                      <div class="min-w-0">
                        <div class="font-semibold text-zinc-200 font-mono truncate">{j.nome}</div>
                        <div class="text-[10px] text-zinc-400">@{j.agente} · {descreverCron(j.agenda?.valor || "0 * * * *")}</div>
                      </div>
                    </div>

                    <div class="flex items-center gap-2 flex-shrink-0">
                      <span
                        class={`text-[11px] font-mono px-2 py-0.5 rounded font-bold ${
                          perto()
                            ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse"
                            : "bg-zinc-900 text-emerald-400 border border-zinc-800"
                        }`}
                      >
                        {formatarContagem(diff())}
                      </span>
                      <IconButton
                        size="xs"
                        variant="ghost"
                        onClick={() => dispararJobAgora(j.id)}
                        title="Executar agora"
                      >
                        <Play size={11} class="fill-current" />
                      </IconButton>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </div>

        {/* Coluna 2: Feed de Atividades Recentes com Status em Tempo Real */}
        <div class="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800 space-y-3">
          <div class="flex items-center justify-between border-b border-zinc-800/80 pb-2">
            <div class="flex items-center gap-2">
              <Activity size={16} class="text-blue-400" />
              <h2 class="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                Feed de Execuções Recentes
              </h2>
            </div>
            <A href="/historico" class="text-[11px] text-blue-400 hover:underline flex items-center gap-1">
              Ver histórico <ArrowRight size={10} />
            </A>
          </div>

          <div class="space-y-2 max-h-80 overflow-y-auto scrollbar-thin pr-1">
            <For
              each={execucoes()}
              fallback={
                <div class="py-8 text-center text-xs text-zinc-500">
                  Nenhuma atividade recente registrada neste workspace.
                </div>
              }
            >
              {(at) => (
                <A
                  href={`/historico?run=${encodeURIComponent(at.id)}`}
                  class="p-2.5 rounded-lg bg-zinc-950/60 border border-zinc-800/80 hover:border-zinc-700 flex items-center justify-between text-xs transition-colors"
                >
                  <div class="flex items-center gap-2.5 min-w-0">
                    <div
                      class={`h-2 w-2 rounded-full flex-shrink-0 ${
                        at.status === "executando"
                          ? "bg-emerald-400 animate-ping"
                          : at.status === "concluido"
                          ? "bg-emerald-400"
                          : at.status === "falhou"
                          ? "bg-rose-400"
                          : at.status === "hitl_pendente"
                          ? "bg-amber-400 animate-pulse"
                          : "bg-zinc-500"
                      }`}
                    />
                    <div class="min-w-0">
                      <div class="font-medium text-zinc-200 truncate">
                        @{at.agente || "agente"}
                        <span class="text-[10px] text-zinc-500 ml-1.5 font-mono">
                          ({at.status})
                        </span>
                      </div>
                      <div class="text-[10px] text-zinc-500 truncate">
                        {at.gatilho_tipo || "cron"} · {at.gatilho_origem || at.id}
                      </div>
                    </div>
                  </div>

                  <div class="text-right flex-shrink-0 text-[10px] text-zinc-400 font-mono">
                    <div>
                      {at.status === "executando"
                        ? formatarDecorrido(agoraMs() - new Date(at.inicio).getTime())
                        : at.duracao_ms
                        ? `${(at.duracao_ms / 1000).toFixed(1)}s`
                        : "—"}
                    </div>
                    <div class="text-zinc-500">
                      {at.inicio ? new Date(at.inicio).toLocaleTimeString("pt-BR") : ""}
                    </div>
                  </div>
                </A>
              )}
            </For>
          </div>
        </div>
      </div>

      {/* Seção 4: Tarefas Prioritárias em Aberto */}
      <div class="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800 space-y-3">
        <div class="flex items-center justify-between border-b border-zinc-800/80 pb-2">
          <div class="flex items-center gap-2">
            <ListTodo size={16} class="text-purple-400" />
            <h2 class="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
              Tarefas Prioritárias em Aberto
            </h2>
          </div>
          <div class="flex items-center gap-2">
            <Button size="xs" variant="primary" onClick={() => setModalNovaTask(true)}>
              <Plus size={12} class="mr-1" /> Criar Task
            </Button>
            <A href="/tasks" class="text-[11px] text-blue-400 hover:underline flex items-center gap-1">
              Ver Kanban completo <ArrowRight size={10} />
            </A>
          </div>
        </div>

        <Show
          when={tasksEmAberto().length > 0}
          fallback={
            <div class="p-6 text-center text-xs text-zinc-500">
              Nenhuma tarefa em aberto no momento. Clique em "+ Nova Task" para adicionar.
            </div>
          }
        >
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <For each={tasksEmAberto()}>
              {(task) => (
                <A
                  href={`/tasks?task=${encodeURIComponent(task.id)}`}
                  class="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800 hover:border-zinc-700 flex flex-col justify-between gap-2 shadow-xs transition-colors"
                >
                  <div class="space-y-1">
                    <div class="flex items-start justify-between gap-2">
                      <span class="text-xs font-semibold text-zinc-100 line-clamp-1">{task.titulo}</span>
                      <Show when={task.prioridade}>
                        <span
                          class={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${
                            task.prioridade === "alta"
                              ? "bg-rose-950 text-rose-300 border border-rose-800/80"
                              : "bg-zinc-800 text-zinc-400"
                          }`}
                        >
                          {task.prioridade}
                        </span>
                      </Show>
                    </div>
                    <Show when={task.descricao}>
                      <p class="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">
                        {task.descricao}
                      </p>
                    </Show>
                  </div>

                  <div class="flex items-center justify-between text-[10px] pt-1.5 border-t border-zinc-800/60 text-zinc-500 font-mono">
                    <span class="text-emerald-400">
                      {task.responsavel ? `@${task.responsavel}` : "Sem agente"}
                    </span>
                    <span class="capitalize px-1.5 py-0.2 rounded bg-zinc-900 border border-zinc-800">
                      {task.coluna}
                    </span>
                  </div>
                </A>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* Seção 5: Banner e Atalhos do Sistema */}
      <div class="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <A
          href="/agenda"
          class="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800/60 hover:border-zinc-700 transition-colors flex items-center gap-3"
        >
          <Calendar size={18} class="text-amber-400" />
          <div>
            <div class="text-xs font-semibold text-zinc-200">Agenda 24h</div>
            <div class="text-[10px] text-zinc-500">Rondas periódicas</div>
          </div>
        </A>

        <A
          href="/fluxos"
          class="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800/60 hover:border-zinc-700 transition-colors flex items-center gap-3"
        >
          <GitBranch size={18} class="text-blue-400" />
          <div>
            <div class="text-xs font-semibold text-zinc-200">Fluxos de Trabalho</div>
            <div class="text-[10px] text-zinc-500">Orquestrações em grafo</div>
          </div>
        </A>

        <A
          href="/apps"
          class="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800/60 hover:border-zinc-700 transition-colors flex items-center gap-3"
        >
          <Terminal size={18} class="text-purple-400" />
          <div>
            <div class="text-xs font-semibold text-zinc-200">Apps & Secrets</div>
            <div class="text-[10px] text-zinc-500">Chaves e conexões</div>
          </div>
        </A>

        <A
          href="/config"
          class="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800/60 hover:border-zinc-700 transition-colors flex items-center gap-3"
        >
          <ShieldAlert size={18} class="text-emerald-400" />
          <div>
            <div class="text-xs font-semibold text-zinc-200">Segurança & Regras</div>
            <div class="text-[10px] text-zinc-500">Permissões e políticas</div>
          </div>
        </A>
      </div>

      {/* Seção 6: Agentes Prontos & Conversas Recentes do Secretário */}
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Coluna 1: Agentes Operacionais Disponíveis */}
        <div class="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800 space-y-3">
          <div class="flex items-center justify-between border-b border-zinc-800/80 pb-2">
            <div class="flex items-center gap-2">
              <Cpu size={16} class="text-purple-400" />
              <h2 class="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                Agentes Operacionais Prontos ({agentes().length})
              </h2>
            </div>
            <A href="/secretario" class="text-[11px] text-purple-400 hover:underline flex items-center gap-1">
              Falar com Agente <ArrowRight size={10} />
            </A>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto scrollbar-thin pr-1">
            <For
              each={agentes()}
              fallback={
                <div class="col-span-2 py-6 text-center text-xs text-zinc-500">
                  Carregando agentes do workspace...
                </div>
              }
            >
              {(ag) => (
                <div class="p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800/80 hover:border-zinc-700 transition-colors flex items-center justify-between gap-2 text-xs">
                  <div class="flex items-center gap-2 min-w-0">
                    <div class="h-6 w-6 rounded-md bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-300 flex-shrink-0">
                      <Bot size={13} />
                    </div>
                    <div class="min-w-0">
                      <div class="font-medium text-zinc-200 truncate font-mono">@{ag.id || ag.nome}</div>
                      <div class="text-[10px] text-zinc-500 truncate">{ag.descricao || ag.funcao || "Operacional"}</div>
                    </div>
                  </div>

                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => navigate(`/secretario?ordem=${encodeURIComponent(`@${ag.id || ag.nome} `)}`)}
                    title={`Chamar @${ag.id || ag.nome}`}
                  >
                    <Play size={10} class="text-emerald-400" />
                  </Button>
                </div>
              )}
            </For>
          </div>
        </div>

        {/* Coluna 2: Sessões Recentes do Secretário */}
        <div class="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800 space-y-3">
          <div class="flex items-center justify-between border-b border-zinc-800/80 pb-2">
            <div class="flex items-center gap-2">
              <MessageSquare size={16} class="text-emerald-400" />
              <h2 class="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                Conversas Recentes com Secretário ({sessoesSecretario().length})
              </h2>
            </div>
            <A href="/secretario" class="text-[11px] text-emerald-400 hover:underline flex items-center gap-1">
              Abrir Chat <ArrowRight size={10} />
            </A>
          </div>

          <div class="space-y-2 max-h-72 overflow-y-auto scrollbar-thin pr-1">
            <For
              each={sessoesSecretario().slice(0, 5)}
              fallback={
                <div class="py-6 text-center text-xs text-zinc-500">
                  Nenhuma conversa recente com o Secretário.
                </div>
              }
            >
              {(sec) => (
                <A
                  href={`/secretario?sessao=${encodeURIComponent(sec.id)}`}
                  class="p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800/80 hover:border-zinc-700 transition-colors flex items-center justify-between gap-3 text-xs block"
                >
                  <div class="flex items-center gap-2.5 min-w-0">
                    <span class={`h-2 w-2 rounded-full flex-shrink-0 ${sec.executando ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"}`} />
                    <div class="min-w-0">
                      <div class="font-medium text-zinc-200 truncate">
                        {sec.titulo_real || sec.title || sec.titulo || `Sessão ${sec.id.slice(0, 8)}`}
                      </div>
                      <div class="text-[10px] text-zinc-500 font-mono truncate">
                        {sec.agent || "secretario-exec"} · {sec.time?.updated ? new Date(sec.time.updated).toLocaleDateString("pt-BR") : "Recente"}
                      </div>
                    </div>
                  </div>

                  <ArrowRight size={12} class="text-zinc-600 flex-shrink-0" />
                </A>
              )}
            </For>
          </div>
        </div>
      </div>

      </Show>

      {/* ─────────────────────────────────────────────────────────────
          ABA 2: AO VIVO & FUNDO (AGENTES EM SEGUNDO PLANO)
         ───────────────────────────────────────────────────────────── */}
      <Show when={abaAtiva() === "aovivo"}>
        <div class="space-y-6">
          {/* Card em Execução Agora */}
          <Show
            when={executandoAgora()}
            fallback={
              <div class="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800 text-center space-y-2">
                <div class="h-10 w-10 rounded-full bg-zinc-800/80 mx-auto flex items-center justify-center text-zinc-400">
                  <Bot size={20} />
                </div>
                <h3 class="text-sm font-bold text-zinc-200">Nenhum agente executando neste segundo</h3>
                <p class="text-xs text-zinc-400 max-w-md mx-auto">
                  O scheduler e os serviços estão em espera ativa. As próximas rondas serão disparadas automaticamente no horário programado.
                </p>
              </div>
            }
          >
            {(exec) => (
              <div class="p-5 rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/30 via-zinc-900 to-zinc-900 shadow-xl space-y-4">
                <div class="flex items-center justify-between gap-4 flex-wrap">
                  <div class="flex items-center gap-3">
                    <div class="h-10 w-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-300">
                      <Zap size={20} class="animate-pulse" />
                    </div>
                    <div>
                      <div class="flex items-center gap-2">
                        <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 animate-pulse font-mono">
                          ● Processo Ativo
                        </span>
                        <span class="text-xs font-mono font-bold px-2 py-0.5 rounded bg-black/60 text-zinc-300 border border-zinc-800 flex items-center">
                          <Clock size={11} class="mr-1 inline" /> {formatarDecorrido(agoraMs() - new Date(exec().inicio).getTime())}
                        </span>
                      </div>
                      <div class="text-base font-bold text-zinc-100 font-mono mt-1">
                        @{exec().agente}
                      </div>
                    </div>
                  </div>

                  <div class="flex items-center gap-2">
                    <A
                      href={exec().tipo === "secretario" ? `/secretario?sessao=${encodeURIComponent(exec().id)}` : `/historico?run=${encodeURIComponent(exec().id)}`}
                      class="px-3.5 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs text-zinc-100 font-bold transition-all shadow-md flex items-center gap-1.5 font-mono cursor-pointer"
                    >
                      <ExternalLink size={13} />
                      <span>{exec().tipo === "secretario" ? "Ver Chat Ao Vivo →" : "Ver Log ao Vivo"}</span>
                    </A>
                  </div>
                </div>

                <div class="p-3.5 rounded-xl bg-black/60 border border-zinc-800 text-xs font-mono text-zinc-300 space-y-1">
                  <div class="text-zinc-500 text-[11px]">Ordem / Instrução em execução:</div>
                  <div class="whitespace-pre-wrap leading-relaxed">{exec().ordem || "(sem ordem detalhada)"}</div>
                </div>
              </div>
            )}
          </Show>

          {/* Histórico Recente de Execuções de Fundo */}
          <div class="p-5 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-4">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <Radio size={16} class="text-blue-400" />
                <h3 class="text-sm font-bold text-zinc-100 font-mono">Últimas Execuções de Background</h3>
              </div>
              <span class="text-xs text-zinc-500 font-mono">{execucoes().length} registros</span>
            </div>

            <div class="space-y-2">
              <For each={execucoes()}>
                {(exec) => {
                  const statusCor = () => {
                    if (exec.status === "concluido") return "text-emerald-400 bg-emerald-950/60 border-emerald-800/60";
                    if (exec.status === "executando") return "text-emerald-400 bg-emerald-950/60 border-emerald-800/60 animate-pulse";
                    return "text-rose-400 bg-rose-950/60 border-rose-800/60";
                  };

                  return (
                    <div class="p-3 rounded-xl bg-zinc-950/70 border border-zinc-800/80 hover:border-zinc-700 transition-colors flex items-center justify-between gap-4">
                      <div class="flex items-center gap-3 min-w-0">
                        <span class={`px-2 py-0.5 rounded text-[10px] font-bold font-mono border uppercase flex-shrink-0 ${statusCor()}`}>
                          {exec.status}
                        </span>
                        <div class="min-w-0">
                          <div class="flex items-center gap-2">
                            <span class="font-bold text-zinc-100 font-mono text-xs">@{exec.agente}</span>
                            <span class="text-zinc-500 font-mono text-[10px] truncate max-w-[160px]">{exec.id}</span>
                          </div>
                          <p class="text-[11px] text-zinc-400 truncate max-w-lg mt-0.5">
                            {exec.ordem || "Execução de rotina"}
                          </p>
                        </div>
                      </div>

                      <div class="flex items-center gap-2 flex-shrink-0">
                        <span class="text-[10px] font-mono text-zinc-500">
                          {exec.duracao_ms ? `${Math.round(exec.duracao_ms / 1000)}s` : "-"}
                        </span>
                        <A
                          href={`/historico?run=${encodeURIComponent(exec.id)}`}
                          class="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-mono transition-colors"
                        >
                          Log →
                        </A>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        </div>
      </Show>

      {/* ─────────────────────────────────────────────────────────────
          ABA 3: CONVERSAS COM O SECRETÁRIO
         ───────────────────────────────────────────────────────────── */}
      <Show when={abaAtiva() === "secretario"}>
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-sm font-bold text-zinc-100 font-mono flex items-center gap-2">
                <Bot size={16} class="text-purple-400" />
                <span>Sessões & Chats com o Secretário</span>
              </h3>
              <p class="text-xs text-zinc-400">
                Histórico centralizado de conversas, consultas estratégicas e ordens despachadas.
              </p>
            </div>
            <Button size="xs" variant="primary" onClick={() => navigate("/secretario")}>
              <Plus size={13} class="mr-1" /> Nova Conversa
            </Button>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <For each={sessoesSecretario()}>
              {(sessao) => (
                <div class="p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800/90 hover:border-purple-700/60 transition-all flex flex-col justify-between gap-3 group shadow-xs">
                  <div class="space-y-1.5">
                    <div class="flex items-center justify-between text-[11px]">
                      <span class="font-mono text-purple-400 font-bold">
                        {sessao.id.slice(0, 12)}…
                      </span>
                      <span class="text-zinc-500 font-mono text-[10px]">
                        {(() => { const ts = sessao.time?.updated || sessao.updated; return ts ? new Date(typeof ts === "number" ? ts : ts).toLocaleString("pt-BR") : ""; })()}
                      </span>
                    </div>
                    <h4 class="text-sm font-semibold text-zinc-100 group-hover:text-purple-300 transition-colors line-clamp-2">
                      {sessao.titulo_real || sessao.title || `Conversa ${sessao.id.slice(0, 8)}`}
                    </h4>
                    <Show when={sessao.agent}>
                      <div class="text-[11px] text-zinc-400 font-mono">
                        Agente: @{sessao.agent} · Modelo: {sessao.model || "padrão"}
                      </div>
                    </Show>
                  </div>

                  <div class="pt-2 border-t border-zinc-800/80 flex items-center justify-between">
                    <span class="text-[10px] font-mono text-zinc-500">
                      {sessao.summary?.files ? `${sessao.summary.files} partes` : "Sessão salva"}
                    </span>
                    <A
                      href={`/secretario?sessao=${encodeURIComponent(sessao.id)}`}
                      class="px-2.5 py-1 rounded-lg bg-purple-950/60 hover:bg-purple-900 text-purple-300 text-xs font-mono font-medium border border-purple-800/60 transition-colors flex items-center gap-1"
                    >
                      <MessageSquare size={12} />
                      <span>Continuar Chat →</span>
                    </A>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* ─────────────────────────────────────────────────────────────
          ABA 4: TASKS EM ANDAMENTO
         ───────────────────────────────────────────────────────────── */}
      <Show when={abaAtiva() === "tasks"}>
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-sm font-bold text-zinc-100 font-mono flex items-center gap-2">
                <CheckSquare size={16} class="text-amber-400" />
                <span>Tarefas em Andamento ({tasksEmAndamento().length})</span>
              </h3>
              <p class="text-xs text-zinc-400">
                Tarefas que estão atualmente com agentes ou precisando de resolução técnica.
              </p>
            </div>
            <A
              href="/tasks"
              class="text-xs font-mono text-amber-400 hover:text-amber-300 underline"
            >
              Abrir Quadro Kanban Completo →
            </A>
          </div>

          <Show
            when={tasksEmAndamento().length > 0}
            fallback={
              <div class="p-8 rounded-2xl bg-zinc-900/40 border border-zinc-800 text-center text-zinc-400 text-xs">
                Nenhuma tarefa em andamento no momento. Todas concluídas ou no backlog.
              </div>
            }
          >
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <For each={tasksEmAndamento()}>
                {(task) => (
                  <div class="p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800 hover:border-amber-700/60 transition-all flex flex-col justify-between gap-3 shadow-xs">
                    <div class="space-y-2">
                      <div class="flex items-center justify-between text-[11px]">
                        <span class="font-mono px-2 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-800/60 font-bold uppercase">
                          {task.coluna}
                        </span>
                        <Show when={task.prioridade}>
                          <span class={`font-mono text-[10px] uppercase font-bold ${
                            task.prioridade === "alta" ? "text-rose-400" : "text-amber-400"
                          }`}>
                            Prioridade {task.prioridade}
                          </span>
                        </Show>
                      </div>

                      <h4 class="text-sm font-bold text-zinc-100">
                        {task.titulo}
                      </h4>

                      <Show when={task.descricao}>
                        <p class="text-xs text-zinc-400 line-clamp-3 leading-relaxed">
                          {task.descricao}
                        </p>
                      </Show>

                      <Show when={task.responsavel}>
                        <div class="text-[11px] font-mono text-zinc-400">
                          Responsável: <span class="text-zinc-200">@{task.responsavel.replace(/^agente:/, "")}</span>
                        </div>
                      </Show>
                    </div>

                    <div class="pt-2 border-t border-zinc-800/80 flex items-center justify-between">
                      <span class="text-[10px] font-mono text-zinc-500">
                        {task.id}
                      </span>
                      <A
                        href={`/tasks?task=${encodeURIComponent(task.id)}`}
                        class="px-2.5 py-1 rounded-lg bg-amber-950/50 hover:bg-amber-900 text-amber-200 text-xs font-mono font-medium border border-amber-800/60 transition-colors"
                      >
                        Ver Detalhes / Resolver →
                      </A>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>

      {/* ─────────────────────────────────────────────────────────────
          ABA 5: FALHAS & RESOLUÇÕES
         ───────────────────────────────────────────────────────────── */}
      <Show when={abaAtiva() === "falhas"}>
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-sm font-bold text-zinc-100 font-mono flex items-center gap-2">
                <AlertTriangle size={16} class="text-rose-400" />
                <span>Falhas Recentes & Ações de Recuperação ({execucoesFalhas().length})</span>
              </h3>
              <p class="text-xs text-zinc-400">
                Execuções que foram interrompidas ou caíram no meio do caminho. Você pode redispará-las com 1 clique.
              </p>
            </div>
            <Button size="xs" variant="ghost" onClick={carregarDadosHome}>
              <RotateCcw size={13} class="mr-1" /> Atualizar
            </Button>
          </div>

          <Show
            when={execucoesFalhas().length > 0}
            fallback={
              <div class="p-8 rounded-2xl bg-zinc-900/40 border border-zinc-800 text-center text-emerald-400 text-xs font-mono flex items-center justify-center gap-1.5">
                <Check size={14} class="mr-1" /> Nenhuma falha detectada nas execuções recentes. Tudo rodando com sucesso!
              </div>
            }
          >
            <div class="space-y-3">
              <For each={execucoesFalhas()}>
                {(exec) => (
                  <div class="p-4 rounded-2xl bg-rose-950/20 border border-rose-800/50 hover:border-rose-700 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div class="space-y-1.5 min-w-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-rose-900/60 text-rose-200 border border-rose-700 uppercase">
                          Falhou
                        </span>
                        <span class="text-xs font-bold text-zinc-100 font-mono">
                          @{exec.agente}
                        </span>
                        <span class="text-[10px] text-zinc-500 font-mono">
                          {exec.id} · {exec.inicio ? new Date(exec.inicio).toLocaleTimeString("pt-BR") : ""}
                        </span>
                      </div>
                      <p class="text-xs text-zinc-300 font-mono leading-relaxed line-clamp-2">
                        {exec.ordem || "Sem descrição da ordem"}
                      </p>
                      <Show when={exec.duracao_ms}>
                        <div class="text-[10px] text-rose-300 font-mono">
                          Tempo antes de interromper: {Math.round(exec.duracao_ms / 1000)}s
                        </div>
                      </Show>
                    </div>

                    <div class="flex items-center gap-2 flex-shrink-0 self-end sm:self-auto">
                      <Button
                        size="xs"
                        variant="primary"
                        onClick={() => repetirExecucao(exec)}
                        class="bg-rose-600 hover:bg-rose-500 text-white font-bold"
                        title="Executar novamente agora"
                      >
                        <RotateCcw size={12} class="mr-1" /> Repetir Execução
                      </Button>
                      <button
                        type="button"
                        class="px-2 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs font-mono transition-colors flex items-center gap-1 cursor-pointer"
                        onClick={() => ignorarFalha(exec.id)}
                        title="Ignorar esta falha (não mostrar mais)"
                      >
                        <EyeOff size={12} /> Ignorar
                      </button>
                      <A
                        href={`/historico?run=${encodeURIComponent(exec.id)}`}
                        class="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-mono transition-colors"
                      >
                        Ver Log →
                      </A>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>

      {/* ─────────────────────────────────────────────────────────────
          ABA 6: AGENDAMENTOS (SCHEDULER 24H)
         ───────────────────────────────────────────────────────────── */}
      <Show when={abaAtiva() === "agendamentos"}>
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-sm font-bold text-zinc-100 font-mono flex items-center gap-2">
                <Timer size={16} class="text-emerald-400" />
                <span>Linha do Tempo de Agendamentos (24h)</span>
              </h3>
              <p class="text-xs text-zinc-400">
                Cronômetros ao vivo segundo a segundo de todas as rotinas programadas da empresa.
              </p>
            </div>
            <A href="/agenda" class="text-xs font-mono text-emerald-400 hover:underline">
              Editar Rotinas na Agenda →
            </A>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <For each={jobsASeguir()}>
              {(job) => {
                const diff = () => job.diffMs;
                return (
                  <div class="p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800 hover:border-emerald-700/60 transition-all flex flex-col justify-between gap-3 shadow-xs">
                    <div class="space-y-1.5">
                      <div class="flex items-center justify-between">
                        <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/60 font-bold flex items-center">
                          <Clock size={10} class="mr-1 inline" /> {formatarContagem(diff())}
                        </span>
                        <span class="text-[10px] font-mono text-zinc-500">
                          {job.agenda?.valor || "cron"}
                        </span>
                      </div>
                      <h4 class="text-sm font-bold text-zinc-100 font-mono">
                        {job.nome}
                      </h4>
                      <div class="text-xs text-emerald-400 font-mono">
                        Agente responsável: @{job.agente}
                      </div>
                    </div>

                    <div class="pt-2 border-t border-zinc-800/80 flex items-center justify-between">
                      <span class="text-[10px] font-mono text-zinc-500">
                        {new Date(job.proxima_exec).toLocaleTimeString("pt-BR")}
                      </span>
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={() => dispararJobAgora(job.id)}
                      >
                        <Play size={11} class="mr-1 fill-current text-emerald-400" /> Rodar Agora
                      </Button>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </Show>

      {/* ─────────────────────────────────────────────────────────────
          ABA 7: FLUXOS & AUTOMAÇÃO (HLE / WORKFLOWS UNIFICADOS)
         ───────────────────────────────────────────────────────────── */}
      <Show when={abaAtiva() === "fluxos"}>
        <div class="space-y-6">
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold text-zinc-100 font-mono flex items-center gap-2">
                <GitBranch size={16} class="text-indigo-400" />
                <span>Fluxos & Automações ({fluxos().length})</span>
              </h3>
              <A href="/fluxos" class="text-xs font-mono text-indigo-400 hover:underline">
                Abrir Studio de Fluxos →
              </A>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <For each={fluxos()}>
                {(fl) => (
                  <div class="p-3.5 rounded-2xl bg-zinc-900/50 border border-zinc-800 hover:border-indigo-700/60 transition-all flex flex-col justify-between gap-3 shadow-xs">
                    <div>
                      <div class="flex items-center justify-between">
                        <span class="text-[10px] font-mono text-zinc-500">{fl.id}</span>
                        <div class="flex items-center gap-1">
                          <Show when={fl.gatilhos?.includes("cron")}>
                            <span class="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[9px] font-mono">⏰ Cron</span>
                          </Show>
                          <Show when={fl.gatilhos?.includes("webhook")}>
                            <span class="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[9px] font-mono">⚡ Webhook</span>
                          </Show>
                          <Show when={fl.temLoop}>
                            <span class="px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-[9px] font-mono">🔁 Loop</span>
                          </Show>
                        </div>
                      </div>
                      <div class="text-xs font-bold text-zinc-100 mt-1.5">{fl.nome || fl.id}</div>
                      <div class="text-[11px] text-zinc-400 font-mono mt-1">
                        {fl.nos ?? 0} nós · {fl.arestas ?? 0} conexões
                      </div>
                    </div>
                    <A
                      href={`/fluxos?fluxo=${encodeURIComponent(fl.id)}`}
                      class="text-[11px] font-mono text-indigo-400 hover:underline pt-2 border-t border-zinc-800/80 block text-right"
                    >
                      Abrir no Studio →
                    </A>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>
      {/* Modal de Criação de Tarefa Rápida */}
      <Show when={modalNovaTask()}>
        <div class="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div class="bg-zinc-900 border border-zinc-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div class="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h2 class="text-sm font-bold text-zinc-100">Criar Nova Tarefa</h2>
              <IconButton size="xs" variant="ghost" onClick={() => setModalNovaTask(false)}>
                <X size={16} />
              </IconButton>
            </div>

            <div class="space-y-3 text-xs">
              <div>
                <label class="block text-zinc-400 mb-1 font-medium">Título da Tarefa *</label>
                <input
                  type="text"
                  placeholder="Ex: Auditoria editorial dos últimos artigos"
                  value={novoTitulo()}
                  onInput={(e) => setNovoTitulo(e.currentTarget.value)}
                  class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-zinc-700"
                />
              </div>

              <div>
                <label class="block text-zinc-400 mb-1 font-medium">Descrição (Opcional)</label>
                <textarea
                  rows={3}
                  placeholder="Detalhes da entrega..."
                  value={novaDescricao()}
                  onInput={(e) => setNovaDescricao(e.currentTarget.value)}
                  class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-zinc-700 resize-none"
                />
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-zinc-400 mb-1 font-medium">Prioridade</label>
                  <select
                    value={novaPrioridade()}
                    onChange={(e) => setNovaPrioridade(e.currentTarget.value)}
                    class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-2 text-zinc-200 focus:outline-none cursor-pointer"
                  >
                    <option value="baixa">Baixa</option>
                    <option value="media">Média</option>
                    <option value="alta">Alta</option>
                  </select>
                </div>

                <div>
                  <label class="block text-zinc-400 mb-1 font-medium">Responsável</label>
                  <select
                    value={novoResponsavel()}
                    onChange={(e) => setNovoResponsavel(e.currentTarget.value)}
                    class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-2 text-zinc-200 focus:outline-none cursor-pointer"
                  >
                    <option value="">Sem responsável</option>
                    <For each={agentes()}>
                      {(ag) => <option value={ag.id}>@{ag.id}</option>}
                    </For>
                  </select>
                </div>
              </div>
            </div>

            <div class="pt-3 border-t border-zinc-800 flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setModalNovaTask(false)}>
                Cancelar
              </Button>
              <Button size="sm" variant="primary" loading={criandoTask()} onClick={criarNovaTask}>
                Criar Tarefa
              </Button>
            </div>
          </div>
        </div>
      </Show>
    </div>
    </Show>
  );
};
