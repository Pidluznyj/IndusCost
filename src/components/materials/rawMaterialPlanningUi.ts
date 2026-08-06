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
  /** Anotações manuais de compra — null quando nunca preenchidas. */
  purchasePlan: RawMaterialPlanningPurchasePlan | null;
};

export type RawMaterialPlanningPurchasePlan = {
  purchaseDate: string | null;
  expectedArrivalDate: string | null;
  purchaseOrderRef: string | null;
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

/**
 * Estilo "alert pill" (mesma linguagem dos avisos Info/Warning/Error/Success):
 * preenchimento suave bem legível + borda no tom + texto escuro do tom.
 */
export const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  danger:
    "border-red-300 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200",
  warning:
    "border-yellow-300 bg-yellow-100 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950/60 dark:text-yellow-200",
  success:
    "border-green-300 bg-green-100 text-green-800 dark:border-green-800 dark:bg-green-950/60 dark:text-green-200",
  info: "border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-200",
  neutral:
    "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200",
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
