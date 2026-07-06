import { buildFilterSummaryLines, formatYmdAsPtBr, type MaterialDemandDateBasis } from "@/src/components/contextual/materialDemandDashboardUi";
import { salesOrderStatusLabel } from "./materialDemandFilters";

type ExportRow = {
  code: string | null;
  description: string;
  unit: string | null;
  unitLabel?: string;
  quantityTotal: number;
  estimatedValueTotal: number;
  unitCostReference: number | null;
  orderCount: number;
  productCount: number;
  customerCount?: number;
  leadingProduct?: { sku: string | null; name: string } | null;
  leadingCustomer?: { customerName: string } | null;
};

type ExportFilters = {
  startDate: string;
  endDate: string;
  dateBasis: MaterialDemandDateBasis;
  statuses: string[];
  status: string;
  customerId: string;
  productId: string;
  companyIssuer: string;
  materialId: string;
  unitKey: string;
  includeOrdersWithoutDeliveryDate: boolean;
};

function csvEscape(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function productLabel(sku: string | null | undefined, name: string | null | undefined): string {
  const n = name?.trim() || "Produto";
  return sku?.trim() ? `[${sku.trim()}] ${n}` : n;
}

export function buildMaterialDemandUsageCsv(
  rows: ExportRow[],
  appliedFilters: ExportFilters,
  facets?: Parameters<typeof buildFilterSummaryLines>[0]["facets"]
): string {
  const headerLines = [
    "Estimativa de uso de matéria-prima — IndusCost",
    ...buildFilterSummaryLines({
      ...appliedFilters,
      facets,
    }),
  ];
  if (appliedFilters.statuses.length > 0) {
    headerLines.push(
      `Status: ${appliedFilters.statuses.map((s) => salesOrderStatusLabel(s)).join(", ")}`
    );
  }
  if (!appliedFilters.includeOrdersWithoutDeliveryDate) {
    headerLines.push("Pedidos sem data de entrega: excluídos");
  }
  headerLines.push(`Período exportado: ${formatYmdAsPtBr(new Date().toISOString().slice(0, 10))}`);

  const columns = [
    "Código",
    "Descrição",
    "Unidade",
    "Quantidade estimada",
    "Valor estimado",
    "Custo unit. ref.",
    "Pedidos",
    "Produtos",
    "Clientes",
    "Principal produto",
    "Principal cliente",
  ];

  const lines = [
    ...headerLines.map((l) => `# ${l}`),
    "",
    columns.join(";"),
    ...rows.map((r) =>
      [
        csvEscape(r.code),
        csvEscape(r.description),
        csvEscape(r.unit ?? r.unitLabel),
        csvEscape(r.quantityTotal),
        csvEscape(r.estimatedValueTotal),
        csvEscape(r.unitCostReference),
        csvEscape(r.orderCount),
        csvEscape(r.productCount),
        csvEscape(r.customerCount),
        csvEscape(
          r.leadingProduct ? productLabel(r.leadingProduct.sku, r.leadingProduct.name) : ""
        ),
        csvEscape(r.leadingCustomer?.customerName ?? ""),
      ].join(";")
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}

export function downloadMaterialDemandCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
