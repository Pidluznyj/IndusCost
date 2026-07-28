/**
 * Formatação e labels de exibição de margem de Pedidos de Venda.
 * Sem cálculo de margem — apenas apresentação do payload do backend.
 */
import { formatNumber } from "./utils.js";
import type {
  SalesOrderCostSource,
  SalesOrderItemMarginPayload,
  SalesOrderMarginStatusSeverity,
  SalesOrderMarginSummaryPayload,
  SalesOrderMarginSummaryStatus,
} from "./salesOrderMarginTypes.js";
import { resolveSalesOrderMarginSummaryStatusMeta } from "./salesOrderMarginStatus.js";
import { mergeSalesOrderMarginCoveragePayloads } from "./salesOrderMarginCoverage.js";

const marginMoneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const marginPercentFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatSalesOrderMarginMoney(value: unknown): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return marginMoneyFormatter.format(n);
}

export function formatSalesOrderMarginPercent(value: unknown): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${marginPercentFormatter.format(n)}%`;
}

export function formatSalesOrderMarkup(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `${formatNumber(n, 2)}x`;
}

export const SALES_ORDER_COST_SOURCE_LABEL: Record<SalesOrderCostSource, string> = {
  SALES_ORDER_ITEM_SNAPSHOT: "Legado — não usar como custo de produção",
  HISTORICAL_SNAPSHOT: "Snapshot histórico do motor de custo",
  VERSIONED_PRODUCTION_COST: "Custo de produção IndusCost (tabela vigente)",
  LIVE_PRODUCT_COST: "Custo de produção IndusCost (motor vivo)",
  RECALCULATED_CURRENT_COST: "Custo de produção parcial recalculado",
  OFFICIAL_FINAL_COST: "Custo oficial da engenharia",
  CURRENT_ENGINEERING_COST: "Custo parcial da engenharia",
  CURRENT_COST: "Custo atual do cadastro",
  MANUAL_COST: "Custo manual",
  MISSING_COST: "Custo de produção não resolvido",
};

export function formatSalesOrderCostSourceLabel(
  source: SalesOrderCostSource | undefined | null
): string {
  if (!source) return "—";
  return SALES_ORDER_COST_SOURCE_LABEL[source] ?? source;
}

export function resolveSalesOrderMarginSupportText(
  summary?: Pick<SalesOrderMarginSummaryPayload, "status"> | null,
  itemMargins?: Array<Pick<SalesOrderItemMarginPayload, "costSource"> | undefined>
): string {
  const sources = new Set(
    (itemMargins ?? [])
      .map((row) => row?.costSource)
      .filter((s): s is SalesOrderCostSource => Boolean(s))
  );

  if (sources.has("VERSIONED_PRODUCTION_COST")) {
    return "Margem realizada com custo de produção IndusCost da tabela oficial vigente na data do pedido. A referência comercial compara o preço vendido com o preço publicado da tabela vinculada à proposta, quando disponível.";
  }
  if (sources.has("HISTORICAL_SNAPSHOT")) {
    return "Margem calculada com snapshot histórico do motor de custo IndusCost.";
  }
  if (
    sources.has("RECALCULATED_CURRENT_COST") ||
    sources.has("CURRENT_ENGINEERING_COST")
  ) {
    return "Margem calculada com custo atual parcial recalculado — estimativa, não histórica.";
  }
  if (
    sources.has("LIVE_PRODUCT_COST") ||
    sources.has("OFFICIAL_FINAL_COST") ||
    sources.size === 0
  ) {
    return "Margem calculada com base no custo atual do produto no IndusCost — estimativa viva.";
  }
  if (sources.has("CURRENT_COST")) {
    return "Margem calculada com base no custo atual do cadastro do produto.";
  }
  if (summary?.status === "SEM_CUSTO" || sources.has("MISSING_COST")) {
    return "Margem incompleta: há itens sem custo oficial disponível.";
  }
  return "Margem calculada com base no custo atual do produto no IndusCost — estimativa viva.";
}

export function salesOrderMarginSeverityBadgeClass(
  severity: SalesOrderMarginStatusSeverity | undefined
): string {
  switch (severity) {
    case "success":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";
    case "danger":
      return "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300";
    case "warning":
      return "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200";
    case "neutral":
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function salesOrderMarginSummaryStatusBadgeClass(
  status: SalesOrderMarginSummaryStatus | undefined
): string {
  switch (status) {
    case "OK":
      return salesOrderMarginSeverityBadgeClass("success");
    case "MARGEM_NEGATIVA":
    case "RECEITA_INVALIDA":
      return salesOrderMarginSeverityBadgeClass("danger");
    case "PARTIAL":
    case "SEM_CUSTO":
    case "SEM_PRODUTO_VINCULADO":
    case "CUSTO_ZERO":
      return salesOrderMarginSeverityBadgeClass("warning");
    case "REVISAR_DADOS":
    case "ITEM_CANCELADO":
      return salesOrderMarginSeverityBadgeClass("neutral");
    default:
      return salesOrderMarginSeverityBadgeClass("neutral");
  }
}

export {
  buildSalesOrderMarginCoverageHint,
  resolveSalesOrderMarginMoneyLabel,
  resolveSalesOrderMarginPercentLabel,
  resolveSalesOrderMarginRevenueLabel,
} from "./salesOrderMarginCoverage.js";

export const SALES_ORDER_COMMERCIAL_REFERENCE_STATUS_LABEL: Record<
  import("./salesOrderMarginTypes.js").SalesOrderMarginCommercialReferenceStatus,
  string
> = {
  OK: "Referência comercial OK",
  SEM_CUSTO: "Sem custo oficial",
  SEM_PRECO_TABELA: "Sem tabela de preço vinculada",
  CUSTO_INDISPONIVEL: "Custo indisponível",
  PRECO_INDISPONIVEL: "Preço de tabela indisponível",
  RECEITA_INVALIDA: "Receita inválida",
};

export function formatOfficialPriceTableReferenceLabel(
  ref?: import("./salesOrderMarginTypes.js").SalesOrderMarginOfficialPriceMeta | null
): string {
  if (!ref?.priceTableCode) return "—";
  const version =
    ref.versionNumber > 0 ? ` v${ref.versionNumber}` : ref.priceTableVersionId ? "" : "";
  return `${ref.priceTableCode}${version}`;
}

export function formatProductionCostReferenceLabel(
  meta?: import("./salesOrderMarginTypes.js").SalesOrderMarginProductionCostMeta | null
): string {
  if (!meta?.versionCode) return "—";
  return `${meta.versionCode} (rev. ${meta.revision})`;
}

export function formatProductTypeLabel(type?: string | null): string {
  if (!type) return "—";
  if (type === "PRODUCT") return "Produto";
  if (type === "COMPONENT") return "Componente";
  return type;
}

export function buildSalesOrderMarginAlerts(
  summary?: SalesOrderMarginSummaryPayload | null
): string[] {
  if (!summary) return [];
  const alerts: string[] = [];
  if (summary.hasMissingCost) {
    alerts.push(
      "Este pedido possui itens sem custo de produção publicado/vigente na tabela de custo IndusCost. A receita e os impostos foram identificados, mas a margem não pode ser calculada até o custo ser publicado."
    );
  }
  if (summary.hasMissingProduct) {
    alerts.push(
      "Existem itens do Nomus sem vínculo com produto local. Revise o cadastro para calcular margem."
    );
  }
  if (summary.hasNegativeMargin) {
    alerts.push(
      "Atenção: este pedido possui item vendido abaixo do custo estimado."
    );
  }
  if (summary.hasInvalidRevenue) {
    alerts.push("Há itens com receita líquida inválida. Revise os dados do pedido.");
  }
  return alerts;
}

export function pickSalesOrderListMarginPercent(
  summary?: SalesOrderMarginSummaryPayload | null
): string {
  const commercial = summary?.commercialMargin;
  if (commercial?.commercialMarginTotalPercent != null) {
    return formatSalesOrderMarginPercent(commercial.commercialMarginTotalPercent);
  }
  if (commercial && commercial.itemsActive > 0 && commercial.itemsCalculated === 0) {
    return "Indisponível";
  }
  return "—";
}

export function pickSalesOrderListMarginValue(
  summary?: SalesOrderMarginSummaryPayload | null
): string {
  const commercial = summary?.commercialMargin;
  if (commercial?.commercialMarginTotalValue != null) {
    return formatSalesOrderMarginMoney(commercial.commercialMarginTotalValue);
  }
  return "—";
}

export const SALES_ORDER_MARGIN_DISPLAY_LABELS = {
  grossSales: "Valor vendido",
  taxEstimated: "Imposto estimado",
  netManagerial: "Receita líquida gerencial",
  cost: "Custo de produção IndusCost",
  productionUnitCost: "Custo unitário de produção",
  productionTotalCost: "Custo total de produção",
  costSource: "Fonte do custo",
  marginValue: "Margem comercial R$",
  marginPercent: "Margem comercial %",
  managerialMarginValue: "Margem gerencial após impostos e custo (R$)",
  managerialMarginPercent: "Margem gerencial após impostos e custo (%)",
  coverage: "Cobertura",
  itemsWithCost: "Itens com custo",
  itemsWithoutCost: "Itens sem custo",
  costFrozen: "Custo histórico congelado",
  costEstimated: "Custo estimado atual",
  costMixed: "Custo misto",
  commercialTitle: "Margem comercial da venda",
  managerialTitle: "Margem gerencial após impostos e custo",
  soldTitle: "Margem vendida sem imposto",
  partialTitle: "Margem comercial parcial",
  unavailableTitle: "Margem comercial indisponível",
} as const;

export type SalesOrderMarginTooltipInput = {
  summary?: SalesOrderMarginSummaryPayload | null;
  itemMargins?: Array<
    Pick<SalesOrderItemMarginPayload, "costSource" | "productionCost" | "unitCost" | "totalCost"> | null | undefined
  >;
  orderIssueDate?: string | null;
  /** Substitui o título padrão do tooltip (ex.: margem geral da listagem). */
  titleOverride?: string | null;
};

function formatCivilDatePtBr(iso: string | null | undefined): string {
  if (!iso?.trim()) return "—";
  const parts = iso.trim().slice(0, 10).split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function pickProductionCostTooltipLines(
  itemMargins?: SalesOrderMarginTooltipInput["itemMargins"]
): string[] {
  const metas = (itemMargins ?? [])
    .map((row) => row?.productionCost)
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
  if (metas.length === 0) return [];

  const unique = new Map<string, (typeof metas)[number]>();
  for (const meta of metas) {
    unique.set(`${meta.versionCode}|${meta.revision}|${meta.effectiveDate}`, meta);
  }

  const lines: string[] = [];
  if (unique.size === 1) {
    const meta = [...unique.values()][0]!;
    lines.push(`Tabela de custo: ${meta.versionCode} (rev. ${meta.revision})`);
    lines.push(`Revisão: ${meta.revision}`);
    lines.push(`Fonte: Tabela de custo vigente`);
    lines.push(`Vigência: ${formatCivilDatePtBr(meta.effectiveDate)}`);
    if (meta.orderIssueDate) {
      lines.push(`Data do pedido: ${formatCivilDatePtBr(meta.orderIssueDate)}`);
    }
    if (meta.warning) lines.push(`Aviso: ${meta.warning}`);
  } else {
    lines.push(`Tabelas de custo: ${unique.size} versões distintas nos itens`);
    lines.push(`Fonte: Tabela de custo vigente`);
  }
  return lines;
}

export function isSalesOrderMarginDisplayUnavailable(
  summary?: SalesOrderMarginSummaryPayload | null
): boolean {
  if (!summary) return true;
  if (
    summary.taxMode === "deductFromGross" &&
    summary.fiscalConfigComplete === false
  ) {
    return true;
  }
  if (summary.hasInvalidRevenue && summary.validItemsCount === 0) return true;
  return false;
}

/** Margem R$/ % calculável — receita/imposto podem estar disponíveis mesmo quando false. */
export function isSalesOrderMarginCalculable(
  summary?: SalesOrderMarginSummaryPayload | null
): boolean {
  if (!summary || isSalesOrderMarginDisplayUnavailable(summary)) return false;
  if (summary.costCoverageStatus === "NONE" && (summary.itemsWithCost ?? 0) === 0) {
    return false;
  }
  if (summary.marginValue == null || !Number.isFinite(summary.marginValue)) return false;
  return true;
}

/** Receita líquida gerencial exibível (independe de custo resolvido). */
export function resolveSalesOrderManagementNetRevenue(
  summary?: Pick<
    SalesOrderMarginSummaryPayload,
    "taxMode" | "netSalesAmountAfterTax" | "netRevenue" | "grossSalesAmount" | "totalSalesRevenueInScope"
  > | null
): number | null {
  if (!summary) return null;
  const netManagerial = summary.netSalesAmountAfterTax ?? summary.netRevenue;
  if (netManagerial != null && Number.isFinite(netManagerial) && netManagerial > 0) {
    return netManagerial;
  }
  const gross = summary.grossSalesAmount ?? summary.totalSalesRevenueInScope;
  if (gross != null && Number.isFinite(gross) && gross > 0 && summary.taxMode === "none") {
    return gross;
  }
  return netManagerial != null && Number.isFinite(netManagerial) ? netManagerial : null;
}

export function resolveSalesOrderMarginCostSourceSummary(
  itemMargins?: Array<Pick<SalesOrderItemMarginPayload, "costSource"> | null | undefined>,
  summary?: Pick<
    SalesOrderMarginSummaryPayload,
    "costSourceSummary" | "hasMissingCost" | "hasFrozenCost" | "hasEstimatedCost" | "hasMixedCost"
  > | null
): string {
  if (summary?.costSourceSummary) return summary.costSourceSummary;
  if (summary?.hasMixedCost) return SALES_ORDER_MARGIN_DISPLAY_LABELS.costMixed;
  if (summary?.hasFrozenCost) return SALES_ORDER_MARGIN_DISPLAY_LABELS.costFrozen;
  if (summary?.hasEstimatedCost) return SALES_ORDER_MARGIN_DISPLAY_LABELS.costEstimated;
  if (summary?.hasMissingCost) return "Custo indisponível";

  const frozenSources = new Set<SalesOrderCostSource>([
    "HISTORICAL_SNAPSHOT",
    "VERSIONED_PRODUCTION_COST",
  ]);
  const estimatedSources = new Set<SalesOrderCostSource>([
    "LIVE_PRODUCT_COST",
    "RECALCULATED_CURRENT_COST",
    "OFFICIAL_FINAL_COST",
    "CURRENT_ENGINEERING_COST",
    "CURRENT_COST",
    "MANUAL_COST",
  ]);

  let hasFrozen = false;
  let hasEstimated = false;
  let hasMissing = false;
  let hasLegacyNomusField = false;
  for (const row of itemMargins ?? []) {
    const source = row?.costSource;
    if (!source) continue;
    if (source === "SALES_ORDER_ITEM_SNAPSHOT") hasLegacyNomusField = true;
    else if (source === "MISSING_COST") hasMissing = true;
    else if (frozenSources.has(source)) hasFrozen = true;
    else if (estimatedSources.has(source)) hasEstimated = true;
  }
  if (hasLegacyNomusField) return SALES_ORDER_COST_SOURCE_LABEL.SALES_ORDER_ITEM_SNAPSHOT;
  if (hasMissing && !hasFrozen && !hasEstimated) return "Custo indisponível";
  if (hasFrozen && hasEstimated) return SALES_ORDER_MARGIN_DISPLAY_LABELS.costMixed;
  if (hasFrozen) return SALES_ORDER_MARGIN_DISPLAY_LABELS.costFrozen;
  if (hasEstimated) return SALES_ORDER_MARGIN_DISPLAY_LABELS.costEstimated;
  if ((itemMargins ?? []).some((row) => row?.costSource === "VERSIONED_PRODUCTION_COST")) {
    return "Custo de produção IndusCost (tabela vigente)";
  }
  return "Custo oficial resolvido";
}

function appendDeductFromGrossTaxTooltipLines(
  lines: string[],
  summary: Pick<
    SalesOrderMarginSummaryPayload,
    | "taxMode"
    | "fiscalConfigComplete"
    | "grossSalesAmount"
    | "totalSalesRevenueInScope"
    | "netRevenue"
    | "netSalesAmountAfterTax"
    | "taxAmount"
    | "taxRuleName"
    | "taxRulePercent"
  >,
  options?: { includeGrossSales?: boolean }
): void {
  const taxMode = summary.taxMode ?? "deductFromGross";
  if (taxMode !== "deductFromGross" || summary.fiscalConfigComplete === false) return;

  const grossSales =
    summary.grossSalesAmount ?? summary.totalSalesRevenueInScope ?? summary.netRevenue;
  const netManagerial = summary.netSalesAmountAfterTax ?? summary.netRevenue;
  const taxAmount =
    summary.taxAmount != null && Number.isFinite(summary.taxAmount)
      ? summary.taxAmount
      : Math.max(0, grossSales - netManagerial);
  const ruleLabel = summary.taxRuleName ?? "TaxRule configurada";
  const rulePercent =
    summary.taxRulePercent != null && Number.isFinite(summary.taxRulePercent)
      ? formatSalesOrderMarginPercent(summary.taxRulePercent)
      : "—";

  if (options?.includeGrossSales !== false) {
    lines.push(`${SALES_ORDER_MARGIN_DISPLAY_LABELS.grossSales}: ${formatSalesOrderMarginMoney(grossSales)}`);
  }
  lines.push(
    `${SALES_ORDER_MARGIN_DISPLAY_LABELS.taxEstimated} (dedução de imposto): ${formatSalesOrderMarginMoney(taxAmount)} — TaxRule ${ruleLabel} (${rulePercent})`
  );
  lines.push(
    `Receita líquida gerencial após impostos: ${formatSalesOrderMarginMoney(netManagerial)}`
  );
}

function buildSalesOrderMarginUnavailableTooltip(
  summary: SalesOrderMarginSummaryPayload | null | undefined
): string {
  const lines = [SALES_ORDER_MARGIN_DISPLAY_LABELS.unavailableTitle, "", "Motivo:"];
  if (!summary) {
    lines.push("• Margem não calculada para este pedido.");
    return lines.join("\n");
  }
  if (summary.taxMode === "deductFromGross" && summary.fiscalConfigComplete === false) {
    lines.push("• TaxRule não configurada ou inválida para margem gerencial.");
  }
  if (summary.costCoverageStatus === "NONE" && summary.itemsWithCost === 0) {
    lines.push("• Custo não resolvido para nenhuma linha do pedido.");
  }
  if (summary.hasInvalidRevenue && summary.validItemsCount === 0) {
    lines.push("• Sem receita válida no escopo.");
  }
  if (summary.hasMissingProduct) {
    lines.push("• Itens sem produto vinculado no IndusCost.");
  }
  if (lines.length === 3) {
    lines.push("• Dados insuficientes para calcular a margem.");
  }
  lines.push("");
  appendDeductFromGrossTaxTooltipLines(lines, summary);
  return lines.join("\n");
}

const COMMERCIAL_MARGIN_SOURCE_LABEL: Record<
  import("./salesOrderCommercialMargin.js").SalesOrderCommercialMarginSource,
  string
> = {
  EXACT_PROPOSAL_SNAPSHOT: "Snapshot da proposta vinculada",
  EXACT_PRICE_TABLE_VERSION: "Versão da tabela comercial vinculada",
  RECONSTRUCTED_AT_ORDER_DATE: "Reconstruída na data do pedido",
  UNAVAILABLE: "Formação não identificada",
};

/** Tooltip por item — detalha a margem comercial da formação. */
export function buildSalesOrderItemCommercialMarginTooltipText(
  commercial?: import("./salesOrderCommercialMargin.js").SalesOrderCommercialMarginItemPayload | null
): string {
  if (!commercial || !commercial.isComplete) {
    return [
      SALES_ORDER_MARGIN_DISPLAY_LABELS.unavailableTitle,
      "",
      "Não foi possível identificar a formação de preço utilizada nesta venda.",
      ...(commercial?.warnings ?? []).map((w) => `Aviso: ${w}`),
    ].join("\n");
  }

  return [
    SALES_ORDER_MARGIN_DISPLAY_LABELS.commercialTitle,
    "",
    `Preço praticado: ${formatSalesOrderMarginMoney(commercial.negotiatedUnitPrice)}`,
    `Valor vendido: ${formatSalesOrderMarginMoney(commercial.soldValue)}`,
    `Custo utilizado: ${formatSalesOrderMarginMoney(commercial.costValue)}`,
    `Imposto: ${formatSalesOrderMarginPercent((commercial.taxRate ?? 0) * 100)} (${formatSalesOrderMarginMoney(commercial.taxValue)})`,
    `Frete percentual: ${formatSalesOrderMarginPercent((commercial.freightRate ?? 0) * 100)} (${formatSalesOrderMarginMoney(commercial.freightRateValue)})`,
    `Frete absoluto: ${formatSalesOrderMarginMoney(commercial.freightAbsoluteValue)}`,
    `Comissão: ${formatSalesOrderMarginPercent((commercial.commissionRate ?? 0) * 100)} (${formatSalesOrderMarginMoney(commercial.commissionValue)})`,
    `Outras variáveis: ${formatSalesOrderMarginPercent((commercial.otherVariablesRate ?? 0) * 100)} (${formatSalesOrderMarginMoney(commercial.otherVariablesValue)})`,
    `Margem comercial R$: ${formatSalesOrderMarginMoney(commercial.commercialMarginValue)}`,
    `Margem comercial %: ${formatSalesOrderMarginPercent(commercial.commercialMarginPercent)}`,
    `Faixa inferior: ${commercial.lowerMarginBand ?? "—"} (${formatSalesOrderMarginMoney(commercial.lowerBandPrice)})`,
    `Faixa superior: ${commercial.upperMarginBand ?? "—"} (${formatSalesOrderMarginMoney(commercial.upperBandPrice)})`,
    `Versão da tabela: ${commercial.priceTableVersionId ?? "—"}`,
    `Origem do cálculo: ${COMMERCIAL_MARGIN_SOURCE_LABEL[commercial.calculationSource]}`,
    ...(commercial.warnings.length
      ? commercial.warnings.map((w) => `Aviso: ${w}`)
      : []),
  ].join("\n");
}

/** Tooltip oficial — prioriza margem comercial da venda; gerencial fica secundária. */
export function buildOfficialSalesOrderMarginTooltipText(
  input: SalesOrderMarginTooltipInput
): string {
  const { summary, itemMargins, orderIssueDate, titleOverride } = input;
  const commercial = summary?.commercialMargin;
  if (commercial) {
    const lines: string[] = [
      titleOverride?.trim() || SALES_ORDER_MARGIN_DISPLAY_LABELS.commercialTitle,
      "",
      "Margem calculada sobre o preço efetivamente vendido, usando custo, impostos, frete, comissão e demais variáveis da formação de preço.",
      "",
      `Valor vendido (itens calculados): ${formatSalesOrderMarginMoney(commercial.commercialSoldTotalValue)}`,
      `Margem comercial R$: ${formatSalesOrderMarginMoney(commercial.commercialMarginTotalValue)}`,
      `Margem comercial %: ${formatSalesOrderMarginPercent(commercial.commercialMarginTotalPercent)}`,
      `Cobertura: ${formatSalesOrderMarginPercent(commercial.commercialMarginCoveragePercent)} do valor ativo`,
      `Itens calculados: ${commercial.itemsCalculated} de ${commercial.itemsActive}`,
    ];
    if (!commercial.isComplete) {
      lines.push("Status: parcial — nem todos os itens possuem formação identificada.");
    }
    for (const warning of commercial.warnings.slice(0, 4)) {
      lines.push(`Aviso: ${warning}`);
    }
    if (summary && summary.marginPercent != null) {
      lines.push("");
      lines.push(SALES_ORDER_MARGIN_DISPLAY_LABELS.managerialTitle);
      lines.push(
        `${SALES_ORDER_MARGIN_DISPLAY_LABELS.managerialMarginPercent}: ${formatSalesOrderMarginPercent(summary.marginPercent)}`
      );
      lines.push(
        `${SALES_ORDER_MARGIN_DISPLAY_LABELS.managerialMarginValue}: ${formatSalesOrderMarginMoney(summary.marginValue)}`
      );
    }
    if (orderIssueDate) {
      lines.push(`Data do pedido: ${formatCivilDatePtBr(orderIssueDate)}`);
    }
    return lines.join("\n");
  }

  if (!summary || isSalesOrderMarginDisplayUnavailable(summary)) {
    return buildSalesOrderMarginUnavailableTooltip(summary);
  }

  const taxMode = summary.taxMode ?? "deductFromGross";
  const isPartial = summary.costCoverageStatus === "PARTIAL";
  const isSemCusto =
    summary.status === "SEM_CUSTO" ||
    (summary.costCoverageStatus === "NONE" && (summary.itemsWithCost ?? 0) === 0);
  const hasUnresolvedCost =
    isSemCusto ||
    summary.hasMissingCost ||
    (itemMargins ?? []).some((row) => row?.costSource === "MISSING_COST");
  const grossSales =
    summary.grossSalesAmount ?? summary.totalSalesRevenueInScope ?? summary.netRevenue;
  const netManagerial = summary.netSalesAmountAfterTax ?? summary.netRevenue;
  const costLabel = hasUnresolvedCost
    ? "Custo de produção não resolvido"
    : resolveSalesOrderMarginCostSourceSummary(itemMargins, summary);

  const title = hasUnresolvedCost
    ? SALES_ORDER_MARGIN_DISPLAY_LABELS.unavailableTitle
    : isPartial
      ? SALES_ORDER_MARGIN_DISPLAY_LABELS.partialTitle
      : taxMode === "none"
        ? SALES_ORDER_MARGIN_DISPLAY_LABELS.soldTitle
        : SALES_ORDER_MARGIN_DISPLAY_LABELS.managerialTitle;

  const lines: string[] = [titleOverride?.trim() || title, ""];

  if (hasUnresolvedCost) {
    lines.push("Custo de produção não resolvido para um ou mais itens.");
    lines.push("A margem abaixo não deve ser interpretada como oficial.");
    lines.push("");
  }

  lines.push(`${SALES_ORDER_MARGIN_DISPLAY_LABELS.grossSales}: ${formatSalesOrderMarginMoney(grossSales)}`);

  if (taxMode === "deductFromGross") {
    appendDeductFromGrossTaxTooltipLines(lines, summary, { includeGrossSales: false });
  } else {
    lines.push("Imposto: não deduzido neste modo");
  }

  if (hasUnresolvedCost) {
    lines.push(`${SALES_ORDER_MARGIN_DISPLAY_LABELS.cost}: Custo não resolvido`);
    lines.push(`${SALES_ORDER_MARGIN_DISPLAY_LABELS.costSource}: —`);
  } else {
    lines.push(
      `${SALES_ORDER_MARGIN_DISPLAY_LABELS.cost}: ${formatSalesOrderMarginMoney(summary.totalCost)} — ${costLabel}`
    );
    lines.push(`${SALES_ORDER_MARGIN_DISPLAY_LABELS.costSource}: Tabela de custo vigente`);
    lines.push(
      `${SALES_ORDER_MARGIN_DISPLAY_LABELS.productionTotalCost}: ${formatSalesOrderMarginMoney(summary.totalCost)}`
    );
  }

  const versionedItems = (itemMargins ?? []).filter(
    (row) => row?.costSource === "VERSIONED_PRODUCTION_COST" && row.unitCost != null
  );
  if (!hasUnresolvedCost && versionedItems.length === 1 && versionedItems[0]?.unitCost != null) {
    lines.push(
      `${SALES_ORDER_MARGIN_DISPLAY_LABELS.productionUnitCost}: ${formatSalesOrderMarginMoney(versionedItems[0].unitCost)}`
    );
  }

  const productionMetaLines = pickProductionCostTooltipLines(itemMargins);
  for (const extra of productionMetaLines) {
    lines.push(extra);
  }
  if (
    orderIssueDate &&
    !productionMetaLines.some((l) => l.startsWith("Data do pedido"))
  ) {
    lines.push(`Data do pedido: ${formatCivilDatePtBr(orderIssueDate)}`);
  }

  if (!hasUnresolvedCost) {
    lines.push(
      `${SALES_ORDER_MARGIN_DISPLAY_LABELS.managerialMarginValue}: ${formatSalesOrderMarginMoney(summary.marginValue)}`
    );

    const percentDenominator = taxMode === "none" ? grossSales : netManagerial;
    if (percentDenominator > 0 && summary.marginPercent != null) {
      lines.push(
        `${SALES_ORDER_MARGIN_DISPLAY_LABELS.managerialMarginPercent}: ${formatSalesOrderMarginMoney(summary.marginValue)} ÷ ${formatSalesOrderMarginMoney(percentDenominator)} = ${formatSalesOrderMarginPercent(summary.marginPercent)}`
      );
    } else {
      lines.push(`${SALES_ORDER_MARGIN_DISPLAY_LABELS.managerialMarginPercent}: —`);
    }
  } else {
    lines.push(`${SALES_ORDER_MARGIN_DISPLAY_LABELS.managerialMarginValue}: —`);
    lines.push(`${SALES_ORDER_MARGIN_DISPLAY_LABELS.managerialMarginPercent}: —`);
  }

  lines.push(`${SALES_ORDER_MARGIN_DISPLAY_LABELS.coverage}: ${summary.costCoverageStatus ?? "—"}`);
  lines.push(`${SALES_ORDER_MARGIN_DISPLAY_LABELS.itemsWithCost}: ${summary.itemsWithCost ?? 0}`);
  lines.push(`${SALES_ORDER_MARGIN_DISPLAY_LABELS.itemsWithoutCost}: ${summary.itemsWithoutCost ?? 0}`);

  if ((summary.itemsWithoutCost ?? 0) > 0 || hasUnresolvedCost) {
    lines.push("Itens sem custo: linhas SEM_CUSTO — não entram na margem agregada.");
  }

  if (isPartial && !hasUnresolvedCost) {
    lines.push("");
    lines.push(`Receita coberta: ${formatSalesOrderMarginMoney(summary.marginRevenueCovered)}`);
    lines.push(`Receita descoberta: ${formatSalesOrderMarginMoney(summary.marginRevenueUncovered)}`);
    lines.push(
      "Parte da venda não entrou na margem por falta de custo resolvido."
    );
  }

  return lines.join("\n");
}

/** Alias retrocompatível — preferir buildOfficialSalesOrderMarginTooltipText. */
export function buildSalesOrderMarginTooltipText(
  summary: SalesOrderMarginSummaryPayload | null | undefined,
  itemMargins?: SalesOrderMarginTooltipInput["itemMargins"]
): string {
  return buildOfficialSalesOrderMarginTooltipText({ summary, itemMargins });
}

type SalesOrderResultTotalsForTooltip = {
  salesAmount: number;
  taxAmount: number;
  netSalesAmount: number;
  costAmount: number;
  marginAmount: number;
  marginPercent: number | null;
  itemsCount: number;
  missingCostCount: number;
  taxPercentApplied: number;
  taxSourceLabel: string;
};

/** Monta tooltip oficial a partir dos totais da aba Resultado de Pedidos. */
export function buildSalesOrderResultTotalsMarginTooltipText(
  totals: SalesOrderResultTotalsForTooltip,
  warnings?: { missingCostCount?: number } | null
): string {
  const itemsWithoutCost = warnings?.missingCostCount ?? totals.missingCostCount;
  const itemsWithCost = Math.max(0, totals.itemsCount - itemsWithoutCost);
  let costCoverageStatus: SalesOrderMarginSummaryPayload["costCoverageStatus"] = "FULL";
  if (itemsWithCost === 0) costCoverageStatus = "NONE";
  else if (itemsWithoutCost > 0) costCoverageStatus = "PARTIAL";

  return buildOfficialSalesOrderMarginTooltipText({
    summary: {
      netRevenue: totals.netSalesAmount,
      totalCost: totals.costAmount,
      marginValue: totals.marginAmount,
      marginPercent: totals.marginPercent,
      markup: totals.costAmount > 0 ? totals.netSalesAmount / totals.costAmount : null,
      itemsCount: totals.itemsCount,
      validItemsCount: itemsWithCost,
      ignoredItemsCount: 0,
      hasMissingCost: itemsWithoutCost > 0,
      hasMissingProduct: false,
      hasNegativeMargin: false,
      hasInvalidRevenue: false,
      status: itemsWithoutCost > 0 ? "PARTIAL" : "OK",
      statusLabel: "Calculada",
      statusSeverity: "success",
      taxMode: "deductFromGross",
      grossSalesAmount: totals.salesAmount,
      taxAmount: totals.taxAmount,
      netSalesAmountAfterTax: totals.netSalesAmount,
      taxRuleName: totals.taxSourceLabel,
      taxRulePercent: totals.taxPercentApplied,
      fiscalConfigComplete: true,
      totalSalesRevenueInScope: totals.salesAmount,
      marginRevenueCovered: totals.netSalesAmount,
      marginRevenueUncovered: 0,
      marginCoveragePercent: 100,
      itemsTotal: totals.itemsCount,
      itemsWithCost,
      itemsWithoutCost,
      costCoverageStatus,
    },
  });
}

/**
 * Consolida margens de pedidos com percentual ponderado por receita (não média simples).
 * Usa apenas valores já calculados no backend.
 */
export function aggregateSalesOrderMarginSummaries(
  summaries: SalesOrderMarginSummaryPayload[]
): SalesOrderMarginSummaryPayload | undefined {
  if (summaries.length === 0) return undefined;

  const netRevenue = summaries.reduce((sum, row) => sum + row.netRevenue, 0);
  const totalCost = summaries.reduce((sum, row) => sum + row.totalCost, 0);
  const marginValue = summaries.reduce((sum, row) => {
    if (row.marginValue == null || !Number.isFinite(row.marginValue)) return sum;
    return sum + row.marginValue;
  }, 0);
  const hasCalculableMargin = summaries.some(
    (row) => row.marginValue != null && Number.isFinite(row.marginValue)
  );
  const itemsCount = summaries.reduce((sum, row) => sum + row.itemsCount, 0);
  const validItemsCount = summaries.reduce((sum, row) => sum + row.validItemsCount, 0);
  const ignoredItemsCount = summaries.reduce((sum, row) => sum + row.ignoredItemsCount, 0);

  const flags = {
    hasMissingCost: summaries.some((row) => row.hasMissingCost),
    hasMissingProduct: summaries.some((row) => row.hasMissingProduct),
    hasNegativeMargin: summaries.some((row) => row.hasNegativeMargin),
    hasInvalidRevenue: summaries.some((row) => row.hasInvalidRevenue),
  };

  const marginPercent =
    hasCalculableMargin && netRevenue > 0
      ? (marginValue / netRevenue) * 100
      : null;
  const markup = totalCost > 0 && hasCalculableMargin ? netRevenue / totalCost : null;

  let status: SalesOrderMarginSummaryPayload["status"] = "OK";
  if (validItemsCount === 0) {
    if (flags.hasInvalidRevenue) status = "REVISAR_DADOS";
    else if (flags.hasMissingProduct && !flags.hasMissingCost) status = "SEM_PRODUTO_VINCULADO";
    else if (flags.hasMissingCost && !flags.hasMissingProduct) status = "SEM_CUSTO";
    else if (flags.hasMissingCost || flags.hasMissingProduct) status = "PARTIAL";
    else status = "REVISAR_DADOS";
  } else if (flags.hasMissingCost || flags.hasMissingProduct || flags.hasInvalidRevenue) {
    status = "PARTIAL";
  } else if (flags.hasNegativeMargin) {
    status = "MARGEM_NEGATIVA";
  }

  const meta = resolveSalesOrderMarginSummaryStatusMeta(status);
  const coverage = mergeSalesOrderMarginCoveragePayloads(
    summaries.map((row) => ({
      totalSalesRevenueInScope: row.totalSalesRevenueInScope,
      marginRevenueCovered: row.marginRevenueCovered,
      marginRevenueUncovered: row.marginRevenueUncovered,
      marginCoveragePercent: row.marginCoveragePercent,
      itemsTotal: row.itemsTotal,
      itemsWithCost: row.itemsWithCost,
      itemsWithoutCost: row.itemsWithoutCost,
      costCoverageStatus: row.costCoverageStatus,
    }))
  );

  const grossSalesAmount = summaries.reduce(
    (sum, row) => sum + (row.grossSalesAmount ?? row.totalSalesRevenueInScope ?? 0),
    0
  );
  const taxAmount = summaries.reduce((sum, row) => sum + (row.taxAmount ?? 0), 0);
  const firstFiscal = summaries.find((row) => row.taxMode != null) ?? summaries[0];
  const hasFrozenCost = summaries.some((row) => row.hasFrozenCost);
  const hasEstimatedCost = summaries.some((row) => row.hasEstimatedCost);
  const hasMixedCost = hasFrozenCost && hasEstimatedCost;
  let costSourceSummary = "Custo oficial resolvido";
  if (hasMixedCost) costSourceSummary = "Custo misto";
  else if (hasFrozenCost) costSourceSummary = "Custo histórico congelado";
  else if (hasEstimatedCost) costSourceSummary = "Custo estimado atual";

  return {
    netRevenue,
    totalCost,
    marginValue: hasCalculableMargin ? marginValue : null,
    marginPercent,
    markup,
    itemsCount,
    validItemsCount,
    ignoredItemsCount,
    ...flags,
    status,
    statusLabel: meta.statusLabel,
    statusSeverity: meta.statusSeverity,
    taxMode: firstFiscal?.taxMode,
    grossSalesAmount,
    taxAmount,
    netSalesAmountAfterTax: netRevenue,
    taxRuleId: firstFiscal?.taxRuleId ?? null,
    taxRuleName: firstFiscal?.taxRuleName ?? null,
    taxRulePercent: firstFiscal?.taxRulePercent ?? null,
    fiscalConfigComplete: summaries.every((row) => row.fiscalConfigComplete !== false),
    costSourceSummary,
    hasFrozenCost,
    hasEstimatedCost,
    hasMixedCost,
    ...coverage,
  };
}
