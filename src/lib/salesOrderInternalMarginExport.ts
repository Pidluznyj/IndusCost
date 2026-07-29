/**
 * Exportação interna de margem — workbook Excel (sem Prisma).
 */
import * as XLSX from "xlsx";
import {
  formatSalesOrderCostSourceLabel,
  SALES_ORDER_COST_SOURCE_LABEL,
} from "./salesOrderMarginDisplay.js";
import type { SalesOrderCostConfidence, SalesOrderMarginStatus } from "./salesOrderMarginTypes.js";

export const SALES_ORDER_INTERNAL_MARGIN_REPORT_DISCLAIMER =
  "Relatório interno — contém informações de custo e margem. Não compartilhar com clientes.";

export const SALES_ORDER_COST_CONFIDENCE_LABEL: Record<SalesOrderCostConfidence, string> = {
  HIGH: "Alta",
  MEDIUM: "Média",
  LOW: "Baixa",
  MISSING: "Indisponível",
};

export type SalesOrderInternalMarginExportFilterRow = {
  label: string;
  value: string;
};

export type SalesOrderInternalMarginExportOrderRow = {
  orderCode: string;
  customerName: string;
  sellerName: string;
  issueDate: string;
  grossValue: number | null;
  discountValue: number | null;
  discountPercent: number | null;
  netRevenue: number;
  totalCost: number;
  /** Margem comercial do Pedido (canônica). */
  marginValue: number;
  marginPercent: number | null;
  marginCoveragePercent: number | null;
  managerialMarginValue: number | null;
  managerialMarginPercent: number | null;
  markup: number | null;
  marginStatusLabel: string;
  logisticStatusLabel?: string;
  itemsWithoutCost: number;
  itemsWithoutProduct: number;
  itemsWithNegativeMargin: number;
};

export type SalesOrderInternalMarginExportItemRow = {
  orderCode: string;
  customerName: string;
  sellerName: string;
  sku: string;
  productName: string;
  quantity: number;
  grossUnitPrice: number | null;
  netUnitPrice: number | null;
  netRevenue: number;
  unitCost: number | null;
  totalCost: number | null;
  /** Margem comercial do item (canônica). */
  marginValue: number | null;
  marginPercent: number | null;
  managerialMarginValue: number | null;
  managerialMarginPercent: number | null;
  markup: number | null;
  costSourceLabel: string;
  costConfidenceLabel: string;
  marginStatusLabel: string;
  notes: string;
};

export type SalesOrderInternalMarginExportAlertRow = {
  alertType: string;
  orderCode: string;
  customerName: string;
  sellerName: string;
  sku: string;
  productName: string;
  netRevenue: number;
  marginValue: number | null;
  marginPercent: number | null;
  marginStatusLabel: string;
};

export type SalesOrderInternalMarginExportPayload = {
  generatedAt: string;
  scopeLabel: string;
  appliedFilters: SalesOrderInternalMarginExportFilterRow[];
  summary: {
    netRevenue: number;
    totalCost: number;
    marginValue: number;
    marginPercent: number | null;
    marginCoveragePercent: number | null;
    markup: number | null;
    ordersCount: number;
    itemsCount: number;
    ordersWithNegativeMargin: number;
    itemsWithoutCost: number;
    itemsWithoutProduct: number;
  };
  orders: SalesOrderInternalMarginExportOrderRow[];
  items: SalesOrderInternalMarginExportItemRow[];
  alerts: SalesOrderInternalMarginExportAlertRow[];
};

function numOrBlank(v: number | null | undefined): number | "" {
  if (v == null || !Number.isFinite(v)) return "";
  return v;
}

function alertTypeLabel(status: SalesOrderMarginStatus): string {
  if (status === "SEM_CUSTO") return "Sem custo";
  if (status === "SEM_PRODUTO_VINCULADO") return "Sem produto vinculado";
  if (status === "MARGEM_NEGATIVA") return "Margem negativa";
  return status;
}

export function buildSalesOrderInternalMarginExportWorkbook(
  payload: SalesOrderInternalMarginExportPayload
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const { summary } = payload;

  const resumoRows = [
    { Campo: "Aviso", Valor: SALES_ORDER_INTERNAL_MARGIN_REPORT_DISCLAIMER },
    { Campo: "Gerado em", Valor: payload.generatedAt },
    { Campo: "Origem", Valor: payload.scopeLabel },
    { Campo: "Valor líquido coberto (comercial)", Valor: summary.netRevenue },
    { Campo: "Custo estimado total (gerencial)", Valor: summary.totalCost },
    { Campo: "Margem comercial R$", Valor: summary.marginValue },
    { Campo: "Margem comercial %", Valor: numOrBlank(summary.marginPercent) },
    { Campo: "Cobertura margem %", Valor: numOrBlank(summary.marginCoveragePercent) },
    { Campo: "Markup (gerencial)", Valor: numOrBlank(summary.markup) },
    { Campo: "Pedidos", Valor: summary.ordersCount },
    { Campo: "Itens", Valor: summary.itemsCount },
    { Campo: "Pedidos com margem negativa", Valor: summary.ordersWithNegativeMargin },
    { Campo: "Itens sem custo", Valor: summary.itemsWithoutCost },
    { Campo: "Itens sem produto", Valor: summary.itemsWithoutProduct },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumoRows), "Resumo");

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      payload.orders.map((row) => ({
        Pedido: row.orderCode,
        Cliente: row.customerName,
        Vendedor: row.sellerName,
        "Data emissão": row.issueDate,
        "Valor bruto": numOrBlank(row.grossValue),
        "Desconto R$": numOrBlank(row.discountValue),
        "Desconto %": numOrBlank(row.discountPercent),
        "Valor líquido": row.netRevenue,
        "Custo estimado (gerencial)": row.totalCost,
        "Margem comercial R$": row.marginValue,
        "Margem comercial %": numOrBlank(row.marginPercent),
        "Cobertura margem %": numOrBlank(row.marginCoveragePercent),
        "Margem gerencial R$": numOrBlank(row.managerialMarginValue),
        "Margem gerencial %": numOrBlank(row.managerialMarginPercent),
        Markup: numOrBlank(row.markup),
        "Status margem comercial": row.marginStatusLabel,
        "Status logístico": row.logisticStatusLabel ?? "",
        "Itens sem custo": row.itemsWithoutCost,
        "Itens sem produto": row.itemsWithoutProduct,
        "Itens margem negativa": row.itemsWithNegativeMargin,
      }))
    ),
    "Pedidos"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      payload.items.map((row) => ({
        Pedido: row.orderCode,
        Cliente: row.customerName,
        Vendedor: row.sellerName,
        SKU: row.sku,
        Produto: row.productName,
        Quantidade: row.quantity,
        "Preço bruto unitário": numOrBlank(row.grossUnitPrice),
        "Preço líquido unitário": numOrBlank(row.netUnitPrice),
        "Valor líquido item": row.netRevenue,
        "Custo unitário usado": numOrBlank(row.unitCost),
        "Custo total": numOrBlank(row.totalCost),
        "Margem comercial R$": numOrBlank(row.marginValue),
        "Margem comercial %": numOrBlank(row.marginPercent),
        "Margem gerencial R$": numOrBlank(row.managerialMarginValue),
        "Margem gerencial %": numOrBlank(row.managerialMarginPercent),
        Markup: numOrBlank(row.markup),
        "Fonte do custo": row.costSourceLabel,
        "Confiança do custo": row.costConfidenceLabel,
        "Status margem comercial": row.marginStatusLabel,
        Observações: row.notes,
      }))
    ),
    "Itens"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      payload.alerts.map((row) => ({
        Alerta: row.alertType,
        Pedido: row.orderCode,
        Cliente: row.customerName,
        Vendedor: row.sellerName,
        SKU: row.sku,
        Produto: row.productName,
        "Valor líquido": row.netRevenue,
        "Margem comercial R$": numOrBlank(row.marginValue),
        "Margem comercial %": numOrBlank(row.marginPercent),
        "Status margem comercial": row.marginStatusLabel,
      }))
    ),
    "Alertas"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      payload.appliedFilters.map((row) => ({
        Filtro: row.label,
        Valor: row.value,
      }))
    ),
    "Filtros Aplicados"
  );

  return wb;
}

export function salesOrderInternalMarginWorkbookToBytes(workbook: XLSX.WorkBook): Uint8Array {
  const arr = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Uint8Array(arr);
}

export function salesOrderInternalMarginExportFilename(
  scopeSlug: string,
  referenceDate = new Date()
): string {
  const stamp = referenceDate.toISOString().slice(0, 10);
  return `pedidos-venda-margem-interno-${scopeSlug}-${stamp}.xlsx`;
}

export function formatInternalMarginExportCostSource(
  source: keyof typeof SALES_ORDER_COST_SOURCE_LABEL | undefined | null
): string {
  if (!source) return "—";
  return formatSalesOrderCostSourceLabel(source);
}

export function formatInternalMarginExportCostConfidence(
  confidence: SalesOrderCostConfidence | undefined | null
): string {
  if (!confidence) return "—";
  return SALES_ORDER_COST_CONFIDENCE_LABEL[confidence] ?? confidence;
}
