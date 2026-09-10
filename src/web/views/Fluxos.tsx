import {
  type Component,
  createSignal,
  onMount,
  createEffect,
  For,
  Show,
  createMemo,
  untrack,
} from "solid-js";
import { useSearchParams, useNavigate } from "@solidjs/router";
import {
  GitBranch,
  Play,
  RefreshCw,
  Plus,
  Trash2,
  X,
  Send,
  Eye,
  Bot,
  Layers,
  HelpCircle,
  FileText,
  Terminal,
  Users,
  CheckCircle2,
  Webhook,
  ArrowRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Sparkles,
  Settings,
  Check,
  ChevronRight,
  Copy,
  Folder,
  Search,
  ArrowLeft,
  Calendar,
  MoreVertical,
  ExternalLink,
  Code2,
  Sliders,
  CheckSquare,
  History,
  ChevronDown,
  AlertCircle,
  Zap,
  Download,
  Upload,
  Globe,
  Clock,
  Workflow,
  ChevronUp,
  GripVertical,
} from "lucide-solid";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { showToast } from "../ui/Toast";
import { fetchApi } from "../lib/context";
import { SecretarioView } from "./Secretario";

export interface NoGrafo {
  id: string;
  tipo: string;
  config?: any;
  pos?: { x: number; y: number };
}

export interface ArestaGrafo {
  de: string;
  para: string;
}

export interface FluxoCompleto {
  id: string;
  nome: string;
  descricao?: string;
  nos: NoGrafo[];
  arestas: ArestaGrafo[];
}

export interface TipoNodeItem {
  tipo: string;
  rotulo: string;
  categoria: "gatilhos" | "agentes" | "logica" | "integracoes" | "governanca";
  icone: any;
  cor: string;
  bg: string;
  desc: string;
}

export const TIPOS_NODE_CATALOGO: TipoNodeItem[] = [
  // Gatilhos
  { tipo: "cron", rotulo: "Gatilho Cron / Agenda", categoria: "gatilhos", icone: Calendar, cor: "text-sky-400", bg: "bg-sky-500/10", desc: "Dispara periodicamente via expressão cron ou intervalo" },
  { tipo: "webhook", rotulo: "Gatilho Webhook", categoria: "gatilhos", icone: Webhook, cor: "text-amber-400", bg: "bg-amber-500/10", desc: "Dispara ao receber requisições HTTP externas no endpoint" },
  { tipo: "manual", rotulo: "Gatilho Manual / Test", categoria: "gatilhos", icone: Play, cor: "text-zinc-300", bg: "bg-zinc-500/10", desc: "Disparo sob demanda direto pelo studio ou botão de teste" },

  // Agentes & Inteligência
  { tipo: "agente", rotulo: "Agente Executor", categoria: "agentes", icone: Bot, cor: "text-emerald-400", bg: "bg-emerald-500/10", desc: "Executa instruções e tarefas com LLMs especializadas" },

  // Lógica & Controle (Estilo n8n)
  { tipo: "subflow", rotulo: "Executar Sub-Fluxo", categoria: "logica", icone: Workflow, cor: "text-purple-400", bg: "bg-purple-500/10", desc: "Invoca e executa outro fluxo modular deste workspace" },
  { tipo: "decisao", rotulo: "Decisão / Branching", categoria: "logica", icone: HelpCircle, cor: "text-amber-400", bg: "bg-amber-500/10", desc: "Bifurcação e roteamento condicional com base em critérios" },
  { tipo: "loop", rotulo: "Loop / HLE", categoria: "logica", icone: RefreshCw, cor: "text-orange-400", bg: "bg-orange-500/10", desc: "Controle de repetição, feedback e parada para HLE (Loop Engineering)" },
  { tipo: "delay", rotulo: "Aguardar / Delay", categoria: "logica", icone: Clock, cor: "text-yellow-400", bg: "bg-yellow-500/10", desc: "Pausa a execução por um intervalo de segundos (ex: 30s)" },

  // Integrações & Execução
  { tipo: "http_request", rotulo: "Requisição HTTP / API", categoria: "integracoes", icone: Globe, cor: "text-blue-400", bg: "bg-blue-500/10", desc: "Chama APIs REST externas (GET, POST, Webhooks de saída)" },
  { tipo: "script", rotulo: "Script do Workspace", categoria: "integracoes", icone: Terminal, cor: "text-cyan-400", bg: "bg-cyan-500/10", desc: "Executa scripts locais (.js, .py, .sh) ou comandos bash" },
  { tipo: "componente", rotulo: "Componente Modular", categoria: "integracoes", icone: Code2, cor: "text-teal-400", bg: "bg-teal-500/10", desc: "Componente customizado reutilizável com entrada e saída" },

  // Governança & Persistência
  { tipo: "task_create", rotulo: "Criar Tarefa", categoria: "governanca", icone: Layers, cor: "text-blue-400", bg: "bg-blue-500/10", desc: "Cria um card no Kanban com título, coluna e prioridade" },
  { tipo: "reuniao", rotulo: "Reunião de Agentes", categoria: "governanca", icone: Users, cor: "text-indigo-400", bg: "bg-indigo-500/10", desc: "Convoca mesa de deliberação coletiva entre múltiplos agentes" },
  { tipo: "registro", rotulo: "Registro / Documento", categoria: "governanca", icone: FileText, cor: "text-purple-400", bg: "bg-purple-500/10", desc: "Grava ata, parecer ou relatório nos registries da empresa" },
];

export const FluxosView: Component = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();



  const [fluxos, setFluxos] = createSignal<any[]>([]);
  const [agentes, setAgentes] = createSignal<any[]>([]);
  const [tasksExistentes, setTasksExistentes] = createSignal<any[]>([]);
  const [buscaTask, setBuscaTask] = createSignal("");
  const [fluxoAtivo, setFluxoAtivo] = createSignal<FluxoCompleto | null>(null);
  const [noSelecionado, setNoSelecionado] = createSignal<NoGrafo | null>(null);

  // Estados de Arrastar Nós (Drag & Drop de Nós no Canvas)
  const [noArrastandoId, setNoArrastandoId] = createSignal<string | null>(null);
  const [dragStart, setDragStart] = createSignal<{ mouseX: number; mouseY: number; nodeX: number; nodeY: number } | null>(null);
  const [houveArrasto, setHouveArrasto] = createSignal(false);

  // Estado de Criação de Conexões entre Nós (Interligar estilo n8n)
  const [conectandoDeNoId, setConectandoDeNoId] = createSignal<string | null>(null);
  const [novoDestinoLigacao, setNovoDestinoLigacao] = createSignal("");
  const [mousePos, setMousePos] = createSignal<{ x: number; y: number }>({ x: 0, y: 0 });

  // Modo no NDV: formulário visual ou JSON avançado
  const [modoNdv, setModoNdv] = createSignal<"form" | "json">("form");

  // Modo de exibição: Canvas único, Split-View lado a lado ou Chat
  const [modoExibicao, setModoExibicao] = createSignal<"canvas" | "split" | "chat">("canvas");

  // Menu de Contexto (Botão Direito no Canvas / Node)
  const [menuContexto, setMenuContexto] = createSignal<{
    aberto: boolean;
    x: number;
    y: number;
    noId?: string;
  }>({ aberto: false, x: 0, y: 0 });

  // Modal / Drawer de Adicionar Novo Node (n8n Drag & Drop)
  const [modalAdicionarNode, setModalAdicionarNode] = createSignal(false);
  const [drawerNosAberto, setDrawerNosAberto] = createSignal(false);
  const [categoriaNodeFiltro, setCategoriaNodeFiltro] = createSignal<string>("todos");
  const [buscaTipoNode, setBuscaTipoNode] = createSignal("");

  // Painel Inferior Colapsável de Logs e Dados I/O por Elemento
  const [painelLogsAberto, setPainelLogsAberto] = createSignal(false);
  const [noLogSelecionadoId, setNoLogSelecionadoId] = createSignal<string | null>(null);
  const [abaLogDetalhe, setAbaLogDetalhe] = createSignal<"dados" | "entrada" | "raw">("dados");

  // Busca na Lista de Workflows
  const [buscaTexto, setBuscaTexto] = createSignal("");
  const [copiadoId, setCopiadoId] = createSignal<string | null>(null);

  // Zoom & Pan do Canvas
  const [zoom, setZoom] = createSignal(1);
  const [pan, setPan] = createSignal({ x: 50, y: 50 });
  const [isPanning, setIsPanning] = createSignal(false);
  const [startPan, setStartPan] = createSignal({ x: 0, y: 0 });

  // Modais de Execução e Novo Workflow
  const [modalExecutar, setModalExecutar] = createSignal(false);
  const [entradaTexto, setEntradaTexto] = createSignal("");
  const [executando, setExecutando] = createSignal(false);

  // Logs de Execuções do Workflow
  const [logsExecucoes, setLogsExecucoes] = createSignal<any[]>([]);
  const [logsAberto, setLogsAberto] = createSignal(false);
  const [logSelecionado, setLogSelecionado] = createSignal<any | null>(null);

  const [modalNovoFluxo, setModalNovoFluxo] = createSignal(false);
  const [novoFluxoId, setNovoFluxoId] = createSignal("");
  const [novoFluxoNome, setNovoFluxoNome] = createSignal("");
  const [novoFluxoDesc, setNovoFluxoDesc] = createSignal("");
  const [novoFluxoTemplate, setNovoFluxoTemplate] = createSignal<"pipeline" | "fanout" | "review" | "debate">("pipeline");

  // Marketplace de Componentes
  const [componentes, setComponentes] = createSignal<any[]>([]);
  const [testandoComponente, setTestandoComponente] = createSignal(false);
  const [resultadoTesteComp, setResultadoTesteComp] = createSignal<any | null>(null);
  const [entradaTesteComp, setEntradaTesteComp] = createSignal('{\n  "texto": "Olá do OpenCorp"\n}');

  const carregarFluxos = async () => {
    try {
      const [lista, listaAgentes, listaTasks, listaComponentes] = await Promise.all([
        fetchApi<any[]>("/flows").catch(() => []),
        fetchApi<any[]>("/agents").catch(() => []),
        fetchApi<any[]>("/tasks").catch(() => []),
        fetchApi<any[]>("/components").catch(() => []),
      ]);
      setFluxos(lista || []);
      setAgentes(listaAgentes || []);
      setTasksExistentes(listaTasks || []);
      setComponentes(listaComponentes || []);

      const urlId = searchParams.fluxo as string;
      if (urlId) {
        void abrirEditorCanvas(urlId);
      }
    } catch {}
  };

  const testarComponenteAtual = async () => {
    const no = noSelecionado();
    if (!no) return;
    setTestandoComponente(true);
    setResultadoTesteComp(null);
    try {
      if (no.config?.componente_id) {
        const res = await fetchApi<any>(`/components/${encodeURIComponent(no.config.componente_id)}/test`, {
          method: "POST",
          body: JSON.stringify({ entrada: entradaTesteComp() }),
        });
        setResultadoTesteComp(res);
      } else {
        setResultadoTesteComp({ ok: false, erro: "Selecione um componente do marketplace para testar" });
      }
    } catch (err: any) {
      setResultadoTesteComp({ ok: false, erro: err.message });
    } finally {
      setTestandoComponente(false);
    }
  };

  const abrirEditorCanvas = async (id: string) => {
    try {
      const f = await fetchApi<FluxoCompleto>(`/flows/${encodeURIComponent(id)}`);
      setFluxoAtivo(f);
      setNoSelecionado(null);
      setSearchParams({ fluxo: id });
      // Carrega logs de execuções ao abrir um fluxo
      void carregarLogs(id);
    } catch (e: any) {
      showToast(`Erro ao carregar fluxo: ${e.message}`, "erro");
    }
  };

  const carregarLogs = async (flowId: string) => {
    try {
      const logs = await fetchApi<any[]>(`/flows/${encodeURIComponent(flowId)}/execucoes`);
      setLogsExecucoes(logs || []);
      if (logs && logs.length > 0) setLogSelecionado(logs[0]);
    } catch {
      setLogsExecucoes([]);
    }
  };

  let navegandoParaLista = false;

  const voltarParaLista = () => {
    navegandoParaLista = true;
    setSearchParams({ fluxo: undefined }, { replace: true });
    navigate("/fluxos", { replace: true });
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("fluxo");
      window.history.replaceState(null, "", u.pathname + (u.search ? u.search : ""));
    } catch {}
    setFluxoAtivo(null);
    setNoSelecionado(null);
    setLogsExecucoes([]);
    setLogSelecionado(null);
    setLogsAberto(false);
    setModalAdicionarNode(false);
    setTimeout(() => {
      navegandoParaLista = false;
    }, 150);
  };

  createEffect(() => {
    if (navegandoParaLista) return;
    const fId = searchParams.fluxo as string | undefined;
    const ativo = untrack(() => fluxoAtivo());
    if (fId) {
      if (!ativo || ativo.id !== fId) {
        void abrirEditorCanvas(fId);
      }
    } else if (ativo) {
      setFluxoAtivo(null);
      setNoSelecionado(null);
      setLogsExecucoes([]);
      setLogSelecionado(null);
      setLogsAberto(false);
    }
  });

  onMount(() => {
    void carregarFluxos();

    const fecharMenu = () => {
      if (menuContexto().aberto) {
        setMenuContexto((prev) => ({ ...prev, aberto: false }));
      }
    };
    window.addEventListener("click", fecharMenu);
    return () => window.removeEventListener("click", fecharMenu);
  });

  // Salvar alterações do Workflow no backend
  const salvarAlteracoesWorkflow = async (novoFluxo: FluxoCompleto) => {
    try {
      await fetchApi(`/flows/${encodeURIComponent(novoFluxo.id)}`, {
        method: "PUT",
        body: JSON.stringify(novoFluxo),
      });
      setFluxoAtivo(novoFluxo);
      showToast("Fluxo atualizado!", "sucesso");
    } catch (err: any) {
      showToast(`Erro ao salvar: ${err.message}`, "erro");
      void carregarFluxos();
    }
  };

  // Copiar Workflow JSON
  const copiarWorkflowJson = async (fluxo: any, e?: MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      let dados = fluxo;
      if (!dados.nos || !dados.arestas) {
        dados = await fetchApi<FluxoCompleto>(`/flows/${encodeURIComponent(fluxo.id)}`);
      }
      const jsonStr = JSON.stringify(dados, null, 2);
      await navigator.clipboard.writeText(jsonStr);
      setCopiadoId(fluxo.id);
      showToast(`Fluxo copiado como JSON!`, "sucesso");
      setTimeout(() => setCopiadoId(null), 2500);
    } catch (err: any) {
      showToast(`Erro ao copiar: ${err.message}`, "erro");
    }
  };

  // Exportar Workflow como arquivo JSON
  const exportarWorkflowJson = async (fluxo: any, e?: MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      let dados = fluxo;
      if (!dados.nos || !dados.arestas) {
        dados = await fetchApi<FluxoCompleto>(`/flows/${encodeURIComponent(fluxo.id)}`);
      }
      const envelope = {
        version: 1,
        exported_at: new Date().toISOString(),
        flow: dados,
      };
      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `flow-${fluxo.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`Fluxo "${fluxo.nome || fluxo.id}" exportado com sucesso!`, "sucesso");
    } catch (err: any) {
      showToast(`Erro ao exportar: ${err.message}`, "erro");
    }
  };

  // Importar Workflow a partir de arquivo JSON
  let inputImportarRef: HTMLInputElement | undefined;

  const importarWorkflowArquivo = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0]!;
    try {
      const text = await file.text();
      const res = await fetch("/flows/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dados: text, sobrescrever: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ erro: "Falha na importação" }));
        showToast(err.erro || "Falha ao importar flow", "erro");
        return;
      }
      const data = await res.json();
      showToast(`Fluxo "${data.flow.nome || data.flow.id}" importado com sucesso!`, "sucesso");
      await carregarFluxos();
      abrirEditorCanvas(data.flow.id);
    } catch (err: any) {
      showToast(`Erro ao importar arquivo: ${err.message}`, "erro");
    } finally {
      input.value = "";
    }
  };

  // Excluir Workflow
  const excluirFluxo = async (id: string, nome?: string, e?: MouseEvent) => {
    if (e) e.stopPropagation();
    if (!confirm(`Tem certeza que deseja excluir o fluxo "${nome || id}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await fetchApi(`/flows/${encodeURIComponent(id)}`, { method: "DELETE" });
      setFluxos((prev) => prev.filter((f) => f.id !== id));
      if (fluxoAtivo()?.id === id) {
        voltarParaLista();
      }
      showToast(`Fluxo "${nome || id}" excluído com sucesso!`, "sucesso");
    } catch (err: any) {
      showToast(`Erro ao excluir fluxo: ${err.message}`, "erro");
    }
  };

  // Adicionar Novo Node ao Workflow Ativo (Suporta Coordenadas via Drag & Drop n8n)
  const adicionarNodeAoWorkflow = async (tipo: string, posCoords?: { x: number; y: number }) => {
    const f = fluxoAtivo();
    if (!f) return;

    const baseId = `${tipo}_${Date.now().toString(36).slice(-4)}`;
    let configPadrao: any = {};

    if (tipo === "agente") {
      const primeiroAgente = agentes()[0]?.id || "executor-padrao";
      configPadrao = { agente: primeiroAgente, ordem: "Analise a entrada: {{entrada}}", session_mode: "nova" };
    } else if (tipo === "subflow") {
      const outroFluxo = fluxos().find((x) => x.id !== f.id)?.id || "";
      configPadrao = { flow_id: outroFluxo, entrada: "{{entrada}}" };
    } else if (tipo === "http_request") {
      configPadrao = { url: "https://httpbin.org/get", metodo: "GET", timeout_ms: 30000 };
    } else if (tipo === "delay") {
      configPadrao = { segundos: 30 };
    } else if (tipo === "loop") {
      configPadrao = { max_iteracoes: 3, condicao_parada: "SUCESSO", retornar_para: "", saida_final: "" };
    } else if (tipo === "cron") {
      configPadrao = { expressao_cron: "0 8 * * *" };
    } else if (tipo === "componente") {
      configPadrao = { arquivo: "scripts/componente.mjs", runtime: "node" };
    } else if (tipo === "script") {
      configPadrao = { arquivo: "scripts/processar.sh", comando: "echo 'executando...'" };
    } else if (tipo === "reuniao") {
      configPadrao = { pauta: "Alinhamento operacional", agentes: ["editor", "critico-site"] };
    } else if (tipo === "decisao") {
      configPadrao = { pergunta: "Aprovar conteúdo?", opcoes: [{ rotulo: "Sim", proximo: "saida" }, { rotulo: "Não", proximo: "revisao" }] };
    } else if (tipo === "task_create") {
      configPadrao = { titulo: "Nova Tarefa via Fluxo", coluna: "backlog", prioridade: "media" };
    } else if (tipo === "registro") {
      configPadrao = { categoria: "documentos", titulo: "Resultado do Fluxo" };
    }

    const novoNode: NoGrafo = {
      id: baseId,
      tipo,
      config: configPadrao,
      pos: posCoords,
    };

    // Conecta automaticamente se não foi solto manualmente longe
    const novosNos = [...(f.nos || []), novoNode];
    const novasArestas = [...(f.arestas || [])];

    if (!posCoords && f.nos && f.nos.length > 0) {
      const ultimo = f.nos[f.nos.length - 1];
      novasArestas.push({ de: ultimo.id, para: baseId });
    }

    const workflowAtualizado: FluxoCompleto = {
      ...f,
      nos: novosNos,
      arestas: novasArestas,
    };

    await salvarAlteracoesWorkflow(workflowAtualizado);
    setNoSelecionado(novoNode);
    setModalAdicionarNode(false);
    setDrawerNosAberto(false);
  };

  // Duplicar Node
  const duplicarNodeSelecionado = async (noId: string) => {
    const f = fluxoAtivo();
    if (!f) return;
    const alvo = f.nos.find((n) => n.id === noId);
    if (!alvo) return;

    const novoId = `${alvo.id}_copia_${Date.now().toString(36).slice(-3)}`;
    const novoNode: NoGrafo = {
      id: novoId,
      tipo: alvo.tipo,
      config: JSON.parse(JSON.stringify(alvo.config || {})),
    };

    const workflowAtualizado: FluxoCompleto = {
      ...f,
      nos: [...f.nos, novoNode],
      arestas: [...f.arestas, { de: alvo.id, para: novoId }],
    };

    await salvarAlteracoesWorkflow(workflowAtualizado);
    setNoSelecionado(novoNode);
  };

  // Excluir Node
  const excluirNode = async (noId: string) => {
    const f = fluxoAtivo();
    if (!f) return;
    if (f.nos.length <= 1) {
      showToast("O fluxo precisa ter ao menos um nó", "aviso");
      return;
    }

    const novosNos = f.nos.filter((n) => n.id !== noId);
    const novasArestas = f.arestas.filter((a) => a.de !== noId && a.para !== noId);

    const workflowAtualizado: FluxoCompleto = {
      ...f,
      nos: novosNos,
      arestas: novasArestas,
    };

    await salvarAlteracoesWorkflow(workflowAtualizado);
    setNoSelecionado(novosNos[0] || null);
  };

  // Atualizar Configuração do Node no formulário NDV
  const atualizarConfigNo = (campo: string, valor: any) => {
    const no = noSelecionado();
    const f = fluxoAtivo();
    if (!no || !f) return;

    const novaConfig = { ...(no.config || {}), [campo]: valor };
    const noAtualizado = { ...no, config: novaConfig };

    setNoSelecionado(noAtualizado);

    const workflowAtualizado: FluxoCompleto = {
      ...f,
      nos: f.nos.map((n) => (n.id === no.id ? noAtualizado : n)),
    };
    setFluxoAtivo(workflowAtualizado);
  };

  // Disparar Execução
  const dispararExecucao = async () => {
    const f = fluxoAtivo();
    if (!f) return;
    setExecutando(true);
    try {
      await fetchApi(`/flows/${encodeURIComponent(f.id)}/run`, {
        method: "POST",
        body: JSON.stringify({ entrada: entradaTexto().trim() || undefined }),
      });
      showToast(`Execução do fluxo "${f.nome || f.id}" iniciada!`, "sucesso");
      setModalExecutar(false);
      setEntradaTexto("");
      // Recarrega logs após disparo e abre o dropdown
      setTimeout(() => {
        void carregarLogs(f.id);
        setLogsAberto(true);
      }, 1500);
    } catch (err: any) {
      showToast(`Erro ao rodar: ${err.message}`, "erro");
    } finally {
      setExecutando(false);
    }
  };

  // Menu de Contexto ao Clicar com Botão Direito no Canvas ou no Node
  const onContextMenuCanvas = (e: MouseEvent, noId?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuContexto({
      aberto: true,
      x: e.clientX,
      y: e.clientY,
      noId,
    });
    if (noId) {
      const n = fluxoAtivo()?.nos.find((item) => item.id === noId);
      if (n) setNoSelecionado(n);
    }
  };

  // Layout Automático de Nós no Canvas
  // Conexões e Ligações entre Nós
  const iniciarConexao = (origemId: string, e?: MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setConectandoDeNoId(origemId);
    showToast(`Ligando a partir de "${origemId}": clique no nó de destino (múltiplas saídas permitidas)`, "info");
  };

  const criarConexao = (origemId: string, destinoId: string) => {
    setConectandoDeNoId(null);
    if (!origemId || !destinoId || origemId === destinoId) return;

    const f = fluxoAtivo();
    if (!f) return;

    const jaExiste = f.arestas.some((a) => a.de === origemId && a.para === destinoId);
    if (jaExiste) {
      showToast("Esta conexão já existe.", "aviso");
      return;
    }

    // Prevenção de loop infinito / ciclos fechados (ex: A → B → C → A)
    const visitados = new Set<string>();
    const fila = [destinoId];
    let temCiclo = false;
    while (fila.length > 0) {
      const atual = fila.shift()!;
      if (atual === origemId) {
        temCiclo = true;
        break;
      }
      if (visitados.has(atual)) continue;
      visitados.add(atual);
      for (const a of f.arestas) {
        if (a.de === atual) fila.push(a.para);
      }
    }

    if (temCiclo) {
      showToast(
        `Não é possível ligar "${origemId}" → "${destinoId}": isso criaria um ciclo (loop infinito) no fluxo. O fluxo deve fluir adiante.`,
        "aviso",
      );
      return;
    }

    const novoFluxo: FluxoCompleto = {
      ...f,
      arestas: [...f.arestas, { de: origemId, para: destinoId }],
    };
    void salvarAlteracoesWorkflow(novoFluxo);
  };

  const completarConexao = (destinoId: string) => {
    const origem = conectandoDeNoId();
    if (!origem) return;
    criarConexao(origem, destinoId);
  };

  const removerAresta = (de: string, para: string) => {
    const f = fluxoAtivo();
    if (!f) return;
    const novoFluxo: FluxoCompleto = {
      ...f,
      arestas: f.arestas.filter((a) => !(a.de === de && a.para === para)),
    };
    void salvarAlteracoesWorkflow(novoFluxo);
    showToast(`Conexão removida: ${de} → ${para}`, "info");
  };

  // Layout dos Nós no Canvas (Usa pos customizada se existir, senão layout topológico)
  const nosPosicionados = createMemo(() => {
    const f = fluxoAtivo();
    if (!f || !f.nos) return [];

    const nos = [...f.nos];
    const arestas = f.arestas || [];

    const niveis: Record<string, number> = {};
    nos.forEach((n) => {
      niveis[n.id] = 0;
    });

    for (let iter = 0; iter < nos.length; iter++) {
      arestas.forEach((a) => {
        if (niveis[a.de] !== undefined) {
          niveis[a.para] = Math.max(niveis[a.para] || 0, (niveis[a.de] || 0) + 1);
        }
      });
    }

    const colunas: Record<number, NoGrafo[]> = {};
    nos.forEach((n) => {
      const lvl = niveis[n.id] || 0;
      if (!colunas[lvl]) colunas[lvl] = [];
      colunas[lvl].push(n);
    });

    const posicionados: Array<NoGrafo & { x: number; y: number }> = [];
    const COL_WIDTH = 270;
    const ROW_HEIGHT = 140;

    Object.entries(colunas).forEach(([lvlStr, lista]) => {
      const colIdx = Number(lvlStr);
      const totalNaColuna = lista.length;
      lista.forEach((no, rowIdx) => {
        const defaultX = 70 + colIdx * COL_WIDTH;
        const defaultY = 90 + (rowIdx - (totalNaColuna - 1) / 2) * ROW_HEIGHT + 110;
        const x = no.pos?.x !== undefined ? no.pos.x : defaultX;
        const y = no.pos?.y !== undefined ? no.pos.y : defaultY;
        posicionados.push({ ...no, x, y });
      });
    });

    return posicionados;
  });

  const arestasCurvadas = createMemo(() => {
    const nos = nosPosicionados();
    const f = fluxoAtivo();
    if (!f || !f.arestas) return [];

    const mapaNos = new Map(nos.map((n) => [n.id, n]));

    return f.arestas
      .map((a) => {
        const origem = mapaNos.get(a.de);
        const destino = mapaNos.get(a.para);
        if (!origem || !destino) return null;

        const x1 = origem.x + 190;
        const y1 = origem.y + 40;
        const x2 = destino.x;
        const y2 = destino.y + 40;

        const dx = Math.max(Math.abs(x2 - x1) * 0.5, 40);
        const path = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
        const midX = Math.round((x1 + x2) / 2);
        const midY = Math.round((y1 + y2) / 2);

        return { ...a, path, x1, y1, x2, y2, midX, midY };
      })
      .filter(Boolean);
  });

  // Linha de Conexão Ativa guiada pelo Mouse (Estilo n8n cable dragging)
  const linhaConexaoGuia = createMemo(() => {
    const origemId = conectandoDeNoId();
    if (!origemId) return null;
    const origemNo = nosPosicionados().find((n) => n.id === origemId);
    if (!origemNo) return null;

    const x1 = origemNo.x + 190;
    const y1 = origemNo.y + 40;
    const mx = Math.round((mousePos().x - pan().x) / zoom());
    const my = Math.round((mousePos().y - pan().y) / zoom());

    const dx = Math.max(Math.abs(mx - x1) * 0.5, 40);
    const path = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${mx - dx} ${my}, ${mx} ${my}`;
    return { path, mx, my };
  });

  const iconeDoNo = (tipo: string) => {
    switch (tipo) {
      case "manual":
      case "webhook":
        return <Webhook size={15} class="text-amber-400" />;
      case "cron":
        return <Calendar size={15} class="text-sky-400" />;
      case "loop":
        return <RefreshCw size={15} class="text-orange-400" />;
      case "componente":
        return <Code2 size={15} class="text-teal-400" />;
      case "agente":
        return <Bot size={15} class="text-emerald-400" />;
      case "script":
        return <Terminal size={15} class="text-cyan-400" />;
      case "decisao":
        return <HelpCircle size={15} class="text-amber-400" />;
      case "task_create":
        return <Layers size={15} class="text-blue-400" />;
      case "reuniao":
        return <Users size={15} class="text-indigo-400" />;
      case "subflow":
        return <Workflow size={15} class="text-purple-400" />;
      case "http_request":
        return <Globe size={15} class="text-sky-400" />;
      case "delay":
        return <Clock size={15} class="text-yellow-400" />;
      case "registro":
      case "saida":
        return <FileText size={15} class="text-purple-400" />;
      default:
        return <Play size={15} class="text-zinc-400" />;
    }
  };

  const corDoNo = (tipo: string) => {
    switch (tipo) {
      case "manual":
      case "webhook":
        return "border-amber-500/50 bg-amber-950/20 text-amber-300";
      case "cron":
        return "border-sky-500/50 bg-sky-950/20 text-sky-300";
      case "loop":
        return "border-orange-500/50 bg-orange-950/20 text-orange-300";
      case "subflow":
        return "border-purple-500/50 bg-purple-950/20 text-purple-300";
      case "http_request":
        return "border-blue-500/50 bg-blue-950/20 text-blue-300";
      case "delay":
        return "border-yellow-500/50 bg-yellow-950/20 text-yellow-300";
      case "componente":
        return "border-teal-500/50 bg-teal-950/20 text-teal-300";
      case "agente":
        return "border-emerald-500/50 bg-emerald-950/20 text-emerald-300";
      case "script":
        return "border-cyan-500/50 bg-cyan-950/20 text-cyan-300";
      case "decisao":
        return "border-amber-500/50 bg-amber-950/20 text-amber-300";
      case "task_create":
        return "border-blue-500/50 bg-blue-950/20 text-blue-300";
      case "reuniao":
        return "border-indigo-500/50 bg-indigo-950/20 text-indigo-300";
      default:
        return "border-zinc-700 bg-zinc-900 text-zinc-300";
    }
  };

  // Mouse Handlers para Canvas (Pan, Drag de Nós, Desmarcar)
  const onMouseDownCanvas = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest(".canvas-node")) return;
    if ((e.target as HTMLElement).closest(".ndv-panel")) return;
    if ((e.target as HTMLElement).closest(".canvas-toolbar")) return;

    // Clique no fundo deseleciona qualquer nó e fecha o NDV
    setNoSelecionado(null);

    // Se estava em modo de conexão, cancela
    if (conectandoDeNoId()) {
      setConectandoDeNoId(null);
      showToast("Conexão cancelada", "info");
      return;
    }

    setIsPanning(true);
    setStartPan({ x: e.clientX - pan().x, y: e.clientY - pan().y });
  };

  const onMouseDownNode = (e: MouseEvent, no: NoGrafo & { x: number; y: number }) => {
    if (conectandoDeNoId()) {
      e.stopPropagation();
      completarConexao(no.id);
      return;
    }

    if (e.button !== 0) return; // apenas clique esquerdo
    e.stopPropagation();
    setNoSelecionado(no);
    setHouveArrasto(false);
    setNoArrastandoId(no.id);
    setDragStart({
      mouseX: e.clientX,
      mouseY: e.clientY,
      nodeX: no.x,
      nodeY: no.y,
    });
  };

  const onMouseMoveCanvas = (e: MouseEvent) => {
    const arrastandoId = noArrastandoId();
    const ds = dragStart();

    // Se estiver arrastando um nó
    if (arrastandoId && ds) {
      const z = zoom();
      const dx = (e.clientX - ds.mouseX) / z;
      const dy = (e.clientY - ds.mouseY) / z;

      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        setHouveArrasto(true);
      }

      const novoX = Math.round(ds.nodeX + dx);
      const novoY = Math.round(ds.nodeY + dy);

      setFluxoAtivo((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          nos: prev.nos.map((n) =>
            n.id === arrastandoId ? { ...n, pos: { x: novoX, y: novoY } } : n
          ),
        };
      });
      return;
    }

    setMousePos({ x: e.clientX, y: e.clientY });

    if (!isPanning()) return;
    setPan({ x: e.clientX - startPan().x, y: e.clientY - startPan().y });
  };

  const onMouseUpCanvas = () => {
    if (noArrastandoId()) {
      setNoArrastandoId(null);
      setDragStart(null);
      if (houveArrasto()) {
        const f = fluxoAtivo();
        if (f) void salvarAlteracoesWorkflow(f);
      }
    }
    setIsPanning(false);
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 60, y: 60 });
  };

  const filtroTipo = createMemo(() => (searchParams.filtro as string) || "todos");
  const setFiltroTipo = (tipo: string) => {
    if (tipo === "todos") {
      setSearchParams({ filtro: undefined });
    } else {
      setSearchParams({ filtro: tipo });
    }
  };

  const fluxosFiltrados = createMemo(() => {
    const q = buscaTexto().toLowerCase().trim();
    const filtro = filtroTipo();
    return fluxos().filter((f) => {
      const matchTexto =
        !q ||
        (f.id && f.id.toLowerCase().includes(q)) ||
        (f.nome && f.nome.toLowerCase().includes(q)) ||
        (f.descricao && f.descricao.toLowerCase().includes(q));
      if (!matchTexto) return false;

      if (filtro === "cron") {
        if (Array.isArray(f.gatilhos)) return f.gatilhos.some((g: any) => g.tipo === "cron");
        if (Array.isArray(f.nos)) return f.nos.some((n: any) => n.tipo === "cron");
        return f.gatilho === "cron";
      }
      if (filtro === "webhook") {
        if (Array.isArray(f.gatilhos)) return f.gatilhos.some((g: any) => g.tipo === "webhook");
        if (Array.isArray(f.nos)) return f.nos.some((n: any) => n.tipo === "webhook");
        return f.gatilho === "webhook";
      }
      if (filtro === "manual") {
        if (Array.isArray(f.gatilhos)) return f.gatilhos.some((g: any) => g.tipo === "manual");
        if (Array.isArray(f.nos)) return f.nos.some((n: any) => n.tipo === "manual");
        return f.gatilho === "manual";
      }
      return true;
    });
  });

  return (
    <div class="flex flex-col h-full w-full overflow-hidden bg-zinc-950 select-none">
      {/* ─────────────────────────────────────────────────────────────
          LISTA PRINCIPAL DE WORKFLOWS (Estilo n8n Workflows Studio)
         ───────────────────────────────────────────────────────────── */}
      <Show when={!fluxoAtivo()}>
        <div class="flex flex-col h-full overflow-hidden p-6 space-y-5">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
            <div class="space-y-1">
              <div class="flex items-center gap-2.5">
                <div class="h-9 w-9 rounded-xl bg-orange-600/20 border border-orange-500/40 flex items-center justify-center text-orange-400">
                  <GitBranch size={18} />
                </div>
                <div>
                  <h1 class="text-xl font-bold text-zinc-100 tracking-tight">Fluxos</h1>
                  <span class="text-xs text-zinc-400">
                    Gerencie, orquestre e execute pipelines automatizados em grafo
                  </span>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <input
                ref={inputImportarRef}
                type="file"
                accept=".json,application/json"
                class="hidden"
                onChange={importarWorkflowArquivo}
              />
              <Button size="sm" variant="ghost" onClick={carregarFluxos} title="Atualizar">
                <RefreshCw size={13} />
              </Button>
              <Button
                size="sm"
                variant="secondary"
                class="border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-zinc-100 text-xs font-semibold"
                onClick={() => inputImportarRef?.click()}
                title="Importar Fluxo de arquivo JSON"
              >
                <Upload size={14} class="mr-1.5 text-zinc-400" /> Importar JSON
              </Button>
              <Button
                size="sm"
                variant="primary"
                class="bg-orange-600 hover:bg-orange-500 text-white font-bold"
                onClick={() => setModalNovoFluxo(true)}
              >
                <Plus size={14} class="mr-1.5" /> Adicionar Fluxo
              </Button>
            </div>
          </div>

          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="flex items-center gap-2 flex-wrap">
              <div class="relative w-64 sm:w-72">
                <Search size={14} class="absolute left-3 top-2.5 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Pesquisar fluxos..."
                  value={buscaTexto()}
                  onInput={(e) => setBuscaTexto(e.currentTarget.value)}
                  class="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-orange-500 font-sans"
                />
              </div>

              {/* Pílulas de filtro de Gatilho / Categoria */}
              <div class="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setFiltroTipo("todos")}
                  class={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                    filtroTipo() === "todos"
                      ? "bg-zinc-700 text-white shadow-xs"
                      : "bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border border-zinc-800"
                  }`}
                >
                  Todos
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroTipo("cron")}
                  class={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                    filtroTipo() === "cron"
                      ? "bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-xs"
                      : "bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border border-zinc-800"
                  }`}
                >
                  <Calendar size={12} class="text-sky-400" />
                  Agendados (Cron)
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroTipo("webhook")}
                  class={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                    filtroTipo() === "webhook"
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-xs"
                      : "bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border border-zinc-800"
                  }`}
                >
                  <Webhook size={12} class="text-amber-400" />
                  Webhooks
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroTipo("manual")}
                  class={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                    filtroTipo() === "manual"
                      ? "bg-zinc-600/30 text-zinc-200 border border-zinc-600/40 shadow-xs"
                      : "bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border border-zinc-800"
                  }`}
                >
                  <Play size={12} class="text-zinc-400" />
                  Manuais
                </button>
              </div>
            </div>

            <div class="text-xs text-zinc-500 font-mono">
              {fluxosFiltrados().length} de {fluxos().length} fluxo(s)
            </div>
          </div>

          <div class="flex-1 overflow-y-auto min-h-0 space-y-2.5 pr-1 scrollbar-thin">
            <For
              each={fluxosFiltrados()}
              fallback={
                <div class="py-16 text-center text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-xl">
                  Nenhum fluxo encontrado.
                </div>
              }
            >
              {(f) => (
                <div
                  class="group p-4 rounded-xl bg-zinc-900/70 border border-zinc-800/80 hover:border-orange-500/50 hover:bg-zinc-900 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer shadow-xs"
                  onClick={() => abrirEditorCanvas(f.id)}
                >
                  <div class="flex items-start gap-3.5 min-w-0">
                    <div class="h-10 w-10 rounded-xl bg-zinc-950 border border-zinc-800 group-hover:border-orange-500/40 flex items-center justify-center text-orange-400 flex-shrink-0 transition-colors">
                      <GitBranch size={18} />
                    </div>

                    <div class="min-w-0 space-y-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <h2 class="text-sm font-bold text-zinc-100 group-hover:text-orange-400 transition-colors truncate">
                          {f.nome || f.id}
                        </h2>
                        <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-400">
                          id: {f.id}
                        </span>
                        <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/40 border border-emerald-800/50 text-emerald-400">
                          {f.nos ?? 0} nodes
                        </span>
                        <Show when={f.temLoop}>
                          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-orange-950/40 border border-orange-800/50 text-orange-400 flex items-center gap-1">
                            <RefreshCw size={10} /> Loop HLE
                          </span>
                        </Show>
                        <For each={f.gatilhos || []}>
                          {(g: any) => (
                            <span class={`text-[10px] font-mono px-1.5 py-0.5 rounded flex items-center gap-1 ${
                              g.tipo === "cron"
                                ? "bg-sky-950/40 border border-sky-800/50 text-sky-400"
                                : g.tipo === "webhook"
                                ? "bg-amber-950/40 border border-amber-800/50 text-amber-400"
                                : "bg-zinc-850 text-zinc-400"
                            }`}>
                              {g.tipo === "cron" ? <Calendar size={10} /> : g.tipo === "webhook" ? <Webhook size={10} /> : <Play size={10} />}
                              {g.tipo === "cron" ? (g.detalhe ? `Cron: ${g.detalhe}` : "Cron") : g.tipo === "webhook" ? "Webhook" : "Manual"}
                            </span>
                          )}
                        </For>
                      </div>

                      <p class="text-xs text-zinc-400 line-clamp-1">
                        {f.descricao || "Pipeline autônomo com nós de agentes, scripts do workspace e governança."}
                      </p>
                    </div>
                  </div>

                  <div class="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="xs"
                      variant="secondary"
                      class="border-zinc-800 hover:border-zinc-700 text-zinc-300 text-[11px]"
                      onClick={(e) => copiarWorkflowJson(f, e)}
                      title="Copiar Fluxo JSON (Ctrl+C)"
                    >
                      <Show
                        when={copiadoId() === f.id}
                        fallback={
                          <>
                            <Copy size={12} class="mr-1.5 text-zinc-400" /> Copiar JSON
                          </>
                        }
                      >
                        <>
                          <Check size={12} class="mr-1.5 text-emerald-400" /> Copiado!
                        </>
                      </Show>
                    </Button>

                    <Button
                      size="xs"
                      variant="secondary"
                      class="border-zinc-800 hover:border-zinc-700 text-zinc-300 text-[11px]"
                      onClick={(e) => exportarWorkflowJson(f, e)}
                      title="Exportar Fluxo como arquivo JSON baixável"
                    >
                      <Download size={12} class="mr-1.5 text-zinc-400" /> Exportar
                    </Button>

                    <Button
                      size="xs"
                      variant="primary"
                      class="bg-orange-600 hover:bg-orange-500 text-white font-bold text-[11px]"
                      onClick={(e) => {
                        e.stopPropagation();
                        abrirEditorCanvas(f.id);
                      }}
                    >
                      <Eye size={12} class="mr-1.5" /> Abrir Canvas
                    </Button>

                    <IconButton
                      size="xs"
                      variant="ghost"
                      class="text-zinc-500 hover:text-rose-400"
                      onClick={(e) => excluirFluxo(f.id, f.nome, e)}
                      title="Excluir fluxo"
                    >
                      <Trash2 size={13} />
                    </IconButton>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* ─────────────────────────────────────────────────────────────
          CASO 2: CANVAS VISUAL DO WORKFLOW (Estilo n8n Canvas Editor)
         ───────────────────────────────────────────────────────────── */}
      <Show when={fluxoAtivo()}>
        <div class="flex flex-col h-full w-full overflow-hidden">
          {/* Topo / Barra de Navegação do Canvas Responsiva */}
          <div class="h-14 border-b border-zinc-800 bg-zinc-900/90 px-3 sm:px-4 flex items-center justify-between gap-2 sm:gap-4 z-20 shrink-0">
            <div class="flex items-center gap-2 sm:gap-3 min-w-0">
              <button
                type="button"
                id="btn-voltar-fluxos"
                class="flex items-center gap-1.5 text-xs text-zinc-200 hover:text-white cursor-pointer px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors shrink-0 shadow-xs"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  voltarParaLista();
                }}
                title="Voltar para lista de Fluxos"
              >
                <ArrowLeft size={14} class="text-orange-400" />
                <span class="font-medium">Voltar para Fluxos</span>
              </button>

              <div class="h-4 w-px bg-zinc-800 shrink-0" />

              <div class="flex items-center gap-1.5 sm:gap-2 min-w-0">
                <div class="h-7 w-7 rounded-lg bg-orange-600/20 border border-orange-500/40 flex items-center justify-center text-orange-400 shrink-0">
                  <GitBranch size={15} />
                </div>
                <button
                  type="button"
                  onClick={() => voltarParaLista()}
                  class="font-bold text-xs text-zinc-100 hover:text-orange-400 transition-colors truncate max-w-[120px] sm:max-w-[200px] md:max-w-[320px] text-left cursor-pointer"
                  title="Clique para voltar aos Fluxos"
                >
                  {fluxoAtivo()!.nome || fluxoAtivo()!.id}
                </button>
              </div>
            </div>

            {/* Controles de Canvas e Ações Responsivos */}
            <div class="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {/* Botão + Adicionar Node */}
              <Button
                size="sm"
                variant="secondary"
                class="border-zinc-800 hover:border-orange-500/50 text-zinc-200 text-xs font-semibold px-2 sm:px-3"
                onClick={() => setModalAdicionarNode(true)}
              >
                <Plus size={14} class="text-orange-400" />
                <span class="hidden sm:inline ml-1">Adicionar Node</span>
                <span class="sm:hidden ml-1">Node</span>
              </Button>

              {/* Zoom Controls (Ocultos em telas menores para não quebrar a barra) */}
              <div class="hidden xl:flex items-center bg-zinc-950 border border-zinc-800 rounded-lg p-0.5 text-xs text-zinc-400">
                <IconButton size="xs" variant="ghost" onClick={() => setZoom((z) => Math.max(z - 0.15, 0.4))} title="Zoom Out (Ctrl+Scroll)">
                  <ZoomOut size={13} />
                </IconButton>
                <span class="px-2 font-mono text-[11px] text-zinc-300">
                  {Math.round(zoom() * 100)}%
                </span>
                <IconButton size="xs" variant="ghost" onClick={() => setZoom((z) => Math.min(z + 0.15, 2))} title="Zoom In (Ctrl+Scroll)">
                  <ZoomIn size={13} />
                </IconButton>
                <IconButton size="xs" variant="ghost" onClick={resetView} title="Resetar Visualização">
                  <Maximize2 size={12} />
                </IconButton>
              </div>

              {/* Logs Dropdown */}
              <div class="relative">
                <Button
                  size="sm"
                  variant="secondary"
                  id="btn-header-logs"
                  class="border-zinc-800 text-zinc-300 text-xs px-2 sm:px-3"
                  onClick={() => { void carregarLogs(fluxoAtivo()!.id); setPainelLogsAberto(!painelLogsAberto()); }}
                  title="Histórico de Execuções e Dados I/O"
                >
                  <History size={13} class="text-zinc-400" />
                  <span class="hidden md:inline ml-1.5">Logs & I/O</span>
                  <Show when={logsExecucoes().length > 0}>
                    <span class="ml-1 px-1.5 py-0.5 rounded-full bg-orange-600/30 text-orange-300 text-[9px] font-bold">{logsExecucoes().length}</span>
                  </Show>
                  <ChevronDown size={11} class="ml-1 text-zinc-500 hidden sm:inline" />
                </Button>

                <Show when={logsAberto()}>
                  <div class="absolute right-0 top-full mt-1 w-[340px] sm:w-[380px] max-w-[calc(100vw-2rem)] max-h-[400px] overflow-y-auto bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl z-50 p-2 space-y-1">
                    <div class="flex items-center justify-between px-2 py-1.5 border-b border-zinc-800 mb-1">
                      <span class="text-[11px] font-bold text-zinc-300 flex items-center gap-1.5">
                        <History size={12} class="text-orange-400" /> Histórico de Execuções
                      </span>
                      <button type="button" onClick={() => setLogsAberto(false)} class="text-zinc-500 hover:text-zinc-300 cursor-pointer">
                        <X size={13} />
                      </button>
                    </div>
                    <Show when={logsExecucoes().length === 0}>
                      <div class="text-center text-zinc-500 text-[11px] py-4">Nenhuma execução registrada</div>
                    </Show>
                    <For each={logsExecucoes()}>
                      {(log) => {
                        const isSelected = () => logSelecionado()?.execId === log.execId;
                        const statusCor = log.status === "concluido" ? "text-emerald-400" : log.status === "falhou" ? "text-rose-400" : "text-amber-400";
                        const statusIcon = log.status === "concluido" ? <CheckCircle2 size={12} class="text-emerald-400" /> : log.status === "falhou" ? <AlertCircle size={12} class="text-rose-400" /> : <RefreshCw size={12} class="text-amber-400 animate-spin" />;
                        return (
                          <button
                            type="button"
                            class={`w-full text-left px-2.5 py-2 rounded-lg cursor-pointer transition-colors text-[11px] ${
                              isSelected() ? "bg-orange-950/40 border border-orange-500/30" : "hover:bg-zinc-800/60 border border-transparent"
                            }`}
                            onClick={() => setLogSelecionado(log)}
                          >
                            <div class="flex items-center justify-between gap-2">
                              <div class="flex items-center gap-1.5 min-w-0">
                                {statusIcon}
                                <span class={`font-mono font-bold ${statusCor}`}>{log.status}</span>
                              </div>
                              <span class="text-[9px] text-zinc-500 font-mono flex-shrink-0">
                                {new Date(log.criadoEm || log.em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                            <div class="text-[10px] text-zinc-500 font-mono truncate mt-0.5">{log.execId}</div>
                            <Show when={log.entrada}>
                              <div class="text-[10px] text-zinc-400 truncate mt-0.5 italic">{(log.entrada as string).slice(0, 80)}</div>
                            </Show>
                            {/* Nós do log */}
                            <Show when={isSelected() && log.nos?.length > 0}>
                              <div class="mt-1.5 pt-1.5 border-t border-zinc-800 space-y-0.5">
                                <For each={log.nos}>
                                  {(n: any) => (
                                    <div class="flex items-center gap-1.5 text-[10px]">
                                      <span class={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${n.status === "ok" ? "bg-emerald-400" : n.status === "falhou" ? "bg-rose-400" : "bg-zinc-600"}`} />
                                      <span class="font-mono text-zinc-400">{n.id}</span>
                                      <span class="text-zinc-600">({n.tipo})</span>
                                      <span class={n.status === "ok" ? "text-emerald-500" : n.status === "falhou" ? "text-rose-500" : "text-zinc-600"}>{n.status}</span>
                                    </div>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </button>
                        );
                      }}
                    </For>
                  </div>
                </Show>
              </div>

              {/* Seletor de Modo de Visualização Responsivo */}
              <div class="flex items-center bg-zinc-950 border border-zinc-800 rounded-lg p-0.5 text-xs">
                <button
                  type="button"
                  class={`px-2 sm:px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer ${
                    modoExibicao() === "chat" ? "bg-zinc-800 text-orange-400 font-bold" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                  onClick={() => setModoExibicao("chat")}
                  title="Foco no Chat do Secretário"
                >
                  <Bot size={13} />
                  <span class="hidden md:inline">Chat</span>
                </button>
                <button
                  type="button"
                  class={`px-2 sm:px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer ${
                    modoExibicao() === "split" ? "bg-zinc-800 text-orange-400 font-bold" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                  onClick={() => setModoExibicao("split")}
                  title="Chat e Canvas Lado a Lado"
                >
                  <Sliders size={13} />
                  <span class="hidden md:inline">Lado a Lado</span>
                </button>
                <button
                  type="button"
                  class={`px-2 sm:px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer ${
                    modoExibicao() === "canvas" ? "bg-zinc-800 text-orange-400 font-bold" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                  onClick={() => setModoExibicao("canvas")}
                  title="Foco no Canvas de Nós"
                >
                  <Maximize2 size={13} />
                  <span class="hidden md:inline">Canvas</span>
                </button>
              </div>

              <Button
                size="sm"
                variant="secondary"
                class="border-zinc-800 hover:border-zinc-700 text-zinc-300 text-xs px-2 sm:px-2.5"
                onClick={() => exportarWorkflowJson(fluxoAtivo()!)}
                title="Exportar este Fluxo como JSON"
              >
                <Download size={13} class="text-zinc-400" />
                <span class="hidden lg:inline ml-1.5">Exportar</span>
              </Button>

              <Button
                size="sm"
                variant="primary"
                class="bg-orange-600 hover:bg-orange-500 text-white font-bold px-2 sm:px-3"
                onClick={() => setModalExecutar(true)}
              >
                <Play size={13} class="fill-current" />
                <span class="hidden sm:inline ml-1.5">Executar</span>
              </Button>

              <IconButton
                size="sm"
                variant="ghost"
                class="text-zinc-500 hover:text-rose-400 hover:bg-rose-950/30 shrink-0"
                onClick={(e) => excluirFluxo(fluxoAtivo()!.id, fluxoAtivo()!.nome, e)}
                title="Excluir este fluxo"
              >
                <Trash2 size={14} />
              </IconButton>
            </div>
          </div>

          {/* Container Principal: Split-View ou Foco Responsivo */}
          <div class="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden relative">
            {/* Painel do Secretário no Modo Split ou Chat */}
            <Show when={modoExibicao() === "split" || modoExibicao() === "chat"}>
              <div
                class={`h-full border-b md:border-b-0 md:border-r border-zinc-800 bg-zinc-950 flex flex-col transition-all duration-200 z-10 ${
                  modoExibicao() === "chat"
                    ? "w-full"
                    : "w-full md:w-[320px] lg:w-[380px] xl:w-[440px] max-w-full shrink-0"
                }`}
              >
                <SecretarioView />
              </div>
            </Show>

            {/* Painel do Canvas com Grid Pontilhado */}
            <Show when={modoExibicao() === "split" || modoExibicao() === "canvas"}>
              <div
                class="flex-1 h-full min-w-0 relative overflow-hidden cursor-grab active:cursor-grabbing bg-[#0d0f12]"
                onScroll={(e) => {
                  e.currentTarget.scrollLeft = 0;
                  e.currentTarget.scrollTop = 0;
                }}
                onMouseDown={onMouseDownCanvas}
                onMouseMove={onMouseMoveCanvas}
                onMouseUp={onMouseUpCanvas}
                onMouseLeave={onMouseUpCanvas}
                onContextMenu={(e) => onContextMenuCanvas(e)}
                onDragOver={(e) => {
                  if (e.dataTransfer?.types.includes("application/opencorp-node-tipo")) {
                    e.preventDefault();
                    e.dataTransfer!.dropEffect = "copy";
                  }
                }}
                onDrop={(e) => {
                  const tipo = e.dataTransfer?.getData("application/opencorp-node-tipo");
                  if (!tipo) return;
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = Math.round((e.clientX - rect.left - pan().x) / zoom());
                  const y = Math.round((e.clientY - rect.top - pan().y) / zoom());
                  void adicionarNodeAoWorkflow(tipo, { x, y });
                }}
            onWheel={(e) => {
              if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -0.08 : 0.08;
                setZoom((z) => Math.max(0.3, Math.min(2.5, z + delta)));
              }
            }}
            style={{
              "background-image": "radial-gradient(#27272a 1px, transparent 1px)",
              "background-size": `${24 * zoom()}px ${24 * zoom()}px`,
              "background-position": `${pan().x}px ${pan().y}px`,
            }}
          >
            {/* Banner Flutuante de Conexão Ativa */}
            <Show when={conectandoDeNoId()}>
              <div class="absolute top-4 left-1/2 -translate-x-1/2 z-40 bg-orange-950/90 border border-orange-500/60 rounded-full px-4 py-1.5 shadow-2xl flex items-center gap-3 text-xs text-orange-200 backdrop-blur-md animate-pulse">
                <span class="flex items-center gap-1.5">
                  <Zap size={12} class="text-orange-400" />
                  <span>
                    Conectando a partir de <strong class="font-mono text-white">{conectandoDeNoId()}</strong> — clique no nó de destino
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setConectandoDeNoId(null);
                    showToast("Conexão cancelada", "info");
                  }}
                  class="px-2 py-0.5 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 text-[11px] font-bold cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </Show>

            {/* Camada Transformada por Zoom e Pan */}
            <div
              class="absolute inset-0 origin-top-left pointer-events-none"
              style={{
                transform: `translate(${pan().x}px, ${pan().y}px) scale(${zoom()})`,
              }}
            >
              {/* SVG para as Arestas / Conexões Curvas com Handles e Botão de Desconectar */}
              <svg class="absolute inset-0 overflow-visible w-full h-full pointer-events-none">
                <defs>
                  <linearGradient id="edge-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="#f97316" />
                    <stop offset="100%" stop-color="#3b82f6" />
                  </linearGradient>
                </defs>
                <For each={arestasCurvadas()}>
                  {(a: any) => (
                    <g class="group">
                      <path
                        d={a.path}
                        fill="none"
                        stroke="#000000"
                        stroke-width="6"
                        opacity="0.5"
                      />
                      <path
                        d={a.path}
                        fill="none"
                        stroke="url(#edge-gradient)"
                        stroke-width="2.5"
                        class="transition-all group-hover:stroke-rose-400 group-hover:stroke-[3.5]"
                      />
                      {/* Ponto interativo para desconectar aresta */}
                      <g
                        transform={`translate(${a.midX}, ${a.midY})`}
                        class="pointer-events-auto cursor-pointer group-hover:opacity-100 opacity-0 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          removerAresta(a.de, a.para);
                        }}
                      >
                        <title>Clique para desconectar ({a.de} → {a.para})</title>
                        <circle r="9" fill="#18181b" stroke="#f43f5e" stroke-width="1.5" />
                        <text y="3" text-anchor="middle" fill="#f43f5e" font-size="10" font-weight="bold">✕</text>
                      </g>
                    </g>
                  )}
                </For>

                {/* Linha Guia Dinâmica ao Conectar estilo n8n */}
                <Show when={linhaConexaoGuia()}>
                  <g class="pointer-events-none animate-pulse">
                    <path
                      d={linhaConexaoGuia()!.path}
                      fill="none"
                      stroke="#f97316"
                      stroke-width="3.5"
                      stroke-dasharray="6,4"
                    />
                    <circle
                      cx={linhaConexaoGuia()!.mx}
                      cy={linhaConexaoGuia()!.my}
                      r="6"
                      fill="#f97316"
                    />
                  </g>
                </Show>
              </svg>

              {/* Nós Visuais no Canvas com Drag & Drop e Portas de Conexão */}
              <div class="relative pointer-events-auto">
                <For each={nosPosicionados()}>
                  {(no) => {
                    const selecionado = () => noSelecionado()?.id === no.id;
                    const isTrigger = no.tipo === "manual" || no.tipo === "webhook";
                    const isConectandoOrigem = () => conectandoDeNoId() === no.id;
                    const isConectandoAlvo = () => conectandoDeNoId() && conectandoDeNoId() !== no.id;
                    const numSaidas = () => (fluxoAtivo()?.arestas || []).filter((a) => a.de === no.id).length;

                    return (
                      <div
                        data-node-id={no.id}
                        class={`canvas-node absolute w-[190px] h-[80px] rounded-xl border p-2.5 transition-all shadow-xl flex flex-col justify-between select-none ${
                          corDoNo(no.tipo)
                        } ${
                          selecionado()
                            ? "ring-2 ring-orange-500 border-orange-400 shadow-orange-500/20 scale-105 z-10"
                            : isConectandoAlvo()
                            ? "ring-2 ring-emerald-500/90 border-emerald-400 animate-pulse cursor-pointer shadow-emerald-500/20 scale-[1.02]"
                            : "hover:border-zinc-500 hover:scale-[1.02] cursor-move"
                        }`}
                        style={{
                          left: `${no.x}px`,
                          top: `${no.y}px`,
                          background: "#18181b",
                        }}
                        onMouseDown={(e) => onMouseDownNode(e, no)}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (conectandoDeNoId()) {
                            completarConexao(no.id);
                          } else {
                            setNoSelecionado(no);
                          }
                        }}
                        onContextMenu={(e) => onContextMenuCanvas(e, no.id)}
                      >
                        {/* Handle de Entrada (Esquerda) */}
                        <Show when={!isTrigger}>
                          <div
                            class="absolute -left-3 top-[28px] w-6 h-6 rounded-full bg-zinc-900 border-2 border-orange-500 shadow-md flex items-center justify-center hover:scale-125 transition-transform cursor-pointer z-20 group"
                            title={conectandoDeNoId() ? "Clique para conectar aqui (Input Port)" : "Input Port (Entrada)"}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (conectandoDeNoId()) completarConexao(no.id);
                            }}
                          >
                            <div class="w-2 h-2 rounded-full bg-orange-400 group-hover:scale-125 transition-transform" />
                          </div>
                        </Show>

                        {/* Topo do Card do Nó */}
                        <div class="flex items-center justify-between gap-1.5 min-w-0">
                          <div class="flex items-center gap-1.5 min-w-0">
                            <div class="p-1 rounded bg-zinc-900 border border-zinc-800 flex-shrink-0">
                              {iconeDoNo(no.tipo)}
                            </div>
                            <div class="min-w-0">
                              <span class="font-bold text-xs text-zinc-100 truncate block font-mono">
                                {no.id}
                              </span>
                              <span class="text-[9px] uppercase font-mono text-zinc-400">
                                {no.tipo}
                              </span>
                            </div>
                          </div>

                          <div class="flex items-center gap-1">
                            <Show when={numSaidas() > 1}>
                              <span
                                class="px-1.5 py-0.2 rounded text-[9px] bg-blue-950 text-blue-400 border border-blue-800/60 font-mono font-bold"
                                title={`${numSaidas()} saídas ativas`}
                              >
                                {numSaidas()} saídas
                              </span>
                            </Show>
                            <Show when={selecionado()}>
                              <span class="h-2 w-2 rounded-full bg-orange-400 animate-pulse" />
                            </Show>
                          </div>
                        </div>

                        {/* Subtítulo / Resumo do Nó */}
                        <div class="text-[10px] text-zinc-400 font-mono truncate px-1 py-0.5 bg-zinc-950/80 rounded border border-zinc-900">
                          {no.config?.agente
                            ? `@${no.config.agente}`
                            : no.config?.arquivo
                            ? no.config.arquivo
                            : no.config?.pergunta
                            ? no.config.pergunta
                            : no.config?.titulo
                            ? no.config.titulo
                            : "Configurado"}
                        </div>

                        {/* Handle de Saída (Direita) - Permite Múltiplas Saídas */}
                        <div
                          class={`absolute -right-3 top-[28px] w-6 h-6 rounded-full bg-zinc-900 border-2 shadow-md flex items-center justify-center hover:scale-125 transition-transform cursor-pointer z-20 group ${
                            isConectandoOrigem() ? "border-orange-500 ring-2 ring-orange-500/50" : "border-blue-500"
                          }`}
                          title="Clique para ligar a outro nó (Output Port - permite múltiplas saídas)"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            iniciarConexao(no.id, e);
                          }}
                        >
                          <div class="w-2 h-2 rounded-full bg-blue-400 group-hover:scale-125 transition-transform" />
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            </div>

            {/* ─────────────────────────────────────────────────────────────
                PAINEL INFERIOR COLAPSÁVEL: LOGS e DADOS I/O POR NÓ
               ───────────────────────────────────────────────────────────── */}
            <Show when={painelLogsAberto()}>
              <div class="absolute bottom-0 left-0 right-0 z-30 bg-zinc-900/98 border-t border-zinc-700 backdrop-blur-md shadow-2xl flex flex-col" style={{ height: "280px", "max-height": "50%" }}>
                {/* Barra de título do painel */}
                <div class="h-9 px-3 flex items-center justify-between border-b border-zinc-800 shrink-0 cursor-ns-resize select-none">
                  <div class="flex items-center gap-2 text-xs">
                    <Terminal size={13} class="text-orange-400" />
                    <span class="font-bold text-zinc-200">Execuções & Dados I/O</span>
                    <Show when={logsExecucoes().length > 0}>
                      <span class="px-1.5 py-0.5 rounded-full bg-orange-600/30 text-orange-300 text-[9px] font-bold">{logsExecucoes().length}</span>
                    </Show>
                  </div>
                  <div class="flex items-center gap-1">
                    <IconButton size="xs" variant="ghost" onClick={() => { void carregarLogs(fluxoAtivo()!.id); }} title="Atualizar Logs">
                      <RefreshCw size={12} class="text-zinc-400" />
                    </IconButton>
                    <IconButton size="xs" variant="ghost" onClick={() => setPainelLogsAberto(false)} title="Fechar painel">
                      <ChevronDown size={14} class="text-zinc-400" />
                    </IconButton>
                  </div>
                </div>

                {/* Corpo: lista de execuções + detalhe do nó selecionado */}
                <div class="flex-1 min-h-0 flex overflow-hidden">
                  {/* Coluna da esquerda: lista de execuções */}
                  <div class="w-52 shrink-0 border-r border-zinc-800 overflow-y-auto scrollbar-thin">
                    <Show when={logsExecucoes().length === 0}>
                      <div class="text-center text-zinc-500 text-[10px] py-6">Nenhuma execução</div>
                    </Show>
                    <For each={logsExecucoes()}>
                      {(log) => {
                        const isSelected = () => logSelecionado()?.execId === log.execId;
                        const statusIcon = log.status === "concluido" ? <CheckCircle2 size={11} class="text-emerald-400" /> : log.status === "falhou" ? <AlertCircle size={11} class="text-rose-400" /> : <RefreshCw size={11} class="text-amber-400 animate-spin" />;
                        return (
                          <button
                            type="button"
                            class={`w-full text-left px-2.5 py-2 text-[10px] border-b border-zinc-800/50 transition-colors cursor-pointer ${
                              isSelected() ? "bg-orange-950/40 text-orange-200" : "hover:bg-zinc-800/60 text-zinc-300"
                            }`}
                            onClick={() => { setLogSelecionado(log); setNoLogSelecionadoId(null); }}
                          >
                            <div class="flex items-center gap-1.5">
                              {statusIcon}
                              <span class="font-mono font-bold">{log.status}</span>
                            </div>
                            <div class="text-[9px] text-zinc-500 font-mono mt-0.5">
                              {new Date(log.criadoEm || log.em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                            </div>
                          </button>
                        );
                      }}
                    </For>
                  </div>

                  {/* Coluna central: trilha de nós da execução */}
                  <div class="w-48 shrink-0 border-r border-zinc-800 overflow-y-auto scrollbar-thin">
                    <Show when={logSelecionado()?.nos?.length > 0} fallback={<div class="text-center text-zinc-500 text-[10px] py-6">Selecione uma execução</div>}>
                      <div class="p-1 space-y-0.5">
                        <For each={logSelecionado()?.nos || []}>
                          {(n: any) => {
                            const sel = () => noLogSelecionadoId() === n.id;
                            return (
                              <button
                                type="button"
                                class={`w-full text-left px-2 py-1.5 rounded-lg text-[10px] transition-colors cursor-pointer flex items-center gap-1.5 ${
                                  sel() ? "bg-zinc-800 text-zinc-100 ring-1 ring-orange-500/50" : "hover:bg-zinc-800/50 text-zinc-300"
                                }`}
                                onClick={() => { setNoLogSelecionadoId(n.id); setAbaLogDetalhe("dados"); }}
                              >
                                <span class={`w-2 h-2 rounded-full shrink-0 ${n.status === "ok" ? "bg-emerald-400" : n.status === "falhou" ? "bg-rose-400" : "bg-zinc-600"}`} />
                                <span class="font-mono truncate">{n.id}</span>
                                <span class="text-zinc-600 text-[9px]">({n.tipo})</span>
                              </button>
                            );
                          }}
                        </For>
                      </div>
                    </Show>
                  </div>

                  {/* Coluna da direita: detalhe I/O do nó selecionado */}
                  <div class="flex-1 min-w-0 flex flex-col overflow-hidden">
                    <Show when={noLogSelecionadoId()} fallback={<div class="flex-1 flex items-center justify-center text-zinc-500 text-[10px]">Selecione um nó na trilha para inspecionar</div>}>
                      {(() => {
                        const noLog = () => (logSelecionado()?.nos || []).find((n: any) => n.id === noLogSelecionadoId());
                        return (
                          <>
                            {/* Abas */}
                            <div class="h-8 px-2 flex items-center gap-1 border-b border-zinc-800 shrink-0">
                              <button type="button" onClick={() => setAbaLogDetalhe("dados")} class={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${abaLogDetalhe() === "dados" ? "bg-zinc-800 text-orange-400 font-bold" : "text-zinc-400 hover:text-zinc-200"}`}>Saída (Output)</button>
                              <button type="button" onClick={() => setAbaLogDetalhe("entrada")} class={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${abaLogDetalhe() === "entrada" ? "bg-zinc-800 text-orange-400 font-bold" : "text-zinc-400 hover:text-zinc-200"}`}>Entrada (Input)</button>
                              <button type="button" onClick={() => setAbaLogDetalhe("raw")} class={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${abaLogDetalhe() === "raw" ? "bg-zinc-800 text-orange-400 font-bold" : "text-zinc-400 hover:text-zinc-200"}`}>Raw / Erros</button>
                              <div class="flex-1" />
                              <Show when={noLog()}>
                                <span class={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold ${noLog()?.status === "ok" ? "bg-emerald-950/50 text-emerald-400" : noLog()?.status === "falhou" ? "bg-rose-950/50 text-rose-400" : "bg-zinc-800 text-zinc-400"}`}>
                                  {noLog()?.status} {noLog()?.duracao_ms !== undefined ? `· ${noLog()?.duracao_ms}ms` : ""}
                                </span>
                              </Show>
                            </div>
                            {/* Conteúdo */}
                            <div class="flex-1 overflow-y-auto p-3 scrollbar-thin">
                              <Show when={abaLogDetalhe() === "dados"}>
                                <pre class="text-[11px] font-mono text-zinc-300 whitespace-pre-wrap select-text">
                                  {noLog()?.saida ? (typeof noLog()?.saida === "string" ? noLog()?.saida : JSON.stringify(noLog()?.saida, null, 2)) : "Sem dados de saída"}
                                </pre>
                              </Show>
                              <Show when={abaLogDetalhe() === "entrada"}>
                                <pre class="text-[11px] font-mono text-zinc-300 whitespace-pre-wrap select-text">
                                  {noLog()?.entrada ? (typeof noLog()?.entrada === "string" ? noLog()?.entrada : JSON.stringify(noLog()?.entrada, null, 2)) : "Sem dados de entrada"}
                                </pre>
                              </Show>
                              <Show when={abaLogDetalhe() === "raw"}>
                                <pre class="text-[11px] font-mono text-zinc-300 whitespace-pre-wrap select-text">
                                  {noLog()?.erro ? `ERRO: ${noLog()?.erro}\n\n` : ""}{JSON.stringify(noLog(), null, 2)}
                                </pre>
                              </Show>
                            </div>
                          </>
                        );
                      })()}
                    </Show>
                  </div>
                </div>
              </div>
            </Show>

            {/* Botão flutuante para abrir painel de logs (quando fechado) */}
            <Show when={!painelLogsAberto() && (modoExibicao() === "canvas" || modoExibicao() === "split")}>
              <button
                type="button"
                id="btn-painel-logs"
                class="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 px-4 py-1.5 rounded-full bg-zinc-900/90 border border-zinc-700 hover:border-orange-500/60 text-xs text-zinc-300 hover:text-orange-400 flex items-center gap-2 transition-all backdrop-blur-md shadow-lg cursor-pointer"
                onClick={() => { setPainelLogsAberto(true); void carregarLogs(fluxoAtivo()!.id); }}
              >
                <ChevronUp size={13} />
                <Terminal size={12} />
                <span class="font-medium">Logs & Dados I/O</span>
                <Show when={logsExecucoes().length > 0}>
                  <span class="px-1.5 py-0.5 rounded-full bg-orange-600/30 text-orange-300 text-[9px] font-bold">{logsExecucoes().length}</span>
                </Show>
              </button>
            </Show>
          </div>
        </Show>

        {/* ─────────────────────────────────────────────────────────────
            NDV LATERAL (Node Details View com Formulário Automático + JSON)
           ───────────────────────────────────────────────────────────── */}
        <Show when={noSelecionado()}>
          <div class="ndv-panel absolute left-2 right-2 sm:left-auto sm:right-4 top-2 sm:top-4 bottom-2 sm:bottom-4 w-auto sm:w-[350px] md:w-96 bg-zinc-900/95 backdrop-blur-md border border-zinc-800 rounded-xl shadow-2xl flex flex-col z-30 transition-all">
                {/* Topo do NDV */}
                <div class="p-3.5 border-b border-zinc-800 flex items-center justify-between">
                  <div class="flex items-center gap-2 min-w-0">
                    <div class="p-1.5 rounded-lg bg-zinc-800 text-orange-400">
                      {iconeDoNo(noSelecionado()!.tipo)}
                    </div>
                    <div class="min-w-0">
                      <h3 class="font-bold text-xs text-zinc-100 font-mono truncate">
                        {noSelecionado()!.id}
                      </h3>
                      <span class="text-[10px] uppercase font-mono text-zinc-500">
                        Tipo: {noSelecionado()!.tipo}
                      </span>
                    </div>
                  </div>

                  <div class="flex items-center gap-1">
                    {/* Toggle de Modos: Formulário Automático vs JSON */}
                    <div class="flex items-center bg-zinc-950 border border-zinc-800 rounded p-0.5 text-[10px] font-mono">
                      <button
                        onClick={() => setModoNdv("form")}
                        class={`px-2 py-0.5 rounded transition-colors ${
                          modoNdv() === "form" ? "bg-zinc-800 text-zinc-100 font-bold" : "text-zinc-400"
                        }`}
                      >
                        Form
                      </button>
                      <button
                        onClick={() => setModoNdv("json")}
                        class={`px-2 py-0.5 rounded transition-colors ${
                          modoNdv() === "json" ? "bg-zinc-800 text-zinc-100 font-bold" : "text-zinc-400"
                        }`}
                      >
                        JSON
                      </button>
                    </div>

                    <IconButton size="xs" variant="ghost" onClick={() => setNoSelecionado(null)}>
                      <X size={15} />
                    </IconButton>
                  </div>
                </div>

                {/* Conteúdo do NDV */}
                <div class="flex-1 overflow-y-auto p-4 space-y-4 text-xs scrollbar-thin">
                  <Show
                    when={modoNdv() === "form"}
                    fallback={
                      /* Versão Avançada JSON */
                      <div class="space-y-2">
                        <span class="text-[10px] font-bold uppercase text-zinc-500 block font-mono">
                          Configuração Estruturada (Raw JSON)
                        </span>
                        <pre class="p-3 rounded-lg bg-black border border-zinc-800 text-[11px] font-mono text-zinc-300 max-h-96 overflow-y-auto whitespace-pre-wrap scrollbar-thin select-text">
                          {JSON.stringify(noSelecionado()!, null, 2)}
                        </pre>
                      </div>
                    }
                  >
                    {/* FORMULÁRIO AUTOMÁTICO BASEADO NO TIPO DE NÓ */}
                    <div class="space-y-3.5">
                      {/* Nó Tipo Agente */}
                      <Show when={noSelecionado()!.tipo === "agente"}>
                        <div class="space-y-1">
                          <label class="text-[11px] font-medium text-zinc-300 block">
                            Agente Especialista *
                          </label>
                          <select
                            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 focus:border-orange-500 font-mono"
                            value={noSelecionado()!.config?.agente || ""}
                            onChange={(e) => atualizarConfigNo("agente", e.currentTarget.value)}
                          >
                            <For each={agentes()}>
                              {(ag) => <option value={ag.id}>@{ag.id} ({ag.role || ag.categoria || "agente"})</option>}
                            </For>
                          </select>
                        </div>

                        <div class="space-y-1">
                          <label class="text-[11px] font-medium text-zinc-300 block">
                            Modo de Sessão / Memória
                          </label>
                          <select
                            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 focus:border-orange-500 font-mono"
                            value={noSelecionado()!.config?.session_mode || "nova"}
                            onChange={(e) => atualizarConfigNo("session_mode", e.currentTarget.value)}
                          >
                            <option value="nova">Nova Sessão a cada execução (Isolado)</option>
                            <option value="reaproveitar">Reaproveitar Sessão (Memória persistente / HLE)</option>
                          </select>
                          <p class="text-[10px] text-zinc-500">
                            Reaproveitar mantém o histórico das tentativas anteriores do agente dentro do mesmo fluxo ou loop de correção.
                          </p>
                        </div>

                        <div class="space-y-1">
                          <label class="text-[11px] font-medium text-zinc-300 block">
                            Ordem / Instrução ao Agente *
                          </label>
                          <textarea
                            rows={4}
                            placeholder="Instrução para a IA. Aceita {{entrada}} como dado anterior..."
                            value={noSelecionado()!.config?.ordem || ""}
                            onInput={(e) => atualizarConfigNo("ordem", e.currentTarget.value)}
                            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-200 font-mono focus:border-orange-500 resize-none leading-relaxed"
                          />
                        </div>
                      </Show>

                      {/* Nó Tipo Loop / HLE */}
                      <Show when={noSelecionado()!.tipo === "loop"}>
                        <div class="space-y-1">
                          <label class="text-[11px] font-medium text-zinc-300 block">
                            Teto Máximo de Iterações (Segurança) *
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={50}
                            value={noSelecionado()!.config?.max_iteracoes ?? 3}
                            onInput={(e) => atualizarConfigNo("max_iteracoes", parseInt(e.currentTarget.value, 10) || 3)}
                            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 font-mono focus:border-orange-500"
                          />
                          <p class="text-[10px] text-zinc-500">
                            Número máximo de voltas permitidas no ciclo para evitar sobrecarga de CPU/tokens.
                          </p>
                        </div>

                        <div class="space-y-1">
                          <label class="text-[11px] font-medium text-zinc-300 block">
                            Condição de Parada (Texto ou Palavra-Chave)
                          </label>
                          <input
                            type="text"
                            placeholder="ex: SUCESSO ou CONCLUIDO"
                            value={noSelecionado()!.config?.condicao_parada || ""}
                            onInput={(e) => atualizarConfigNo("condicao_parada", e.currentTarget.value)}
                            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 font-mono focus:border-orange-500"
                          />
                          <p class="text-[10px] text-zinc-500">
                            Quando o output contiver este texto, o loop encerra imediatamente e segue para a saída final.
                          </p>
                        </div>

                        <div class="space-y-1">
                          <label class="text-[11px] font-medium text-zinc-300 block">
                            ID do Nó para Retornar (Loop)
                          </label>
                          <input
                            type="text"
                            placeholder="ex: roteirista ou renderizar"
                            value={noSelecionado()!.config?.retornar_para || ""}
                            onInput={(e) => atualizarConfigNo("retornar_para", e.currentTarget.value)}
                            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 font-mono focus:border-orange-500"
                          />
                        </div>

                        <div class="space-y-1">
                          <label class="text-[11px] font-medium text-zinc-300 block">
                            ID do Nó de Saída Final (Pós-Loop)
                          </label>
                          <input
                            type="text"
                            placeholder="ex: publicar ou registro_fim"
                            value={noSelecionado()!.config?.saida_final || ""}
                            onInput={(e) => atualizarConfigNo("saida_final", e.currentTarget.value)}
                            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 font-mono focus:border-orange-500"
                          />
                        </div>
                      </Show>

                      {/* Nó Tipo Gatilho Cron */}
                      <Show when={noSelecionado()!.tipo === "cron"}>
                        <div class="space-y-1">
                          <label class="text-[11px] font-medium text-zinc-300 block">
                            Expressão Cron *
                          </label>
                          <input
                            type="text"
                            placeholder="ex: 0 8 * * * (todo dia às 08:00)"
                            value={noSelecionado()!.config?.expressao_cron || "0 8 * * *"}
                            onInput={(e) => atualizarConfigNo("expressao_cron", e.currentTarget.value)}
                            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 font-mono focus:border-orange-500"
                          />
                          <p class="text-[10px] text-zinc-500">
                            Dispara o fluxo automaticamente conforme a agenda definida, sem necessidade de crons cegos no sistema.
                          </p>
                        </div>
                      </Show>

                      {/* Nó Tipo Gatilho Webhook (estilo n8n Webhook Node) */}
                      <Show when={noSelecionado()!.tipo === "webhook"}>
                        <div class="space-y-2">
                          <div class="space-y-1">
                            <label class="text-[11px] font-medium text-zinc-300 block">
                              URL do Webhook (Endpoint de Entrada)
                            </label>
                            <div class="p-2 rounded-lg bg-zinc-950 border border-zinc-800 font-mono text-[11px] text-emerald-400 select-all break-all">
                              {window.location.origin}/flows/{fluxoAtivo()?.id}/webhook
                            </div>
                          </div>
                          <div class="space-y-1">
                            <label class="text-[10px] text-zinc-400 block">
                              URL Destino (para webhook de saída HTTP, se aplicável)
                            </label>
                            <input
                              type="text"
                              placeholder="ex: https://api.exemplo.com/webhook"
                              value={noSelecionado()!.config?.url || ""}
                              onInput={(e) => atualizarConfigNo("url", e.currentTarget.value)}
                              class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 font-mono focus:border-orange-500"
                            />
                          </div>
                          <p class="text-[10px] text-zinc-500">
                            Ao receber um POST com JSON, o payload é injetado diretamente na variável <code>$OPENCORP_INPUT</code> dos nós seguintes.
                          </p>
                        </div>
                      </Show>

                      {/* Nó Tipo Componente Modular */}
                      <Show when={noSelecionado()!.tipo === "componente"}>
                        <div class="space-y-3">
                          {/* Seletor de Componente do Marketplace */}
                          <div class="space-y-1">
                            <label class="text-[11px] font-medium text-zinc-300 flex items-center justify-between">
                              <span>Componente do Marketplace / Integrador</span>
                              <span class="text-[10px] text-orange-400 font-mono">{componentes().length} disponíveis</span>
                            </label>
                            <select
                              value={noSelecionado()!.config?.componente_id || ""}
                              onChange={(e) => {
                                const val = e.currentTarget.value;
                                atualizarConfigNo("componente_id", val);
                                const selecionado = componentes().find((c) => c.id === val);
                                if (selecionado) {
                                  atualizarConfigNo("runtime", selecionado.runtime);
                                }
                              }}
                              class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 focus:border-orange-500"
                            >
                              <option value="">— Personalizado (Arquivo ou Código Inline) —</option>
                              <For each={componentes()}>
                                {(c) => (
                                  <option value={c.id}>
                                    {c.builtin ? "📦 " : "🧩 "}
                                    {c.nome} ({c.runtime})
                                  </option>
                                )}
                              </For>
                            </select>
                          </div>

                          {/* Se escolheu um componente cadastrado, exibir detalhes */}
                          <Show
                            when={(() => {
                              const cId = noSelecionado()!.config?.componente_id;
                              return componentes().find((c) => c.id === cId);
                            })()}
                          >
                            {(comp) => (
                              <div class="p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800 text-xs space-y-1.5">
                                <div class="flex items-center justify-between">
                                  <span class="font-medium text-zinc-200">{comp().nome}</span>
                                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 font-mono">
                                    v{comp().versao || "1.0.0"} · {comp().runtime}
                                  </span>
                                </div>
                                <p class="text-[11px] text-zinc-400">{comp().descricao || "Sem descrição."}</p>
                                <Show when={comp().tags && comp().tags.length > 0}>
                                  <div class="flex flex-wrap gap-1 pt-1">
                                    <For each={comp().tags}>
                                      {(t) => (
                                        <span class="text-[9px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400">
                                          #{t}
                                        </span>
                                      )}
                                    </For>
                                  </div>
                                </Show>
                              </div>
                            )}
                          </Show>

                          {/* Configuração personalizada quando nenhum componente pré-fabricado for selecionado */}
                          <Show when={!noSelecionado()!.config?.componente_id}>
                            <div class="space-y-2 pt-1 border-t border-zinc-800/60">
                              <div class="flex gap-2">
                                <div class="flex-1 space-y-1">
                                  <label class="text-[11px] font-medium text-zinc-300 block">Runtime</label>
                                  <select
                                    value={noSelecionado()!.config?.runtime || "node"}
                                    onChange={(e) => atualizarConfigNo("runtime", e.currentTarget.value)}
                                    class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 focus:border-orange-500"
                                  >
                                    <option value="node">Node.js (JavaScript)</option>
                                    <option value="python">Python 3</option>
                                    <option value="bash">Bash Script</option>
                                  </select>
                                </div>
                                <div class="flex-1 space-y-1">
                                  <label class="text-[11px] font-medium text-zinc-300 block">Arquivo (Opcional)</label>
                                  <input
                                    type="text"
                                    placeholder="scripts/conversor.mjs"
                                    value={noSelecionado()!.config?.arquivo || ""}
                                    onInput={(e) => atualizarConfigNo("arquivo", e.currentTarget.value)}
                                    class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 font-mono focus:border-orange-500"
                                  />
                                </div>
                              </div>

                              <div class="space-y-1">
                                <label class="text-[11px] font-medium text-zinc-300 block">
                                  Código Inline (se não usar arquivo)
                                </label>
                                <textarea
                                  rows={5}
                                  placeholder={
                                    noSelecionado()!.config?.runtime === "bash"
                                      ? 'echo "{\\"output\\": \\"$OPENCORP_INPUT\\"}"'
                                      : 'const entrada = JSON.parse(process.env.OPENCORP_ENTRADA || "{}");\nconsole.log(JSON.stringify({ output: "ok", dados: entrada }));'
                                  }
                                  value={noSelecionado()!.config?.codigo || ""}
                                  onInput={(e) => atualizarConfigNo("codigo", e.currentTarget.value)}
                                  class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 font-mono focus:border-orange-500 resize-y"
                                />
                              </div>
                            </div>
                          </Show>

                          {/* Teste Interativo e Preview de I/O */}
                          <div class="space-y-2 pt-2 border-t border-zinc-800/80">
                            <label class="text-[11px] font-medium text-zinc-300 block">
                              Testar I/O do Componente
                            </label>
                            <textarea
                              rows={2}
                              value={entradaTesteComp()}
                              onInput={(e) => setEntradaTesteComp(e.currentTarget.value)}
                              placeholder='{"parametro": "valor"}'
                              class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 font-mono focus:border-orange-500 resize-none"
                            />
                            <div class="flex items-center justify-between">
                              <button
                                type="button"
                                disabled={testandoComponente() || !noSelecionado()!.config?.componente_id}
                                onClick={testarComponenteAtual}
                                class="px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs font-medium flex items-center gap-1.5 transition-colors"
                              >
                                <span>{testandoComponente() ? "Executando teste..." : "Executar Teste"}</span>
                              </button>
                              <Show when={!noSelecionado()!.config?.componente_id}>
                                <span class="text-[10px] text-zinc-500">Selecione um componente para testar</span>
                              </Show>
                            </div>

                            {/* Resultado do Teste */}
                            <Show when={resultadoTesteComp()}>
                              <div
                                class={`p-2.5 rounded-lg border text-xs font-mono space-y-1 ${
                                  resultadoTesteComp().ok
                                    ? "bg-emerald-950/20 border-emerald-800/40 text-emerald-300"
                                    : "bg-red-950/20 border-red-800/40 text-red-300"
                                }`}
                              >
                                <div class="flex items-center justify-between text-[10px]">
                                  <span>{resultadoTesteComp().ok ? "✓ Sucesso" : "✕ Falhou"}</span>
                                  <Show when={resultadoTesteComp().duracao_ms !== undefined}>
                                    <span>{resultadoTesteComp().duracao_ms}ms</span>
                                  </Show>
                                </div>
                                <pre class="whitespace-pre-wrap text-[11px] max-h-32 overflow-y-auto">
                                  {resultadoTesteComp().ok
                                    ? (resultadoTesteComp().json
                                        ? JSON.stringify(resultadoTesteComp().json, null, 2)
                                        : resultadoTesteComp().saida)
                                    : resultadoTesteComp().erro}
                                </pre>
                              </div>
                            </Show>
                          </div>
                        </div>
                      </Show>

                      {/* Nó Tipo Script */}
                      <Show when={noSelecionado()!.tipo === "script"}>
                        <div class="space-y-1">
                          <label class="text-[11px] font-medium text-zinc-300 block">
                            Caminho do Script (.js, .py, .sh)
                          </label>
                          <input
                            type="text"
                            placeholder="ex: scripts/processar-dados.sh"
                            value={noSelecionado()!.config?.arquivo || ""}
                            onInput={(e) => atualizarConfigNo("arquivo", e.currentTarget.value)}
                            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 font-mono focus:border-orange-500"
                          />
                        </div>

                        <div class="space-y-1">
                          <label class="text-[11px] font-medium text-zinc-300 block">
                            Comando Bash Alternativo
                          </label>
                          <input
                            type="text"
                            placeholder="ex: python3 script.py {{entrada}}"
                            value={noSelecionado()!.config?.comando || ""}
                            onInput={(e) => atualizarConfigNo("comando", e.currentTarget.value)}
                            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 font-mono focus:border-orange-500"
                          />
                        </div>
                      </Show>

                      {/* Nó Tipo Reunião */}
                      <Show when={noSelecionado()!.tipo === "reuniao"}>
                        <div class="space-y-1">
                          <label class="text-[11px] font-medium text-zinc-300 block">
                            Pauta da Reunião *
                          </label>
                          <textarea
                            rows={3}
                            placeholder="Tema central para a deliberação dos agentes..."
                            value={noSelecionado()!.config?.pauta || ""}
                            onInput={(e) => atualizarConfigNo("pauta", e.currentTarget.value)}
                            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 focus:border-orange-500 resize-none"
                          />
                        </div>
                      </Show>

                      {/* Nó Tipo Decisão */}
                      <Show when={noSelecionado()!.tipo === "decisao"}>
                        <div class="space-y-1">
                          <label class="text-[11px] font-medium text-zinc-300 block">
                            Pergunta de Decisão *
                          </label>
                          <input
                            type="text"
                            placeholder="ex: Os critérios de qualidade foram atendidos?"
                            value={noSelecionado()!.config?.pergunta || ""}
                            onInput={(e) => atualizarConfigNo("pergunta", e.currentTarget.value)}
                            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 focus:border-orange-500"
                          />
                        </div>
                      </Show>

                      {/* Nó Tipo Task Create */}
                      <Show when={noSelecionado()!.tipo === "task_create"}>
                        <div class="space-y-1">
                          <label class="text-[11px] font-medium text-zinc-300 block">
                            Título da Tarefa no Kanban *
                          </label>
                          <input
                            type="text"
                            placeholder="ex: Publicar artigo aprovado na fila"
                            value={noSelecionado()!.config?.titulo || ""}
                            onInput={(e) => atualizarConfigNo("titulo", e.currentTarget.value)}
                            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 focus:border-orange-500"
                          />
                        </div>

                        <div class="grid grid-cols-2 gap-2">
                          <div>
                            <label class="text-[10px] text-zinc-400 block mb-1">Coluna</label>
                            <select
                              class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-1.5 text-xs text-zinc-200 focus:border-orange-500"
                              value={noSelecionado()!.config?.coluna || "backlog"}
                              onChange={(e) => atualizarConfigNo("coluna", e.currentTarget.value)}
                            >
                              <option value="backlog">Backlog</option>
                              <option value="fazer">A Fazer</option>
                              <option value="andamento">Em Andamento</option>
                              <option value="revisao">Revisão</option>
                            </select>
                          </div>
                          <div>
                            <label class="text-[10px] text-zinc-400 block mb-1">Prioridade</label>
                            <select
                              class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-1.5 text-xs text-zinc-200 focus:border-orange-500"
                              value={noSelecionado()!.config?.prioridade || "media"}
                              onChange={(e) => atualizarConfigNo("prioridade", e.currentTarget.value)}
                            >
                              <option value="baixa">Baixa</option>
                              <option value="media">Média</option>
                              <option value="alta">Alta</option>
                              <option value="urgente">Urgente</option>
                            </select>
                          </div>
                        </div>

                        {/* Selecionar Task Existente */}
                        <div class="space-y-1.5 pt-2 border-t border-zinc-800 mt-2">
                          <label class="text-[11px] font-medium text-zinc-300 block">
                            ou Executar Task Existente (pesquisar por nome)
                          </label>
                          <input
                            type="text"
                            placeholder="Pesquisar tarefa existente pelo título ou descrição..."
                            value={buscaTask()}
                            onInput={(e) => setBuscaTask(e.currentTarget.value)}
                            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 focus:border-orange-500 font-mono"
                          />
                          <Show when={buscaTask().trim().length >= 2}>
                            <div class="max-h-32 overflow-y-auto space-y-1 scrollbar-thin">
                              <For
                                each={tasksExistentes().filter((t) => {
                                  const q = buscaTask().toLowerCase();
                                  return (
                                    (t.titulo && t.titulo.toLowerCase().includes(q)) ||
                                    (t.descricao && t.descricao.toLowerCase().includes(q)) ||
                                    (t.id && t.id.toLowerCase().includes(q))
                                  );
                                }).slice(0, 8)}
                                fallback={
                                  <div class="text-[10px] text-zinc-500 py-2 text-center">Nenhuma task encontrada.</div>
                                }
                              >
                                {(t) => (
                                  <div
                                    onClick={() => {
                                      atualizarConfigNo("titulo", t.titulo || t.id);
                                      atualizarConfigNo("task_id", t.id);
                                      atualizarConfigNo("coluna", t.coluna || "backlog");
                                      atualizarConfigNo("prioridade", t.prioridade || "media");
                                      setBuscaTask("");
                                      showToast(`Task "${t.titulo || t.id}" selecionada!`, "sucesso");
                                    }}
                                    class="px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-orange-500/60 cursor-pointer text-xs flex items-center justify-between gap-2 transition-colors"
                                  >
                                    <div class="min-w-0">
                                      <span class="font-medium text-zinc-200 truncate block">{t.titulo || t.id}</span>
                                      <span class="text-[10px] text-zinc-500 truncate block">{t.descricao || `coluna: ${t.coluna}`}</span>
                                    </div>
                                    <span class={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                                      t.coluna === "feito" ? "bg-emerald-950/50 text-emerald-400" :
                                      t.coluna === "fazendo" ? "bg-blue-950/50 text-blue-400" :
                                      t.coluna === "bloqueado" ? "bg-amber-950/50 text-amber-400" :
                                      "bg-zinc-900 text-zinc-400"
                                    }`}>{t.coluna}</span>
                                  </div>
                                )}
                              </For>
                            </div>
                          </Show>
                        </div>
                      </Show>

                      {/* Nó Tipo Sub-Fluxo */}
                      <Show when={noSelecionado()!.tipo === "subflow"}>
                        <div class="space-y-1">
                          <label class="text-[11px] font-medium text-zinc-300 block">
                            Fluxo a Executar *
                          </label>
                          <select
                            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 focus:border-orange-500 font-mono"
                            value={noSelecionado()!.config?.flow_id || ""}
                            onChange={(e) => atualizarConfigNo("flow_id", e.currentTarget.value)}
                          >
                            <option value="">— Selecione um fluxo —</option>
                            <For each={fluxos().filter((x) => x.id !== fluxoAtivo()?.id)}>
                              {(f) => <option value={f.id}>{f.nome || f.id}</option>}
                            </For>
                          </select>
                          <p class="text-[10px] text-zinc-500">
                            O sub-fluxo será executado de ponta a ponta e seu resultado final será propagado como saída deste nó.
                          </p>
                        </div>
                        <div class="space-y-1">
                          <label class="text-[11px] font-medium text-zinc-300 block">
                            Entrada para o Sub-Fluxo
                          </label>
                          <input
                            type="text"
                            placeholder="ex: {{entrada}} ou texto fixo"
                            value={noSelecionado()!.config?.entrada || "{{entrada}}"}
                            onInput={(e) => atualizarConfigNo("entrada", e.currentTarget.value)}
                            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 font-mono focus:border-orange-500"
                          />
                        </div>
                      </Show>

                      {/* Nó Tipo HTTP Request */}
                      <Show when={noSelecionado()!.tipo === "http_request"}>
                        <div class="space-y-1">
                          <label class="text-[11px] font-medium text-zinc-300 block">
                            URL do Endpoint *
                          </label>
                          <input
                            type="text"
                            placeholder="https://api.exemplo.com/v1/recurso"
                            value={noSelecionado()!.config?.url || ""}
                            onInput={(e) => atualizarConfigNo("url", e.currentTarget.value)}
                            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 font-mono focus:border-orange-500"
                          />
                        </div>
                        <div class="grid grid-cols-2 gap-2">
                          <div class="space-y-1">
                            <label class="text-[10px] text-zinc-400 block">Método HTTP</label>
                            <select
                              class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-1.5 text-xs text-zinc-200 focus:border-orange-500 font-mono"
                              value={noSelecionado()!.config?.metodo || "GET"}
                              onChange={(e) => atualizarConfigNo("metodo", e.currentTarget.value)}
                            >
                              <option value="GET">GET</option>
                              <option value="POST">POST</option>
                              <option value="PUT">PUT</option>
                              <option value="PATCH">PATCH</option>
                              <option value="DELETE">DELETE</option>
                            </select>
                          </div>
                          <div class="space-y-1">
                            <label class="text-[10px] text-zinc-400 block">Timeout (ms)</label>
                            <input
                              type="number"
                              min={1000}
                              max={120000}
                              value={noSelecionado()!.config?.timeout_ms ?? 30000}
                              onInput={(e) => atualizarConfigNo("timeout_ms", parseInt(e.currentTarget.value, 10) || 30000)}
                              class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-1.5 text-xs text-zinc-200 font-mono focus:border-orange-500"
                            />
                          </div>
                        </div>
                        <div class="space-y-1">
                          <label class="text-[11px] font-medium text-zinc-300 block">
                            Headers (JSON, opcional)
                          </label>
                          <textarea
                            rows={2}
                            placeholder='{"Authorization": "Bearer {{token}}"}'
                            value={noSelecionado()!.config?.headers || ""}
                            onInput={(e) => atualizarConfigNo("headers", e.currentTarget.value)}
                            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 font-mono focus:border-orange-500 resize-none"
                          />
                        </div>
                        <div class="space-y-1">
                          <label class="text-[11px] font-medium text-zinc-300 block">
                            Body (JSON, para POST/PUT/PATCH)
                          </label>
                          <textarea
                            rows={3}
                            placeholder='{"dados": "{{entrada}}"}'
                            value={noSelecionado()!.config?.body || ""}
                            onInput={(e) => atualizarConfigNo("body", e.currentTarget.value)}
                            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 font-mono focus:border-orange-500 resize-none"
                          />
                        </div>
                        <p class="text-[10px] text-zinc-500">
                          A resposta JSON da API é propagada como saída do nó. Variáveis como <code>{`{{entrada}}`}</code> são interpoladas antes do envio.
                        </p>
                      </Show>

                      {/* Nó Tipo Delay / Aguardar */}
                      <Show when={noSelecionado()!.tipo === "delay"}>
                        <div class="space-y-1">
                          <label class="text-[11px] font-medium text-zinc-300 block">
                            Tempo de Espera (segundos) *
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={86400}
                            value={noSelecionado()!.config?.segundos ?? 30}
                            onInput={(e) => atualizarConfigNo("segundos", parseInt(e.currentTarget.value, 10) || 30)}
                            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 font-mono focus:border-orange-500"
                          />
                          <p class="text-[10px] text-zinc-500">
                            Pausa a execução do pipeline por este intervalo antes de seguir para o próximo nó. Máximo: 24h (86400s).
                          </p>
                        </div>
                      </Show>

                      {/* Nó Tipo Registro / Documento */}
                      <Show when={noSelecionado()!.tipo === "registro" || noSelecionado()!.tipo === "saida"}>
                        <div class="space-y-1">
                          <label class="text-[11px] font-medium text-zinc-300 block">
                            Categoria do Registro
                          </label>
                          <input
                            type="text"
                            placeholder="ex: documentos, atas, relatorios"
                            value={noSelecionado()!.config?.categoria || "documentos"}
                            onInput={(e) => atualizarConfigNo("categoria", e.currentTarget.value)}
                            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 focus:border-orange-500 font-mono"
                          />
                        </div>
                      </Show>
                    </div>

                    {/* ─────────────────────────────────────────────────────────
                        SEÇÃO N8N: CONEXÕES DO NÓ (LIGAÇÕES DE ENTRADA & SAÍDA)
                       ───────────────────────────────────────────────────────── */}
                    <div class="pt-3 border-t border-zinc-800 space-y-2.5">
                      <div class="flex items-center justify-between">
                        <span class="text-[11px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                          <GitBranch size={13} class="text-orange-400" /> Conexões & Ligações
                        </span>
                        <button
                          type="button"
                          onClick={() => iniciarConexao(noSelecionado()!.id)}
                          class="px-2 py-0.5 rounded bg-zinc-800 hover:bg-orange-600 hover:text-white text-zinc-300 text-[10px] font-medium transition-colors cursor-pointer"
                        >
                          + Ligar no Canvas
                        </button>
                      </div>

                      {/* Ligações de Entrada */}
                      <div class="space-y-1">
                        <span class="text-[10px] text-zinc-500 font-medium block">Entradas (ativado após):</span>
                        <div class="flex flex-wrap gap-1">
                          <For
                            each={(fluxoAtivo()?.arestas || []).filter((a) => a.para === noSelecionado()!.id)}
                            fallback={<span class="text-[10px] text-zinc-600 italic">Nenhum nó anterior (gatilho inicial)</span>}
                          >
                            {(aresta) => (
                              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-[10px] font-mono text-zinc-300">
                                ← {aresta.de}
                                <button
                                  type="button"
                                  onClick={() => removerAresta(aresta.de, aresta.para)}
                                  class="text-zinc-500 hover:text-rose-400 ml-0.5 cursor-pointer font-bold"
                                  title="Remover conexão"
                                >
                                  ✕
                                </button>
                              </span>
                            )}
                          </For>
                        </div>
                      </div>

                      {/* Ligações de Saída */}
                      <div class="space-y-1">
                        <span class="text-[10px] text-zinc-500 font-medium block">Saídas (dispara em seguida):</span>
                        <div class="flex flex-wrap gap-1">
                          <For
                            each={(fluxoAtivo()?.arestas || []).filter((a) => a.de === noSelecionado()!.id)}
                            fallback={<span class="text-[10px] text-zinc-600 italic">Fim da esteira (nenhum nó seguinte)</span>}
                          >
                            {(aresta) => (
                              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-[10px] font-mono text-zinc-300">
                                → {aresta.para}
                                <button
                                  type="button"
                                  onClick={() => removerAresta(aresta.de, aresta.para)}
                                  class="text-zinc-500 hover:text-rose-400 ml-0.5 cursor-pointer font-bold"
                                  title="Remover conexão"
                                >
                                  ✕
                                </button>
                              </span>
                            )}
                          </For>
                        </div>
                      </div>

                      {/* Adicionar Ligação por Dropdown */}
                      <div class="flex items-center gap-1.5 pt-1">
                        <select
                          value={novoDestinoLigacao()}
                          onChange={(e) => setNovoDestinoLigacao(e.currentTarget.value)}
                          class="flex-1 bg-zinc-950 border border-zinc-800 rounded p-1.5 text-[11px] text-zinc-200 focus:border-orange-500"
                        >
                          <option value="">Ligar este nó para...</option>
                          <For each={(fluxoAtivo()?.nos || []).filter((n) => n.id !== noSelecionado()?.id)}>
                            {(outro) => <option value={outro.id}>→ {outro.id} ({outro.tipo})</option>}
                          </For>
                        </select>
                        <Button
                          size="xs"
                          variant="secondary"
                          onClick={() => {
                            const dest = novoDestinoLigacao();
                            if (!dest) {
                              showToast("Selecione um nó de destino", "aviso");
                              return;
                            }
                            criarConexao(noSelecionado()!.id, dest);
                            setNovoDestinoLigacao("");
                          }}
                        >
                          Ligar
                        </Button>
                      </div>
                    </div>

                    {/* ─────────────────────────────────────────────────────────
                        SEÇÃO N8N: CONTEXTO DO NÓ ANTERIOR & VARIÁVEIS DE ENTRADA
                       ───────────────────────────────────────────────────────── */}
                    <div class="pt-3 border-t border-zinc-800 space-y-2">
                      <span class="text-[11px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                        <Terminal size={13} class="text-cyan-400" /> Dados Anteriores & Variáveis (n8n)
                      </span>
                      <p class="text-[10px] text-zinc-400 leading-relaxed">
                        O agente deste nó recebe automaticamente toda a resposta e saída do nó anterior no contexto de execução.
                      </p>

                      <div class="space-y-1">
                        <span class="text-[10px] text-zinc-500 font-medium block">Variáveis disponíveis para interpolar na ordem:</span>
                        <div class="flex flex-wrap gap-1 text-[10px] font-mono">
                          <button
                            type="button"
                            onClick={() => {
                              const ord = noSelecionado()?.config?.ordem || "";
                              atualizarConfigNo("ordem", `${ord} {{entrada}}`.trim());
                              showToast("{{entrada}} adicionado à ordem", "info");
                            }}
                            class="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 hover:border-cyan-500 text-cyan-400 cursor-pointer"
                            title="Clique para adicionar à instrução"
                          >
                            {`{{entrada}}`}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const ord = noSelecionado()?.config?.ordem || "";
                              atualizarConfigNo("ordem", `${ord} {{$input}}`.trim());
                              showToast("{{$input}} adicionado à ordem", "info");
                            }}
                            class="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 hover:border-cyan-500 text-cyan-400 cursor-pointer"
                            title="Clique para adicionar à instrução"
                          >
                            {`{{$input}}`}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const ord = noSelecionado()?.config?.ordem || "";
                              atualizarConfigNo("ordem", `${ord} {{json}}`.trim());
                              showToast("{{json}} adicionado à ordem", "info");
                            }}
                            class="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 hover:border-cyan-500 text-cyan-400 cursor-pointer"
                            title="Clique para adicionar à instrução"
                          >
                            {`{{json}}`}
                          </button>
                        </div>
                      </div>
                    </div>
                  </Show>
                </div>

                {/* Rodapé do NDV com Ações de Salvar e Excluir Node */}
                <div class="p-3 border-t border-zinc-800 flex items-center justify-between">
                  <Button
                    size="xs"
                    variant="ghost"
                    class="text-rose-400 hover:text-rose-300"
                    onClick={() => excluirNode(noSelecionado()!.id)}
                  >
                    <Trash2 size={13} class="mr-1" /> Excluir Node
                  </Button>

                  <Button
                    size="xs"
                    variant="primary"
                    class="bg-orange-600 hover:bg-orange-500 text-white font-bold"
                    onClick={() => setNoSelecionado(null)}
                  >
                    Concluir Edição
                  </Button>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      {/* ─────────────────────────────────────────────────────────────
          MENU DE CONTEXTO ESTILO N8N (Ao clicar com botão direito)
         ───────────────────────────────────────────────────────────── */}
      <Show when={menuContexto().aberto}>
        <div
          class="fixed z-50 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl py-1.5 w-56 text-xs text-zinc-200 select-none animate-in fade-in zoom-in-95 duration-100"
          style={{
            left: `${Math.min(menuContexto().x, window.innerWidth - 230)}px`,
            top: `${Math.min(menuContexto().y, window.innerHeight - 250)}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Show
            when={menuContexto().noId}
            fallback={
              /* Menu do Canvas Vazio */
              <>
                <button
                  onClick={() => {
                    setMenuContexto((p) => ({ ...p, aberto: false }));
                    setModalAdicionarNode(true);
                  }}
                  class="w-full px-3 py-1.5 flex items-center justify-between hover:bg-orange-600 hover:text-white transition-colors text-left"
                >
                  <span class="flex items-center gap-2">
                    <Plus size={14} /> Adicionar Node
                  </span>
                  <span class="text-[10px] opacity-60 font-mono">N</span>
                </button>
                <div class="my-1 border-t border-zinc-800" />
                <button
                  onClick={() => {
                    setMenuContexto((p) => ({ ...p, aberto: false }));
                    resetView();
                  }}
                  class="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-800 text-left"
                >
                  <Maximize2 size={13} /> Resetar Visualização
                </button>
                <button
                  onClick={() => {
                    setMenuContexto((p) => ({ ...p, aberto: false }));
                    void copiarWorkflowJson(fluxoAtivo()!);
                  }}
                  class="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-800 text-left"
                >
                  <Copy size={13} /> Copiar Workflow JSON
                </button>
              </>
            }
          >
            {/* Menu ao Clicar em um Node */}
            <div class="px-3 py-1 text-[10px] font-mono text-zinc-500 uppercase border-b border-zinc-800 mb-1">
              Node: {menuContexto().noId}
            </div>
            <button
              onClick={() => {
                const n = fluxoAtivo()?.nos.find((item) => item.id === menuContexto().noId);
                if (n) setNoSelecionado(n);
                setMenuContexto((p) => ({ ...p, aberto: false }));
              }}
              class="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-800 text-left"
            >
              <Sliders size={13} class="text-orange-400" /> Abrir Parâmetros (NDV)
            </button>
            <button
              onClick={() => {
                void duplicarNodeSelecionado(menuContexto().noId!);
                setMenuContexto((p) => ({ ...p, aberto: false }));
              }}
              class="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-800 text-left"
            >
              <Copy size={13} /> Duplicar Node
            </button>
            <button
              onClick={() => {
                setMenuContexto((p) => ({ ...p, aberto: false }));
                setModalAdicionarNode(true);
              }}
              class="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-800 text-left"
            >
              <Plus size={13} /> Conectar Novo Node
            </button>
            <div class="my-1 border-t border-zinc-800" />
            <button
              onClick={() => {
                void excluirNode(menuContexto().noId!);
                setMenuContexto((p) => ({ ...p, aberto: false }));
              }}
              class="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-rose-950/80 text-rose-400 text-left"
            >
              <Trash2 size={13} /> Excluir Node
            </button>
          </Show>
        </div>
      </Show>

      {/* ─────────────────────────────────────────────────────────────
          DRAWER LATERAL: CATÁLOGO DE NÓS COM DRAG & DROP (estilo n8n)
         ───────────────────────────────────────────────────────────── */}
      <Show when={modalAdicionarNode()}>
        {/* Overlay escuro */}
        <div class="fixed inset-0 bg-black/50 z-40" onClick={() => setModalAdicionarNode(false)} />

        {/* Drawer lateral direito */}
        <div class="fixed top-0 right-0 bottom-0 w-[340px] max-w-[85vw] z-50 bg-zinc-900 border-l border-zinc-700 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
          {/* Cabeçalho */}
          <div class="p-3 border-b border-zinc-800 flex items-center justify-between shrink-0">
            <div class="flex items-center gap-2">
              <div class="p-1.5 rounded-lg bg-orange-600/20 border border-orange-500/40">
                <Plus size={15} class="text-orange-400" />
              </div>
              <div>
                <h3 class="text-xs font-bold text-zinc-100">Adicionar Node</h3>
                <p class="text-[10px] text-zinc-500">Arraste para o canvas ou clique</p>
              </div>
            </div>
            <IconButton size="xs" variant="ghost" onClick={() => setModalAdicionarNode(false)}>
              <X size={15} />
            </IconButton>
          </div>

          {/* Barra de busca */}
          <div class="px-3 py-2 border-b border-zinc-800 shrink-0">
            <div class="relative">
              <Search size={13} class="absolute left-2.5 top-2 text-zinc-500" />
              <input
                type="text"
                placeholder="Buscar nós..."
                value={buscaTipoNode()}
                onInput={(e) => setBuscaTipoNode(e.currentTarget.value)}
                class="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-[11px] text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>

          {/* Filtro de categorias */}
          <div class="px-3 py-2 flex flex-wrap gap-1 border-b border-zinc-800 shrink-0">
            <For each={["todos", "gatilhos", "agentes", "logica", "integracoes", "governanca"]}>
              {(cat) => (
                <button
                  type="button"
                  onClick={() => setCategoriaNodeFiltro(cat)}
                  class={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors cursor-pointer ${
                    categoriaNodeFiltro() === cat
                      ? "bg-orange-600/30 text-orange-300 border border-orange-500/40"
                      : "bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-transparent"
                  }`}
                >
                  {cat === "todos" ? "Todos" : cat === "gatilhos" ? "Gatilhos" : cat === "agentes" ? "Agentes & IA" : cat === "logica" ? "Lógica" : cat === "integracoes" ? "Integrações" : "Governança"}
                </button>
              )}
            </For>
          </div>

          {/* Lista de nós arrastáveis */}
          <div class="flex-1 overflow-y-auto p-2 space-y-1.5 scrollbar-thin">
            <For
              each={TIPOS_NODE_CATALOGO.filter((item) => {
                const catOk = categoriaNodeFiltro() === "todos" || item.categoria === categoriaNodeFiltro();
                const q = buscaTipoNode().toLowerCase().trim();
                const buscaOk = !q || item.rotulo.toLowerCase().includes(q) || item.tipo.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q);
                return catOk && buscaOk;
              })}
              fallback={<div class="text-center text-zinc-500 text-[10px] py-8">Nenhum nó encontrado</div>}
            >
              {(item) => (
                <div
                  draggable={true}
                  onDragStart={(e) => {
                    e.dataTransfer!.setData("application/opencorp-node-tipo", item.tipo);
                    e.dataTransfer!.effectAllowed = "copy";
                  }}
                  onClick={() => void adicionarNodeAoWorkflow(item.tipo)}
                  class="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 hover:border-orange-500/60 hover:bg-zinc-900 cursor-grab active:cursor-grabbing transition-all flex items-start gap-2.5 group"
                >
                  <div class={`p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 ${item.cor} group-hover:scale-110 transition-transform shrink-0`}>
                    <item.icone size={16} />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="font-bold text-[11px] text-zinc-200 group-hover:text-orange-400 transition-colors flex items-center gap-1.5">
                      {item.rotulo}
                      <GripVertical size={11} class="text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <p class="text-[10px] text-zinc-500 mt-0.5 leading-relaxed line-clamp-2">
                      {item.desc}
                    </p>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Modal Novo Workflow */}
      <Show when={modalNovoFluxo()}>
        <div class="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 z-50" onClick={() => setModalNovoFluxo(false)}>
          <div class="bg-zinc-900 border border-zinc-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div class="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div class="flex items-center gap-2">
                <Plus size={16} class="text-orange-400" />
                <h3 class="text-sm font-bold text-zinc-100">Criar Novo Fluxo</h3>
              </div>
              <IconButton size="xs" variant="ghost" onClick={() => setModalNovoFluxo(false)}>
                <X size={16} />
              </IconButton>
            </div>

            <div class="space-y-3 text-xs">
              <div>
                <label class="block text-zinc-300 font-medium mb-1">Nome do Fluxo *</label>
                <input
                  type="text"
                  placeholder="ex: Publicação Editorial de Conteúdo"
                  value={novoFluxoNome()}
                  onInput={(e) => {
                    setNovoFluxoNome(e.currentTarget.value);
                    if (!novoFluxoId()) {
                      setNovoFluxoId(
                        e.currentTarget.value
                          .toLowerCase()
                          .normalize("NFD")
                          .replace(/[\u0300-\u036f]/g, "")
                          .replace(/[^a-z0-9]+/g, "-")
                          .replace(/^-+|-+$/g, "")
                      );
                    }
                  }}
                  class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-zinc-200 focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label class="block text-zinc-300 font-medium mb-1">ID (kebab-case) *</label>
                <input
                  type="text"
                  placeholder="ex: publicacao-editorial"
                  value={novoFluxoId()}
                  onInput={(e) => setNovoFluxoId(e.currentTarget.value)}
                  class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-zinc-200 font-mono focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label class="block text-zinc-300 font-medium mb-1">Template Inicial</label>
                <select
                  value={novoFluxoTemplate()}
                  onChange={(e) => setNovoFluxoTemplate(e.currentTarget.value as any)}
                  class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-zinc-200 focus:outline-none focus:border-orange-500"
                >
                  <option value="pipeline">Pipeline Sequencial (Gatilho → Agente → Registro)</option>
                  <option value="fanout">Fanout Paralelo (Múltiplos agentes → Síntese)</option>
                  <option value="review">Review de Qualidade (Executor → Revisor)</option>
                  <option value="debate">Debate de Diretoria (Proponentes → Moderador)</option>
                </select>
              </div>

              <div>
                <label class="block text-zinc-300 font-medium mb-1">Descrição (Opcional)</label>
                <textarea
                  rows={2}
                  placeholder="Objetivo deste fluxo..."
                  value={novoFluxoDesc()}
                  onInput={(e) => setNovoFluxoDesc(e.currentTarget.value)}
                  class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-zinc-200 focus:outline-none focus:border-orange-500 resize-none"
                />
              </div>
            </div>

            <div class="pt-3 border-t border-zinc-800 flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setModalNovoFluxo(false)}>
                Cancelar
              </Button>
              <Button
                size="sm"
                variant="primary"
                class="bg-orange-600 hover:bg-orange-500 text-white font-bold"
                onClick={async () => {
                  const id = novoFluxoId().trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
                  const nome = novoFluxoNome().trim();
                  if (!id || !nome) return;
                  try {
                    await fetchApi("/flows", {
                      method: "POST",
                      body: JSON.stringify({
                        id,
                        nome,
                        descricao: novoFluxoDesc(),
                        nos: [{ id: "gatilho", tipo: "manual", config: {} }],
                        arestas: [],
                      }),
                    });
                    setModalNovoFluxo(false);
                    await carregarFluxos();
                    void abrirEditorCanvas(id);
                  } catch {}
                }}
              >
                Criar Fluxo
              </Button>
            </div>
          </div>
        </div>
      </Show>

      {/* Modal Executar Workflow */}
      <Show when={modalExecutar()}>
        <div class="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 z-50" onClick={() => setModalExecutar(false)}>
          <div class="bg-zinc-900 border border-zinc-800 rounded-xl max-w-lg w-full p-5 space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div class="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div class="flex items-center gap-2">
                <Play size={16} class="text-orange-400 fill-current" />
                <h3 class="text-sm font-bold text-zinc-100">
                  Executar Fluxo: {fluxoAtivo()?.nome}
                </h3>
              </div>
              <IconButton size="xs" variant="ghost" onClick={() => setModalExecutar(false)}>
                <X size={16} />
              </IconButton>
            </div>

            <div class="space-y-3 text-xs">
              <label class="block text-zinc-300 font-medium">
                Entrada Inicial / Payload para o primeiro Node
              </label>
              <textarea
                rows={4}
                placeholder="Insira parâmetros ou dados para alimentar o pipeline..."
                value={entradaTexto()}
                onInput={(e) => setEntradaTexto(e.currentTarget.value)}
                class="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-zinc-200 focus:outline-none focus:border-orange-500 font-mono resize-none"
              />
            </div>

            <div class="pt-3 border-t border-zinc-800 flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setModalExecutar(false)}>
                Cancelar
              </Button>
              <Button
                size="sm"
                variant="primary"
                class="bg-orange-600 hover:bg-orange-500 text-white font-bold"
                loading={executando()}
                onClick={dispararExecucao}
              >
                <Send size={12} class="mr-1.5" /> Iniciar Execução
              </Button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};
