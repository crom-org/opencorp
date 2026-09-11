import { type Component, createSignal, createEffect, createMemo, For, Show } from "solid-js";
import {
  Copy,
  Check,
  Edit3,
  ShieldAlert,
  CheckCircle,
  XCircle,
  Terminal,
  Brain,
  Globe,
  Sparkles,
  HelpCircle,
  ChevronRight,
  ChevronLeft,
  Send,
  CornerDownLeft,
} from "lucide-solid";
import { IconButton } from "../../ui/IconButton";
import { Button } from "../../ui/Button";
import { showToast } from "../../ui/Toast";
import { renderMarkdown, processarDiagramasMermaid } from "../../md.js";
import type { ChatMensagem, TurnoPasso, AcaoItem, ItemPergunta } from "./types";

export type { ChatMensagem, TurnoPasso, AcaoItem, ItemPergunta };

export interface SessionTurnProps {
  mensagem: ChatMensagem;
  indice: number;
  decorridoFmt?: string;
  onEditarPrompt?: (indice: number) => void;
  onAprovarHitl?: (id: string) => void;
  onRejeitarHitl?: (id: string, motivo: string) => void;
  mostrarPensamento?: boolean;
  mostrarAcoes?: boolean;
  mostrarTerminal?: boolean;
  onAbrirIframeUrl?: (url: string) => void;
  onSelecionarOpcao?: (opcao: string) => void;
  /** Se true, o usuário já respondeu a esta mensagem (há uma msg do user após ela) — oculta o card de opções */
  jaRespondida?: boolean;
}

/** Componente dedicado para o corpo de pensamento: auto-scroll para baixo durante geração ao vivo e preservação de rolagem manual sem saltos para o topo */
const PensamentoCorpo: Component<{ texto: string }> = (props) => {
  let containerRef: HTMLDivElement | undefined;
  let usuarioRolouParaCima = false;

  const onScroll = () => {
    if (!containerRef) return;
    const distFim = containerRef.scrollHeight - containerRef.scrollTop - containerRef.clientHeight;
    usuarioRolouParaCima = distFim > 45;
  };

  createEffect(() => {
    // Monitora alterações no texto do pensamento
    const _t = props.texto;
    if (!containerRef) return;
    const scrollAnterior = containerRef.scrollTop;
    queueMicrotask(() => {
      if (!containerRef) return;
      if (!usuarioRolouParaCima) {
        // Auto-scroll para baixo acompanhando o raciocínio em tempo real
        containerRef.scrollTop = containerRef.scrollHeight;
      } else {
        // Preserva a posição que o usuário escolheu, sem resetar para 0
        containerRef.scrollTop = scrollAnterior;
      }
    });
  });

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      class="p-3 text-zinc-300 leading-relaxed font-sans border-t border-zinc-800/60 bg-zinc-950/40 max-h-64 overflow-y-auto scrollbar-thin select-text text-xs"
      innerHTML={renderMarkdown(props.texto)}
    />
  );
};

/**
 * Detecta se um texto do assistente apresenta opções de escolha para o usuário
 * (ex: listas numeradas "1. ...", "2. ...", ou com bullets após uma pergunta).
 */
/**
 * Extrai todas as perguntas com opções de escolha contidas no texto do assistente
 * (suporta múltiplas perguntas, blocos inline "(a)... (b)...", listas numeradas e tópicos).
 */
export function extrairPerguntasDeTexto(texto?: string): ItemPergunta[] {
  if (!texto || typeof texto !== "string") return [];
  const perguntas: ItemPergunta[] = [];
  const linhas = texto.split("\n").map((l) => l.trim());

  let i = 0;
  while (i < linhas.length) {
    const l = linhas[i];

    // 1.1 Linha inline com (a)... (b)...
    if (/\(a\)/i.test(l) && /\(b\)/i.test(l)) {
      const partes = l.split(/(?=\([a-d]\))/i);
      const opcoes: string[] = [];
      let perguntaTexto = "";
      let header: string | undefined;

      const matchHeader = /^([^:\n]{2,35}):/i.exec(partes[0] || "");
      if (matchHeader) {
        header = matchHeader[1].trim();
      }

      for (const p of partes) {
        const m = /^\(([a-d])\)\s*(.+)$/i.exec(p.trim());
        if (m) {
          let conteudo = m[2].trim();
          const qMatch = /^(.*?)(?:\s+(?:qual|o que|como|deseja|prefere).*?\?|\s*\?)/i.exec(conteudo);
          if (qMatch && qMatch[1].length > 5) {
            conteudo = qMatch[1].trim();
          }
          opcoes.push(conteudo.replace(/;$/, "").trim());
        } else if (!perguntaTexto) {
          perguntaTexto = p.replace(/^.*?(?:opções|escolha|opção)[:\s]*/i, "").trim();
        }
      }

      if (opcoes.length >= 2 && opcoes.length <= 6) {
        if (!perguntaTexto || perguntaTexto.length < 5) {
          perguntaTexto = header ? `${header}: Escolha uma opção` : "Escolha uma opção:";
        }
        perguntas.push({
          id: `q_${perguntas.length + 1}`,
          header,
          pergunta: perguntaTexto,
          opcoes,
          permiteCustom: true,
        });
        i++;
        continue;
      }
    }

    // 1.2 Bloco vertical de opções numeradas ou com letras
    const matchNum = /^(?:(?:\d+[\.\)]|\[\d+\]|[a-d][\.\)])\s+)(.+)$/i.exec(l);
    if (matchNum) {
      const possiveisOpcoes = [matchNum[1].trim()];
      let j = i + 1;
      while (j < linhas.length) {
        const prox = linhas[j];
        if (!prox) { j++; continue; }
        const mProx = /^(?:(?:\d+[\.\)]|\[\d+\]|[a-d][\.\)])\s+)(.+)$/i.exec(prox);
        if (mProx) {
          possiveisOpcoes.push(mProx[1].trim());
          j++;
        } else {
          break;
        }
      }

      if (possiveisOpcoes.length >= 2 && possiveisOpcoes.length <= 6) {
        const saoMuitoLongas = possiveisOpcoes.some((o) => o.length > 130 || o.startsWith("##") || o.includes("\n"));
        // Filtra itens que são claramente dados/arquivos/caminhos e não opções reais de escolha
        const pareceDados = possiveisOpcoes.some((o) =>
          /\.(json|ts|tsx|js|jsx|yaml|yml|md|txt|csv|xml|html|css|py|sh|sql|log|png|jpg|gif|svg|mp4|webp|pdf|env|toml|lock)\b/i.test(o) ||
          /^[`'"].*[`'"]$/.test(o) ||
          /^['"`]/.test(o) ||
          /^\/.+\//.test(o) ||
          /^~\/|^\.\/|^home\/|^\/home/i.test(o) ||
          /^[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z]{2,5}$/i.test(o) ||
          /^(https?:\/\/|ftp:\/\/)/.test(o)
        );
        if (!saoMuitoLongas && !pareceDados) {
          let perguntaEncontrada: string | undefined;
          let headerEncontrado: string | undefined;
          for (let k = i - 1; k >= Math.max(0, i - 4); k--) {
            const anterior = linhas[k];
            if (!anterior) continue;
            if (anterior.includes("?") || /escolha|opç|qual|deseja|selecione/i.test(anterior)) {
              perguntaEncontrada = anterior.replace(/^[#*>\s]+/, "").trim();
              const mH = /^([^:\n]{2,35}):/i.exec(perguntaEncontrada);
              if (mH) headerEncontrado = mH[1].trim();
              break;
            }
          }
          // Só cria card interativo se encontrou uma pergunta explícita antes da lista —
          // listas numeradas sem pergunta são informativas (ex: listagem de arquivos, passos, etc.)
          if (perguntaEncontrada) {
            perguntas.push({
              id: `q_${perguntas.length + 1}`,
              header: headerEncontrado,
              pergunta: perguntaEncontrada,
              opcoes: possiveisOpcoes,
              permiteCustom: true,
            });
            i = j;
            continue;
          }
        }
      }
    }

    // 1.3 Seção ou parágrafo que faz pergunta explícita no formato "Tópico: pergunta? Ou alternativa?"
    const matchTopicoPergunta = /^(\*{0,2})([A-ZÀ-Ú][^:\n—(]{2,35})(?:\s*\([^)]*\))?\1(?:\s*:\s*|\s+[—\-]\s+)(.+)$/i.exec(l);
    if (matchTopicoPergunta) {
      const topico = matchTopicoPergunta[2].trim();
      const resto = matchTopicoPergunta[3].trim();

      const jaProcessado = perguntas.some((p) => p.header?.toLowerCase() === topico.toLowerCase());
      if (!jaProcessado) {
        // Alternativas explícitas com "Ou X?"
        const matchOu = /(?:posso|quer|deseja|prefere)?\s*([^?]+)\?\s*Ou\s+(.*?)(?:\s+é\s+aceitável)?\?/i.exec(resto);
        if (matchOu) {
          let opt1 = matchOu[1].replace(/^.*?—\s*/, "").replace(/^[—\s]+/, "").trim();
          let opt2 = matchOu[2].trim();
          opt1 = opt1.replace(/^(?:posso|devo|quer)\s+/i, "");
          opt1 = opt1.charAt(0).toUpperCase() + opt1.slice(1);
          opt2 = opt2.charAt(0).toUpperCase() + opt2.slice(1);
          if (opt1.length > 3 && opt2.length > 3) {
            perguntas.push({
              id: `q_${perguntas.length + 1}`,
              header: topico,
              pergunta: `${topico}: ${resto}`,
              opcoes: [opt1, opt2],
              permiteCustom: true,
            });
            i++;
            continue;
          }
        }

        // Pergunta de confirmação "quer X?" ou "posso X?"
        const matchSimNao = /(?:quer|deseja|posso|devo)\s+([^?]+)\?/i.exec(resto);
        if (matchSimNao && resto.includes("?")) {
          const acao = matchSimNao[1].trim();
          const acaoCurta = acao.length > 40 ? `${acao.slice(0, 37)}...` : acao;
          perguntas.push({
            id: `q_${perguntas.length + 1}`,
            header: topico,
            pergunta: `${topico}: ${resto}`,
            opcoes: [`Sim, ${acaoCurta}`, "Não, deixar para depois"],
            permiteCustom: true,
          });
          i++;
          continue;
        }

        // Afirmação com proposição "posso montar via X já"
        const matchProposicao = /(?:posso|podemos|devo)\s+([^.\n]+)/i.exec(resto);
        if (matchProposicao && !resto.includes("não")) {
          const acao = matchProposicao[1].trim();
          const acaoCurta = acao.length > 40 ? `${acao.slice(0, 37)}...` : acao;
          perguntas.push({
            id: `q_${perguntas.length + 1}`,
            header: topico,
            pergunta: `${topico}: ${resto}`,
            opcoes: [`Sim, pode ${acaoCurta}`, "Ainda não, aguardar"],
            permiteCustom: true,
          });
          i++;
          continue;
        }
      }
    }

    i++;
  }

  return perguntas;
}

/** Wrapper para compatibilidade com código que espera uma única pergunta/opções */
export function extrairOpcoesDeTexto(texto?: string): { pergunta?: string; opcoes: string[] } | null {
  const lista = extrairPerguntasDeTexto(texto);
  if (lista.length === 0) return null;
  return {
    pergunta: lista[0].pergunta,
    opcoes: lista[0].opcoes,
  };
}

// Armazenamento reativo global/persistente para evitar reset de estado entre ticks de polling ou reconciliação do SolidJS
const [globalCustomInputAberto, setGlobalCustomInputAberto] = createSignal<Record<string, Record<string, boolean>>>({});
const [globalCustomTexto, setGlobalCustomTexto] = createSignal<Record<string, Record<string, string>>>({});
const [globalRespostasMulti, setGlobalRespostasMulti] = createSignal<Record<string, Record<string, string>>>({});
const [globalAbasAtivas, setGlobalAbasAtivas] = createSignal<Record<string, number>>({});

export const SessionTurn: Component<SessionTurnProps> = (props) => {
  const [copiado, setCopiado] = createSignal(false);
  const [opcaoEscolhida, setOpcaoEscolhida] = createSignal<string | null>(null);
  const msgKey = () => props.mensagem.id || `idx_${props.indice}`;

  const abaPerguntaAtiva = () => globalAbasAtivas()[msgKey()] || 0;
  const setAbaPerguntaAtiva = (novaAba: number) => {
    const k = msgKey();
    setGlobalAbasAtivas((prev) => ({ ...prev, [k]: novaAba }));
  };

  const respostasPorPergunta = () => globalRespostasMulti()[msgKey()] || {};
  const setResposta = (k: string, val: string) => {
    const mId = msgKey();
    setGlobalRespostasMulti((prev) => ({
      ...prev,
      [mId]: { ...(prev[mId] || {}), [k]: val },
    }));
  };

  const m = () => props.mensagem;

  // Consolidação de perguntas estruturadas (via tool ask_question ou via texto)
  const dadosPerguntas = createMemo((): ItemPergunta[] => {
    const mVal = m();
    if (mVal.role !== "assistant") return [];

    // 1. Múltiplas perguntas diretas na mensagem
    if (mVal.perguntas && mVal.perguntas.length > 0) {
      return mVal.perguntas;
    }

    // 2. Opções diretas singulares na mensagem
    if (mVal.opcoes && mVal.opcoes.length > 0) {
      return [
        {
          id: "q_root",
          pergunta: mVal.pergunta || "Escolha uma opção:",
          opcoes: mVal.opcoes,
          permiteCustom: true,
        },
      ];
    }

    // 3. Perguntas ou opções vindas de passos (tool call ask_question)
    if (mVal.passos) {
      for (const p of mVal.passos) {
        if (p.perguntas && p.perguntas.length > 0) {
          return p.perguntas;
        }
        if (p.tipo === "pergunta" && p.opcoes && p.opcoes.length > 0) {
          return [
            {
              id: "q_passo",
              pergunta: p.pergunta,
              opcoes: p.opcoes,
              permiteCustom: true,
            },
          ];
        }
        if (p.tipo === "acao" && p.opcoes && p.opcoes.length > 0) {
          return [
            {
              id: "q_acao",
              pergunta: p.pergunta || p.resumo || "Escolha uma opção:",
              opcoes: p.opcoes,
              permiteCustom: true,
            },
          ];
        }
      }
    }

    // 4. Detecção inteligente no texto da mensagem
    return extrairPerguntasDeTexto(mVal.content);
  });

  const totalPerguntas = () => dadosPerguntas().length;
  const abaAtual = () => Math.min(abaPerguntaAtiva(), Math.max(0, totalPerguntas() - 1));
  const perguntaAtual = () => dadosPerguntas()[abaAtual()];
  const qKey = (q: ItemPergunta, idx: number) => q.id || `q_${idx}`;
  const keyAtual = () => {
    const q = perguntaAtual();
    return q ? qKey(q, abaAtual()) : "";
  };

  const respostaAtual = () => respostasPorPergunta()[keyAtual()] || "";
  const isCustomAberto = () => !!globalCustomInputAberto()[msgKey()]?.[keyAtual()];
  const setCustomAberto = (aberto: boolean) => {
    const mId = msgKey();
    const qk = keyAtual();
    setGlobalCustomInputAberto((prev) => ({
      ...prev,
      [mId]: { ...(prev[mId] || {}), [qk]: aberto },
    }));
  };

  const textoCustomAtual = () => globalCustomTexto()[msgKey()]?.[keyAtual()] || "";
  const setTextoCustom = (val: string) => {
    const mId = msgKey();
    const qk = keyAtual();
    setGlobalCustomTexto((prev) => ({
      ...prev,
      [mId]: { ...(prev[mId] || {}), [qk]: val },
    }));
  };

  const responderOpcao = (opcao: string) => {
    const total = totalPerguntas();
    if (total <= 1) {
      setOpcaoEscolhida(opcao);
      props.onSelecionarOpcao?.(opcao);
      return;
    }
    const k = keyAtual();
    setResposta(k, opcao);
    // Se não for a última pergunta, avança automaticamente para agilizar a resposta
    if (abaAtual() < total - 1) {
      setAbaPerguntaAtiva(abaAtual() + 1);
    }
  };

  const enviarCustom = () => {
    const txt = textoCustomAtual().trim();
    if (!txt) return;
    const total = totalPerguntas();
    if (total <= 1) {
      setOpcaoEscolhida(txt);
      props.onSelecionarOpcao?.(txt);
      return;
    }
    const k = keyAtual();
    setResposta(k, txt);
    if (abaAtual() < total - 1) {
      setAbaPerguntaAtiva(abaAtual() + 1);
    } else {
      enviarTodasRespostas();
    }
  };

  const pularPergunta = () => {
    const total = totalPerguntas();
    if (total <= 1) {
      props.onSelecionarOpcao?.("Pular / sem preferência");
      return;
    }
    const k = keyAtual();
    setResposta(k, "(Ignorado)");
    if (abaAtual() < total - 1) {
      setAbaPerguntaAtiva(abaAtual() + 1);
    } else {
      enviarTodasRespostas();
    }
  };

  const totalRespondidas = () => {
    const resps = respostasPorPergunta();
    const lista = dadosPerguntas();
    return lista.filter((q, idx) => {
      const k = qKey(q, idx);
      return !!resps[k];
    }).length;
  };

  const enviarTodasRespostas = () => {
    const lista = dadosPerguntas();
    const resps = respostasPorPergunta();
    const linhas: string[] = [];
    lista.forEach((q, idx) => {
      const k = qKey(q, idx);
      const r = resps[k];
      if (r && r !== "(Ignorado)") {
        const titulo = q.header || q.pergunta || `Pergunta ${idx + 1}`;
        linhas.push(`${titulo}: ${r}`);
      }
    });
    if (linhas.length > 0) {
      props.onSelecionarOpcao?.(linhas.join("\n"));
    }
  };

  // Só pulsa se este passo for o ÚLTIMO passo e ainda não houver resposta final emitida
  const isPassoPensandoAtivo = (idx: number) => {
    if (m().concluida !== false) return false;
    const passos = m().passos;
    if (!passos || passos.length === 0) return false;
    const isUltimo = idx === passos.length - 1;
    const ultPasso = passos[passos.length - 1];
    return isUltimo && ultPasso?.tipo === "pensamento" && !m().content;
  };

  const isPensandoAutonomoAtivo = (pIdx: number, total: number) => {
    if (m().concluida !== false) return false;
    return pIdx === total - 1 && !m().content;
  };

  // Detecta primeira URL no conteúdo para sugestão de preview lateral
  const urlDetectada = createMemo(() => {
    if (m().iframeUrl) return m().iframeUrl;
    const match = m().content?.match(/(https?:\/\/[^\s"'<>)]+)/i);
    return match ? match[1] : null;
  });

  const copiar = async () => {
    const texto = m().content || "";
    if (!texto) {
      showToast("Nada para copiar", "aviso");
      return;
    }
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(texto);
        ok = true;
      }
    } catch {
      /* fallback abaixo */
    }
    if (!ok) {
      try {
        const ta = document.createElement("textarea");
        ta.value = texto;
        ta.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        /* nada */
      }
    }
    if (ok) {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
      showToast("Copiado para a área de transferência", "info");
    } else {
      showToast("Falha ao copiar", "aviso");
    }
  };

  let turnRef: HTMLDivElement | undefined;

  createEffect(() => {
    m().content;
    m().passos;
    if (turnRef) {
      setTimeout(() => {
        if (turnRef) void processarDiagramasMermaid(turnRef);
      }, 40);
    }
  });

  return (
    <div
      ref={turnRef}
      data-role={m().role}
      class={`group relative flex flex-col py-3 px-4 rounded-xl transition-colors ${
        m().role === "user"
          ? "oc-user bg-zinc-900/60 border border-zinc-800/80 ml-auto max-w-[85%]"
          : "oc-assistant bg-transparent mr-auto max-w-full w-full"
      }`}
    >
      {/* Imagens Anexadas ao Turno */}
      <Show when={m().imagens && m().imagens!.length > 0}>
        <div class="flex flex-wrap gap-2 mb-2">
          <For each={m().imagens}>
            {(src) => (
              <img
                src={src}
                alt="Anexo de prompt"
                class="max-w-xs max-h-48 rounded-lg border border-zinc-700 object-cover shadow-sm cursor-zoom-in"
                onClick={() => window.open(src, "_blank")}
              />
            )}
          </For>
        </div>
      </Show>

      {/* Alerta de HITL (Human In The Loop) */}
      <Show when={m().hitl}>
        {(h) => (
          <div class="my-2 p-3 rounded-lg bg-amber-950/30 border border-amber-800/60 text-xs">
            <div class="flex items-center gap-1.5 font-semibold text-amber-300 mb-1">
              <ShieldAlert size={15} />
              <span>Autorização Requerida · {h().agente}</span>
            </div>
            <p class="text-zinc-300 mb-1">{h().ordem}</p>
            <p class="text-amber-400/80 italic text-[11px] mb-2">{h().motivo_guard}</p>
            <div class="flex items-center gap-2">
              <Button
                size="xs"
                variant="primary"
                onClick={() => props.onAprovarHitl?.(h().id)}
              >
                <CheckCircle size={13} class="mr-1 text-emerald-600" /> Aprovar
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  const mot = prompt("Motivo da rejeição:")?.trim();
                  if (mot) props.onRejeitarHitl?.(h().id, mot);
                }}
              >
                <XCircle size={13} class="mr-1 text-rose-400" /> Rejeitar
              </Button>
            </div>
          </div>
        )}
      </Show>

      {/* Saída de Terminal Direto */}
      <Show when={props.mostrarTerminal !== false && m().terminal !== undefined}>
        <pre class="p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-emerald-400 overflow-x-auto my-1 scrollbar-thin">
          <code>{m().terminal}</code>
        </pre>
      </Show>

      {/* Indicador de Raciocínio ao Vivo quando ainda não há passos prontos */}
      <Show
        when={
          props.mostrarPensamento !== false &&
          m().concluida === false &&
          (!m().passos || m().passos!.length === 0) &&
          !m().content &&
          !m().pensamento
        }
      >
        <div class="flex items-center gap-2 text-xs font-mono text-purple-300 py-2 px-3 rounded-xl bg-purple-950/40 border border-purple-800/50 animate-pulse my-1.5">
          <span class="animate-spin text-purple-400">⚡</span>
          <span>Iniciando raciocínio ao vivo...</span>
          <Show when={props.decorridoFmt}>
            <span class="ml-auto text-zinc-500 text-[10px]">{props.decorridoFmt}</span>
          </Show>
        </div>
      </Show>

      {/* Pensamento Autônomo se não estiver presente nos passos */}
      <Show
        when={
          props.mostrarPensamento !== false &&
          m().pensamento &&
          (!m().passos || !m().passos!.some((p) => p.tipo === "pensamento" && p.texto))
        }
      >
        <For each={m().pensamento!.split("\n\n---\n\n").filter(Boolean)}>
          {(pensamentoItem, pIdx) => {
            const itens = m().pensamento!.split("\n\n---\n\n").filter(Boolean);
            const ativo = () => isPensandoAutonomoAtivo(pIdx(), itens.length);
            return (
              <details
                class="mb-2 rounded-xl bg-zinc-950/70 border border-zinc-800/80 overflow-hidden text-xs"
                open={m().concluida === false}
              >
                <summary class="px-3 py-1.5 cursor-pointer font-medium text-zinc-400 hover:text-zinc-200 flex items-center justify-between select-none bg-zinc-900/40">
                  <span class="flex items-center gap-1.5">
                    <Brain size={13} class={ativo() ? "text-purple-400" : "text-zinc-400"} />
                    <span
                      class={
                        ativo()
                          ? "text-purple-300 animate-pulse font-semibold"
                          : "text-zinc-300 font-medium"
                      }
                    >
                      {ativo() ? "Pensando…" : `Raciocínio (${pIdx() + 1})`}
                    </span>
                  </span>
                  <span class="text-[10px] text-zinc-500 font-mono">
                    {ativo() ? (props.decorridoFmt || "ao vivo") : "concluído"}
                  </span>
                </summary>
                <PensamentoCorpo texto={pensamentoItem} />
              </details>
            );
          }}
        </For>
      </Show>

      {/* Exibição em Ordem Cronológica de Passos (Pensamento -> Bash/Ação -> Texto) */}
      <Show
        when={m().passos && m().passos!.length > 0}
        fallback={
          <>
            {/* Fallback Legado: Ações / Ferramentas em Andamento */}
            <Show when={props.mostrarAcoes !== false && m().acoes && m().acoes!.length > 0}>
              <div class="space-y-1 mb-2">
                <For each={m().acoes}>
                  {(acao) => (
                    <div class="flex items-center gap-2 text-xs text-zinc-400 bg-zinc-900/50 px-2.5 py-1 rounded border border-zinc-800/60 font-mono">
                      <span class={acao.sucesso === false ? "text-rose-400" : "text-emerald-400"}>
                        {acao.sucesso === false ? "✗" : "✓"}
                      </span>
                      <span class="text-zinc-300 font-semibold">{acao.ferramenta || "ferramenta"}:</span>
                      <span class="text-zinc-400 truncate">{acao.resumo || "executando..."}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Conteúdo Principal da Mensagem com Markdown Rico */}
            <Show when={m().content}>
              <div
                class="text-sm text-zinc-100 leading-relaxed font-sans break-words select-text my-1"
                innerHTML={renderMarkdown(m().content)}
              />
            </Show>
          </>
        }
      >
        <div class="space-y-2">
          <For each={m().passos}>
            {(passo, idx) => (
              <>
                {/* Passo: Pensamento Separado */}
                <Show when={props.mostrarPensamento !== false && passo.tipo === "pensamento" && passo.texto}>
                  <details
                    class="rounded-xl bg-zinc-950/70 border border-zinc-800/80 overflow-hidden text-xs my-1.5"
                    open={m().concluida === false}
                  >
                    <summary class="px-3 py-1.5 cursor-pointer font-medium text-zinc-400 hover:text-zinc-200 flex items-center justify-between select-none bg-zinc-900/40">
                      <span class="flex items-center gap-1.5">
                        <Brain size={13} class={isPassoPensandoAtivo(idx()) ? "text-purple-400" : "text-zinc-400"} />
                        <span
                          class={
                            isPassoPensandoAtivo(idx())
                              ? "text-purple-300 animate-pulse font-semibold"
                              : "text-zinc-300 font-medium"
                          }
                        >
                          {isPassoPensandoAtivo(idx()) ? "Pensando…" : `Raciocínio (${idx() + 1})`}
                        </span>
                      </span>
                      <span class="text-[10px] text-zinc-500 font-mono">
                        {isPassoPensandoAtivo(idx()) ? (props.decorridoFmt || "ao vivo") : "concluído"}
                      </span>
                    </summary>
                    <PensamentoCorpo texto={passo.texto} />
                  </details>
                </Show>

                {/* Passo: Ação / Tool (Bash, Comandos, Leitura) com Saída e Status */}
                <Show when={props.mostrarAcoes !== false && passo.tipo === "acao" && passo.ferramenta !== "unknown" && passo.ferramenta !== "invalid"}>
                  <details
                    class="rounded-xl bg-zinc-950/85 border border-zinc-800 text-xs font-mono text-zinc-300 my-1.5 overflow-hidden group"
                    open={Boolean(passo.saida && (passo.sucesso === false || (passo.saida.length < 500 && !m().content)))}
                  >
                    <summary class="flex items-center gap-2 px-3 py-2 cursor-pointer select-none hover:bg-zinc-900/50 transition-colors">
                      <Terminal size={13} class="text-amber-400 flex-shrink-0" />
                      <span class="text-amber-300/90 font-bold">{passo.ferramenta}:</span>
                      <span class="truncate flex-1 text-zinc-300">{passo.resumo || "executado"}</span>
                      <Show
                        when={passo.status !== "running"}
                        fallback={
                          <span class="text-[10px] ml-auto flex-shrink-0 font-bold px-1.5 py-0.2 rounded border bg-amber-950/60 text-amber-300 border-amber-800/60 animate-pulse flex items-center gap-1">
                            <span class="animate-spin text-[8px]">⏳</span> em execução...
                          </span>
                        }
                      >
                        <span
                          class={`text-[10px] ml-auto flex-shrink-0 font-bold px-1.5 py-0.2 rounded border ${
                            passo.sucesso !== false
                              ? "bg-emerald-950/60 text-emerald-300 border-emerald-800/60"
                              : "bg-rose-950/60 text-rose-300 border-rose-800/60"
                          }`}
                        >
                          {passo.sucesso !== false ? "✓ ok" : "✗ falhou"}
                        </span>
                      </Show>
                    </summary>
                    <Show when={passo.saida}>
                      <div class="px-3 py-2 bg-black/60 border-t border-zinc-800/60 text-zinc-300 text-[11px] leading-relaxed max-h-56 overflow-y-auto font-mono whitespace-pre-wrap select-text scrollbar-thin">
                        {passo.saida}
                      </div>
                    </Show>
                  </details>
                </Show>

                {/* Passo: Resposta de Texto com Markdown Rico */}
                <Show when={passo.tipo === "texto" && passo.texto}>
                  <div
                    class="text-sm text-zinc-100 leading-relaxed font-sans break-words select-text my-1"
                    innerHTML={renderMarkdown(passo.texto)}
                  />
                </Show>
              </>
            )}
          </For>
        </div>
      </Show>

      {/* Bloco de Escolhas / Opções Interativas da IA — só aparece se o usuário ainda não respondeu */}
      <Show when={dadosPerguntas().length > 0 && !props.jaRespondida}>
        {() => {
          const q = () => perguntaAtual();
          const opcoes = () => q()?.opcoes || [];
          const saoCurtas = () => opcoes().every((o) => o.length < 35);
          const total = () => totalPerguntas();
          const permiteCustom = () => q()?.permiteCustom !== false;

          return (
            <div class="my-3 p-3.5 rounded-xl bg-gradient-to-br from-purple-950/40 via-zinc-950/70 to-zinc-900/60 border border-purple-800/40 text-xs shadow-lg backdrop-blur-sm chat-pergunta-card">
              {/* Cabeçalho de Navegação de Múltiplas Perguntas */}
              <Show when={total() > 1}>
                <div class="flex items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-purple-900/30">
                  <div class="flex items-center gap-1.5 font-medium text-purple-300 text-[11px]">
                    <Sparkles size={13} class="text-purple-400 shrink-0" />
                    <span>Pergunta {abaAtual() + 1} de {total()}</span>
                  </div>
                  {/* Pills de Navegação por Pergunta */}
                  <div class="flex items-center gap-1">
                    <For each={dadosPerguntas()}>
                      {(item, idx) => {
                        const ativa = () => abaAtual() === idx();
                        const k = qKey(item, idx());
                        const respondida = () => !!respostasPorPergunta()[k];
                        return (
                          <button
                            type="button"
                            onClick={() => setAbaPerguntaAtiva(idx())}
                            class={`h-5 min-w-5 px-1.5 rounded-full text-[10px] font-bold flex items-center justify-center transition-all cursor-pointer ${
                              ativa()
                                ? "bg-purple-600 text-white shadow-sm shadow-purple-500/30"
                                : respondida()
                                ? "bg-purple-950/80 text-purple-300 border border-purple-700/50"
                                : "bg-zinc-800/70 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                            }`}
                            title={item.header || item.pergunta}
                          >
                            <Show when={respondida() && !ativa()} fallback={idx() + 1}>
                              <Check size={10} class="text-emerald-400" />
                            </Show>
                          </button>
                        );
                      }}
                    </For>
                  </div>
                </div>
              </Show>

              {/* Título da Pergunta Atual */}
              <div class="flex items-start gap-2 font-semibold text-purple-300 mb-2 select-none">
                <Show when={total() <= 1}>
                  <Sparkles size={15} class="text-purple-400 shrink-0 mt-0.5 animate-pulse" />
                </Show>
                <div class="flex-1 min-w-0">
                  <Show when={q()?.header}>
                    <span class="inline-block px-1.5 py-0.5 mb-1 rounded bg-purple-900/60 border border-purple-700/40 text-[10px] font-medium text-purple-200 mr-1.5">
                      {q()?.header}
                    </span>
                  </Show>
                  <span class="break-words leading-snug">{q()?.pergunta || "A IA solicitou sua escolha:"}</span>
                </div>
              </div>

              {/* Lista de Opções */}
              <div class={saoCurtas() ? "grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2" : "flex flex-col gap-2 mt-2"}>
                <For each={opcoes()}>
                  {(opcao, opcIdx) => {
                    const selecionada = () =>
                      total() > 1
                        ? respostaAtual() === opcao
                        : opcaoEscolhida() === opcao;
                    return (
                      <button
                        type="button"
                        data-testid="chat-opcao-btn"
                        data-opcao={opcao}
                        onClick={() => responderOpcao(opcao)}
                        class={`group flex items-start sm:items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-left text-xs font-medium transition-all duration-200 border cursor-pointer w-full min-w-0 overflow-hidden box-border chat-opcao-btn ${
                          selecionada()
                            ? "bg-purple-900/50 text-purple-200 border-purple-500 shadow-sm shadow-purple-500/20"
                            : "bg-zinc-900/80 hover:bg-purple-950/30 text-zinc-300 hover:text-purple-200 border-zinc-800/80 hover:border-purple-600/50 hover:shadow-sm"
                        }`}
                      >
                        <span
                          class={`h-5 w-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 sm:mt-0 transition-colors ${
                            selecionada()
                              ? "bg-purple-500 text-white"
                              : "bg-zinc-800 text-zinc-400 group-hover:bg-purple-900/60 group-hover:text-purple-300"
                          }`}
                        >
                          {opcIdx() + 1}
                        </span>
                        <span class="flex-1 min-w-0 leading-relaxed break-words overflow-hidden">{opcao}</span>
                        <Show when={selecionada()}>
                          <span class="text-[10px] text-emerald-400 font-semibold shrink-0 flex items-center gap-1">
                            <Check size={11} /> Selecionado
                          </span>
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </div>

              {/* Opção Customizada / Digitar Resposta Própria (se habilitado) */}
              <Show when={permiteCustom()}>
                <div class="mt-2 pt-2 border-t border-purple-900/30">
                  <Show
                    when={isCustomAberto()}
                    fallback={
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setCustomAberto(true);
                        }}
                        class="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium text-purple-300 hover:text-purple-200 bg-purple-950/20 hover:bg-purple-900/30 border border-purple-800/30 transition-colors cursor-pointer"
                      >
                        <Edit3 size={12} />
                        <span>Outro: digitar resposta personalizada...</span>
                      </button>
                    }
                  >
                    <div class="flex items-center gap-1.5 mt-1" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        placeholder="Digite sua resposta personalizada..."
                        value={textoCustomAtual()}
                        onInput={(e) => {
                          setTextoCustom(e.currentTarget.value);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            enviarCustom();
                          }
                        }}
                        class="flex-1 px-3 py-1.5 rounded-lg bg-zinc-950 border border-purple-700/60 text-zinc-100 text-xs focus:outline-none focus:border-purple-400 placeholder-zinc-500"
                        autofocus
                      />
                      <button
                        type="button"
                        onClick={enviarCustom}
                        disabled={!textoCustomAtual().trim()}
                        class="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-medium text-xs flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                      >
                        <Send size={11} />
                        <span>Enviar</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setCustomAberto(false)}
                        class="px-2 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs transition-colors cursor-pointer"
                        title="Cancelar"
                      >
                        ✕
                      </button>
                    </div>
                  </Show>
                </div>
              </Show>

              {/* Rodapé com Navegação / Envio para Múltiplas Perguntas */}
              <Show when={total() > 1}>
                <div class="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-purple-900/30">
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={abaAtual() === 0}
                      onClick={() => setAbaPerguntaAtiva(abaAtual() - 1)}
                      class="px-2.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 disabled:opacity-30 text-zinc-300 text-xs flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <ChevronLeft size={13} />
                      <span>Anterior</span>
                    </button>
                    <button
                      type="button"
                      onClick={pularPergunta}
                      class="px-2 py-1 rounded-md text-zinc-400 hover:text-zinc-200 text-[11px] transition-colors cursor-pointer"
                    >
                      Pular
                    </button>
                  </div>
                  <div class="flex items-center gap-2">
                    <Show when={abaAtual() < total() - 1}>
                      <button
                        type="button"
                        onClick={() => setAbaPerguntaAtiva(abaAtual() + 1)}
                        class="px-2.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-xs flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <span>Próxima</span>
                        <ChevronRight size={13} />
                      </button>
                    </Show>
                    <Show when={totalRespondidas() > 0 || abaAtual() === total() - 1}>
                      <button
                        type="button"
                        onClick={enviarTodasRespostas}
                        class="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-purple-500/20 transition-colors cursor-pointer"
                      >
                        <span>Enviar respostas ({totalRespondidas()}/{total()})</span>
                        <CornerDownLeft size={12} />
                      </button>
                    </Show>
                  </div>
                </div>
              </Show>

              {/* Botão de Pular para Pergunta Única Opcional */}
              <Show when={total() <= 1 && q()?.opcional}>
                <div class="flex justify-end mt-2 pt-1.5">
                  <button
                    type="button"
                    onClick={pularPergunta}
                    class="text-zinc-400 hover:text-zinc-200 text-[11px] underline cursor-pointer"
                  >
                    Pular esta pergunta
                  </button>
                </div>
              </Show>
            </div>
          );
        }}
      </Show>

      {/* Ações Discretas na Base do Balão do Usuário (Editar / Copiar) */}
      <Show when={m().role === "user"}>
        <div class="flex items-center justify-end gap-1 pt-1 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Show when={props.onEditarPrompt}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                props.onEditarPrompt?.(props.indice);
              }}
              class="p-1 rounded-md bg-transparent text-zinc-500 hover:text-amber-300 hover:bg-zinc-800/80 transition-colors cursor-pointer"
              title="Editar prompt"
              aria-label="Editar prompt"
            >
              <Edit3 size={13} />
            </button>
          </Show>
          <button
            type="button"
            onClick={copiar}
            class="p-1 rounded-md bg-transparent text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/80 transition-colors cursor-pointer"
            title="Copiar prompt"
            aria-label="Copiar prompt"
          >
            <Show when={copiado()} fallback={<Copy size={13} />}>
              <Check size={13} class="text-emerald-400" />
            </Show>
          </button>
        </div>
      </Show>

      {/* Ação Discreta na Base da Resposta do Assistente (Abrir Preview / Copiar) */}
      <Show when={m().role === "assistant" && m().concluida !== false}>
        <div class="flex items-center justify-end gap-2 pt-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Show when={urlDetectada() && props.onAbrirIframeUrl}>
            <button
              type="button"
              onClick={() => props.onAbrirIframeUrl?.(urlDetectada()!)}
              class="px-2 py-0.5 rounded-md bg-blue-500/15 border border-blue-500/30 text-blue-300 hover:bg-blue-500/25 text-[11px] font-medium inline-flex items-center gap-1 transition-colors cursor-pointer"
              title="Abrir no Preview Lateral"
            >
              <Globe size={11} /> Abrir Preview
            </button>
          </Show>
          <button
            type="button"
            onClick={copiar}
            class="p-1 rounded-md bg-transparent text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/80 transition-colors cursor-pointer"
            title="Copiar resposta"
            aria-label="Copiar resposta"
          >
            <Show when={copiado()} fallback={<Copy size={13} />}>
              <Check size={13} class="text-emerald-400" />
            </Show>
          </button>
        </div>
      </Show>

      {/* Indicador de Digitação / Pensando quando vazio */}
      <Show when={!m().content && m().concluida === false && !m().pensamento}>
        <div class="flex items-center gap-2 py-1 text-xs text-zinc-400 italic">
          <span class="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
          <span>Processando resposta com modelo livre...</span>
        </div>
      </Show>
    </div>
  );
};
