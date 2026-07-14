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
  resolveCommissionReportMonths,
  type CommissionReportSourceLine,
  type CommissionReportsMonthsFilter,
  type CommissionReportsPayload,
  type CommissionReportsQuery,
} from "./commissionReports.shared.js";
import { applyActiveCustomerExclusionsToReportLines } from "./commissionReportsCustomerExclusion.js";
import { loadActiveCustomerExclusionRuleSnapshots } from "./commissionCustomerExclusionRules.server.js";
import {
  COMMISSION_RECEIPT_AMBIGUOUS_SALES_LINK_REASON,
  resolveUniqueSalesOrderFromNfeLinkCandidates,
} from "./commissionSalesOrderNfeLinkResolution.js";
import {
  reconcileReportLineWithOfficialSnapshot,
  reportLineMisclassifiedAgainstSnapshot,
  type OfficialCommissionSnapshotRef,
} from "./commissionReportOfficialReconcile.js";
import { decimalToNumber } from "./commission-money.js";
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
  const isGroupCompany = row.status === "GROUP_COMPANY_EXCLUDED";
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
    linkResolutionSource: null,
    linkResolutionStatus: null,
    nomusNfeId: row.nomusNfeId,
    nfeNumber: row.nfeNumber,
    localItemId: null,
    nomusOrderItemId: null,
    productCode: row.productCode,
    productName: row.productNameSnapshot,
    rawSellerId: row.rawSellerId,
    rawSellerName: row.rawSellerName,
    // CUSTOMER_EXCLUDED mantém vendedor atribuível (filtro Relatórios); grupo zera.
    canonicalSellerId: isGroupCompany ? null : row.canonicalSellerId,
    canonicalSellerName: isGroupCompany ? null : row.canonicalSellerName,
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
  months: number[];
  scope: CommissionAccessScope;
  ownSellerIds: Set<string>;
}): Promise<{
  lines: CommissionReportSourceLine[];
  monthsIncluded: CommissionReportsPayload["monthsIncluded"];
}> {
  if (input.months.length === 0) {
    return { lines: [], monthsIncluded: [] };
  }

  const where: Prisma.CommissionReceiptLedgerLineWhereInput = {
    year: input.year,
    month: { in: input.months },
    closing: {
      status: "CLOSED",
      source: RECEIPT_CLOSING_SOURCE,
    },
  };

  const rows = await prisma.commissionReceiptLedgerLine.findMany({
    where,
    orderBy: [
      { month: "asc" },
      { settlementDate: "desc" },
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

  for (const month of input.months) {
    const monthRows = byMonth.get(month);
    if (!monthRows || monthRows.length === 0) continue;
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

async function loadPreviewMonthSourceLines(input: {
  year: number;
  month: number;
  scope: CommissionAccessScope;
  ownSellerIds: Set<string>;
}): Promise<{
  lines: CommissionReportSourceLine[];
  monthsIncluded: CommissionReportsPayload["monthsIncluded"];
}> {
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

async function attachLocalOrderIdsToReportLines(
  lines: CommissionReportSourceLine[]
): Promise<CommissionReportSourceLine[]> {
  const missingCodes = [
    ...new Set(
      lines
        .filter((line) => !line.localOrderId && Boolean(line.orderCode?.trim()))
        .map((line) => line.orderCode!.trim())
    ),
  ];
  const nfeIds = [
    ...new Set(
      lines
        .map((line) => line.nomusNfeId)
        .filter((id): id is number => id != null && Number.isFinite(id) && id > 0)
    ),
  ];

  const [orders, nfeLinks] = await Promise.all([
    missingCodes.length > 0
      ? prisma.salesOrder.findMany({
          where: { orderCode: { in: missingCodes } },
          select: { id: true, orderCode: true },
        })
      : Promise.resolve([]),
    nfeIds.length > 0
      ? prisma.salesOrderNfeLink.findMany({
          where: { nfeExternalId: { in: nfeIds } },
          select: { salesOrderId: true, nfeExternalId: true, orderCode: true },
        })
      : Promise.resolve([]),
  ]);

  const idsByCode = new Map<string, string[]>();
  for (const order of orders) {
    const list = idsByCode.get(order.orderCode) ?? [];
    list.push(order.id);
    idsByCode.set(order.orderCode, list);
  }
  const linksByNfe = new Map<number, Array<{ salesOrderId: string; orderCode: string | null }>>();
  for (const link of nfeLinks) {
    const list = linksByNfe.get(link.nfeExternalId) ?? [];
    list.push({ salesOrderId: link.salesOrderId, orderCode: link.orderCode });
    linksByNfe.set(link.nfeExternalId, list);
  }

  const withAmbiguousReason = (
    line: CommissionReportSourceLine
  ): CommissionReportSourceLine => ({
    ...line,
    localOrderId: null,
    linkResolutionSource: "AMBIGUOUS",
    linkResolutionStatus: "AMBIGUOUS",
    statusReason:
      line.statusReason?.includes("Vínculo ambíguo")
        ? line.statusReason
        : line.statusReason
          ? `${line.statusReason} · ${COMMISSION_RECEIPT_AMBIGUOUS_SALES_LINK_REASON}`
          : COMMISSION_RECEIPT_AMBIGUOUS_SALES_LINK_REASON,
  });

  return lines.map((line) => {
    const nfeId = line.nomusNfeId;
    if (nfeId != null && linksByNfe.has(nfeId)) {
      const resolution = resolveUniqueSalesOrderFromNfeLinkCandidates(
        linksByNfe.get(nfeId) ?? []
      );
      if (resolution.status === "AMBIGUOUS") {
        return withAmbiguousReason(line);
      }
      if (resolution.status === "OK") {
        return {
          ...line,
          localOrderId: resolution.salesOrderId,
          orderCode: line.orderCode ?? resolution.orderCode,
          linkResolutionSource: line.linkResolutionSource ?? "INVOICE_SALES_ORDER",
          linkResolutionStatus: "OK",
        };
      }
    }

    if (line.localOrderId) {
      return {
        ...line,
        linkResolutionSource: line.linkResolutionSource ?? "SCHEDULE",
        linkResolutionStatus: line.linkResolutionStatus ?? "OK",
      };
    }

    const code = line.orderCode?.trim();
    if (!code) {
      return {
        ...line,
        linkResolutionSource: line.linkResolutionSource ?? "UNRESOLVED",
        linkResolutionStatus: line.linkResolutionStatus ?? "UNRESOLVED",
      };
    }
    const idsForCode = idsByCode.get(code) ?? [];
    if (idsForCode.length > 1) {
      return withAmbiguousReason(line);
    }
    const localOrderId = idsForCode[0] ?? null;
    return {
      ...line,
      localOrderId,
      linkResolutionSource: localOrderId
        ? line.linkResolutionSource ?? "EXTERNAL_ID"
        : line.linkResolutionSource ?? "UNRESOLVED",
      linkResolutionStatus: localOrderId
        ? line.linkResolutionStatus ?? "OK"
        : line.linkResolutionStatus ?? "UNRESOLVED",
    };
  });
}

/**
 * Mesma regra do mês único: ledger CLOSED primeiro; se não houver fechamento e o status
 * permitir, carrega prévia. Assim "Todos os meses" / multi-mês não zeram quando o mês
 * individual ainda tem dados de prévia.
 */
async function loadReportSource(input: {
  query: CommissionReportsQuery;
  scope: CommissionAccessScope;
}): Promise<{
  lines: CommissionReportSourceLine[];
  monthsIncluded: CommissionReportsPayload["monthsIncluded"];
}> {
  const ownSellerIds = await resolveOwnCanonicalSellerIds(input.scope);
  const months = resolveCommissionReportMonths(input.query.months);
  const status = input.query.status;

  if (status === "PREVIEW") {
    const previews = await Promise.all(
      months.map((month) =>
        loadPreviewMonthSourceLines({
          year: input.query.year,
          month,
          scope: input.scope,
          ownSellerIds,
        })
      )
    );
    const lines: CommissionReportSourceLine[] = [];
    const monthsIncluded: CommissionReportsPayload["monthsIncluded"] = [];
    for (const part of previews) {
      for (const line of part.lines) {
        if (line.periodStatus === "PREVIEW") lines.push(line);
      }
      for (const meta of part.monthsIncluded) {
        if (meta.periodStatus === "PREVIEW") monthsIncluded.push(meta);
      }
    }
    return { lines, monthsIncluded };
  }

  const closed = await loadClosedLedgerSourceLines({
    year: input.query.year,
    months,
    scope: input.scope,
    ownSellerIds,
  });

  if (status === "CLOSED") {
    return closed;
  }

  const closedMonths = new Set(closed.monthsIncluded.map((m) => m.month));
  const missing = months.filter((m) => !closedMonths.has(m));
  if (missing.length === 0) {
    return closed;
  }

  const previews = await Promise.all(
    missing.map((month) =>
      loadPreviewMonthSourceLines({
        year: input.query.year,
        month,
        scope: input.scope,
        ownSellerIds,
      })
    )
  );

  const lines = [...closed.lines];
  const monthsIncluded = [...closed.monthsIncluded];
  for (const part of previews) {
    lines.push(...part.lines);
    monthsIncluded.push(...part.monthsIncluded);
  }
  monthsIncluded.sort((a, b) => a.month - b.month);
  return { lines, monthsIncluded };
}

/**
 * Ledger CLOSED pode estar stale (zerado/NO_MARGIN) após rematerialização do snapshot.
 * Exibição do relatório re-alinha ao CommissionOrderSnapshot / schedule ACTIVE —
 * sem alterar linhas persistidas nem comissão paga.
 */
export async function enrichReportLinesWithOfficialSnapshots(
  lines: CommissionReportSourceLine[]
): Promise<CommissionReportSourceLine[]> {
  if (lines.length === 0) return lines;

  const orderIds = [
    ...new Set(
      lines
        .map((line) => line.localOrderId)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
  const orderCodes = [
    ...new Set(
      lines
        .filter((line) => !line.localOrderId && Boolean(line.orderCode?.trim()))
        .map((line) => line.orderCode!.trim())
    ),
  ];

  const [byIdRows, byCodeOrders] = await Promise.all([
    orderIds.length > 0
      ? prisma.commissionOrderSnapshot.findMany({
          where: { salesOrderId: { in: orderIds }, status: "ACTIVE" },
          select: {
            salesOrderId: true,
            totalFinalCommissionAmount: true,
            totalSoldAmount: true,
            canonicalSellerId: true,
            canonicalSellerName: true,
            rawSellerId: true,
            rawSellerName: true,
            salesOrder: { select: { orderCode: true } },
            items: { select: { status: true } },
            receivableSchedules: {
              where: { status: "ACTIVE" },
              select: { scheduledCommissionAmount: true },
            },
          },
        })
      : Promise.resolve([]),
    orderCodes.length > 0
      ? prisma.salesOrder.findMany({
          where: { orderCode: { in: orderCodes } },
          select: { id: true, orderCode: true },
        })
      : Promise.resolve([]),
  ]);

  const missingIds = byCodeOrders
    .map((o) => o.id)
    .filter((id) => !byIdRows.some((r) => r.salesOrderId === id));

  const byCodeSnapshots =
    missingIds.length > 0
      ? await prisma.commissionOrderSnapshot.findMany({
          where: { salesOrderId: { in: missingIds }, status: "ACTIVE" },
          select: {
            salesOrderId: true,
            totalFinalCommissionAmount: true,
            totalSoldAmount: true,
            canonicalSellerId: true,
            canonicalSellerName: true,
            rawSellerId: true,
            rawSellerName: true,
            salesOrder: { select: { orderCode: true } },
            items: { select: { status: true } },
            receivableSchedules: {
              where: { status: "ACTIVE" },
              select: { scheduledCommissionAmount: true },
            },
          },
        })
      : [];

  const snapByOrderId = new Map<string, OfficialCommissionSnapshotRef>();
  const snapByOrderCode = new Map<string, OfficialCommissionSnapshotRef>();

  for (const row of [...byIdRows, ...byCodeSnapshots]) {
    const scheduledCommissionSum = row.receivableSchedules.reduce(
      (sum, s) => sum + decimalToNumber(s.scheduledCommissionAmount),
      0
    );
    const ref: OfficialCommissionSnapshotRef = {
      salesOrderId: row.salesOrderId,
      orderCode: row.salesOrder.orderCode,
      totalFinalCommissionAmount: decimalToNumber(row.totalFinalCommissionAmount),
      totalSoldAmount: decimalToNumber(row.totalSoldAmount),
      canonicalSellerId: row.canonicalSellerId,
      canonicalSellerName: row.canonicalSellerName,
      rawSellerId: row.rawSellerId,
      rawSellerName: row.rawSellerName,
      scheduledCommissionSum,
      itemStatuses: row.items.map((i) => i.status),
    };
    snapByOrderId.set(ref.salesOrderId, ref);
    if (ref.orderCode) snapByOrderCode.set(ref.orderCode, ref);
  }
  for (const order of byCodeOrders) {
    const snap = snapByOrderId.get(order.id);
    if (snap) snapByOrderCode.set(order.orderCode, snap);
  }

  return lines.map((line) => {
    const snap =
      (line.localOrderId ? snapByOrderId.get(line.localOrderId) : undefined) ??
      (line.orderCode ? snapByOrderCode.get(line.orderCode.trim()) : undefined);
    if (!snap) return line;
    if (
      !reportLineMisclassifiedAgainstSnapshot(
        {
          status: line.status,
          expectedCommissionAmount: line.expectedCommissionAmount,
          releasedCommissionAmount: line.releasedCommissionAmount,
        },
        snap
      )
    ) {
      return line;
    }
    const reconciled = reconcileReportLineWithOfficialSnapshot(
      {
        status: line.status,
        statusReason: line.statusReason,
        expectedCommissionAmount: line.expectedCommissionAmount,
        releasedCommissionAmount: line.releasedCommissionAmount,
        grossCommissionAmount: line.grossCommissionAmount,
        commissionableBaseAmount: line.commissionableBaseAmount,
        canonicalSellerId: line.canonicalSellerId,
        canonicalSellerName: line.canonicalSellerName,
        rawSellerId: line.rawSellerId,
        rawSellerName: line.rawSellerName,
        source: line.source,
        scheduledCommissionAmount: line.scheduledCommissionAmount,
      },
      snap
    );
    return {
      ...line,
      ...reconciled,
    };
  });
}

export async function getCommissionReportsPage(
  query: CommissionReportsQuery,
  scope: CommissionAccessScope
): Promise<CommissionReportsPayload> {
  const loaded = await loadReportSource({ query, scope });
  if (loaded.lines.length === 0) {
    return buildEmptyCommissionReportsPayload(query);
  }
  const withOrders = await attachLocalOrderIdsToReportLines(loaded.lines);
  const enriched = await enrichReportLinesWithOfficialSnapshots(withOrders);
  const exclusionRules = await loadActiveCustomerExclusionRuleSnapshots();
  const lines = applyActiveCustomerExclusionsToReportLines(enriched, exclusionRules);
  return assembleCommissionReportsPayload(lines, query, loaded.monthsIncluded);
}

export async function exportCommissionReportsXlsx(
  query: CommissionReportsQuery,
  scope: CommissionAccessScope
): Promise<{ buffer: Buffer; filename: string }> {
  const loaded = await loadReportSource({ query, scope });
  const withOrders = await attachLocalOrderIdsToReportLines(loaded.lines);
  const enriched = await enrichReportLinesWithOfficialSnapshots(withOrders);
  const exclusionRules = await loadActiveCustomerExclusionRuleSnapshots();
  const lines = applyActiveCustomerExclusionsToReportLines(enriched, exclusionRules);
  const payload = assembleCommissionReportsPayload(
    lines,
    { ...query, page: 1, pageSize: Math.max(lines.length, 1) },
    loaded.monthsIncluded
  );
  const records = filterCommissionReportRecords(
    lines.map(mapSourceLineToReportRecord),
    query
  );
  const months: CommissionReportsMonthsFilter = query.months;
  const wb = buildCommissionReportsExportWorkbook({
    sellers: payload.sellers,
    records,
    year: query.year,
    months,
    summary: payload.summary,
  });
  return {
    buffer: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer,
    filename: buildCommissionReportsExportFilename(query.year, months),
  };
}
