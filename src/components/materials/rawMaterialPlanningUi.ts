/**
 * UI puro (labels/tons/formatação) do Planejamento de Matéria-Prima — sem
 * fetch, sem Prisma. Tipos espelham o payload de
 * src/lib/rawMaterialPlanning.server.ts (não importado diretamente aqui para
 * manter este arquivo frontend-safe e sem acoplar aos tipos Prisma).
 */
import type {
  RawMaterialPlanningConfidence,
  RawMaterialPlanningHorizon,
  RawMaterialPlanningStatus,
} from "@/src/lib/rawMaterialPlanning.shared";

export type RawMaterialPlanningTimelinePoint = {
  date: string;
  openingBalance: number;
  inbound: number;
  outbound: number;
  closingBalance: number;
  protectionTotal: number;
  freeBalance: number;
  shortfall: number;
  demandEvents: Array<{ date: string; quantity: number; salesOrderId: string; orderCode: string | null }>;
  inboundEvents: Array<{
    date: string;
    quantity: number;
    purchaseOrderId: string;
    purchaseOrderCode: string | null;
    status: string;
  }>;
};

export type RawMaterialPlanningConsumingOrderRow = {
  salesOrderId: string;
  orderCode: string | null;
  customerId: string | null;
  customerName: string | null;
  productId: string;
  productSku: string | null;
  productName: string;
  productQuantity: number;
  openQuantity: number;
  deliveryDate: string | null;
  needByDate: string | null;
  needByDateSource: "expectedDeliveryDate" | "none";
  materialQuantity: number;
  unit: string;
};

export type RawMaterialPlanningInboundRow = {
  purchaseOrderId: string;
  purchaseOrderCode: string | null;
  supplierId: string | null;
  quantity: number;
  unit: string;
  expectedDeliveryDate: string | null;
  status: string;
  arrivesBeforeRisk: boolean | null;
  unitMismatch: boolean;
};

export type RawMaterialPlanningRow = {
  materialId: string;
  code: string | null;
  description: string;
  unit: string;
  countedBalance: number;
  lastStockConferenceAt: string | null;
  stockCountAgeDays: number | null;
  minimumQuantity: number | null;
  contingencyQuantity: number | null;
  protectionTotal: number;
  demandInHorizon: number;
  confirmedInboundInHorizon: number;
  lowestProjectedBalance: number;
  lowestProjectedBalanceDate: string | null;
  firstRiskDate: string | null;
  buyByDate: string | null;
  buyByBlockedReason: "NO_RISK" | "NO_LEAD_TIME" | null;
  technicalNeed: number;
  suggestedQuantity: number;
  lotAdjustment: number;
  adjustmentNote: string | null;
  leadTimeDays: number | null;
  leadTimeSampleCount: number;
  supplier: string | null;
  estimatedUnitCost: number | null;
  estimatedPurchaseValue: number | null;
  situation: RawMaterialPlanningStatus;
  confidence: RawMaterialPlanningConfidence;
  confidenceReasons: string[];
  alerts: string[];
  timeline: RawMaterialPlanningTimelinePoint[];
  consumingOrders: RawMaterialPlanningConsumingOrderRow[];
  confirmedInbound: RawMaterialPlanningInboundRow[];
};

export type RawMaterialPlanningSummary = {
  buyNowCount: number;
  buyWithin7DaysCount: number;
  materialsAtRiskCount: number;
  ordersAtRiskCount: number;
  estimatedPurchaseValue: number | null;
  estimatedPurchaseValueIsPartial: boolean;
  staleStockCountMaterials: number;
  missingLeadTimeMaterials: number;
  unitConversionErrorMaterials: number;
  totalMaterials: number;
};

export type RawMaterialPlanningDataQuality = {
  ordersWithoutNeedDate: number;
  itemsWithoutFulfillmentStatus: number;
  purchaseOrdersWithoutExpectedDate: number;
};

export type RawMaterialPlanningResponse = {
  appliedFilters: Record<string, unknown>;
  asOfDate: string;
  horizon: RawMaterialPlanningHorizon;
  horizonEndDate: string;
  generatedAt: string;
  summary: RawMaterialPlanningSummary;
  materials: RawMaterialPlanningRow[];
  dataQuality: RawMaterialPlanningDataQuality;
  warnings: string[];
};

export const RAW_MATERIAL_PLANNING_STATUS_LABELS: Record<RawMaterialPlanningStatus, string> = {
  BUY_NOW: "Comprar agora",
  BUY_WITHIN_7_DAYS: "Comprar em até 7 dias",
  PLAN_PURCHASE: "Planejar compra",
  COVERED_BY_STOCK: "Coberto por estoque",
  COVERED_BY_CONFIRMED_INBOUND: "Coberto por entrada confirmada",
  INBOUND_LATE: "Entrada confirmada chega atrasada",
  PARTIALLY_COVERED: "Cobertura parcial",
  DATA_INCOMPLETE: "Dados incompletos",
  STOCK_COUNT_STALE: "Contagem de estoque desatualizada",
  UNIT_CONVERSION_ERROR: "Erro de unidade",
};

export type StatusTone = "danger" | "warning" | "success" | "info" | "neutral";

export const RAW_MATERIAL_PLANNING_STATUS_TONE: Record<RawMaterialPlanningStatus, StatusTone> = {
  BUY_NOW: "danger",
  BUY_WITHIN_7_DAYS: "warning",
  PLAN_PURCHASE: "info",
  COVERED_BY_STOCK: "success",
  COVERED_BY_CONFIRMED_INBOUND: "success",
  INBOUND_LATE: "danger",
  PARTIALLY_COVERED: "warning",
  DATA_INCOMPLETE: "neutral",
  STOCK_COUNT_STALE: "neutral",
  UNIT_CONVERSION_ERROR: "danger",
};

export const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  danger:
    "border-red-200/80 bg-red-50/70 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300",
  warning:
    "border-amber-200/80 bg-amber-50/70 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300",
  success:
    "border-emerald-200/80 bg-emerald-50/70 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300",
  info: "border-sky-200/80 bg-sky-50/70 text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-300",
  neutral:
    "border-border bg-muted/40 text-muted-foreground",
};

export const RAW_MATERIAL_PLANNING_CONFIDENCE_LABELS: Record<RawMaterialPlanningConfidence, string> = {
  HIGH: "Alta",
  MEDIUM: "Média",
  LOW: "Baixa",
};

export const RAW_MATERIAL_PLANNING_CONFIDENCE_TONE: Record<RawMaterialPlanningConfidence, StatusTone> = {
  HIGH: "success",
  MEDIUM: "warning",
  LOW: "danger",
};

export const RAW_MATERIAL_PLANNING_HORIZON_LABELS: Record<RawMaterialPlanningHorizon, string> = {
  "30": "Próximos 30 dias",
  "60": "Próximos 60 dias",
  "90": "Próximos 90 dias",
  custom: "Período personalizado",
};

export function formatYmdPtBr(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
}

export function formatIsoDateTimePtBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR");
}

export function buyByBlockedReasonLabel(reason: "NO_RISK" | "NO_LEAD_TIME" | null): string | null {
  if (reason === "NO_RISK") return "Sem risco de ruptura no horizonte analisado.";
  if (reason === "NO_LEAD_TIME") return "Sem lead time confiável para calcular a data limite de compra.";
  return null;
}
