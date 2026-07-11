/**
 * Copy / help estático da UI Funil Pedido → Caixa.
 * Não calcula estágios — só textos e mapeamento visual.
 */

export type OrderToCashFunnelExplanation = {
  whatItMeans: string;
  howWeCalculate: string;
  whatIsIncluded: string;
  whatIsExcluded: string;
  howToInterpret: string;
};

export const ORDER_TO_CASH_FUNNEL_TITLE = "Funil Pedido → Caixa";

export const ORDER_TO_CASH_FUNNEL_SUBTITLE =
  "Acompanhe onde cada venda está parada: pedido, entrega, NF, Contas a Receber ou caixa.";

export const ORDER_TO_CASH_FUNNEL_PROPOSAL_NOTICE =
  "Neste funil, Pedido de Venda é a origem oficial. Propostas aparecem apenas como histórico/cotação quando disponíveis e não são fonte financeira.";

export const ORDER_TO_CASH_FUNNEL_EMPTY =
  "Nenhum pedido encontrado para os filtros selecionados.";

export const ORDER_TO_CASH_FUNNEL_LOADING =
  "Carregando Funil Pedido → Caixa…";

export const ORDER_TO_CASH_FUNNEL_ERROR_FALLBACK =
  "Não foi possível carregar o Funil Pedido → Caixa. Tente novamente. Se o problema persistir, acione o suporte técnico.";

export const ORDER_TO_CASH_DATE_AXIS_OPTIONS = [
  { value: "ORDER_ISSUE_DATE", label: "Emissão do pedido" },
  { value: "EXPECTED_DELIVERY_DATE", label: "Previsão de entrega" },
  { value: "STOCK_DOCUMENT_DATE", label: "Documento de saída" },
  { value: "NFE_DATE", label: "Data da NF" },
  { value: "RECEIVABLE_DUE_DATE", label: "Vencimento do CR" },
  { value: "RECEIVABLE_SETTLEMENT_DATE", label: "Baixa do CR" },
  { value: "FORECAST_DATE", label: "Data de forecast" },
  { value: "UPDATED_AT", label: "Atualização do pedido" },
] as const;

export const ORDER_TO_CASH_STAGE_FILTER_OPTIONS = [
  { value: "", label: "Todos os estágios" },
  { value: "PEDIDO_EMITIDO", label: "Pedido emitido" },
  { value: "PEDIDO_FUTURO_SAUDAVEL", label: "Futuro saudável" },
  { value: "PEDIDO_PROXIMO_ATENCAO", label: "Próximo / atenção" },
  { value: "PEDIDO_ATRASADO_SEM_DOCUMENTO", label: "Atrasado sem documento" },
  { value: "PEDIDO_PARCIALMENTE_ATENDIDO", label: "Parcialmente atendido" },
  { value: "PEDIDO_TOTALMENTE_ATENDIDO", label: "Totalmente atendido" },
  { value: "PEDIDO_ATENDIDO_COM_EXCEDENTE", label: "Atendido com excedente" },
  { value: "DOCUMENTO_SEM_NF", label: "Documento sem NF" },
  { value: "NF_SEM_CR", label: "NF sem CR" },
  { value: "CR_ABERTO", label: "CR aberto" },
  { value: "RECEBIDO", label: "Recebido" },
  { value: "BLOQUEADO_REVISAO", label: "Bloqueado / revisão" },
  { value: "SEM_EVIDENCIA", label: "Sem evidência" },
  { value: "CANCELADO", label: "Cancelado" },
] as const;

export const ORDER_TO_CASH_TEMPERATURE_OPTIONS = [
  { value: "", label: "Todas" },
  { value: "QUENTE", label: "Quente" },
  { value: "MORNO", label: "Morno" },
  { value: "FRIO", label: "Frio" },
  { value: "CONGELADO", label: "Congelado" },
] as const;

export const ORDER_TO_CASH_ALERT_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "ENTREGA_VENCIDA_SEM_DOCUMENTO", label: "Entrega vencida sem documento" },
  { value: "RECEBIMENTO_PREVISTO_SEM_CR", label: "Recebimento previsto sem CR" },
  { value: "DOCUMENTO_PARCIAL", label: "Documento parcial" },
  { value: "DOCUMENTO_COM_EXCEDENTE", label: "Documento com excedente" },
  { value: "PRODUTO_FORA_DO_PEDIDO", label: "Produto fora do pedido" },
  { value: "NF_SEM_CR", label: "NF sem CR" },
  { value: "CR_VENCIDO", label: "CR vencido" },
  { value: "BAIXA_NAO_ENCONTRADA", label: "Baixa não encontrada" },
  { value: "FORECAST_EM_RISCO", label: "Forecast em risco" },
  { value: "PEDIDO_ANTIGO_SEM_EVOLUCAO", label: "Pedido antigo sem evolução" },
] as const;

export const ORDER_TO_CASH_STAGE_GROUP_OPTIONS = [
  { value: "", label: "Todos os grupos" },
  { value: "COMERCIAL", label: "Comercial" },
  { value: "OPERACIONAL", label: "Operacional" },
  { value: "FISCAL", label: "Fiscal" },
  { value: "FINANCEIRO", label: "Financeiro" },
  { value: "CAIXA", label: "Caixa" },
  { value: "RISCO", label: "Risco" },
] as const;

export const ORDER_TO_CASH_CONFIDENCE_OPTIONS = [
  { value: "", label: "Todas" },
  { value: "ALTA", label: "Alta" },
  { value: "MEDIA", label: "Média" },
  { value: "BAIXA", label: "Baixa" },
  { value: "MUITO_BAIXA", label: "Muito baixa" },
] as const;

export const ORDER_TO_CASH_RESPONSIBLE_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "COMERCIAL", label: "Comercial" },
  { value: "PCP_PRODUCAO", label: "PCP / Produção" },
  { value: "FATURAMENTO", label: "Faturamento" },
  { value: "FINANCEIRO", label: "Financeiro" },
  { value: "DIRETORIA", label: "Diretoria" },
  { value: "TI", label: "TI" },
] as const;

export const ORDER_TO_CASH_PERIOD_PRESETS = [
  { value: "this_month", label: "Este mês" },
  { value: "last_month", label: "Mês anterior" },
  { value: "next_30", label: "Próximos 30 dias" },
  { value: "next_60", label: "Próximos 60 dias" },
  { value: "next_90", label: "Próximos 90 dias" },
  { value: "overdue", label: "Vencidos" },
  { value: "current_year", label: "Ano atual" },
  { value: "last_12_months", label: "Últimos 12 meses" },
  { value: "custom", label: "Personalizado" },
] as const;

/** Sequência visual do funil (raia principal). Códigos de estágio da API. */
export const ORDER_TO_CASH_VISUAL_FUNNEL: Array<{
  id: string;
  label: string;
  stages: string[];
  tone: "blue" | "amber" | "green" | "orange" | "gray" | "red";
}> = [
  { id: "emitido", label: "Pedido emitido", stages: ["PEDIDO_EMITIDO"], tone: "gray" },
  {
    id: "futuro",
    label: "Futuro saudável",
    stages: ["PEDIDO_FUTURO_SAUDAVEL"],
    tone: "blue",
  },
  {
    id: "atencao",
    label: "Atenção / atrasado",
    stages: ["PEDIDO_PROXIMO_ATENCAO", "PEDIDO_ATRASADO_SEM_DOCUMENTO"],
    tone: "amber",
  },
  {
    id: "parcial",
    label: "Parcialmente atendido",
    stages: ["PEDIDO_PARCIALMENTE_ATENDIDO"],
    tone: "amber",
  },
  {
    id: "total",
    label: "Totalmente atendido",
    stages: ["PEDIDO_TOTALMENTE_ATENDIDO", "PEDIDO_ATENDIDO_COM_EXCEDENTE"],
    tone: "blue",
  },
  {
    id: "doc_nf",
    label: "NF/documento sem CR",
    stages: ["DOCUMENTO_SEM_NF", "NF_SEM_CR"],
    tone: "orange",
  },
  { id: "cr", label: "CR aberto", stages: ["CR_ABERTO"], tone: "blue" },
  { id: "recebido", label: "Recebido", stages: ["RECEBIDO"], tone: "green" },
];

export const ORDER_TO_CASH_RISK_LANE = {
  id: "bloqueado",
  label: "Bloqueado / revisão",
  stages: ["BLOQUEADO_REVISAO", "SEM_EVIDENCIA"],
  tone: "red" as const,
};

export const CARD_BLOCK_A_KEYS = [
  "valor_pedidos_ativos",
  "pedido_futuro_saudavel",
  "pedido_em_atencao",
  "pedido_bloqueado_revisao",
] as const;

export const CARD_BLOCK_B_KEYS = [
  "pedido_parcialmente_atendido",
  "pedido_totalmente_atendido",
  "documento_nf_sem_cr",
  "excesso_produto_fora",
] as const;

export const CARD_BLOCK_C_KEYS = [
  "cr_aberto",
  "recebido",
  "forecast_em_risco",
] as const;

const baseHelp = (
  what: string,
  how: string,
  incl: string,
  excl: string,
  interpret: string
): OrderToCashFunnelExplanation => ({
  whatItMeans: what,
  howWeCalculate: how,
  whatIsIncluded: incl,
  whatIsExcluded: excl,
  howToInterpret: interpret,
});

export const ORDER_TO_CASH_CARD_HELP: Record<string, OrderToCashFunnelExplanation> = {
  valor_pedidos_ativos: baseHelp(
    "Soma do valor dos pedidos ainda ativos no funil (não cancelados e não totalmente recebidos).",
    "Agrega o valueForStage de cada pedido classificado no servidor, um estágio principal por pedido.",
    "Pedidos abertos no paradigma Pedido → Caixa.",
    "Cancelados, recebidos e alertas técnicos (não somam carteira).",
    "Use como visão de carteira comercial ativa — não é caixa."
  ),
  pedido_futuro_saudavel: baseHelp(
    "Pedidos com previsão à frente, sem bloqueio e sem evidência fiscal/financeira ainda.",
    "Classificação servidor: PEDIDO_FUTURO_SAUDAVEL.",
    "Pedidos futuros saudáveis.",
    "Atrasados, bloqueados, com NF/CR/baixa.",
    "Prioridade saudável de receita planejada (temperatura quente)."
  ),
  pedido_em_atencao: baseHelp(
    "Pedidos na janela próxima da entrega ou recém vencidos, ainda sem documento/NF/CR.",
    "Classificação servidor: PEDIDO_PROXIMO_ATENCAO.",
    "Pedidos em atenção operacional.",
    "Já faturados/com CR/recebidos.",
    "Precisam empurrão de PCP/faturamento."
  ),
  pedido_bloqueado_revisao: baseHelp(
    "Pedidos antigos/vencidos sem evolução (sem documento, NF ou CR).",
    "Classificação servidor: BLOQUEADO_REVISAO.",
    "Pedidos congelados / risco de carteira.",
    "Pedidos futuros saudáveis ou com evidência fiscal/financeira.",
    "Não trate como lead quente — revise ou cancele."
  ),
  pedido_parcialmente_atendido: baseHelp(
    "Cobertura parcial no mapa de atendimento.",
    "Classificação servidor: PEDIDO_PARCIALMENTE_ATENDIDO.",
    "Pedidos com remessa incompleta.",
    "Alertas de excedente (não duplicam este valor).",
    "Completar remessa / documento."
  ),
  pedido_totalmente_atendido: baseHelp(
    "Itens do pedido cobertos no mapa (com ou sem excedente no estágio operacional).",
    "Estágios PEDIDO_TOTALMENTE_ATENDIDO e PEDIDO_ATENDIDO_COM_EXCEDENTE.",
    "Atendimento total no fulfillment map.",
    "Valor de cabeçalho de NF como carteira.",
    "Formalizar NF/CR se ainda faltarem."
  ),
  documento_nf_sem_cr: baseHelp(
    "Há documento de saída e/ou NF, ainda sem Contas a Receber.",
    "Estágios DOCUMENTO_SEM_NF e NF_SEM_CR.",
    "Evidência fiscal/operacional sem título.",
    "CR aberto e baixas.",
    "Gerar/vincular CR."
  ),
  excesso_produto_fora: baseHelp(
    "Referência de pedidos com alerta de excedente ou produto fora do pedido.",
    "Vem de riskSummary (alertas). Não recalcula no frontend.",
    "Pedidos com DOCUMENTO_COM_EXCEDENTE ou PRODUTO_FORA_DO_PEDIDO.",
    "Não soma carteira ativa além do estágio principal.",
    "Revisar vínculo/quantidade — é alerta técnico."
  ),
  cr_aberto: baseHelp(
    "Direito financeiro formalizado, sem baixa total.",
    "Classificação servidor: CR_ABERTO.",
    "Títulos abertos vinculados ao pedido.",
    "Valor do pedido comercial duplicado e comissões.",
    "Cobrar / acompanhar vencimento."
  ),
  recebido: baseHelp(
    "Baixa materializada — caixa confirmado.",
    "Classificação servidor: RECEBIDO.",
    "Pedidos com recebimento total.",
    "CR ainda aberto e forecast.",
    "Não entra em pedidos ativos."
  ),
  forecast_em_risco: baseHelp(
    "Referência de risco (bloqueado + atrasado sem documento + sem evidência).",
    "Card de referência da API; não soma carteira além dos estágios principais.",
    "Estágios de risco já classificados.",
    "Não inventa valor de alerta.",
    "Priorize revisão comercial/diretoria."
  ),
};

/** Help “?” dos KPIs por vendedor/cliente (sem comissão). */
export const ORDER_TO_CASH_ENTITY_KPI_HELP: Record<string, OrderToCashFunnelExplanation> = {
  sellerName: baseHelp(
    "Vendedor comercial do pedido de venda.",
    "Agrupamos pelo vendedor do SalesOrder (importação Nomus). Sem nome/ID → “Sem vendedor informado”.",
    "Nome ou ID do vendedor do pedido.",
    "Comissão, vendedor comissionável e responsável do CRM.",
    "Use para qualidade da carteira sob o vendedor do pedido."
  ),
  customerName: baseHelp(
    "Cliente do pedido de venda.",
    "Agrupamos pelo cliente do SalesOrder. Sem nome → “Cliente sem nome”.",
    "Nome ou ID do cliente do pedido.",
    "Contatos CRM sem pedido.",
    "Use para priorizar contas com risco ou conversão baixa."
  ),
  valorTotal: baseHelp(
    "Valor total dos pedidos no recorte (um estágio principal por pedido).",
    "Soma do valueForStage dos pedidos não cancelados do grupo.",
    "Pedidos classificados no funil.",
    "Cabeçalho de NF, excedente e produto fora (não duplicam).",
    "Tamanho da carteira — não é caixa confirmado."
  ),
  orderCount: baseHelp(
    "Quantidade de pedidos do grupo.",
    "Contagem distinta de pedidos (cancelados fora).",
    "Pedidos do vendedor/cliente no filtro.",
    "Itens avulsos sem pedido.",
    "Volume operacional além do valor."
  ),
  valorFuturoSaudavel: baseHelp(
    "Valor em pedido futuro saudável.",
    "Soma dos pedidos no estágio PEDIDO_FUTURO_SAUDAVEL.",
    "Pedidos com previsão à frente, sem bloqueio.",
    "Atrasados, bloqueados e com NF/CR.",
    "Carteira saudável de horizonte futuro."
  ),
  valorEmAtencao: baseHelp(
    "Valor em pedido em atenção.",
    "Soma dos pedidos em PEDIDO_PROXIMO_ATENCAO.",
    "Janela próxima da entrega.",
    "Já faturados/com CR.",
    "Prioridade de curto prazo."
  ),
  valorBloqueado: baseHelp(
    "Valor bloqueado para revisão.",
    "Soma dos pedidos em BLOQUEADO_REVISAO.",
    "Pedidos antigos/vencidos sem evolução.",
    "Futuro saudável e recebido.",
    "Não trate como lead quente."
  ),
  valorParcialmenteAtendido: baseHelp(
    "Valor parcialmente atendido.",
    "Soma em PEDIDO_PARCIALMENTE_ATENDIDO.",
    "Cobertura parcial no mapa.",
    "Alertas de excedente (não duplicam).",
    "Completar remessa/documento."
  ),
  valorCrAberto: baseHelp(
    "Valor com Contas a Receber aberto.",
    "Soma em CR_ABERTO.",
    "Pedidos com título aberto.",
    "Já recebidos.",
    "Direito financeiro ainda a receber."
  ),
  valorRecebido: baseHelp(
    "Valor já recebido/baixado.",
    "Soma em RECEBIDO.",
    "Baixas materializadas.",
    "Previsão sem baixa.",
    "Caixa confirmado ligado aos pedidos."
  ),
  valorEmRisco: baseHelp(
    "Valor em risco (bloqueado, atrasado sem documento ou sem evidência).",
    "Soma dos estágios de risco — um pedido em um estágio, sem duplicar.",
    "BLOQUEADO_REVISAO, PEDIDO_ATRASADO_SEM_DOCUMENTO, SEM_EVIDENCIA.",
    "Alertas técnicos de excedente/fora.",
    "Fila de revisão prioritária."
  ),
  taxaPedidoParaCr: baseHelp(
    "Taxa pedido → Contas a Receber (por valor).",
    "Valor dos pedidos com CR ou recebido ÷ valor total × 100.",
    "Pedidos com evidência de CR/baixa.",
    "Pedidos só em carteira/documento.",
    "Baixo = gargalo de formalização financeira."
  ),
  taxaPedidoParaRecebido: baseHelp(
    "Taxa pedido → recebido (por valor).",
    "Valor recebido ÷ valor total × 100.",
    "Pedidos em RECEBIDO / com baixa.",
    "CR ainda aberto.",
    "Quanto da carteira já virou caixa."
  ),
  confiancaMedia: baseHelp(
    "Confiança média ponderada pelo valor.",
    "Σ (confiança × valor do estágio) ÷ Σ valor.",
    "Pedidos do grupo no funil.",
    "Comissão ou regras de remuneração.",
    "Baixa confiança pede revisão de evidência."
  ),
  principalGargalo: baseHelp(
    "Principal gargalo do grupo.",
    "Estágio de maior prioridade entre pedidos ainda não recebidos (valor como desempate).",
    "Um estágio principal por pedido.",
    "Alertas auxiliares.",
    "Onde concentrar a ação recomendada."
  ),
  acaoRecomendada: baseHelp(
    "Ação sugerida a partir do gargalo.",
    "Usa a recomendação do estágio gargalo (classificação do pedido).",
    "Texto operacional do funil.",
    "Comissão ou meta de vendedor.",
    "Próximo passo para destravar a carteira."
  ),
  valorSemDocumento: baseHelp(
    "Valor ainda sem documento de saída/NF.",
    "Pedidos em estágios pré-documento sem stock document e sem NF.",
    "Carteira só em pedido/atendimento.",
    "Já com documento ou NF.",
    "Fila de faturamento/expedição."
  ),
  valorDocumentoNfSemCr: baseHelp(
    "Valor com documento/NF ainda sem CR.",
    "Soma DOCUMENTO_SEM_NF + NF_SEM_CR.",
    "Evidência fiscal/operacional sem título.",
    "Já com CR ou recebido.",
    "Gargalo típico de formalização financeira."
  ),
  pedidosAntigosCount: baseHelp(
    "Quantidade de pedidos antigos (≥ 90 dias ou bloqueados).",
    "Conta pedidos com idade ≥ 90 dias desde a emissão ou em BLOQUEADO_REVISAO.",
    "Pedidos velhos no recorte.",
    "Pedidos novos saudáveis.",
    "Sinal de carteira estagnada no cliente."
  ),
};

export const TONE_CLASSES: Record<
  string,
  { border: string; bg: string; text: string; accent: string }
> = {
  green: {
    border: "border-[#ABEFC6]",
    bg: "bg-[#ECFDF3]",
    text: "text-[#067647]",
    accent: "border-l-[#067647]",
  },
  blue: {
    border: "border-[#B2DDFF]",
    bg: "bg-[#EFF8FF]",
    text: "text-[#175CD3]",
    accent: "border-l-[#175CD3]",
  },
  amber: {
    border: "border-[#FEDF89]",
    bg: "bg-[#FFFAEB]",
    text: "text-[#B54708]",
    accent: "border-l-[#B54708]",
  },
  red: {
    border: "border-[#FECDCA]",
    bg: "bg-[#FEF3F2]",
    text: "text-[#B42318]",
    accent: "border-l-[#B42318]",
  },
  orange: {
    border: "border-[#FDBA74]",
    bg: "bg-[#FFF6ED]",
    text: "text-[#C2410C]",
    accent: "border-l-[#C2410C]",
  },
  gray: {
    border: "border-[#EAECF0]",
    bg: "bg-[#F9FAFB]",
    text: "text-[#344054]",
    accent: "border-l-[#667085]",
  },
};

export function temperatureTone(temp: string): keyof typeof TONE_CLASSES {
  if (temp === "QUENTE") return "green";
  if (temp === "MORNO") return "amber";
  if (temp === "FRIO") return "orange";
  if (temp === "CONGELADO") return "red";
  return "gray";
}
