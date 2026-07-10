/**
 * Relatórios de comissão — leitura do ledger oficial de Fechamento (sem recálculo paralelo).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import type { CommissionAccessScope } from "./commissionAccessScope.js";
import { RECEIPT_CLOSING_SOURCE } from "./commissionReceiptClosing.js";
import {
  getReceiptClosingPage,
  getReceiptClosingPreviewPage,
} from "./commissionReceiptClosingApi.server.js";
import { markReceivableReceivedAnchors } from "./commissionReceiptClosingApi.js";
import type { ReceiptClosingApiLine } from "./commissionReceiptClosingApi.shared.js";
import {
  assembleCommissionReportsPayload,
  buildCommissionReportsExportFilename,
  buildCommissionReportsExportWorkbook,
  buildEmptyCommissionReportsPayload,
  filterCommissionReportRecords,
  mapSourceLineToReportRecord,
  type CommissionReportSourceLine,
  type CommissionReportsPayload,
  type CommissionReportsQuery,
} from "./commissionReports.shared.js";
import * as XLSX from "xlsx";

function toIsoDate(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  return value.toISOString();
}

function mapLedgerPrismaRowToApiLine(row: {
  ledgerLineKey: string;
  nomusReceivableId: number | null;
  receivableNumber: string | null;
  installmentNumber: number | null;
  settlementDate: Date | null;
  dueDate: Date | null;
  customerId: string | null;
  customerExternalId: number | null;
  customerNameSnapshot: string | null;
  orderCode: string | null;
  nomusNfeId: number | null;
  nfeNumber: string | null;
  productCode: string | null;
  productNameSnapshot: string | null;
  rawSellerId: number | null;
  rawSellerName: string | null;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  sellerResolutionStatus: string | null;
  receivedAmount: Prisma.Decimal | number;
  allocatedCommercialBase: Prisma.Decimal | number;
  commissionRatePercent: Prisma.Decimal | number;
  expectedCommissionAmount: Prisma.Decimal | number;
  releasedCommissionAmount: Prisma.Decimal | number;
  ruleId: string | null;
  ruleNameSnapshot: string | null;
  exclusionReason: string | null;
  status: string;
  exceptionReason: string | null;
}): ReceiptClosingApiLine {
  const received = Number(row.receivedAmount);
  const released = Number(row.releasedCommissionAmount);
  const expected = Number(row.expectedCommissionAmount);
  const isExcluded = row.status === "CUSTOMER_EXCLUDED" || row.status === "GROUP_COMPANY_EXCLUDED";
  return {
    lineKey: row.ledgerLineKey,
    nomusReceivableId: row.nomusReceivableId,
    receivableNumber: row.receivableNumber,
    installmentNumber: row.installmentNumber,
    settlementDate: toIsoDate(row.settlementDate),
    dueDate: toIsoDate(row.dueDate),
    customerId: row.customerId,
    customerExternalId: row.customerExternalId,
    customerName: row.customerNameSnapshot,
    orderCode: row.orderCode,
    localOrderId: null,
    nomusNfeId: row.nomusNfeId,
    nfeNumber: row.nfeNumber,
    localItemId: null,
    nomusOrderItemId: null,
    productCode: row.productCode,
    productName: row.productNameSnapshot,
    rawSellerId: row.rawSellerId,
    rawSellerName: row.rawSellerName,
    canonicalSellerId: isExcluded ? null : row.canonicalSellerId,
    canonicalSellerName: isExcluded ? null : row.canonicalSellerName,
    sellerResolutionStatus: row.sellerResolutionStatus,
    receivedAmount: received,
    uniqueReceivedAmount: received,
    commissionableBaseAmount: Number(row.allocatedCommercialBase),
    ratePercent: Number(row.commissionRatePercent),
    expectedCommissionAmount: expected,
    releasedCommissionAmount: released,
    grossCommissionAmount:
      row.status === "CUSTOMER_EXCLUDED" ? (expected > 0 ? expected : released) : released,
    scheduledCommissionAmount: null,
    commissionReceivableScheduleId: null,
    ruleId: row.ruleId,
    ruleName: row.ruleNameSnapshot,
    exclusionReason: row.exclusionReason,
    status: row.status,
    statusReason: row.exceptionReason ?? row.exclusionReason,
    source: "PERSISTED_LEDGER",
  };
}

function lineMatchesOwnScope(line: ReceiptClosingApiLine, scope: CommissionAccessScope): boolean {
  if (scope.dataScope !== "own") return true;
  if (scope.nomusSellerId != null && line.rawSellerId === scope.nomusSellerId) return true;
  if (scope.sellerResponsibleName) {
    const name = scope.sellerResponsibleName.trim().toLowerCase();
    if (line.canonicalSellerName?.trim().toLowerCase() === name) return true;
    if (line.rawSellerName?.trim().toLowerCase() === name) return true;
  }
  return false;
}

async function resolveOwnCanonicalSellerIds(scope: CommissionAccessScope): Promise<Set<string>> {
  if (scope.dataScope !== "own" || scope.nomusSellerId == null) return new Set();
  const persons = await prisma.commissionPerson.findMany({
    where: { nomusPersonId: scope.nomusSellerId, type: "SELLER" },
    select: { id: true },
  });
  return new Set(persons.map((p) => p.id));
}

function applyOwnScopeToLines(
  lines: ReceiptClosingApiLine[],
  scope: CommissionAccessScope,
  ownSellerIds: Set<string>
): ReceiptClosingApiLine[] {
  if (scope.dataScope !== "own") return lines;
  return lines.filter((line) => {
    if (line.canonicalSellerId && ownSellerIds.has(line.canonicalSellerId)) return true;
    return lineMatchesOwnScope(line, scope);
  });
}

async function loadClosedLedgerSourceLines(input: {
  year: number;
  month: number | "all";
  scope: CommissionAccessScope;
  ownSellerIds: Set<string>;
}): Promise<{
  lines: CommissionReportSourceLine[];
  monthsIncluded: CommissionReportsPayload["monthsIncluded"];
}> {
  const where: Prisma.CommissionReceiptLedgerLineWhereInput = {
    year: input.year,
    ...(input.month === "all" ? {} : { month: input.month }),
    closing: {
      status: "CLOSED",
      source: RECEIPT_CLOSING_SOURCE,
    },
  };

  const rows = await prisma.commissionReceiptLedgerLine.findMany({
    where,
    orderBy: [
      { month: "asc" },
      { settlementDate: "asc" },
      { nomusReceivableId: "asc" },
      { productCode: "asc" },
    ],
  });

  const byMonth = new Map<number, typeof rows>();
  for (const row of rows) {
    const list = byMonth.get(row.month) ?? [];
    list.push(row);
    byMonth.set(row.month, list);
  }

  const lines: CommissionReportSourceLine[] = [];
  const monthsIncluded: CommissionReportsPayload["monthsIncluded"] = [];

  for (const [month, monthRows] of [...byMonth.entries()].sort((a, b) => a[0] - b[0])) {
    const closingId = monthRows.find((r) => r.closingId)?.closingId ?? null;
    const apiLines = markReceivableReceivedAnchors(
      monthRows.map((row) => mapLedgerPrismaRowToApiLine(row))
    );
    const scoped = applyOwnScopeToLines(apiLines, input.scope, input.ownSellerIds);
    for (const line of scoped) {
      lines.push({
        ...line,
        year: input.year,
        month,
        periodStatus: "CLOSED",
        closingId,
      });
    }
    monthsIncluded.push({
      year: input.year,
      month,
      periodStatus: "CLOSED",
      closingId,
    });
  }

  return { lines, monthsIncluded };
}

async function loadSingleMonthSourceLines(input: {
  year: number;
  month: number;
  status: string | "all";
  scope: CommissionAccessScope;
  ownSellerIds: Set<string>;
}): Promise<{
  lines: CommissionReportSourceLine[];
  monthsIncluded: CommissionReportsPayload["monthsIncluded"];
}> {
  if (input.status === "PREVIEW") {
    const preview = await getReceiptClosingPreviewPage({
      year: input.year,
      month: input.month,
    });
    if (preview.mode === "CLOSED") {
      return { lines: [], monthsIncluded: [] };
    }
    const scoped = applyOwnScopeToLines(preview.lines, input.scope, input.ownSellerIds);
    return {
      lines: scoped.map((line) => ({
        ...line,
        year: input.year,
        month: input.month,
        periodStatus: "PREVIEW" as const,
        closingId: null,
      })),
      monthsIncluded: [
        {
          year: input.year,
          month: input.month,
          periodStatus: "PREVIEW",
          closingId: null,
        },
      ],
    };
  }

  const closed = await loadClosedLedgerSourceLines({
    year: input.year,
    month: input.month,
    scope: input.scope,
    ownSellerIds: input.ownSellerIds,
  });
  if (input.status === "CLOSED" || closed.lines.length > 0) {
    return closed;
  }

  // Sem fechamento: prévia rotulada (somente mês específico).
  const closedPage = await getReceiptClosingPage(input.year, input.month);
  if (closedPage.mode === "CLOSED") {
    const scoped = applyOwnScopeToLines(closedPage.lines, input.scope, input.ownSellerIds);
    return {
      lines: scoped.map((line) => ({
        ...line,
        year: input.year,
        month: input.month,
        periodStatus: "CLOSED" as const,
        closingId: closedPage.closing?.closingId ?? null,
      })),
      monthsIncluded: [
        {
          year: input.year,
          month: input.month,
          periodStatus: "CLOSED",
          closingId: closedPage.closing?.closingId ?? null,
        },
      ],
    };
  }

  const preview = await getReceiptClosingPreviewPage({
    year: input.year,
    month: input.month,
  });
  const scoped = applyOwnScopeToLines(preview.lines, input.scope, input.ownSellerIds);
  return {
    lines: scoped.map((line) => ({
      ...line,
      year: input.year,
      month: input.month,
      periodStatus: "PREVIEW" as const,
      closingId: null,
    })),
    monthsIncluded: [
      {
        year: input.year,
        month: input.month,
        periodStatus: "PREVIEW",
        closingId: null,
      },
    ],
  };
}

async function loadReportSource(input: {
  query: CommissionReportsQuery;
  scope: CommissionAccessScope;
}): Promise<{
  lines: CommissionReportSourceLine[];
  monthsIncluded: CommissionReportsPayload["monthsIncluded"];
}> {
  const ownSellerIds = await resolveOwnCanonicalSellerIds(input.scope);
  if (input.query.month === "all") {
    return loadClosedLedgerSourceLines({
      year: input.query.year,
      month: "all",
      scope: input.scope,
      ownSellerIds,
    });
  }
  return loadSingleMonthSourceLines({
    year: input.query.year,
    month: input.query.month,
    status: input.query.status,
    scope: input.scope,
    ownSellerIds,
  });
}

export async function getCommissionReportsPage(
  query: CommissionReportsQuery,
  scope: CommissionAccessScope
): Promise<CommissionReportsPayload> {
  const { lines, monthsIncluded } = await loadReportSource({ query, scope });
  if (lines.length === 0) {
    return buildEmptyCommissionReportsPayload(query);
  }
  return assembleCommissionReportsPayload(lines, query, monthsIncluded);
}

export async function exportCommissionReportsXlsx(
  query: CommissionReportsQuery,
  scope: CommissionAccessScope
): Promise<{ buffer: Buffer; filename: string }> {
  const { lines, monthsIncluded } = await loadReportSource({ query, scope });
  const payload = assembleCommissionReportsPayload(
    lines,
    { ...query, page: 1, pageSize: Math.max(lines.length, 1) },
    monthsIncluded
  );
  const records = filterCommissionReportRecords(
    lines.map(mapSourceLineToReportRecord),
    query
  );
  const wb = buildCommissionReportsExportWorkbook({
    sellers: payload.sellers,
    records,
    year: query.year,
    month: query.month,
  });
  return {
    buffer: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer,
    filename: buildCommissionReportsExportFilename(query.year, query.month),
  };
}
