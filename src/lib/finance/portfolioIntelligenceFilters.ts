/**
 * Filtros da Central de Inteligência da Carteira (UI + query string).
 * Não recalcula maturidade — só monta params da API.
 */

import type { FinanceBiFilterChip } from "@/src/lib/financeBiFilterChips";

export type PortfolioIntelligenceDateAxis =
  | "ORDER_ISSUE_DATE"
  | "EXPECTED_DELIVERY_DATE"
  | "NFE_DATE"
  | "STOCK_DOCUMENT_DATE"
  | "RECEIVABLE_DUE_DATE"
  | "RECEIVABLE_SETTLEMENT_DATE"
  | "FORECAST_DATE"
  | "UPDATED_AT";

export type PortfolioIntelligencePeriodPreset =
  | "this_month"
  | "last_month"
  | "next_30"
  | "next_60"
  | "next_90"
  | "overdue"
  | "current_year"
  | "last_12_months"
  | "custom"
  | "";

export type PortfolioIntelligenceUiFilters = {
  customerExternalId: string;
  sellerExternalId: string;
  sellerName: string;
  companyId: string;
  statusPrincipal: string;
  /** Status financeiro do mapa (FIN_*). */
  financialStatus: string;
  /** Status operacional do mapa (OP_*). */
  operationalStatus: string;
  confidenceLabel: string;
  /** Alertas técnicos (tags). */
  tagsAlerta: string;
  /** Alerta operacional (tag de atendimento/excesso/fora). */
  operationalAlert: string;
  orderCode: string;
  productExternalId: string;
  minValue: string;
  maxValue: string;
  dateAxis: PortfolioIntelligenceDateAxis;
  periodPreset: PortfolioIntelligencePeriodPreset;
  from: string;
  to: string;
  onlyWithoutNfe: boolean;
  onlyWithoutStockDocument: boolean;
  onlyWithoutReceivable: boolean;
  onlyWithoutSeller: boolean;
  onlyTechnicalDivergence: boolean;
  onlyVeryLowConfidence: boolean;
  onlyFuturePortfolio: boolean;
  onlyBlockedPortfolio: boolean;
  onlyOverdueStatus: boolean;
  onlyAboveMinValue: boolean;
  /** Recortes O2C (cards/funil de negócio). */
  onlyFutureDelivery: boolean;
  onlyPastDelivery: boolean;
  onlyWithCr: boolean;
  onlyWithDocOrNfe: boolean;
  onlyOrderOnly: boolean;
  onlyOrderWithPaymentTerms: boolean;
  onlyOrderWithoutPaymentTerms: boolean;
};

export const PORTFOLIO_INTELLIGENCE_DATE_AXIS_OPTIONS: Array<{
  value: PortfolioIntelligenceDateAxis;
  label: string;
  hint: string;
}> = [
  {
    value: "ORDER_ISSUE_DATE",
    label: "Emissão do pedido",
    hint: "Pedidos de venda por data de emissão — não é vencimento de CR.",
  },
  {
    value: "EXPECTED_DELIVERY_DATE",
    label: "Previsão de entrega/faturamento",
    hint: "Data prevista do pedido — diferente de vencimento de Contas a Receber.",
  },
  {
    value: "NFE_DATE",
    label: "Data da NF",
    hint: "Processamento/emissão da NF vinculada.",
  },
  {
    value: "STOCK_DOCUMENT_DATE",
    label: "Documento de saída",
    hint: "Data do documento de saída / estoque.",
  },
  {
    value: "RECEIVABLE_DUE_DATE",
    label: "Vencimento do CR",
    hint: "Contas a Receber por vencimento — diferente de emissão do pedido.",
  },
  {
    value: "RECEIVABLE_SETTLEMENT_DATE",
    label: "Baixa / recebimento",
    hint: "Data de liquidação/baixa do CR.",
  },
  {
    value: "FORECAST_DATE",
    label: "Data prevista de recebimento",
    hint: "Previsão de recebimento usada na conciliação (CR > NF > pedido).",
  },
  {
    value: "UPDATED_AT",
    label: "Atualização da run",
    hint: "Última atualização do pedido/fato na materialização da run.",
  },
];

export const PORTFOLIO_INTELLIGENCE_PERIOD_PRESETS: Array<{
  value: PortfolioIntelligencePeriodPreset;
  label: string;
}> = [
  { value: "this_month", label: "Este mês" },
  { value: "last_month", label: "Mês anterior" },
  { value: "next_30", label: "Próximos 30 dias" },
  { value: "next_60", label: "Próximos 60 dias" },
  { value: "next_90", label: "Próximos 90 dias" },
  { value: "overdue", label: "Vencidos" },
  { value: "current_year", label: "Ano atual" },
  { value: "last_12_months", label: "Últimos 12 meses" },
  { value: "custom", label: "Personalizado" },
];

export const PORTFOLIO_INTELLIGENCE_STATUS_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "RECEBIDO", label: "Recebido" },
  { value: "CR_ABERTO", label: "CR aberto" },
  { value: "FATURADO_SEM_CR", label: "Faturado sem CR" },
  { value: "CARTEIRA_FUTURA_PROVAVEL", label: "Carteira futura provável" },
  { value: "CARTEIRA_PRESENTE_ATENCAO", label: "Presente / atenção" },
  { value: "CARTEIRA_VENCIDA_BLOQUEADA", label: "Carteira vencida bloqueada" },
  { value: "SEM_EVIDENCIA", label: "Sem evidência suficiente" },
] as const;

export const PORTFOLIO_INTELLIGENCE_CONFIDENCE_OPTIONS = [
  { value: "", label: "Todas" },
  { value: "ALTA", label: "Alta" },
  { value: "MEDIA", label: "Média" },
  { value: "BAIXA", label: "Baixa" },
  { value: "MUITO_BAIXA", label: "Muito baixa" },
] as const;

export const PORTFOLIO_INTELLIGENCE_FINANCIAL_STATUS_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "FIN_RECEBIDO", label: "Recebido" },
  { value: "FIN_CR_ABERTO", label: "CR aberto" },
  { value: "FIN_FATURADO_SEM_CR", label: "Faturado sem CR" },
  { value: "FIN_SEM_CR", label: "Sem CR" },
] as const;

export const PORTFOLIO_INTELLIGENCE_OPERATIONAL_STATUS_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "OP_TOTALMENTE_ATENDIDO", label: "Totalmente atendido" },
  {
    value: "OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE",
    label: "Totalmente atendido (com excedente)",
  },
  { value: "OP_PARCIALMENTE_ATENDIDO", label: "Parcialmente atendido" },
  { value: "OP_NAO_ATENDIDO", label: "Não atendido" },
  { value: "OP_DOCUMENTO_SEM_ITEMIZACAO", label: "Documento sem itemização" },
  { value: "OP_VINCULO_APENAS_CABECALHO", label: "Vínculo só de cabeçalho" },
] as const;

export const PORTFOLIO_INTELLIGENCE_TECHNICAL_ALERT_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "DIVERGENCIA_TECNICA", label: "Divergência técnica" },
  { value: "NF_SEM_DOCUMENTO", label: "NF sem documento" },
  { value: "NF_CABECALHO_MAIOR_PEDIDO", label: "NF maior que pedido" },
  { value: "DIVERGENCIA_PRECO", label: "Divergência de preço" },
  { value: "SEM_CONDICAO_PAGAMENTO", label: "Sem condição de pagamento" },
  { value: "VINCULO_INCOMPLETO", label: "Vínculo incompleto" },
  { value: "PEDIDO_ANTIGO_SEM_EVOLUCAO", label: "Pedido antigo sem evolução" },
] as const;

export const PORTFOLIO_INTELLIGENCE_OPERATIONAL_ALERT_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "QUANTIDADE_EXCEDENTE_DOCUMENTO", label: "Quantidade excedente" },
  { value: "PRODUTO_FORA_DO_PEDIDO", label: "Produto fora do pedido" },
  { value: "DOCUMENTO_SEM_CR", label: "Documento sem CR" },
] as const;

export const PORTFOLIO_INTELLIGENCE_TAG_OPTIONS = [
  ...PORTFOLIO_INTELLIGENCE_TECHNICAL_ALERT_OPTIONS.filter((o) => o.value),
  ...PORTFOLIO_INTELLIGENCE_OPERATIONAL_ALERT_OPTIONS.filter((o) => o.value),
] as const;

export const PORTFOLIO_INTELLIGENCE_DATE_AXIS_HELP = {
  whatItMeans:
    "Pedidos por emissão são diferentes de CR por vencimento. Comparar eixos diferentes pode gerar divergências.",
  howWeCalculate:
    "O filtro de período usa só a data do eixo escolhido (emissão, previsão, NF, documento, vencimento do CR, baixa, forecast ou atualização).",
  whatIsIncluded:
    "Pedidos que têm a data desse eixo dentro do intervalo. Atalhos como “Próximos 30 dias” e “Vencidos” preenchem as datas automaticamente.",
  whatIsExcluded:
    "Pedidos sem a data do eixo escolhido ficam de fora do recorte. Não misture emissão de pedido com vencimento de Contas a Receber na mesma leitura.",
  howToInterpret:
    "Antes de comparar números, confira o chip “Eixo: …”. Emissão = carteira comercial; vencimento de CR = títulos financeiros.",
};

function formatYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function createDefaultPortfolioIntelligenceUiFilters(
  defaults?: Partial<Pick<PortfolioIntelligenceUiFilters, "customerExternalId">>
): PortfolioIntelligenceUiFilters {
  return {
    customerExternalId: defaults?.customerExternalId ?? "",
    sellerExternalId: "",
    sellerName: "",
    companyId: "",
    statusPrincipal: "",
    financialStatus: "",
    operationalStatus: "",
    confidenceLabel: "",
    tagsAlerta: "",
    operationalAlert: "",
    orderCode: "",
    productExternalId: "",
    minValue: "",
    maxValue: "",
    dateAxis: "FORECAST_DATE",
    periodPreset: "",
    from: "",
    to: "",
    onlyWithoutNfe: false,
    onlyWithoutStockDocument: false,
    onlyWithoutReceivable: false,
    onlyWithoutSeller: false,
    onlyTechnicalDivergence: false,
    onlyVeryLowConfidence: false,
    onlyFuturePortfolio: false,
    onlyBlockedPortfolio: false,
    onlyOverdueStatus: false,
    onlyAboveMinValue: false,
    onlyFutureDelivery: false,
    onlyPastDelivery: false,
    onlyWithCr: false,
    onlyWithDocOrNfe: false,
    onlyOrderOnly: false,
    onlyOrderWithPaymentTerms: false,
    onlyOrderWithoutPaymentTerms: false,
  };
}

export function resolvePortfolioIntelligencePeriodPreset(
  preset: PortfolioIntelligencePeriodPreset,
  today = startOfToday()
): { from: string; to: string } | null {
  if (!preset || preset === "custom") return null;

  const todayYmd = formatYmdLocal(today);

  if (preset === "this_month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { from: formatYmdLocal(start), to: formatYmdLocal(end) };
  }
  if (preset === "last_month") {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return { from: formatYmdLocal(start), to: formatYmdLocal(end) };
  }
  if (preset === "next_30" || preset === "next_60" || preset === "next_90") {
    const days = preset === "next_30" ? 30 : preset === "next_60" ? 60 : 90;
    const end = new Date(today);
    end.setDate(end.getDate() + days);
    return { from: todayYmd, to: formatYmdLocal(end) };
  }
  if (preset === "overdue") {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return { from: "", to: formatYmdLocal(yesterday) };
  }
  if (preset === "current_year") {
    return {
      from: formatYmdLocal(new Date(today.getFullYear(), 0, 1)),
      to: todayYmd,
    };
  }
  if (preset === "last_12_months") {
    const start = new Date(today);
    start.setFullYear(start.getFullYear() - 1);
    return { from: formatYmdLocal(start), to: todayYmd };
  }
  return null;
}

export function applyPeriodPresetToFilters(
  filters: PortfolioIntelligenceUiFilters,
  preset: PortfolioIntelligencePeriodPreset
): PortfolioIntelligenceUiFilters {
  if (preset === "custom") {
    return { ...filters, periodPreset: "custom" };
  }
  if (!preset) {
    return { ...filters, periodPreset: "", from: "", to: "" };
  }
  const range = resolvePortfolioIntelligencePeriodPreset(preset);
  if (!range) return { ...filters, periodPreset: preset };

  let dateAxis = filters.dateAxis;
  // Atalhos futuros/vencidos fazem mais sentido em previsão/forecast do que em emissão.
  if (
    (preset === "next_30" ||
      preset === "next_60" ||
      preset === "next_90" ||
      preset === "overdue") &&
    (dateAxis === "ORDER_ISSUE_DATE" || dateAxis === "UPDATED_AT")
  ) {
    dateAxis = "FORECAST_DATE";
  }

  return {
    ...filters,
    periodPreset: preset,
    dateAxis,
    from: range.from,
    to: range.to,
  };
}

export function dateAxisLabel(axis: PortfolioIntelligenceDateAxis): string {
  return (
    PORTFOLIO_INTELLIGENCE_DATE_AXIS_OPTIONS.find((o) => o.value === axis)?.label ?? axis
  );
}

function optionLabel(
  options: readonly { value: string; label: string }[],
  value: string
): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

/** Normaliza filtros UI → campos efetivos enviados à API (atalhos rápidos). */
export function resolvePortfolioIntelligenceEffectiveFilters(
  filters: PortfolioIntelligenceUiFilters
): PortfolioIntelligenceUiFilters {
  let next = { ...filters };

  if (next.onlyVeryLowConfidence) next.confidenceLabel = "MUITO_BAIXA";
  if (next.onlyFuturePortfolio) next.statusPrincipal = "CARTEIRA_FUTURA_PROVAVEL";
  if (next.onlyBlockedPortfolio || next.onlyOverdueStatus) {
    next.statusPrincipal = "CARTEIRA_VENCIDA_BLOQUEADA";
  }
  if (next.onlyTechnicalDivergence) {
    const tags = new Set(
      next.tagsAlerta
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    );
    tags.add("DIVERGENCIA_TECNICA");
    next.tagsAlerta = [...tags].join(",");
  }
  if (next.operationalAlert.trim()) {
    const tags = new Set(
      next.tagsAlerta
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    );
    tags.add(next.operationalAlert.trim());
    next.tagsAlerta = [...tags].join(",");
  }
  if (next.onlyAboveMinValue && !next.minValue.trim()) {
    // Sem valor mínimo configurado o atalho não restringe.
    next.onlyAboveMinValue = false;
  }
  if (!next.onlyAboveMinValue) {
    // minValue do formulário ainda vale se preenchido manualmente.
  }

  return next;
}

export function buildPortfolioIntelligenceFilterChips(
  filters: PortfolioIntelligenceUiFilters,
  onRemoveField?: (field: keyof PortfolioIntelligenceUiFilters) => void,
  options?: { customerNameByExternalId?: Record<string, string> }
): FinanceBiFilterChip[] {
  const chips: FinanceBiFilterChip[] = [];
  const push = (id: keyof PortfolioIntelligenceUiFilters, label: string) => {
    chips.push({
      id,
      label,
      onRemove: onRemoveField ? () => onRemoveField(id) : undefined,
    });
  };

  push("dateAxis", `Eixo: ${dateAxisLabel(filters.dateAxis)}`);

  if (filters.periodPreset && filters.periodPreset !== "custom") {
    push(
      "periodPreset",
      `Período: ${optionLabel(PORTFOLIO_INTELLIGENCE_PERIOD_PRESETS, filters.periodPreset)}`
    );
  }
  if (filters.from.trim()) push("from", `De: ${filters.from}`);
  if (filters.to.trim()) push("to", `Até: ${filters.to}`);
  if (filters.customerExternalId.trim()) {
    const name =
      options?.customerNameByExternalId?.[filters.customerExternalId.trim()]?.trim();
    push(
      "customerExternalId",
      `Cliente: ${name || filters.customerExternalId}`
    );
  }
  if (filters.sellerExternalId.trim()) {
    push("sellerExternalId", `Vendedor ID: ${filters.sellerExternalId}`);
  }
  if (filters.sellerName.trim()) push("sellerName", `Vendedor: ${filters.sellerName}`);
  if (filters.companyId.trim()) push("companyId", `Empresa: ${filters.companyId}`);
  if (filters.statusPrincipal) {
    push(
      "statusPrincipal",
      `Status: ${optionLabel([...PORTFOLIO_INTELLIGENCE_STATUS_OPTIONS], filters.statusPrincipal)}`
    );
  }
  if (filters.financialStatus) {
    push(
      "financialStatus",
      `Status financeiro: ${optionLabel(
        [...PORTFOLIO_INTELLIGENCE_FINANCIAL_STATUS_OPTIONS],
        filters.financialStatus
      )}`
    );
  }
  if (filters.operationalStatus) {
    push(
      "operationalStatus",
      `Status operacional: ${optionLabel(
        [...PORTFOLIO_INTELLIGENCE_OPERATIONAL_STATUS_OPTIONS],
        filters.operationalStatus
      )}`
    );
  }
  if (filters.confidenceLabel) {
    push(
      "confidenceLabel",
      `Confiança: ${optionLabel([...PORTFOLIO_INTELLIGENCE_CONFIDENCE_OPTIONS], filters.confidenceLabel)}`
    );
  }
  if (filters.tagsAlerta.trim()) {
    const tech = filters.tagsAlerta
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) =>
        optionLabel([...PORTFOLIO_INTELLIGENCE_TECHNICAL_ALERT_OPTIONS], t)
      )
      .join(", ");
    push("tagsAlerta", `Alerta técnico: ${tech || filters.tagsAlerta}`);
  }
  if (filters.operationalAlert.trim()) {
    push(
      "operationalAlert",
      `Alerta: ${optionLabel(
        [...PORTFOLIO_INTELLIGENCE_OPERATIONAL_ALERT_OPTIONS],
        filters.operationalAlert
      )}`
    );
  }
  if (filters.orderCode.trim()) push("orderCode", `Pedido: ${filters.orderCode}`);
  if (filters.productExternalId.trim()) {
    push("productExternalId", `Produto/SKU: ${filters.productExternalId}`);
  }
  if (filters.minValue.trim()) push("minValue", `Valor mín.: ${filters.minValue}`);
  if (filters.maxValue.trim()) push("maxValue", `Valor máx.: ${filters.maxValue}`);
  if (filters.onlyWithoutNfe) push("onlyWithoutNfe", "Sem NF");
  if (filters.onlyWithoutStockDocument) {
    push("onlyWithoutStockDocument", "Sem documento de saída");
  }
  if (filters.onlyWithoutReceivable) push("onlyWithoutReceivable", "Sem CR");
  if (filters.onlyWithoutSeller) push("onlyWithoutSeller", "Sem vendedor informado");
  if (filters.onlyTechnicalDivergence) {
    push("onlyTechnicalDivergence", "Divergência técnica");
  }
  if (filters.onlyVeryLowConfidence) {
    push("onlyVeryLowConfidence", "Confiança muito baixa");
  }
  if (filters.onlyFuturePortfolio) push("onlyFuturePortfolio", "Carteira futura");
  if (filters.onlyBlockedPortfolio) push("onlyBlockedPortfolio", "Carteira bloqueada");
  if (filters.onlyOverdueStatus) push("onlyOverdueStatus", "Somente vencidos (status)");
  if (filters.onlyAboveMinValue) push("onlyAboveMinValue", "Acima do valor mínimo");
  if (filters.onlyFutureDelivery) push("onlyFutureDelivery", "Entrega futura");
  if (filters.onlyPastDelivery) push("onlyPastDelivery", "Entrega vencida");
  if (filters.onlyWithCr) push("onlyWithCr", "Já virou CR");
  if (filters.onlyWithDocOrNfe) push("onlyWithDocOrNfe", "Com doc/NF");
  if (filters.onlyOrderOnly) push("onlyOrderOnly", "Só pedido");
  if (filters.onlyOrderWithPaymentTerms) {
    push("onlyOrderWithPaymentTerms", "Só pedido com condição");
  }
  if (filters.onlyOrderWithoutPaymentTerms) {
    push("onlyOrderWithoutPaymentTerms", "Só pedido sem condição");
  }

  return chips;
}

export function countActivePortfolioIntelligenceFilters(
  filters: PortfolioIntelligenceUiFilters
): number {
  let n = 0;
  if (filters.customerExternalId.trim()) n += 1;
  if (filters.sellerExternalId.trim() || filters.sellerName.trim()) n += 1;
  if (filters.companyId.trim()) n += 1;
  if (filters.statusPrincipal) n += 1;
  if (filters.financialStatus) n += 1;
  if (filters.operationalStatus) n += 1;
  if (filters.confidenceLabel) n += 1;
  if (filters.tagsAlerta.trim()) n += 1;
  if (filters.operationalAlert.trim()) n += 1;
  if (filters.orderCode.trim()) n += 1;
  if (filters.productExternalId.trim()) n += 1;
  if (filters.minValue.trim()) n += 1;
  if (filters.maxValue.trim()) n += 1;
  if (filters.from.trim() || filters.to.trim()) n += 1;
  if (filters.onlyWithoutNfe) n += 1;
  if (filters.onlyWithoutStockDocument) n += 1;
  if (filters.onlyWithoutReceivable) n += 1;
  if (filters.onlyWithoutSeller) n += 1;
  if (filters.onlyTechnicalDivergence) n += 1;
  if (filters.onlyVeryLowConfidence) n += 1;
  if (filters.onlyFuturePortfolio) n += 1;
  if (filters.onlyBlockedPortfolio) n += 1;
  if (filters.onlyOverdueStatus) n += 1;
  if (filters.onlyAboveMinValue) n += 1;
  if (filters.onlyFutureDelivery) n += 1;
  if (filters.onlyPastDelivery) n += 1;
  if (filters.onlyWithCr) n += 1;
  if (filters.onlyWithDocOrNfe) n += 1;
  if (filters.onlyOrderOnly) n += 1;
  if (filters.onlyOrderWithPaymentTerms) n += 1;
  if (filters.onlyOrderWithoutPaymentTerms) n += 1;
  return n;
}

/** Converte filtros UI efetivos nos args do query builder da API. */
export function portfolioIntelligenceUiFiltersToQueryArgs(
  filters: PortfolioIntelligenceUiFilters,
  extras?: { runId?: string; page?: number; pageSize?: number }
) {
  const effective = resolvePortfolioIntelligenceEffectiveFilters(filters);
  const minValue =
    effective.onlyAboveMinValue || effective.minValue.trim()
      ? effective.minValue.trim()
      : "";

  return {
    runId: extras?.runId ?? "",
    customerExternalId: effective.customerExternalId,
    sellerExternalId: effective.sellerExternalId,
    sellerName: effective.sellerName,
    companyId: effective.companyId,
    orderCode: effective.orderCode,
    productExternalId: effective.productExternalId,
    statusPrincipal: effective.statusPrincipal,
    financialStatus: effective.financialStatus,
    operationalStatus: effective.operationalStatus,
    confidenceLabel: effective.confidenceLabel,
    tagsAlerta: effective.tagsAlerta,
    operationalAlert: effective.operationalAlert,
    minValue,
    maxValue: effective.maxValue,
    dateAxis:
      effective.from.trim() || effective.to.trim() ? effective.dateAxis : "",
    from: effective.from,
    to: effective.to,
    onlyWithoutNfe: effective.onlyWithoutNfe,
    onlyWithoutStockDocument: effective.onlyWithoutStockDocument,
    onlyWithoutReceivable: effective.onlyWithoutReceivable,
    onlyWithoutSeller: effective.onlyWithoutSeller,
    onlyFutureDelivery: effective.onlyFutureDelivery,
    onlyPastDelivery: effective.onlyPastDelivery,
    onlyWithCr: effective.onlyWithCr,
    onlyWithDocOrNfe: effective.onlyWithDocOrNfe,
    onlyOrderOnly: effective.onlyOrderOnly,
    onlyOrderWithPaymentTerms: effective.onlyOrderWithPaymentTerms,
    onlyOrderWithoutPaymentTerms: effective.onlyOrderWithoutPaymentTerms,
    page: extras?.page ?? 1,
    pageSize: extras?.pageSize ?? 200,
  };
}

/** Limpa recortes O2C (cards/funil) mantendo cliente/período/eixo. */
export function clearPortfolioIntelligenceO2cSliceFilters(
  filters: PortfolioIntelligenceUiFilters
): PortfolioIntelligenceUiFilters {
  return {
    ...filters,
    statusPrincipal: "",
    onlyFuturePortfolio: false,
    onlyBlockedPortfolio: false,
    onlyOverdueStatus: false,
    onlyFutureDelivery: false,
    onlyPastDelivery: false,
    onlyWithCr: false,
    onlyWithDocOrNfe: false,
    onlyOrderOnly: false,
    onlyOrderWithPaymentTerms: false,
    onlyOrderWithoutPaymentTerms: false,
    onlyWithoutNfe: false,
    onlyWithoutStockDocument: false,
    onlyWithoutReceivable: false,
  };
}

export type PortfolioO2cUiFilterHint = {
  statusPrincipal?: string;
  onlyWithoutNfe?: boolean;
  onlyWithoutStockDocument?: boolean;
  onlyWithoutReceivable?: boolean;
  onlyFutureDelivery?: boolean;
  onlyPastDelivery?: boolean;
  onlyWithCr?: boolean;
  onlyWithDocOrNfe?: boolean;
  onlyOrderOnly?: boolean;
  onlyOrderWithPaymentTerms?: boolean;
  onlyOrderWithoutPaymentTerms?: boolean;
  /** Atalho de funil / status. */
  evidenceStage?: "SO_PEDIDO" | "DOC_OU_NF" | "CR_ABERTO" | "RECEBIDO" | "BLOQUEADO";
  /** Bucket de aging (eixo forecast + from/to). */
  agingBucket?: "OVERDUE" | "D0_30" | "D31_60" | "D61_90_PLUS" | "SEM_DATA";
  asOfDate?: string;
};

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d!);
  dt.setDate(dt.getDate() + days);
  return formatYmdLocal(dt);
}

/** Aplica clique de card/funil/bucket O2C nos filtros UI (substitui o recorte anterior). */
export function applyPortfolioO2cFilterHint(
  filters: PortfolioIntelligenceUiFilters,
  hint: PortfolioO2cUiFilterHint
): PortfolioIntelligenceUiFilters {
  let next = clearPortfolioIntelligenceO2cSliceFilters(filters);

  if (hint.evidenceStage) {
    switch (hint.evidenceStage) {
      case "SO_PEDIDO":
        next.onlyOrderOnly = true;
        break;
      case "DOC_OU_NF":
        next.onlyWithDocOrNfe = true;
        next.onlyWithoutReceivable = true;
        break;
      case "CR_ABERTO":
        next.statusPrincipal = "CR_ABERTO";
        break;
      case "RECEBIDO":
        next.statusPrincipal = "RECEBIDO";
        break;
      case "BLOQUEADO":
        next.statusPrincipal = "CARTEIRA_VENCIDA_BLOQUEADA";
        break;
    }
  }

  if (hint.agingBucket) {
    const asOf = hint.asOfDate?.trim() || formatYmdLocal(startOfToday());
    next.dateAxis = "FORECAST_DATE";
    next.periodPreset = "custom";
    if (hint.agingBucket === "OVERDUE") {
      next.from = "";
      next.to = addDaysYmd(asOf, -1);
    } else if (hint.agingBucket === "D0_30") {
      next.from = asOf;
      next.to = addDaysYmd(asOf, 30);
    } else if (hint.agingBucket === "D31_60") {
      next.from = addDaysYmd(asOf, 31);
      next.to = addDaysYmd(asOf, 60);
    } else if (hint.agingBucket === "D61_90_PLUS") {
      next.from = addDaysYmd(asOf, 61);
      next.to = "";
    } else {
      // SEM_DATA: sem recorte de período — deixa o restante dos filtros
      next.from = "";
      next.to = "";
      next.periodPreset = "";
    }
  }

  if (hint.statusPrincipal) next.statusPrincipal = hint.statusPrincipal;
  if (hint.onlyWithoutNfe) next.onlyWithoutNfe = true;
  if (hint.onlyWithoutStockDocument) next.onlyWithoutStockDocument = true;
  if (hint.onlyWithoutReceivable) next.onlyWithoutReceivable = true;
  if (hint.onlyFutureDelivery) next.onlyFutureDelivery = true;
  if (hint.onlyPastDelivery) next.onlyPastDelivery = true;
  if (hint.onlyWithCr) next.onlyWithCr = true;
  if (hint.onlyWithDocOrNfe) next.onlyWithDocOrNfe = true;
  if (hint.onlyOrderOnly) next.onlyOrderOnly = true;
  if (hint.onlyOrderWithPaymentTerms) next.onlyOrderWithPaymentTerms = true;
  if (hint.onlyOrderWithoutPaymentTerms) next.onlyOrderWithoutPaymentTerms = true;

  return next;
}
