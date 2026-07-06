import {
  amortizationMetricsAreFinite,
  amortizationStatusLabel,
  buildProjectAmortizationTargets,
  buildProjectCostAmortizationSummary,
  listAmortizableCostSources,
  resolveMoldTotalCost,
  roundProjectMoney,
  type ProjectCostAmortizationRow,
  type ProjectCostAmortizationSummary,
  type ProjectCostAmortizationTargetType,
} from "./projectsCostAmortization.js";
import { buildProjectGuidedItems, computeProjectGuidedCosts } from "./projectsGuidedFlow.js";
import { buildProjectCostSnapshot, resolveProjectCostFinalUnitPrice } from "./projectsCostSnapshot.js";
import {
  findOtherCostBatchItems,
  loadOtherCostBatchLines,
  OTHER_COST_GROUP_LABEL,
  parseOtherCostMeta,
  parseOtherCostUserNotes,
  resolveOtherCostItemLineTotal,
} from "./projectsOtherCostGroups.js";
import { formatMoldDescriptionForDisplay } from "./projectsMoldCostLines.js";
import type { ProjectDetail, ProjectStatus, ProjectType } from "@/src/types/projects.js";

export const PROJECT_EXECUTIVE_REPORT_VERSION = "1.0";
export const PROJECT_EXECUTIVE_REPORT_TITLE = "Relatório Gerencial de Projeto";
export const PROJECT_EXECUTIVE_REPORT_BUTTON_LABEL = "Gerar relatório gerencial";
export const PROJECT_EXECUTIVE_REPORT_ROUTE_SUFFIX = "report";
export const PROJECT_EXECUTIVE_REPORT_DEFAULT_SCOPE =
  "Projeto técnico/comercial para estimativa de custos, investimentos, amortização e viabilidade de fornecimento.";
export const PROJECT_EXECUTIVE_REPORT_NOT_INFORMED = "Não informado";
export const PROJECT_EXECUTIVE_REPORT_TECHNICAL_ANNEX_MESSAGE =
  "Anexo técnico disponível em próxima versão.";

export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  NEW_PRODUCT: "Novo produto",
  NEW_COMPONENT: "Novo componente",
  MOLD: "Molde",
  PRODUCT_CHANGE: "Alteração de produto",
  PRODUCT_WITH_NEW_COMPONENT: "Produto com componente novo",
  FULL_DEVELOPMENT: "Desenvolvimento completo",
  QUICK_ESTIMATE: "Estimativa rápida",
};

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  DRAFT: "Rascunho",
  TECHNICAL_ANALYSIS: "Análise técnica",
  WAITING_QUOTATION: "Aguardando cotação",
  WAITING_INTERNAL_APPROVAL: "Aguardando aprovação interna",
  SENT_TO_CUSTOMER: "Enviado ao cliente",
  NEGOTIATION: "Negociação",
  APPROVED: "Aprovado",
  REJECTED: "Rejeitado",
  CANCELLED: "Cancelado",
  CONVERTED: "Convertido",
};

export type ProjectExecutiveReportItemStatus =
  | "OK"
  | "NO_COST"
  | "PENDING"
  | "WITH_AMORTIZATION"
  | "INCOMPLETE_AMORTIZATION";

export type ProjectExecutiveReportAlertCode =
  | "NO_CUSTOMER"
  | "NO_COMMERCIAL_OWNER"
  | "ITEM_NO_COST"
  | "MOLD_NO_AMORTIZATION"
  | "OTHER_COST_NO_AMORTIZATION"
  | "INCOMPLETE_AMORTIZATION"
  | "ABSORBED_VALUE"
  | "PRICE_MARGIN_UNDEFINED";

export type ProjectExecutiveReportPayload = {
  generatedAt: string;
  reportVersion: string;
  project: {
    id: string;
    code: string;
    name: string;
    customerName: string;
    status: ProjectStatus;
    statusLabel: string;
    type: ProjectType;
    typeLabel: string;
    commercialOwner: string | null;
    technicalOwner: string | null;
    versionLabel: string;
    createdAt: string;
    updatedAt: string;
  };
  scope: {
    objective: string;
    summary: string;
    notes: string | null;
  };
  executiveSummary: {
    baseItemsCost: number;
    moldsTotal: number;
    otherCostsTotal: number;
    investmentTotal: number;
    amortizedToCustomer: number;
    absorbedInternally: number;
    finalItemsCost: number;
    totalProjectCost: number;
    pendingItemsCount: number;
    totalAmortizationAllocated: number;
    totalUnallocatedAmortization: number;
    overallAmortizationStatus: string;
  };
  decision: {
    text: string;
    warnings: string[];
  };
  items: Array<{
    id: string;
    name: string;
    typeLabel: string;
    originLabel: string;
    baseUnitCost: number;
    unitAmortizedCost: number;
    finalUnitCost: number;
    baseQuantity: number;
    estimatedTotalCost: number;
    status: ProjectExecutiveReportItemStatus;
    statusLabel: string;
  }>;
  molds: Array<{
    id: string;
    name: string;
    statusLabel: string;
    description: string;
    totalCost: number;
    passThroughPercent: number;
    passThroughAmount: number;
    absorbedAmount: number;
    amortizationStatus: string;
    impactedItems: string[];
  }>;
  otherCosts: Array<{
    batchId: string;
    description: string;
    groupLabel: string;
    supplierName: string | null;
    totalCost: number;
    passThroughPercent: number;
    passThroughAmount: number;
    absorbedAmount: number;
    amortizationStatus: string;
    notes: string | null;
  }>;
  amortizationMemory: Array<{
    sourceLabel: string;
    sourceTypeLabel: string;
    targetItemLabel: string;
    passThroughPercent: number;
    allocationPercent: number;
    allocatedAmount: number;
    amortizationQuantity: number;
    unitAmortizedCost: number;
  }>;
  economicAnalysis: {
    pending: boolean;
    message: string;
    finalUnitCost: number | null;
    suggestedPrice: number | null;
    estimatedMarginPercent: number | null;
    estimatedRevenue: number | null;
    estimatedGrossProfit: number | null;
    amortizationBaseQuantity: number | null;
    fiscalRuleName: string | null;
    taxPercent: number | null;
    taxAmount: number | null;
    marginAmount: number | null;
    pricingItems: Array<{
      displayName: string;
      finalUnitCost: number;
      suggestedPrice: number;
      taxPercent: number;
      targetMarginPercent: number;
      taxAmount: number | null;
      marginAmount: number | null;
      fiscalRuleName: string | null;
    }>;
  };
  risks: {
    technicalRisks: string[];
    commercialRisks: string[];
    notes: string | null;
    automaticAlerts: string[];
  };
  alerts: Array<{
    code: ProjectExecutiveReportAlertCode;
    message: string;
  }>;
  approval: {
    preparedBy: string;
    reviewedBy: string;
    approvedBy: string;
  };
  technicalAnnex: {
    enabled: boolean;
    message: string;
  };
};

const ITEM_STATUS_LABEL: Record<ProjectExecutiveReportItemStatus, string> = {
  OK: "OK",
  NO_COST: "Sem custo",
  PENDING: "Pendente",
  WITH_AMORTIZATION: "Com amortização",
  INCOMPLETE_AMORTIZATION: "Amortização incompleta",
};

function targetTypeLabel(type: ProjectCostAmortizationTargetType): string {
  switch (type) {
    case "OFFICIAL_PRODUCT":
      return "Produto oficial";
    case "OFFICIAL_COMPONENT":
      return "Componente oficial";
    case "SIMULATION":
      return "Produto simulado";
    default:
      return "Item legado";
  }
}

function sourceTypeLabel(sourceType: "MOLD" | "OTHER_COST"): string {
  return sourceType === "MOLD" ? "Molde" : "Outro custo";
}

function resolveOverallAmortizationStatus(
  amortizations: ProjectCostAmortizationSummary["amortizations"]
): string {
  if (amortizations.length === 0) return "Não configurado";
  const statuses = amortizations.map((a) => a.status);
  if (statuses.some((s) => s === "EXCESS")) return "Distribuição excedente";
  if (statuses.some((s) => s === "INCOMPLETE")) return "Distribuição incompleta";
  if (statuses.every((s) => s === "DISTRIBUTED")) return "Distribuído 100%";
  if (statuses.every((s) => s === "NOT_CONFIGURED")) return "Não configurado";
  if (statuses.some((s) => s === "NO_ELIGIBLE_ITEMS")) return "Sem itens elegíveis";
  return "Distribuição incompleta";
}

function resolveItemStatus(
  baseUnitCost: number,
  unitAmortizedCost: number,
  hasIncompleteAmortization: boolean,
  guidedPending: boolean
): ProjectExecutiveReportItemStatus {
  if (guidedPending || baseUnitCost <= 0) {
    return baseUnitCost <= 0 ? "NO_COST" : "PENDING";
  }
  if (hasIncompleteAmortization) return "INCOMPLETE_AMORTIZATION";
  if (unitAmortizedCost > 0) return "WITH_AMORTIZATION";
  return "OK";
}

function resolveCostSummary(detail: ProjectDetail): ProjectCostAmortizationSummary {
  if (detail.costAmortizationSummary) {
    return detail.costAmortizationSummary as ProjectCostAmortizationSummary;
  }
  const saved = (detail.costAmortizations ?? []) as ProjectCostAmortizationRow[];
  return buildProjectCostAmortizationSummary(detail, saved);
}

export function formatExecutiveReportMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatExecutiveReportPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

export function formatExecutiveReportDate(value: string | Date | null | undefined): string {
  if (!value) return PROJECT_EXECUTIVE_REPORT_NOT_INFORMED;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return PROJECT_EXECUTIVE_REPORT_NOT_INFORMED;
  return parsed.toLocaleDateString("pt-BR");
}

export function getProjectExecutiveReportPath(projectId: string): string {
  return `/projects/${projectId}/${PROJECT_EXECUTIVE_REPORT_ROUTE_SUFFIX}`;
}

export function isProjectExecutiveReportPath(pathname: string): boolean {
  const parts = pathname.replace(/^\//, "").split("/").filter(Boolean);
  return parts[0] === "projects" && !!parts[1] && parts[2] === PROJECT_EXECUTIVE_REPORT_ROUTE_SUFFIX;
}

export function buildProjectExecutiveReport(
  detail: ProjectDetail,
  options?: { generatedAt?: Date }
): ProjectExecutiveReportPayload {
  const generatedAt = (options?.generatedAt ?? new Date()).toISOString();
  const costSnapshot = buildProjectCostSnapshot(detail, { generatedAt: new Date(generatedAt) });
  const summary = costSnapshot.costAmortizationSummary;
  const guided = costSnapshot.guidedCosts;
  const targets = buildProjectAmortizationTargets(detail);
  const guidedItems = buildProjectGuidedItems(detail);
  const guidedById = new Map(guidedItems.map((row) => [row.id, row]));
  const rollupById = new Map(summary.itemRollups.map((row) => [row.targetItemId, row]));
  const amortBySource = new Map(
    summary.amortizations.map((row) => [`${row.sourceType}:${row.sourceId}`, row])
  );

  const incompleteSources = summary.amortizations.filter(
    (row) => row.status === "INCOMPLETE" || row.status === "EXCESS" || row.status === "NOT_CONFIGURED"
  );

  const items = targets
    .filter((target) => {
      const guidedItem = guidedById.get(target.targetItemId);
      return guidedItem?.itemType !== "RAW_MATERIAL";
    })
    .map((target) => {
    const rollup = rollupById.get(target.targetItemId);
    const guidedItem = guidedById.get(target.targetItemId);
    const baseUnitCost = rollup?.baseUnitCost ?? target.baseUnitCost;
    const unitAmortizedCost = rollup?.unitAmortizedCost ?? 0;
    const finalUnitCost = rollup?.finalUnitCost ?? baseUnitCost;
    const baseQuantity = target.suggestedQuantity;
    const estimatedTotalCost = roundProjectMoney(finalUnitCost * baseQuantity);
    const itemIncomplete = incompleteSources.some((source) =>
      source.allocations.some((alloc) => alloc.targetItemId === target.targetItemId)
    );
    const status = resolveItemStatus(
      baseUnitCost,
      unitAmortizedCost,
      itemIncomplete,
      guidedItem?.status === "PENDING_COST"
    );
    return {
      id: target.targetItemId,
      name: target.displayName,
      typeLabel: targetTypeLabel(target.targetItemType),
      originLabel: guidedItem?.originLabel ?? PROJECT_EXECUTIVE_REPORT_NOT_INFORMED,
      baseUnitCost,
      unitAmortizedCost,
      finalUnitCost,
      baseQuantity,
      estimatedTotalCost,
      status,
      statusLabel: ITEM_STATUS_LABEL[status],
    };
  });

  const molds = detail.molds.map((mold) => {
    const amort = amortBySource.get(`MOLD:${mold.id}`);
    const impactedItems =
      amort?.allocations.map((row) => row.targetDescriptionSnapshot).filter(Boolean) ?? [];
    return {
      id: mold.id,
      name: mold.name,
      statusLabel: guidedById.get(mold.id)?.statusLabel ?? PROJECT_EXECUTIVE_REPORT_NOT_INFORMED,
      description: formatMoldDescriptionForDisplay(
        mold.notes,
        mold.moldType,
        PROJECT_EXECUTIVE_REPORT_NOT_INFORMED
      ),
      totalCost: resolveMoldTotalCost(mold),
      passThroughPercent: amort?.passThroughPercent ?? 100,
      passThroughAmount: amort?.passThroughAmount ?? resolveMoldTotalCost(mold),
      absorbedAmount: amort?.absorbedAmount ?? 0,
      amortizationStatus: amortizationStatusLabel(amort?.status ?? "NOT_CONFIGURED"),
      impactedItems,
    };
  });

  const otherCosts = listAmortizableCostSources(detail)
    .filter((source) => source.sourceType === "OTHER_COST")
    .map((source) => {
      const batchItems = findOtherCostBatchItems(detail.simulatedItems, source.sourceId);
      const meta = parseOtherCostMeta(batchItems[0]?.notes);
      const groupLabel = OTHER_COST_GROUP_LABEL[meta.group];
      const lines = loadOtherCostBatchLines(detail.simulatedItems, source.sourceId);
      const supplierName = lines.find((line) => line.supplierName)?.supplierName ?? null;
      const notes =
        parseOtherCostUserNotes(batchItems[0]?.notes) ??
        batchItems.map((item) => item.description).join("; ");
      const amort = amortBySource.get(`OTHER_COST:${source.sourceId}`);
      return {
        batchId: source.sourceId,
        description: source.description,
        groupLabel,
        supplierName,
        totalCost: roundProjectMoney(
          batchItems.reduce((acc, item) => acc + resolveOtherCostItemLineTotal(item), 0)
        ),
        passThroughPercent: amort?.passThroughPercent ?? 100,
        passThroughAmount: amort?.passThroughAmount ?? source.totalCost,
        absorbedAmount: amort?.absorbedAmount ?? 0,
        amortizationStatus: amortizationStatusLabel(amort?.status ?? "NOT_CONFIGURED"),
        notes: notes || null,
      };
    });

  const amortizationMemory = summary.amortizations.flatMap((source) =>
    source.allocations.map((alloc) => ({
      sourceLabel: source.sourceDescriptionSnapshot,
      sourceTypeLabel: sourceTypeLabel(source.sourceType),
      targetItemLabel: alloc.targetDescriptionSnapshot,
      passThroughPercent: source.passThroughPercent,
      allocationPercent: alloc.allocationPercent,
      allocatedAmount: alloc.allocatedAmount,
      amortizationQuantity: alloc.amortizationQuantity,
      unitAmortizedCost: alloc.unitAmortizedCost,
    }))
  );

  const totalUnallocatedAmortization = roundProjectMoney(
    summary.amortizations.reduce((acc, row) => acc + row.unallocatedAmount, 0)
  );

  const investmentTotal = roundProjectMoney(summary.totalMoldsCost + summary.totalOtherCosts);
  const reportBaseItemsCost = roundProjectMoney(
    items.reduce((acc, item) => acc + item.baseUnitCost, 0)
  );
  const reportFinalItemsCost = roundProjectMoney(
    items.reduce((acc, item) => acc + item.finalUnitCost, 0)
  );

  const alerts: ProjectExecutiveReportPayload["alerts"] = [];
  if (!detail.customerName?.trim()) {
    alerts.push({ code: "NO_CUSTOMER", message: "Projeto sem cliente." });
  }
  if (!detail.commercialOwner?.trim()) {
    alerts.push({ code: "NO_COMMERCIAL_OWNER", message: "Projeto sem responsável comercial." });
  }
  for (const item of items) {
    if (item.status === "NO_COST" || item.status === "PENDING") {
      alerts.push({
        code: "ITEM_NO_COST",
        message: `Item sem custo: ${item.name}.`,
      });
    }
  }
  for (const amort of summary.amortizations) {
    if (amort.sourceType === "MOLD" && amort.status === "NOT_CONFIGURED") {
      alerts.push({
        code: "MOLD_NO_AMORTIZATION",
        message: `Molde sem amortização configurada: ${amort.sourceDescriptionSnapshot}.`,
      });
    }
    if (amort.sourceType === "OTHER_COST" && amort.status === "NOT_CONFIGURED") {
      alerts.push({
        code: "OTHER_COST_NO_AMORTIZATION",
        message: `Outro custo sem amortização configurada: ${amort.sourceDescriptionSnapshot}.`,
      });
    }
    if (amort.status === "INCOMPLETE" || amort.status === "EXCESS") {
      alerts.push({
        code: "INCOMPLETE_AMORTIZATION",
        message: `Distribuição de amortização incompleta: ${amort.sourceDescriptionSnapshot}.`,
      });
    }
  }
  if (summary.totalAbsorbedAmount > 0) {
    alerts.push({
      code: "ABSORBED_VALUE",
      message: "Valor absorvido internamente maior que zero.",
    });
  }
  const savedPricing = costSnapshot.pricing.view;
  const commercialSummary = costSnapshot.pricing.commercialSummary;
  const hasSavedProjectPricing = savedPricing.hasSavedPricing === true;
  const calculatedPricingItems = savedPricing.items.filter(
    (item) => resolveProjectCostFinalUnitPrice(item) != null
  );
  const pricingPrimary = calculatedPricingItems[0] ?? null;

  if (!hasSavedProjectPricing && calculatedPricingItems.length === 0) {
    alerts.push({
      code: "PRICE_MARGIN_UNDEFINED",
      message: "Preço/margem não definidos.",
    });
  }

  const decisionWarnings: string[] = [];
  if (guided.pendingCount > 0) {
    decisionWarnings.push("Projeto pendente de revisão de custos antes da aprovação final.");
  }
  if (
    summary.amortizations.some(
      (row) => row.status === "INCOMPLETE" || row.status === "EXCESS" || row.status === "NOT_CONFIGURED"
    )
  ) {
    decisionWarnings.push(
      "Projeto possui amortizações incompletas que precisam ser revisadas antes da aprovação comercial."
    );
  }

  const decisionText = `Aprovar o projeto considerando investimento total de ${formatExecutiveReportMoney(
    investmentTotal
  )}, sendo ${formatExecutiveReportMoney(summary.totalPassThroughAmount)} repassados ao cliente via amortização e ${formatExecutiveReportMoney(
    summary.totalAbsorbedAmount
  )} absorvidos internamente pela empresa.`;

  const finalUnitCost =
    commercialSummary.averageFinalUnitCost ??
    pricingPrimary?.finalUnitCost ??
    summary.finalItemsUnitCostWithAmortization;
  const economicPending = costSnapshot.totals.pricingPending || !hasSavedProjectPricing;
  const reportSuggestedPrice = costSnapshot.totals.finalSetPrice;
  const estimatedMarginPercent =
    commercialSummary.hasMultipleMargins
      ? null
      : pricingPrimary?.targetMarginPercent ??
        savedPricing.config.defaultMarginPercent ??
        null;
  const amortizationBaseQuantity =
    amortizationMemory.length > 0
      ? Math.max(...amortizationMemory.map((row) => row.amortizationQuantity))
      : null;

  const pricingItems = calculatedPricingItems.map((item) => ({
    displayName: item.displayName,
    finalUnitCost: item.finalUnitCost,
    suggestedPrice: resolveProjectCostFinalUnitPrice(item)!,
    taxPercent: item.taxPercent,
    targetMarginPercent: item.targetMarginPercent,
    taxAmount: item.taxAmount,
    marginAmount: item.marginAmount,
    fiscalRuleName: item.fiscalRuleName,
  }));

  const versionLabel = detail.currentVersion
    ? `v${detail.currentVersion.versionNumber}`
    : PROJECT_EXECUTIVE_REPORT_NOT_INFORMED;

  return {
    generatedAt,
    reportVersion: PROJECT_EXECUTIVE_REPORT_VERSION,
    project: {
      id: detail.id,
      code: detail.code,
      name: detail.title,
      customerName: detail.customerName?.trim() || PROJECT_EXECUTIVE_REPORT_NOT_INFORMED,
      status: detail.status,
      statusLabel: PROJECT_STATUS_LABEL[detail.status],
      type: detail.projectType,
      typeLabel: PROJECT_TYPE_LABEL[detail.projectType],
      commercialOwner: detail.commercialOwner?.trim() || null,
      technicalOwner: detail.technicalOwner?.trim() || null,
      versionLabel,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
    },
    scope: {
      objective: detail.description?.trim() || PROJECT_EXECUTIVE_REPORT_DEFAULT_SCOPE,
      summary: detail.description?.trim() || PROJECT_EXECUTIVE_REPORT_DEFAULT_SCOPE,
      notes: detail.notes?.trim() || null,
    },
    executiveSummary: {
      baseItemsCost: reportBaseItemsCost,
      moldsTotal: summary.totalMoldsCost,
      otherCostsTotal: summary.totalOtherCosts,
      investmentTotal,
      amortizedToCustomer: summary.totalPassThroughAmount,
      absorbedInternally: summary.totalAbsorbedAmount,
      finalItemsCost: reportFinalItemsCost,
      totalProjectCost: guided.totalProjectCost,
      pendingItemsCount: guided.pendingCount,
      totalAmortizationAllocated: summary.totalAmortizationAllocated,
      totalUnallocatedAmortization,
      overallAmortizationStatus: resolveOverallAmortizationStatus(summary.amortizations),
    },
    decision: {
      text: decisionText,
      warnings: decisionWarnings,
    },
    items,
    molds,
    otherCosts,
    amortizationMemory,
    economicAnalysis: {
      pending: economicPending,
      message: "Análise comercial pendente de definição de preço e margem.",
      finalUnitCost: Number.isFinite(finalUnitCost) ? finalUnitCost : null,
      suggestedPrice: reportSuggestedPrice,
      estimatedMarginPercent,
      estimatedRevenue:
        reportSuggestedPrice != null && amortizationBaseQuantity
          ? roundProjectMoney(reportSuggestedPrice * amortizationBaseQuantity)
          : null,
      estimatedGrossProfit:
        reportSuggestedPrice != null &&
        amortizationBaseQuantity &&
        Number.isFinite(finalUnitCost)
          ? roundProjectMoney((reportSuggestedPrice - finalUnitCost) * amortizationBaseQuantity)
          : null,
      amortizationBaseQuantity,
      fiscalRuleName: pricingPrimary?.fiscalRuleName ?? null,
      taxPercent: pricingPrimary?.taxPercent ?? null,
      taxAmount: pricingPrimary?.taxAmount ?? null,
      marginAmount: pricingPrimary?.marginAmount ?? null,
      pricingItems,
    },
    risks: {
      technicalRisks: detail.alerts
        .filter((alert) => alert.severity !== "info")
        .map((alert) => alert.message),
      commercialRisks: [],
      notes: detail.notes?.trim() || null,
      automaticAlerts: alerts.map((alert) => alert.message),
    },
    alerts,
    approval: {
      preparedBy: detail.commercialOwner?.trim() || PROJECT_EXECUTIVE_REPORT_NOT_INFORMED,
      reviewedBy: detail.technicalOwner?.trim() || PROJECT_EXECUTIVE_REPORT_NOT_INFORMED,
      approvedBy: PROJECT_EXECUTIVE_REPORT_NOT_INFORMED,
    },
    technicalAnnex: {
      enabled: false,
      message: PROJECT_EXECUTIVE_REPORT_TECHNICAL_ANNEX_MESSAGE,
    },
  };
}

export function executiveReportMetricsAreFinite(report: ProjectExecutiveReportPayload): boolean {
  const summaryLike: ProjectCostAmortizationSummary = {
    baseItemsUnitCost: report.executiveSummary.baseItemsCost,
    totalMoldsCost: report.executiveSummary.moldsTotal,
    totalOtherCosts: report.executiveSummary.otherCostsTotal,
    totalPassThroughAmount: report.executiveSummary.amortizedToCustomer,
    totalAbsorbedAmount: report.executiveSummary.absorbedInternally,
    totalAmortizationAllocated: report.executiveSummary.totalAmortizationAllocated,
    finalItemsUnitCostWithAmortization: report.executiveSummary.finalItemsCost,
    itemRollups: report.items.map((item) => ({
      targetItemId: item.id,
      displayName: item.name,
      baseUnitCost: item.baseUnitCost,
      unitAmortizedCost: item.unitAmortizedCost,
      finalUnitCost: item.finalUnitCost,
      totalAllocated: 0,
      sourceLabels: [],
    })),
    amortizations: [],
    alerts: [],
  };
  if (!amortizationMetricsAreFinite(summaryLike)) return false;

  const nums = [
    report.executiveSummary.investmentTotal,
    report.executiveSummary.totalProjectCost,
    report.executiveSummary.totalUnallocatedAmortization,
  ];
  return nums.every((value) => Number.isFinite(value));
}
