import {
  type Component,
  createSignal,
  createEffect,
  onMount,
  onCleanup,
  For,
  Show,
  createMemo,
} from "solid-js";
import {
  Bot,
  Brain,
  Terminal,
  Globe,
  Plus,
  History,
  Settings2,
  Sparkles,
  ArrowDown,
  ArrowUp,
  Loader2,
  Trash2,
  Eye,
  EyeOff,
  Check,
  X,
  Clock,
  ExternalLink,
  Square,
} from "lucide-solid";
import { SessionTurn } from "./SessionTurn";
import { PromptInput, type Anexo } from "./PromptInput";
import { FollowupQueueDock } from "./FollowupQueueDock";
import { ChatIframeEmbed } from "./ChatIframeEmbed";
import { IconButton } from "../../ui/IconButton";
import { Button } from "../../ui/Button";
import type { UniversalChatProps } from "./types";

export const UniversalChat: Component<UniversalChatProps> = (props) => {
  // Configurações de visibilidade dos blocos
  const [mostrarPensamento, setMostrarPensamento] = createSignal(
    props.mostrarPensamentoPadrao !== false
  );
  const [mostrarAcoes, setMostrarAcoes] = createSignal(
    props.mostrarAcoesPadrao !== false
  );

  // Estado do Iframe Lateral Embutido
  const [iframeAberto, setIframeAberto] = createSignal(
    props.iframeConfig?.aberto ?? false
  );
  const [iframeUrl, setIframeUrl] = createSignal(props.iframeConfig?.url || "");
  const [iframeExpandido, setIframeExpandido] = createSignal(false);
  const [abaMobile, setAbaMobile] = createSignal<"chat" | "preview">("chat");

  // Estado local do Prompt (texto e anexos)
  const [localPrompt, setLocalPrompt] = createSignal(props.valorPrompt || "");
  const [localAnexos, setLocalAnexos] = createSignal<Anexo[]>([]);

  // Sincroniza valor externo do prompt (ex: restaurar ao editar)
  createEffect(() => {
    if (props.valorPrompt !== undefined) {
      setLocalPrompt(props.valorPrompt);
    }
  });

  // Sincroniza props de iframe quando mudarem externamente
  createEffect(() => {
    if (props.iframeConfig?.url) {
      setIframeUrl(props.iframeConfig.url);
    }
    if (props.iframeConfig?.aberto !== undefined) {
      setIframeAberto(props.iframeConfig.aberto);
    }
  });

  const abrirIframeComUrl = (url: string) => {
    setIframeUrl(url);
    setIframeAberto(true);
    setAbaMobile("preview");
    props.iframeConfig?.onUrlChange?.(url);
    props.iframeConfig?.onToggle?.(true);
  };

  const fecharIframe = () => {
    setIframeAberto(false);
    setIframeExpandido(false);
    setAbaMobile("chat");
    props.iframeConfig?.onToggle?.(false);
  };

  // Scroll automático
  let scrollContainerRef: HTMLDivElement | undefined;
  let usuarioRolouManual = false;
  const [mostrarBotaoFim, setMostrarBotaoFim] = createSignal(false);
  let carregandoAnterioresEmAndamento = false;

  const rolarParaFim = (suave = true) => {
    if (!scrollContainerRef) return;
    scrollContainerRef.scrollTo({
      top: scrollContainerRef.scrollHeight,
      behavior: suave ? "smooth" : "auto",
    });
    usuarioRolouManual = false;
    setMostrarBotaoFim(false);
  };

  const carregarAnterioresPreservandoScroll = async () => {
    if (
      !scrollContainerRef ||
      !props.onCarregarAnteriores ||
      props.carregandoAnteriores ||
      carregandoAnterioresEmAndamento ||
      !props.temMaisMensagensAnteriores
    ) {
      return;
    }
    carregandoAnterioresEmAndamento = true;
    const alturaAnterior = scrollContainerRef.scrollHeight;
    const topoAnterior = scrollContainerRef.scrollTop;

    try {
      await props.onCarregarAnteriores();
      // Ajusta o scroll imediatamente para manter o foco relativo
      requestAnimationFrame(() => {
        if (scrollContainerRef) {
          const diferenca = scrollContainerRef.scrollHeight - alturaAnterior;
          scrollContainerRef.scrollTop = topoAnterior + diferenca;
        }
      });
    } finally {
      setTimeout(() => {
        carregandoAnterioresEmAndamento = false;
      }, 250);
    }
  };

  const onScroll = () => {
    if (!scrollContainerRef) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef;
    const distanciaFim = scrollHeight - scrollTop - clientHeight;
    const rolouParaCima = distanciaFim > 80;
    usuarioRolouManual = rolouParaCima;
    setMostrarBotaoFim(rolouParaCima);

    // Infinite scroll para cima: ao chegar a menos de 100px do topo, carrega automaticamente mensagens anteriores
    if (scrollTop < 100 && props.temMaisMensagensAnteriores && !props.carregandoAnteriores && !carregandoAnterioresEmAndamento) {
      void carregarAnterioresPreservandoScroll();
    }
  };

  createEffect(() => {
    props.mensagens.length;
    if (!usuarioRolouManual) {
      setTimeout(() => rolarParaFim(false), 30);
    }
  });

  onMount(() => {
    rolarParaFim(false);
  });

  const agenteId = () => props.agente?.id || "secretario-exec";
  const agenteNome = () => props.agente?.nome || "secretario-exec";
  const modeloNome = () => props.agente?.modelo || "";
  const podeEnviar = () =>
    props.podeEnviarPrompt !== false && props.modo !== "leitura";
  const modoVis = () => props.modoVisualizacao || "ambos";

  return (
    <div class="flex flex-col h-full w-full overflow-hidden bg-zinc-950 text-zinc-100 relative">
      {/* ─── Topbar / Header do Chat (Apenas quando o chat está visível) ─── */}
      <Show when={modoVis() !== "app"}>
        <div class="flex items-center justify-between px-4 py-2.5 bg-zinc-900/70 border-b border-zinc-800/80 select-none z-10 flex-shrink-0 backdrop-blur-xs">
          <div class="flex items-center gap-3 min-w-0">
          <div class="h-8 w-8 rounded-xl bg-gradient-to-br from-emerald-500/20 to-blue-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 flex-shrink-0 shadow-xs">
            <Show
              when={props.agente?.icone}
              fallback={<Bot size={16} />}
            >
              {(Icone) => {
                const Comp = Icone();
                return <Comp size={16} />;
              }}
            </Show>
          </div>
          <div class="flex flex-col min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-semibold text-sm text-zinc-100 font-mono leading-none">
                @{agenteNome()}
              </span>
              <Show when={modeloNome()}>
                <span class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-800/80 text-zinc-400 border border-zinc-700/60 truncate max-w-xs">
                  {modeloNome()}
                </span>
              </Show>
              <Show when={props.agente?.status === "executando" || props.carregando}>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse flex items-center gap-1">
                  <span class="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  AO VIVO
                </span>
                <Show when={props.onParar}>
                  <button
                    type="button"
                    onClick={() => props.onParar?.()}
                    class="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 hover:border-rose-500/60 active:scale-95 transition-all flex items-center gap-1 cursor-pointer"
                    title="Interromper agente"
                  >
                    <Square size={9} fill="currentColor" />
                    Parar
                  </button>
                </Show>
              </Show>
            </div>
          </div>
        </div>

        {/* Alternador de Abas Mobile quando o Iframe está aberto */}
        <Show when={iframeAberto()}>
          <div class="flex md:hidden items-center bg-zinc-950 border border-zinc-800 rounded-lg p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setAbaMobile("chat")}
              class={`px-2 py-1 rounded font-medium transition-colors ${
                abaMobile() === "chat" ? "bg-zinc-800 text-zinc-100" : "text-zinc-400"
              }`}
            >
              💬 Chat
            </button>
            <button
              type="button"
              onClick={() => setAbaMobile("preview")}
              class={`px-2 py-1 rounded font-medium transition-colors ${
                abaMobile() === "preview" ? "bg-zinc-800 text-zinc-100" : "text-zinc-400"
              }`}
            >
              🌐 Preview
            </button>
          </div>
        </Show>

        {/* Ações da Direita (Toggles, Sessões, Iframe) */}
        <div class="flex items-center gap-2">
          {/* Toggle de Pensamento */}
          <IconButton
            size="lg"
            titulo={
              mostrarPensamento()
                ? "Ocultar Raciocínio / Pensamento"
                : "Exibir Raciocínio / Pensamento"
            }
            onClick={() => setMostrarPensamento((p) => !p)}
            class={
              mostrarPensamento()
                ? "text-purple-400 bg-purple-500/10 border border-purple-500/30"
                : "text-zinc-500 hover:text-zinc-300"
            }
          >
            <Brain size={22} />
          </IconButton>

          {/* Toggle de Ações / Ferramentas */}
          <IconButton
            size="lg"
            titulo={
              mostrarAcoes()
                ? "Ocultar Passos de Ferramentas"
                : "Exibir Passos de Ferramentas"
            }
            onClick={() => setMostrarAcoes((a) => !a)}
            class={
              mostrarAcoes()
                ? "text-amber-400 bg-amber-500/10 border border-amber-500/30"
                : "text-zinc-500 hover:text-zinc-300"
            }
          >
            <Terminal size={22} />
          </IconButton>

          {/* Toggle de Preview Lateral (Iframe) */}
          <IconButton
            size="lg"
            titulo={iframeAberto() ? "Fechar Preview Lateral" : "Abrir Preview Lateral (Iframe)"}
            onClick={() => {
              if (iframeAberto()) {
                fecharIframe();
              } else {
                setIframeAberto(true);
                props.iframeConfig?.onToggle?.(true);
              }
            }}
            class={
              iframeAberto()
                ? "text-blue-400 bg-blue-500/15 border border-blue-500/30"
                : "text-zinc-400 hover:text-zinc-200"
            }
          >
            <Globe size={22} />
          </IconButton>

          <Show when={props.onNovaSessao}>
            <IconButton
              data-testid="btn-nova-conversa"
              size="lg"
              titulo="Nova Conversa"
              onClick={props.onNovaSessao!}
              class="text-zinc-400 hover:text-zinc-200"
            >
              <Plus size={22} />
            </IconButton>
          </Show>

          <Show when={props.onAbrirHistorico}>
            <IconButton
              size="lg"
              titulo="Histórico de Sessões"
              onClick={props.onAbrirHistorico!}
              class="text-zinc-400 hover:text-zinc-200"
            >
              <History size={22} />
            </IconButton>
          </Show>

          <Show when={props.onAbrirConfiguracoes}>
            <IconButton
              size="lg"
              titulo="Configurar Agente / Motor"
              data-testid="btn-configurar-motor"
              onClick={props.onAbrirConfiguracoes!}
              class="text-zinc-400 hover:text-zinc-200"
            >
              <Settings2 size={22} />
            </IconButton>
          </Show>
        </div>
        </div>
      </Show>

      {/* ─── Corpo Principal (Chat + Iframe Split View) ──────────── */}
      <div class="flex flex-1 min-h-0 w-full overflow-hidden relative">
        {/* Painel do Chat */}
        <div
          class={`flex flex-col h-full min-w-0 transition-all duration-200 ${
            modoVis() === "app"
              ? "hidden"
              : modoVis() === "chat"
                ? "w-full flex"
                : iframeAberto()
                  ? iframeExpandido()
                    ? "hidden md:hidden"
                    : "w-full md:w-1/2 flex"
                  : "w-full flex"
          } ${iframeAberto() && abaMobile() === "preview" && modoVis() === "ambos" ? "hidden md:flex" : "flex"}`}
        >
          {/* Feed de Mensagens com Scroll */}
          <div
            ref={scrollContainerRef}
            onScroll={onScroll}
            class="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0 scrollbar-thin"
          >
            <Show
              when={props.mensagens.length > 0}
              fallback={
                <div class="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500 select-none">
                  <div class="h-12 w-12 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-blue-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-3 shadow-inner">
                    <Sparkles size={24} />
                  </div>
                  <h3 class="text-base font-semibold text-zinc-200 mb-1">
                    {agenteNome()} pronto para atuar
                  </h3>
                  <p class="text-xs text-zinc-500 max-w-md mb-4">
                    Envie ordens, peça modificações em arquivos do workspace ou visualize previews ao vivo.
                  </p>

                  <Show when={props.sugestoesRapidas && props.sugestoesRapidas.length > 0}>
                    <div class="flex flex-wrap gap-2 justify-center max-w-lg">
                      <For each={props.sugestoesRapidas}>
                        {(s) => (
                          <button
                            type="button"
                            onClick={() => props.onEnviarPrompt?.(s.prompt)}
                            class="px-3 py-1.5 rounded-xl bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-300 hover:text-zinc-100 transition-colors cursor-pointer text-left"
                          >
                            {s.rotulo}
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              }
            >
              <div class="max-w-3xl mx-auto w-full space-y-3">
                {/* Indicador de Mensagens Anteriores / Início da Conversa */}
                <Show when={props.temMaisMensagensAnteriores}>
                  <div class="flex justify-center py-2">
                    <Show
                      when={props.carregandoAnteriores}
                      fallback={
                        <button
                          type="button"
                          onClick={carregarAnterioresPreservandoScroll}
                          class="text-xs px-3.5 py-1.5 rounded-full bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700/60 text-zinc-300 hover:text-white transition-all flex items-center gap-1.5 cursor-pointer shadow-md hover:scale-102 active:scale-98"
                          title="Carregar mensagens anteriores desta conversa"
                        >
                          <ArrowUp size={13} class="text-emerald-400" />
                          <span>
                            Carregar mensagens anteriores
                            {props.totalMensagens && props.totalMensagens > props.mensagens.length
                              ? ` (${props.totalMensagens - props.mensagens.length} restantes)`
                              : ""}
                          </span>
                        </button>
                      }
                    >
                      <div class="text-xs px-3.5 py-1.5 rounded-full bg-zinc-900/90 border border-emerald-500/30 text-emerald-400 flex items-center gap-2 shadow-sm animate-pulse">
                        <Loader2 size={13} class="animate-spin text-emerald-400" />
                        <span>Carregando mensagens anteriores...</span>
                      </div>
                    </Show>
                  </div>
                </Show>
                <Show when={!props.temMaisMensagensAnteriores && (props.totalMensagens || 0) > 2}>
                  <div class="text-center py-2 text-[11px] text-zinc-600 flex items-center justify-center gap-2 select-none">
                    <span class="h-px w-12 bg-zinc-800/80"></span>
                    <span>Início do histórico da conversa</span>
                    <span class="h-px w-12 bg-zinc-800/80"></span>
                  </div>
                </Show>

                <For each={props.mensagens}>
                  {(msg, idx) => {
                    // Verifica se há uma mensagem do usuário APÓS esta mensagem do assistente
                    const jaRespondida = () => {
                      if (msg.role !== "assistant") return false;
                      const proximas = props.mensagens.slice(idx() + 1);
                      return proximas.some((m) => m.role === "user");
                    };
                    return (
                      <SessionTurn
                        mensagem={msg}
                        indice={idx()}
                        decorridoFmt={props.decorridoFmt}
                        mostrarPensamento={mostrarPensamento()}
                        mostrarAcoes={mostrarAcoes()}
                        mostrarTerminal={props.mostrarTerminalPadrao !== false}
                        onEditarPrompt={props.onEditarPrompt}
                        onAprovarHitl={props.onAprovarHitl}
                        onRejeitarHitl={props.onRejeitarHitl}
                        onAbrirIframeUrl={abrirIframeComUrl}
                        jaRespondida={jaRespondida()}
                        onSelecionarOpcao={(opcao) => {
                          if (props.onSelecionarOpcao) {
                            props.onSelecionarOpcao(opcao);
                          } else {
                            void props.onEnviarPrompt?.(opcao);
                          }
                        }}
                      />
                    );
                  }}
                </For>
              </div>
            </Show>
          </div>

          {/* Botão Flutuante de Rolar para o Fim */}
          <Show when={mostrarBotaoFim()}>
            <button
              type="button"
              onClick={() => rolarParaFim(true)}
              class="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-700 text-xs text-zinc-200 shadow-lg hover:bg-zinc-800 flex items-center gap-1.5 transition-all animate-bounce cursor-pointer"
            >
              <ArrowDown size={13} /> Novas mensagens
            </button>
          </Show>

          {/* Prompt Input (Apenas se podeEnviar for verdadeiro) */}
          <Show when={podeEnviar()}>
            <div class="p-3 bg-zinc-950 border-t border-zinc-800/80 flex-shrink-0">
              <div class="max-w-3xl mx-auto w-full">
                {/* Dock da Fila de Espera (Prompts agendados/followups) */}
                <FollowupQueueDock
                  items={props.filaPrompts || []}
                  onAdiantar={props.onAdiantarFila}
                  onEditar={props.onEditarFila}
                  onRemover={props.onRemoverFila}
                />

                <PromptInput
                  valor={props.valorPrompt !== undefined ? props.valorPrompt : localPrompt()}
                  onInput={(v) => {
                    setLocalPrompt(v);
                    props.onValorPromptChange?.(v);
                  }}
                  onEnfileirar={(txt, att) => {
                    if (props.onAdicionarFila) {
                      props.onAdicionarFila(txt, att);
                    }
                  }}
                  refTextarea={props.refTextarea}
                  anexos={localAnexos()}
                  onAdicionarAnexo={(a) => setLocalAnexos((prev) => [...prev, a])}
                  onRemoverAnexo={(idx) => setLocalAnexos((prev) => prev.filter((_, i) => i !== idx))}
                  placeholder={
                    props.placeholder || `Envie uma ordem ou mensagem para @${agenteNome()}...`
                  }
                  carregando={props.carregando || false}
                  onParar={props.onParar}
                  agenteSelecionado={agenteId()}
                  onMudarAgente={() => {}}
                  onEnviar={() => {
                    const txt = props.valorPrompt !== undefined ? props.valorPrompt : localPrompt();
                    const att = localAnexos();
                    if (!txt.trim() && att.length === 0) return;
                    setLocalPrompt("");
                    props.onValorPromptChange?.("");
                    setLocalAnexos([]);
                    if (props.onEnviarPrompt) {
                      void props.onEnviarPrompt(txt, att);
                    }
                  }}
                />
              </div>
            </div>
          </Show>
        </div>

        {/* Painel do Iframe Embed (Split View ou Tela Cheia) */}
        <Show when={iframeAberto() && modoVis() !== "chat"}>
          <div
            class={`h-full min-w-0 transition-all duration-200 ${
              modoVis() === "app" || iframeExpandido() ? "w-full" : "w-full md:w-1/2"
            } ${abaMobile() === "chat" && modoVis() === "ambos" ? "hidden md:block" : "block"}`}
          >
            <ChatIframeEmbed
              url={iframeUrl()}
              titulo={props.iframeConfig?.titulo || "Preview"}
              aberto={true}
              onFechar={fecharIframe}
              onUrlChange={(u) => {
                setIframeUrl(u);
                props.iframeConfig?.onUrlChange?.(u);
              }}
              modoExpandido={modoVis() === "app" || iframeExpandido()}
              onToggleExpandido={() => setIframeExpandido((e) => !e)}
            />
          </div>
        </Show>
      </div>
    </div>
  );
};
