import type { FinanceCostCentersUiFilters } from "./financeCostCentersPageTypes.js";
import type { CostCenterExpenseMapDrilldownFilters } from "./financeCostCenterExpenseMap.js";
import type { CostCenterDetailAppliedFilterLine } from "./financeCostCenterDetailShared.js";

export const FINANCE_CC_DETAIL_EXPORT_TITLE = "Detalhamento de Gastos por Centro de Custo";

function formatDateBrInput(value: string | undefined | null): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-");
    return `${d}/${m}/${y}`;
  }
  return raw;
}

function formatDateRange(from: string | undefined | null, to: string | undefined | null): string {
  const fromLabel = formatDateBrInput(from);
  const toLabel = formatDateBrInput(to);
  if (fromLabel && toLabel) return `${fromLabel} até ${toLabel}`;
  if (fromLabel) return `a partir de ${fromLabel}`;
  if (toLabel) return `até ${toLabel}`;
  return "—";
}

function labelOrAll(value: string | undefined | null, allLabel = "Todos"): string {
  const raw = String(value ?? "").trim();
  return raw ? raw : allLabel;
}

function statusLabel(status: string): string {
  switch (status) {
    case "open":
      return "Em aberto";
    case "overdue":
      return "Vencidos";
    case "settled":
      return "Liquidados";
    case "all":
      return "Todos";
    default:
      return status || "Todos";
  }
}

function timingLabel(timing: string): string {
  switch (timing) {
    case "overdue":
      return "Vencidos";
    case "upcoming":
      return "A vencer";
    case "paid":
      return "Pagos/liquidados";
    case "all":
      return "Todos";
    default:
      return timing || "Todos";
  }
}

function allocationSourceLabel(source: string): string {
  switch (source) {
    case "AUTO_RULE":
      return "Auto rule";
    case "BATCH":
      return "Batch";
    case "MANUAL":
      return "Manual";
    case "all":
      return "Todas";
    default:
      return source || "Todas";
  }
}

function classificationScopeLabel(value: string): string {
  switch (value) {
    case "classified":
      return "Classificados";
    case "unclassified":
      return "Sem classificação";
    case "all":
      return "Todos";
    default:
      return value || "Todos";
  }
}

export function sanitizeCostCenterExportSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "centro-custo";
}

export function buildCostCenterDetailExportFilename(
  centerName: string,
  referenceDate = new Date()
): string {
  const slug = sanitizeCostCenterExportSlug(centerName);
  const year = referenceDate.getFullYear();
  return `centro-custo-${slug}-${year}.xlsx`;
}

export function buildCostCenterDetailPdfFilename(
  centerName: string,
  referenceDate = new Date()
): string {
  return buildCostCenterDetailExportFilename(centerName, referenceDate).replace(/\.xlsx$/, ".pdf");
}

export function buildCostCenterDetailAppliedFilterLines(input: {
  pageFilters: FinanceCostCentersUiFilters;
  drilldown: CostCenterExpenseMapDrilldownFilters;
}): CostCenterDetailAppliedFilterLine[] {
  const { pageFilters, drilldown } = input;
  const lines: CostCenterDetailAppliedFilterLine[] = [];

  if (pageFilters.year) lines.push({ label: "Ano", value: String(pageFilters.year) });
  if (pageFilters.month) lines.push({ label: "Mês", value: String(pageFilters.month) });
  if (pageFilters.companyName.trim()) {
    lines.push({ label: "Empresa (tela)", value: pageFilters.companyName.trim() });
  }
  if (pageFilters.classification && pageFilters.classification !== "all") {
    lines.push({
      label: "Classificação (tela)",
      value: classificationScopeLabel(pageFilters.classification),
    });
  }

  lines.push({ label: "Busca", value: labelOrAll(drilldown.search, "—") });
  lines.push({ label: "Empresa", value: labelOrAll(drilldown.companyName, "Todas") });
  lines.push({ label: "Fornecedor", value: labelOrAll(drilldown.supplierName, "Todos") });
  lines.push({
    label: "Classificação Nomus",
    value: labelOrAll(drilldown.classification, "Todas"),
  });
  lines.push({ label: "Status", value: statusLabel(drilldown.status) });
  lines.push({ label: "Prazo", value: timingLabel(drilldown.timing) });
  lines.push({
    label: "Fonte alocação",
    value: allocationSourceLabel(drilldown.allocationSource),
  });
  lines.push({
    label: "Apenas locked manual",
    value: drilldown.lockedOnly ? "Sim" : "Não",
  });
  if (drilldown.minAmount.trim()) {
    lines.push({ label: "Valor mínimo", value: drilldown.minAmount.trim() });
  }
  if (drilldown.maxAmount.trim()) {
    lines.push({ label: "Valor máximo", value: drilldown.maxAmount.trim() });
  }
  lines.push({
    label: "Vencimento",
    value: formatDateRange(drilldown.dueDateFrom, drilldown.dueDateTo),
  });
  lines.push({
    label: "Competência",
    value: formatDateRange(drilldown.competenceDateFrom, drilldown.competenceDateTo),
  });
  lines.push({
    label: "Pagamento",
    value: formatDateRange(drilldown.paymentDateFrom, drilldown.paymentDateTo),
  });

  return lines;
}

/** Linhas de filtros a partir dos query params da API (server-side). */
export function buildCostCenterDetailAppliedFilterLinesFromQuery(
  query: Record<string, unknown>
): CostCenterDetailAppliedFilterLine[] {
  const read = (key: string) =>
    typeof query[key] === "string" ? String(query[key]).trim() : "";
  const bool = (key: string) => query[key] === true || query[key] === "true";

  const lines: CostCenterDetailAppliedFilterLine[] = [];
  if (query.year) lines.push({ label: "Ano", value: String(query.year) });
  if (query.month) lines.push({ label: "Mês", value: String(query.month) });
  const pageClassification = read("classification");
  if (pageClassification && pageClassification !== "all") {
    lines.push({
      label: "Classificação (tela)",
      value: classificationScopeLabel(pageClassification),
    });
  }

  lines.push({ label: "Busca", value: labelOrAll(read("search"), "—") });
  lines.push({ label: "Empresa", value: labelOrAll(read("companyName"), "Todas") });
  lines.push({ label: "Fornecedor", value: labelOrAll(read("personName"), "Todos") });
  lines.push({
    label: "Classificação Nomus",
    value: labelOrAll(read("nomusClassification"), "Todas"),
  });
  lines.push({ label: "Status", value: statusLabel(read("status") || "all") });
  lines.push({ label: "Prazo", value: timingLabel(read("timing") || "all") });
  lines.push({
    label: "Fonte alocação",
    value: allocationSourceLabel(read("allocationSource") || "all"),
  });
  lines.push({ label: "Apenas locked manual", value: bool("lockedOnly") ? "Sim" : "Não" });
  const minAmount = read("minAmount");
  const maxAmount = read("maxAmount");
  if (minAmount) lines.push({ label: "Valor mínimo", value: minAmount });
  if (maxAmount) lines.push({ label: "Valor máximo", value: maxAmount });
  lines.push({
    label: "Vencimento",
    value: formatDateRange(read("dueDateFrom"), read("dueDateTo")),
  });
  lines.push({
    label: "Competência",
    value: formatDateRange(read("competenceDateFrom"), read("competenceDateTo")),
  });
  lines.push({
    label: "Pagamento",
    value: formatDateRange(read("paymentDateFrom"), read("paymentDateTo")),
  });

  return lines;
}
