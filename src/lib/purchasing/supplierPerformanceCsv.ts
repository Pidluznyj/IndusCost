/**
 * OP-26 — CSV do Desempenho de Fornecedores.
 *
 * Puro (sem Prisma / Node). Gerado a partir das linhas canônicas produzidas
 * pelo motor do servidor — nunca montado no frontend a partir da tela visível.
 * Proteção contra CSV formula injection no mesmo padrão da Tesouraria.
 */

import type {
  SupplierPerformanceReportRowDto,
  SupplierPerformanceSummaryDto,
} from "./supplierPerformance.js";

/** Prefixo que neutraliza fórmula em Excel/LibreOffice (OWASP CSV Injection). */
const CSV_FORMULA_RE = /^[=+\-@\t\r]/;

export function neutralizeSupplierPerformanceCsvFormula(value: string): string {
  if (!value) return value;
  if (CSV_FORMULA_RE.test(value)) return `'${value}`;
  return value;
}

export function escapeSupplierPerformanceCsvCell(value: unknown): string {
  if (value == null) return "";
  const raw = String(value);
  const safe = neutralizeSupplierPerformanceCsvFormula(raw);
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

/** Número com ponto decimal — CSV é consumido por planilha/BI, não por humano. */
function csvNumber(value: number | null | undefined, fractionDigits: number): string {
  if (value == null || !Number.isFinite(value)) return "";
  return value.toFixed(fractionDigits);
}

function csvIsoDate(value: string | null | undefined): string {
  if (!value) return "";
  return value;
}

export const SUPPLIER_PERFORMANCE_DETAIL_CSV_HEADERS = [
  "supplier_id",
  "supplier_name",
  "supplier_document",
  "purchase_order_id",
  "purchase_order_code",
  "purchase_order_date",
  "purchase_order_status",
  "purchase_order_amount",
  "quality_score",
  "delivery_score",
  "conformity_score",
  "service_score",
  "overall_score",
  "methodology_version",
  "evaluation_revision",
  "evaluated_by",
  "evaluated_at",
  "updated_by",
  "updated_at",
  "notes",
] as const;

/** Uma linha por Pedido de Compra elegível (avaliado ou não). */
export type SupplierPerformanceDetailCsvRow = {
  supplierId: string;
  supplierName: string;
  supplierDocument: string | null;
  purchaseOrderId: string;
  purchaseOrderCode: string;
  /** Eixo canônico do período: COALESCE(issuedAt, createdAt). */
  purchaseOrderDate: string;
  purchaseOrderStatus: string;
  purchaseOrderAmount: number | null;
  qualityScore: number | null;
  deliveryScore: number | null;
  conformityScore: number | null;
  serviceScore: number | null;
  overallScore: number | null;
  methodologyVersion: number | null;
  evaluationRevision: number | null;
  evaluatedBy: string | null;
  evaluatedAt: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  notes: string | null;
};

export function buildSupplierPerformanceDetailCsv(
  rows: readonly SupplierPerformanceDetailCsvRow[]
): string {
  const lines: string[] = [
    SUPPLIER_PERFORMANCE_DETAIL_CSV_HEADERS.map(escapeSupplierPerformanceCsvCell).join(","),
  ];
  for (const row of rows) {
    lines.push(
      [
        row.supplierId,
        row.supplierName,
        row.supplierDocument,
        row.purchaseOrderId,
        row.purchaseOrderCode,
        csvIsoDate(row.purchaseOrderDate),
        row.purchaseOrderStatus,
        csvNumber(row.purchaseOrderAmount, 2),
        csvNumber(row.qualityScore, 1),
        csvNumber(row.deliveryScore, 1),
        csvNumber(row.conformityScore, 1),
        csvNumber(row.serviceScore, 1),
        csvNumber(row.overallScore, 2),
        row.methodologyVersion ?? "",
        row.evaluationRevision ?? "",
        row.evaluatedBy,
        csvIsoDate(row.evaluatedAt),
        row.updatedBy,
        csvIsoDate(row.updatedAt),
        row.notes,
      ]
        .map(escapeSupplierPerformanceCsvCell)
        .join(",")
    );
  }
  return `﻿${lines.join("\n")}`;
}

export const SUPPLIER_PERFORMANCE_SUMMARY_CSV_HEADERS = [
  "supplier_id",
  "supplier_name",
  "supplier_document",
  "supplier_status",
  "eligible_orders",
  "evaluated_orders",
  "pending_orders",
  "coverage",
  "quality_score",
  "delivery_score",
  "conformity_score",
  "service_score",
  "overall_score",
] as const;

function summaryCells(summary: SupplierPerformanceSummaryDto): (string | number)[] {
  return [
    summary.eligibleOrders,
    summary.evaluatedOrders,
    summary.pendingOrders,
    summary.coverage == null ? "" : summary.coverage.toFixed(6),
    csvNumber(summary.qualityScore, 2),
    csvNumber(summary.deliveryScore, 2),
    csvNumber(summary.conformityScore, 2),
    csvNumber(summary.serviceScore, 2),
    csvNumber(summary.overallScore, 2),
  ];
}

/** Consolidado por fornecedor — mesma engine/período da tela do relatório. */
export function buildSupplierPerformanceSummaryCsv(
  rows: readonly SupplierPerformanceReportRowDto[]
): string {
  const lines: string[] = [
    SUPPLIER_PERFORMANCE_SUMMARY_CSV_HEADERS.map(escapeSupplierPerformanceCsvCell).join(","),
  ];
  for (const row of rows) {
    lines.push(
      [
        row.supplierId,
        row.supplierName,
        row.supplierDocument,
        row.supplierStatus,
        ...summaryCells(row.summary),
      ]
        .map(escapeSupplierPerformanceCsvCell)
        .join(",")
    );
  }
  return `﻿${lines.join("\n")}`;
}

/** Nome de arquivo estável e seguro para Content-Disposition. */
export function buildSupplierPerformanceCsvFilename(
  kind: "detalhado" | "consolidado",
  period: { from: string | null; to: string | null }
): string {
  const from = period.from ?? "inicio";
  const to = period.to ?? "hoje";
  return `desempenho-fornecedores-${kind}-${from}-${to}.csv`.replace(/[^\w.-]+/g, "_");
}
