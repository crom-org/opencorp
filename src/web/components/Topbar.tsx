import { type Component, createSignal, onMount, Show, For } from "solid-js";
import { useLocation, A } from "@solidjs/router";
import {
  Radio,
  Server,
  FolderGit2,
  Cpu,
  Clock,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Activity,
  Layers,
  Sparkles,
  Bell,
  Bot,
  Calendar,
  CheckSquare,
  ArrowRight,
  Terminal,
  Menu,
  Building2,
  ChevronsUpDown,
} from "lucide-solid";
import { sseConnected, wsAtivo, setWsAtivo, workspaces, fetchApi, notificacoesNaoLidas, setSidebarMobileAberta } from "../lib/context";

interface StatusInfo {
  scheduler?: boolean;
  secretario?: boolean;
  versao?: string;
  executandoAgora?: {
    id: string;
    agente: string;
    status: string;
    ordem?: string;
    inicio?: string;
  } | null;
  ultimaExecucao?: {
    id: string;
    agente: string;
    status: string;
    inicio?: string;
  } | null;
  proximaRotina?: {
    id: string;
    nome: string;
    proxima_exec: string;
    diffMin: number;
  } | null;
  taskDestaque?: {
    id: string;
    titulo: string;
    coluna: string;
    prioridade: string;
    responsavel?: string;
  } | null;
  totalTasksAndamento?: number;
  aprovacoesPendentes?: number;
}

export const Topbar: Component = () => {
  const location = useLocation();
  const [hoverCard, setHoverCard] = createSignal(false);
  const [statusInfo, setStatusInfo] = createSignal<StatusInfo>({ versao: "0.7.0" });
  let timerHover: number | undefined;

  const getBreadcrumb = () => {
    const p = location.pathname.replace(/^\//, "") || "home";
    const mapa: Record<string, string> = {
      home: "Início",
      secretario: "Secretário Executivo",
      workspace: "Workspace & Código",
      tasks: "Quadro de Tarefas (Kanban)",
      agentes: "Catálogo de Agentes",
      reunioes: "Reuniões Multi-Agente",
      agenda: "Rotinas & Agendamentos",
      fluxos: "Fluxos & Automação",
      hooks: "Webhooks & Gatilhos",
      apps: "Mini-Apps (Alfa)",
      secrets: "Segredos & Senhas",
      historico: "Linha do Tempo de Execuções",
      notificacoes: "Central de Notificações",
      config: "Configurações do Sistema",
      docs: "Documentação",
    };
    return mapa[p] || p;
  };

  const carregarStatus = async () => {
    try {
      const calls: Promise<any>[] = [
        fetchApi<{ scheduler: boolean; secretario: boolean }>("/status"),
        fetchApi<{ ok: boolean; versao: string }>("/health"),
      ];

      if (wsAtivo()) {
        calls.push(
          fetchApi<any[]>("/execucoes?limite=6"),
          fetchApi<any[]>("/schedules"),
          fetchApi<any[]>("/tasks"),
          fetchApi<any[]>("/approvals")
        );
      }

      const [st, hl, execs, jobs, tasks, aprovs] = await Promise.allSettled(calls);

      const getVal = <T,>(r: PromiseSettledResult<T> | undefined, def: T): T =>
        r && r.status === "fulfilled" ? r.value : def;

      const dStatus = getVal(st, null);
      const dHealth = getVal(hl, null);
      const dExecs = getVal(execs, []);
      const dJobs = getVal(jobs, []);
      const dTasks = getVal(tasks, []);
      const dAprovs = getVal(aprovs, []);

      // 1. Executando agora ou última execução (considera jobs de background e Secretário)
      const secExec = dStatus?.secretario_executando;
      const emAndamento =
        dExecs.find((e: any) => e.status === "executando") ||
        (secExec ? {
          id: secExec.id,
          agente: secExec.agente || "secretario-exec",
          ordem: secExec.titulo || "Conversa com Secretário em andamento",
          inicio: secExec.inicio || new Date().toISOString(),
          status: "executando",
          tipo: "secretario",
        } : null);
      const ultima = dExecs.length > 0 ? dExecs[0] : null;

      // 2. Próxima rotina programada
      const now = Date.now();
      const rotinasFuturas = dJobs
        .filter((j: any) => j.ativo !== false && j.proxima_exec)
        .map((j: any) => {
          const diffMs = new Date(j.proxima_exec).getTime() - now;
          return {
            id: j.id,
            nome: j.nome,
            proxima_exec: j.proxima_exec,
            diffMin: Math.max(0, Math.round(diffMs / 60000)),
          };
        })
        .filter((j: any) => new Date(j.proxima_exec).getTime() >= now - 15000)
        .sort(
          (a: any, b: any) =>
            new Date(a.proxima_exec).getTime() - new Date(b.proxima_exec).getTime(),
        );

      // 3. Tasks em andamento ou próxima prioritária do backlog
      const tasksAndamento = dTasks.filter(
        (t: any) =>
          t.coluna === "fazendo" ||
          t.coluna === "em_andamento" ||
          t.coluna === "in_progress",
      );
      const taskPrioritaria =
        tasksAndamento.length > 0
          ? tasksAndamento[0]
          : dTasks.find((t: any) => t.coluna !== "feito" && t.prioridade === "alta") ||
            (dTasks.length > 0 ? dTasks[0] : null);

      setStatusInfo({
        scheduler: dStatus?.scheduler,
        secretario: dStatus?.secretario,
        versao: dHealth?.versao || "0.7.0",
        executandoAgora: emAndamento || null,
        ultimaExecucao: ultima || null,
        proximaRotina: rotinasFuturas.length > 0 ? rotinasFuturas[0] : null,
        taskDestaque: taskPrioritaria || null,
        totalTasksAndamento: tasksAndamento.length,
        aprovacoesPendentes: dAprovs.filter((a: any) => a.status === "pendente").length,
      });
    } catch {}
  };

  const onMouseEnterBadge = () => {
    clearTimeout(timerHover);
    setHoverCard(true);
    void carregarStatus();
  };

  const onMouseLeaveBadge = () => {
    timerHover = window.setTimeout(() => {
      setHoverCard(false);
    }, 250);
  };

  const workspaceAtual = () => {
    const id = wsAtivo();
    const ws = workspaces().find((w) => w.id === id);
    return ws || { id: id || "padrão", path: "Pasta atual do servidor" };
  };

  return (
    <header class="h-14 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-md px-3 sm:px-6 flex items-center justify-between flex-shrink-0 z-30 select-none">
      {/* Breadcrumb, Menu Mobile & Seletor Rápido de Workspace */}
      <div class="flex items-center gap-2 text-xs min-w-0">
        <button
          type="button"
          onClick={() => setSidebarMobileAberta(true)}
          class="md:hidden h-9 w-9 -ml-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 border border-zinc-800 transition-colors cursor-pointer flex items-center justify-center shrink-0"
          title="Abrir navegação"
          aria-label="Abrir navegação"
        >
          <Menu size={18} />
        </button>

        {/* Seletor Rápido de Workspace no Topbar (Mobile e Desktop) */}
        <div class="relative flex items-center bg-zinc-900/90 border border-zinc-800 hover:border-zinc-700 rounded-lg px-2 h-8 min-w-0 transition-colors focus-within:border-emerald-500/60 shadow-xs shrink-0">
          <Building2 size={13} class="text-emerald-400 flex-shrink-0 mr-1.5 pointer-events-none" />
          <select
            id="select-workspace-topbar"
            class="bg-transparent text-xs font-semibold text-zinc-100 focus:outline-none cursor-pointer appearance-none truncate pr-4 max-w-[110px] sm:max-w-[170px]"
            value={wsAtivo()}
            onChange={(e) => {
              const novo = e.currentTarget.value;
              setWsAtivo(novo);
            }}
          >
            <option value="" class="bg-zinc-900 text-zinc-400" selected={!wsAtivo()}>
              {workspaces().length === 0 ? "(Sem empresa)" : "(Início)"}
            </option>
            <For each={workspaces()}>
              {(w) => (
                <option value={w.id} class="bg-zinc-900 text-zinc-100" selected={w.id === wsAtivo()}>
                  {w.id}
                </option>
              )}
            </For>
          </select>
          <ChevronsUpDown size={11} class="text-zinc-500 absolute right-1.5 pointer-events-none" />
        </div>

        <span class="text-zinc-600 hidden sm:inline">/</span>
        <span class="text-zinc-200 font-semibold truncate hidden sm:inline">{getBreadcrumb()}</span>
      </div>

      {/* Ações e Controles à Direita */}
      <div class="flex items-center gap-2.5">
        {/* Central de Notificações com Badge */}
        <A
          href="/notificacoes"
          data-view="notificacoes"
          class={`nav-item relative p-2 rounded-lg border transition-all flex items-center justify-center ${
            location.pathname === "/notificacoes"
              ? "bg-zinc-800 border-zinc-700 text-zinc-100 shadow-xs"
              : "bg-zinc-900/60 border-zinc-800/80 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-850 hover:border-zinc-700"
          }`}
          title="Central de Notificações"
        >
          <Bell size={15} />
          <Show when={notificacoesNaoLidas() > 0}>
            <span
              id="nav-badge-notificacoes"
              class="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-zinc-950 ring-2 ring-zinc-950 animate-pulse"
            >
              {notificacoesNaoLidas() > 99 ? "99+" : notificacoesNaoLidas()}
            </span>
          </Show>
        </A>

        {/* Indicador de Conexão SSE com Card Popover no Hover */}
        <div
          class="relative"
          onMouseEnter={onMouseEnterBadge}
          onMouseLeave={onMouseLeaveBadge}
        >
          <A
            href="/home?aba=aovivo"
            class={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
              sseConnected()
                ? "bg-emerald-950/30 border-emerald-800/50 text-emerald-300 hover:border-emerald-600/80"
                : "bg-zinc-900/60 border-zinc-800/60 text-zinc-400 hover:border-zinc-700"
            }`}
            title="Abrir Central de Operações Ao Vivo"
          >
            <Radio
              size={12}
              class={sseConnected() ? "text-emerald-400 animate-pulse" : "text-zinc-500"}
            />
            <span class="font-medium font-mono">
              {sseConnected() ? "ao vivo" : "offline"}
            </span>
            <Show when={statusInfo().executandoAgora}>
              <span class="h-1.5 w-1.5 rounded-full bg-blue-400 animate-ping ml-0.5" />
            </Show>
          </A>

          {/* CARD POPOVER INFORMATIVO AO VIVO */}
          <Show when={hoverCard()}>
            <div
              class="absolute right-0 top-full mt-2 w-96 p-4 rounded-2xl bg-zinc-950/95 border border-zinc-800/90 shadow-2xl backdrop-blur-xl z-50 text-xs space-y-3 animate-in fade-in duration-150"
              onMouseEnter={() => clearTimeout(timerHover)}
              onMouseLeave={onMouseLeaveBadge}
            >
              {/* Topo do Card */}
              <div class="flex items-center justify-between border-b border-zinc-800/80 pb-2.5">
                <div class="flex items-center gap-2">
                  <div class="h-6 w-6 rounded-md bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                    <Activity size={13} />
                  </div>
                  <span class="font-bold text-zinc-100 font-mono text-xs">
                    Centro de Operações
                  </span>
                </div>
                <A
                  href="/home?aba=aovivo"
                  class="text-[10px] font-mono text-emerald-400 hover:underline"
                >
                  Abrir Painel Completo →
                </A>
              </div>

              {/* SEÇÃO 1: EXECUÇÃO AO VIVO */}
              <div class="space-y-1">
                <div class="text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-mono">
                  Execução em Tempo Real
                </div>

                <Show
                  when={statusInfo().executandoAgora}
                  fallback={
                    <div class="p-2.5 rounded-xl bg-zinc-900/40 border border-zinc-800/60 flex items-center justify-between">
                      <div class="flex items-center gap-2 text-zinc-400 min-w-0">
                        <Bot size={14} class="text-zinc-500 flex-shrink-0" />
                        <span class="text-[11px] font-medium truncate">Nenhum agente executando agora</span>
                      </div>
                      <Show when={statusInfo().ultimaExecucao}>
                        {(ult) => (
                          <A
                            href={`/historico?run=${encodeURIComponent(ult().id)}`}
                            class="text-[10px] text-emerald-400 hover:underline font-mono flex-shrink-0"
                          >
                            Última: @{ult().agente}
                          </A>
                        )}
                      </Show>
                    </div>
                  }
                >
                  {(exec) => (
                    <div class="p-3 rounded-xl bg-blue-950/30 border border-blue-800/60 space-y-2 shadow-xs">
                      <div class="flex items-center justify-between">
                        <div class="flex items-center gap-1.5 text-blue-300 font-bold text-xs font-mono">
                          <span class="h-2 w-2 rounded-full bg-blue-400 animate-ping" />
                          <span>Executando Agora</span>
                        </div>
                        <A
                          href={exec().tipo === "secretario" ? `/secretario?sessao=${encodeURIComponent(exec().id)}` : `/historico?run=${encodeURIComponent(exec().id)}`}
                          class="px-2 py-0.5 rounded bg-blue-900/50 hover:bg-blue-800 text-[10px] text-blue-200 border border-blue-700/60 font-mono transition-colors"
                        >
                          {exec().tipo === "secretario" ? "Ver Chat Ao Vivo →" : "Ver Log →"}
                        </A>
                      </div>

                      <div class="flex items-center gap-2 text-xs">
                        <span class="font-bold text-zinc-100 font-mono">@{exec().agente}</span>
                        <span class="text-zinc-500 font-mono text-[10px] truncate max-w-[180px]">
                          {exec().id}
                        </span>
                      </div>

                      <Show when={exec().ordem}>
                        <p class="text-[11px] text-zinc-300 line-clamp-2 leading-relaxed">
                          {exec().ordem}
                        </p>
                      </Show>
                    </div>
                  )}
                </Show>
              </div>

              {/* SEÇÃO 2: PRÓXIMA TASK & PRÓXIMA ROTINA */}
              <div class="space-y-1.5">
                <div class="text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-mono">
                  Próxima Task & Agenda
                </div>

                {/* Próxima Task em Andamento / Prioritária */}
                <Show when={statusInfo().taskDestaque}>
                  {(task) => (
                    <A
                      href={`/tasks?task=${encodeURIComponent(task().id)}`}
                      class="p-2.5 rounded-xl bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800/80 hover:border-zinc-700 transition-all flex items-start gap-2.5 group"
                    >
                      <CheckSquare size={14} class="text-amber-400 flex-shrink-0 mt-0.5" />
                      <div class="min-w-0 flex-1 space-y-0.5">
                        <div class="flex items-center justify-between gap-1 text-[11px]">
                          <span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 capitalize">
                            {task().coluna}
                          </span>
                          <Show when={task().responsavel}>
                            <span class="text-[10px] font-mono text-zinc-400 truncate">
                              @{task().responsavel?.replace(/^agente:/, "")}
                            </span>
                          </Show>
                        </div>
                        <div class="text-xs text-zinc-200 font-medium truncate group-hover:text-emerald-300 transition-colors">
                          {task().titulo}
                        </div>
                      </div>
                    </A>
                  )}
                </Show>

                {/* Próxima Rotina do Scheduler */}
                <Show when={statusInfo().proximaRotina}>
                  {(rot) => (
                    <A
                      href="/agenda"
                      class="p-2.5 rounded-xl bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800/80 hover:border-zinc-700 transition-all flex items-center justify-between group text-xs"
                    >
                      <div class="flex items-center gap-2 min-w-0">
                        <Calendar size={14} class="text-purple-400 flex-shrink-0" />
                        <div class="truncate">
                          <span class="font-medium text-zinc-200 font-mono text-[11px] truncate group-hover:text-purple-300">
                            {rot().nome}
                          </span>
                        </div>
                      </div>
                      <span class="text-[10px] font-mono text-emerald-400 flex-shrink-0 font-medium">
                        {rot().diffMin === 0 ? "agora" : `em ~${rot().diffMin} min`}
                      </span>
                    </A>
                  )}
                </Show>
              </div>

              {/* SEÇÃO 3: SERVIÇOS & HITL */}
              <div class="grid grid-cols-3 gap-2 text-[10px] font-mono">
                {/* SSE */}
                <div class="p-2 rounded-lg bg-zinc-900/50 border border-zinc-800/60 text-center">
                  <div class="text-zinc-500">Stream</div>
                  <div class={sseConnected() ? "text-emerald-400 font-bold" : "text-zinc-500"}>
                    {sseConnected() ? "ao vivo" : "off"}
                  </div>
                </div>

                {/* Scheduler */}
                <div class="p-2 rounded-lg bg-zinc-900/50 border border-zinc-800/60 text-center">
                  <div class="text-zinc-500">Scheduler</div>
                  <div class="text-emerald-400 font-bold">ativo</div>
                </div>

                {/* HITL Aprovações */}
                <div class="p-2 rounded-lg bg-zinc-900/50 border border-zinc-800/60 text-center">
                  <div class="text-zinc-500">Aprovações</div>
                  <div
                    class={
                      (statusInfo().aprovacoesPendentes || 0) > 0
                        ? "text-amber-400 font-bold animate-pulse"
                        : "text-zinc-400"
                    }
                  >
                    {statusInfo().aprovacoesPendentes || 0} pend.
                  </div>
                </div>
              </div>

              {/* Rodapé com Atalhos Rápidos */}
              <div class="pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[11px]">
                <A
                  href="/home?aba=aovivo"
                  class="text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1 font-bold"
                >
                  <Activity size={12} />
                  <span>Central de Operações →</span>
                </A>
                <A
                  href="/config"
                  class="text-zinc-400 hover:text-emerald-400 transition-colors flex items-center gap-1"
                >
                  <Cpu size={12} />
                  <span>Config</span>
                </A>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </header>
  );
};
