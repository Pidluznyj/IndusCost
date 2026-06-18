import { salesOrderStatusLabel } from "@/src/lib/materialDemandFilters";

export type MaterialDemandDateBasis = "issueDate" | "expectedDeliveryDate";

export type MaterialDemandDashboardTab =
  | "usage-estimate"
  | "planned-vs-realized"
  | "summary"
  | "by-material"
  | "by-period";

export type MaterialDemandTabDef = {
  id: MaterialDemandDashboardTab;
  label: string;
};

export const MATERIAL_DEMAND_TABS: MaterialDemandTabDef[] = [
  { id: "usage-estimate", label: "Estimativa de uso" },
  { id: "planned-vs-realized", label: "Previsto x Realizado" },
  { id: "summary", label: "Resumo" },
  { id: "by-material", label: "Por matéria-prima" },
  { id: "by-period", label: "Por período" },
];

export const MATERIAL_DEMAND_TAB_HINTS: Record<MaterialDemandDashboardTab, string> = {
  "usage-estimate":
    "Quanto de cada matéria-prima será necessário para atender os pedidos filtrados no período selecionado.",
  "planned-vs-realized":
    "Compara a necessidade prevista de matéria-prima com o que foi efetivamente faturado.",
  summary: "Indicadores consolidados, distribuição por valor e evolução mensal estimada.",
  "by-material": "Lista analítica por matéria-prima com percentuais e detalhamento expandível.",
  "by-period": "Necessidade agrupada por mês e evolução temporal da estimativa.",
};

export function materialDemandTabNeedsRows(tab: MaterialDemandDashboardTab): boolean {
  return tab === "usage-estimate" || tab === "by-material";
}

export function defaultMaterialDemandTab(
  context: "products" | "sales-orders"
): MaterialDemandDashboardTab {
  return context === "sales-orders" ? "usage-estimate" : "summary";
}

export function dateBasisLabelPt(dateBasis: MaterialDemandDateBasis): string {
  return dateBasis === "expectedDeliveryDate" ? "Entrega prevista" : "Emissão do pedido";
}

export function formatDatePtBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

export function formatYmdAsPtBr(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
}

export function buildUsageEstimateTitle(
  dateBasis: MaterialDemandDateBasis,
  startDate: string,
  endDate: string
): string {
  return `Estimativa de uso — ${dateBasisLabelPt(dateBasis)} de ${formatYmdAsPtBr(startDate)} a ${formatYmdAsPtBr(endDate)}`;
}

export type FilterSummaryInput = {
  dateBasis: MaterialDemandDateBasis;
  startDate: string;
  endDate: string;
  statuses: string[];
  status: string;
  customerId: string;
  productId: string;
  companyIssuer: string;
  materialId: string;
  unitKey: string;
  includeOrdersWithoutDeliveryDate?: boolean;
  facets?: {
    customers: Array<{ id: string; companyName: string }>;
    products: Array<{ id: string; sku: string | null; name: string }>;
    units: Array<{ unitKey: string; unitLabel: string }>;
    materials: Array<{ materialId: string; code: string | null; description: string }>;
  };
};

export function buildFilterSummaryLines(f: FilterSummaryInput): string[] {
  const lines: string[] = [
    `Base do período: ${dateBasisLabelPt(f.dateBasis)}`,
    `Período: ${formatYmdAsPtBr(f.startDate)} a ${formatYmdAsPtBr(f.endDate)}`,
  ];
  if (f.statuses.length > 0) {
    lines.push(`Status: ${f.statuses.map((s) => salesOrderStatusLabel(s)).join(", ")}`);
  } else if (f.status) {
    lines.push(`Status: ${salesOrderStatusLabel(f.status)}`);
  }
  if (f.includeOrdersWithoutDeliveryDate === false) {
    lines.push("Pedidos sem data de entrega: excluídos");
  }
  if (f.companyIssuer) lines.push(`Empresa emissora: ${f.companyIssuer}`);
  if (f.customerId && f.facets) {
    const c = f.facets.customers.find((x) => x.id === f.customerId);
    lines.push(`Cliente: ${c?.companyName ?? f.customerId}`);
  }
  if (f.productId && f.facets) {
    const p = f.facets.products.find((x) => x.id === f.productId);
    lines.push(`Produto: ${p ? (p.sku ? `[${p.sku}] ${p.name}` : p.name) : f.productId}`);
  }
  if (f.materialId && f.facets) {
    const m = f.facets.materials.find((x) => x.materialId === f.materialId);
    lines.push(`Matéria-prima: ${m ? (m.code ? `[${m.code}] ${m.description}` : m.description) : f.materialId}`);
  }
  if (f.unitKey && f.facets) {
    const u = f.facets.units.find((x) => x.unitKey === f.unitKey);
    lines.push(`Unidade: ${u?.unitLabel ?? f.unitKey}`);
  }
  return lines;
}

export function materialDemandTabButtonClass(active: boolean): string {
  return active
    ? "border-primary bg-primary/10 text-primary"
    : "border-border bg-card text-foreground hover:bg-accent";
}
