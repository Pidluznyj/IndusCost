/**
 * KAN-LINK-08 — Labels/tipos do diagnóstico operacional (puro, seguro no frontend).
 */

export const SALES_ORDER_FLOW_DIAGNOSTIC_BADGES = [
  "OP_LINKED",
  "OP_PARTIAL",
  "STOCK_FULFILLED",
  "DS_LINKED",
  "DS_PARTIAL",
  "DS_UNRECOGNIZED",
  "NFE_AUTHORIZED",
  "NFE_CANCELLED",
  "NFE_UNLINKED",
  "OP_UNLINKED",
  "SHIPMENT_COMPLETE",
  "AMBIGUOUS_LINK",
  "ITEM_UNRESOLVED",
  "EXCESS_COVERAGE",
  "PARTIAL_COVERAGE",
  "SNAPSHOT_DIVERGENT",
] as const;

export type SalesOrderFlowDiagnosticBadge =
  (typeof SALES_ORDER_FLOW_DIAGNOSTIC_BADGES)[number];

export const SALES_ORDER_FLOW_DIAGNOSTIC_BADGE_LABELS: Record<
  SalesOrderFlowDiagnosticBadge,
  string
> = {
  OP_LINKED: "OP vinculada",
  OP_PARTIAL: "OP parcial",
  STOCK_FULFILLED: "Atendido sem OP",
  DS_LINKED: "DS vinculado",
  DS_PARTIAL: "DS parcial",
  DS_UNRECOGNIZED: "DS não reconhecido",
  NFE_AUTHORIZED: "NF autorizada",
  NFE_CANCELLED: "NF cancelada",
  NFE_UNLINKED: "NF sem vínculo",
  OP_UNLINKED: "OP sem vínculo",
  SHIPMENT_COMPLETE: "Envio completo",
  AMBIGUOUS_LINK: "Vínculo ambíguo",
  ITEM_UNRESOLVED: "Item não resolvido",
  EXCESS_COVERAGE: "Cobertura excedente",
  PARTIAL_COVERAGE: "Cobertura parcial",
  SNAPSHOT_DIVERGENT: "Snapshot divergente",
};

export type SalesOrderFlowOperationalDiagnosticEvidenceLine = {
  kind: "PRODUCTION_ORDER" | "OUTPUT_DOCUMENT" | "NFE" | "SHIPMENT";
  label: string;
  detail: string | null;
  quantity: number | null;
  present: boolean;
  sourceLabel: string | null;
};

export type SalesOrderFlowOperationalDiagnosticItem = {
  salesOrderItemId: string;
  sequence: string | null;
  productLabel: string | null;
  linkStatus: string;
  coverageStatus: string;
  activeObligation: number;
  fulfilledQuantity: number;
  remainingFulfillment: number;
  cutQuantity: number;
  canceledQuantity: number;
  productionOrderQuantity: number;
  productionCoverage: string;
  documentedQuantity: number;
  documentedCoverage: string;
  invoicedQuantity: number;
  invoicedCoverage: string;
  shippedQuantity: number;
  shippedCoverage: string;
  sourceSummary: string[];
  warnings: string[];
};

export type SalesOrderFlowOperationalDiagnosticTotals = {
  activeObligation: number;
  fulfilledQuantity: number;
  remainingFulfillment: number;
  cutQuantity: number;
  canceledQuantity: number;
  productionOrderQuantity: number;
  documentedQuantity: number;
  invoicedQuantity: number;
  shippedQuantity: number;
  linkedProductionOrderCount: number;
  linkedOutputDocumentCount: number;
  linkedNfeCount: number;
};

export type SalesOrderFlowOperationalDiagnostics = {
  contractVersion: "sales-order-flow-operational-diagnostics/v1";
  /** Título do painel. */
  title: string;
  stageLabel: string | null;
  stageReason: string | null;
  bottleneckItemLabel: string | null;
  bottleneckReason: string | null;
  nextAction: string | null;
  responsibleArea: string | null;
  pendingObligation: boolean;
  totals: SalesOrderFlowOperationalDiagnosticTotals;
  productionOrderLabels: string[];
  outputDocumentLabels: string[];
  nfeLabels: string[];
  evidencesFound: SalesOrderFlowOperationalDiagnosticEvidenceLine[];
  evidencesMissing: SalesOrderFlowOperationalDiagnosticEvidenceLine[];
  items: SalesOrderFlowOperationalDiagnosticItem[];
  warnings: string[];
  badges: SalesOrderFlowDiagnosticBadge[];
  computedAt: string | null;
  computationVersion: string | null;
  expectedComputationVersion: string;
  snapshotDivergent: boolean;
};
