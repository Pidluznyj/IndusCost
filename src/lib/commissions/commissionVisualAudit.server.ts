import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import type { CommissionAccessScope } from "./commissionAccessScope.js";
import { decimalToNumber, roundMoney } from "./commission-money.js";
import {
  buildVisualAuditCsv,
  buildVisualAuditNomusReference,
  buildVisualAuditRow,
  computeVisualAuditCards,
  enrichVisualAuditRowsWithSellerIdentity,
  filterRowsByAppraisalMode,
  type VisualAuditNomusReference,
  type VisualAuditRow,
  type VisualAuditRowInput,
} from "./commissionVisualAudit.js";
import {
  buildVisualAuditClosingCsv,
  buildVisualAuditClosingDetail,
  buildVisualAuditClosingRows,
  COMMISSION_VISUAL_AUDIT_CLOSING_RECONCILIATION_NOTE,
  COMMISSION_VISUAL_AUDIT_CLOSING_SCOPE_NOTE,
  countVisualAuditCriticalDivergenceReceivables,
  countVisualAuditRowsByCategory,
  filterVisualAuditClosingRows,
  mapClosingMaterializationToVisualAuditCards,
  type VisualAuditClosingRow,
  type VisualAuditOfficialCategory,
} from "./commissionVisualAuditOfficial.js";
import {
  buildReceiptClosingPageFromLedger,
  buildReceiptClosingPageFromPreview,
} from "./commissionReceiptClosingApi.js";
import {
  findClosedReceiptClosing,
  loadReceiptClosingLedgerLines,
  previewCommissionReceiptClosing,
  type ReceiptClosingFilters,
} from "./commissionReceiptClosing.server.js";
import type { ReceiptClosingPagePayload } from "./commissionReceiptClosingApi.shared.js";
import { resolveVisualAuditCustomerExclusion } from "./commissionCustomerExclusionApply.js";
import { loadCommissionSellerIdentityContext } from "./commissionSellerIdentity.server.js";
import {
  buildCommissionRecordsWhere,
  COMMISSION_CONFIRMED_STATUSES,
  paginatedMeta,
  resolvePeriodDateRange,
  type CommissionVisualAuditQuery,
} from "./commissionQuery.js";

export type CommissionVisualAuditPayload = {
  cards: ReturnType<typeof computeVisualAuditCards>;
  rows: Array<VisualAuditRow | VisualAuditClosingRow>;
  pagination: ReturnType<typeof paginatedMeta>;
  nomusReference: VisualAuditNomusReference;
  scopeNote?: string;
  reconciliationNote?: string;
  materializationSummary?: ReceiptClosingPagePayload["materializationSummary"];
  officialCards?: ReceiptClosingPagePayload["cards"];
  reconciliation?: ReceiptClosingPagePayload["reconciliation"];
  criticalDivergence?: boolean;
  criticalDivergenceReason?: string | null;
  categoryRowCounts?: Partial<Record<string, number>>;
  criticalDivergenceReceivableCount?: number;
};

type ArMeta = {
  settlementDate: Date | null;
  amountReceivable: number;
  amountReceived: number;
  balanceReceivable: number;
};

function documentKey(row: {
  commissionPersonId: string;
  nomusNfeId: number | null;
  nfeNumber: string | null;
  orderCode: string | null;
}): string {
  const nf = row.nomusNfeId ?? row.nfeNumber ?? row.orderCode ?? "—";
  return `${row.commissionPersonId}:${nf}`;
}

async function loadArMeta(ids: number[]): Promise<Map<number, ArMeta>> {
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id)))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.nomusAccountsReceivable.findMany({
    where: { externalId: { in: unique } },
    select: {
      externalId: true,
      settlementDate: true,
      amountReceivable: true,
      amountReceived: true,
      balanceReceivable: true,
    },
  });
  return new Map(
    rows.map((r) => [
      r.externalId,
      {
        settlementDate: r.settlementDate,
        amountReceivable: decimalToNumber(r.amountReceivable),
        amountReceived: decimalToNumber(r.amountReceived),
        balanceReceivable: decimalToNumber(r.balanceReceivable),
      },
    ])
  );
}

async function loadSettledReceivableIds(query: CommissionVisualAuditQuery): Promise<number[]> {
  const range = resolvePeriodDateRange(query);
  if (!range) return [];
  const rows = await prisma.nomusAccountsReceivable.findMany({
    where: {
      settlementDate: { gte: range.from, lte: range.to },
    },
    select: { externalId: true },
  });
  return rows.map((row) => row.externalId);
}

async function loadCustomerExceptionIds(): Promise<Set<number>> {
  const rows = await prisma.commissionCustomerException.findMany({
    where: { active: true },
    select: { customerExternalId: true },
  });
  return new Set(rows.map((r) => r.customerExternalId).filter((id): id is number => id != null));
}

function buildScopeWhere(
  query: CommissionVisualAuditQuery,
  scope: CommissionAccessScope
): Prisma.CommissionRecordWhereInput {
  return buildCommissionRecordsWhere(
    {
      year: null,
      month: null,
      from: null,
      to: null,
      periodBasis: "confirmedAt",
      status: null,
      statusIn: COMMISSION_CONFIRMED_STATUSES,
      originStage: null,
      commissionPersonId: query.commissionPersonId,
      orderCode: query.orderCode,
      nfeNumber: query.nfeNumber,
      customer: query.customer,
      sellerId: query.sellerId,
      representativeId: query.representativeId,
      hasRule: null,
      includeSuperseded: false,
      page: query.page,
      pageSize: query.pageSize,
    },
    scope,
    { periodBasis: "confirmedAt" }
  );
}

async function buildVisualAuditWhere(
  query: CommissionVisualAuditQuery,
  scope: CommissionAccessScope
): Promise<Prisma.CommissionRecordWhereInput> {
  const scopeWhere = buildScopeWhere(query, scope);

  if (query.appraisalMode === "PAYABLE") {
    const settledIds = await loadSettledReceivableIds(query);
    if (settledIds.length === 0) {
      return { id: { in: [] } };
    }
    const parts: Prisma.CommissionRecordWhereInput[] = [
      scopeWhere,
      {
        paymentSchedules: {
          some: {
            source: "ACCOUNTS_RECEIVABLE",
            nomusReceivableId: { in: settledIds },
          },
        },
      },
    ];
    if (query.nomusReceivableId != null) {
      parts.push({
        paymentSchedules: {
          some: {
            nomusReceivableId: query.nomusReceivableId,
            source: "ACCOUNTS_RECEIVABLE",
          },
        },
      });
    }
    return { AND: parts };
  }

  const periodWhere = buildCommissionRecordsWhere(
    {
      year: query.year,
      month: query.month,
      from: query.from,
      to: query.to,
      periodBasis: "confirmedAt",
      status: null,
      statusIn: COMMISSION_CONFIRMED_STATUSES,
      originStage: null,
      commissionPersonId: query.commissionPersonId,
      orderCode: query.orderCode,
      nfeNumber: query.nfeNumber,
      customer: query.customer,
      sellerId: query.sellerId,
      representativeId: query.representativeId,
      hasRule: null,
      includeSuperseded: false,
      page: query.page,
      pageSize: query.pageSize,
    },
    scope,
    { periodBasis: "confirmedAt" }
  );

  if (query.nomusReceivableId != null) {
    return {
      AND: [
        periodWhere,
        {
          paymentSchedules: {
            some: { nomusReceivableId: query.nomusReceivableId, source: "ACCOUNTS_RECEIVABLE" },
          },
        },
      ],
    };
  }
  return periodWhere;
}

function applyRowFilters(rows: VisualAuditRow[], query: CommissionVisualAuditQuery): VisualAuditRow[] {
  let filtered = rows;
  if (query.onlySettled) {
    filtered = filtered.filter(
      (r) => r.receivableTitleStatus === "BAIXADO" || r.receivableTitleStatus === "PARCIAL"
    );
  }
  if (query.onlyOpen) {
    filtered = filtered.filter((r) =>
      ["EM_ABERTO", "FUTURO", "VENCIDO", "PARCIAL"].includes(r.receivableTitleStatus)
    );
  }
  if (query.onlyDivergences) {
    filtered = filtered.filter((r) => r.alerts.length > 0 || r.commissionStatus === "DIVERGENTE");
  }
  if (query.onlyZeroCommission) {
    filtered = filtered.filter((r) => r.commissionStatus === "SEM_COMISSAO");
  }
  if (query.onlyMissingReceivableLink) {
    filtered = filtered.filter((r) => r.receivableTitleStatus === "SEM_VINCULO");
  }
  if (query.dueDateFrom || query.dueDateTo) {
    filtered = filtered.filter((r) => {
      if (!r.dueDate) return false;
      const due = new Date(r.dueDate).getTime();
      if (query.dueDateFrom && due < query.dueDateFrom.getTime()) return false;
      if (query.dueDateTo && due > query.dueDateTo.getTime()) return false;
      return true;
    });
  }
  if (query.settlementDateFrom || query.settlementDateTo) {
    filtered = filtered.filter((r) => {
      if (!r.settlementDate) return false;
      const st = new Date(r.settlementDate).getTime();
      if (query.settlementDateFrom && st < query.settlementDateFrom.getTime()) return false;
      if (query.settlementDateTo && st > query.settlementDateTo.getTime()) return false;
      return true;
    });
  }
  if (query.receivableTitleStatus) {
    filtered = filtered.filter((r) => r.receivableTitleStatus === query.receivableTitleStatus);
  }
  if (query.commissionStatus) {
    filtered = filtered.filter((r) => r.commissionStatus === query.commissionStatus);
  }
  return filtered;
}

async function buildVisualAuditRows(
  query: CommissionVisualAuditQuery,
  scope: CommissionAccessScope
): Promise<VisualAuditRow[]> {
  const where = await buildVisualAuditWhere(query, scope);
  const records = await prisma.commissionRecord.findMany({
    where,
    include: {
      commissionPerson: { select: { id: true, name: true } },
      paymentSchedules: {
        where: { source: "ACCOUNTS_RECEIVABLE" },
        orderBy: [{ dueDate: "asc" }, { installmentNumber: "asc" }],
      },
    },
    orderBy: [{ confirmedAt: "desc" }, { nfeNumber: "asc" }],
  });

  const docTotals = new Map<string, { base: number; commission: number }>();
  for (const record of records) {
    const key = documentKey(record);
    const entry = docTotals.get(key) ?? { base: 0, commission: 0 };
    entry.base = roundMoney(entry.base + decimalToNumber(record.baseAmount));
    entry.commission = roundMoney(entry.commission + decimalToNumber(record.commissionAmount));
    docTotals.set(key, entry);
  }

  const receivableIds = records.flatMap((r) =>
    r.paymentSchedules.map((s) => s.nomusReceivableId).filter((id): id is number => id != null)
  );
  const arMeta = await loadArMeta(receivableIds);
  const exceptionCustomers = await loadCustomerExceptionIds();
  const period = resolvePeriodDateRange(query);

  const inputs: VisualAuditRowInput[] = [];

  for (const record of records) {
    const docKey = documentKey(record);
    const docAgg = docTotals.get(docKey) ?? { base: 0, commission: 0 };
    const schedules = record.paymentSchedules;
    const recordRatePercent = decimalToNumber(record.ratePercent);
    const recordCommissionAmount = decimalToNumber(record.commissionAmount);

    if (schedules.length === 0) {
      const exclusionView = resolveVisualAuditCustomerExclusion({
        metadataJson: record.metadataJson,
        customerExternalId: record.customerExternalId,
        legacyExceptionCustomerIds: exceptionCustomers,
        commissionExpected: 0,
        commissionReleased: decimalToNumber(record.releasedAmount),
        itemRatePercent: recordRatePercent,
      });
      inputs.push({
        lineId: record.id,
        recordId: record.id,
        scheduleId: null,
        commissionPersonId: record.commissionPersonId,
        commissionPersonName: record.commissionPerson.name,
        nomusSellerId: record.nomusSellerId,
        customerExternalId: record.customerExternalId,
        customerName: record.customerName,
        orderCode: record.orderCode,
        nfeNumber: record.nfeNumber,
        nomusNfeId: record.nomusNfeId,
        confirmedAt: record.confirmedAt?.toISOString() ?? null,
        documentKey: docKey,
        documentBaseAmount: docAgg.base,
        documentCommissionTotal: docAgg.commission,
        itemBaseAmount: decimalToNumber(record.baseAmount),
        itemCommissionAmount: recordCommissionAmount,
        itemRatePercent: exclusionView.itemRatePercent,
        productCode: record.productCode,
        nomusReceivableId: null,
        installmentNumber: null,
        dueDate: null,
        settlementDate: null,
        receivableAmount: 0,
        receivedAmount: 0,
        openBalance: 0,
        allocationPercent: null,
        commissionExpected: exclusionView.commissionExpected,
        commissionReleased: exclusionView.commissionReleased,
        hasArLink: false,
        hasSchedule: false,
        customerNoCommission: exclusionView.customerNoCommission,
        isCommissionable: exclusionView.isCommissionable,
        exclusionReason: exclusionView.exclusionReason,
        exclusionRuleId: exclusionView.exclusionRuleId,
      });
      continue;
    }

    for (const schedule of schedules) {
      const ar =
        schedule.nomusReceivableId != null
          ? arMeta.get(schedule.nomusReceivableId)
          : undefined;
      const settlementDate = ar?.settlementDate?.toISOString() ?? null;

      if (query.appraisalMode === "PAYABLE" && period) {
        if (!settlementDate) continue;
        const settled = new Date(settlementDate).getTime();
        if (settled < period.from.getTime() || settled > period.to.getTime()) continue;
      }

      const exclusionView = resolveVisualAuditCustomerExclusion({
        metadataJson: record.metadataJson,
        customerExternalId: record.customerExternalId,
        legacyExceptionCustomerIds: exceptionCustomers,
        commissionExpected: decimalToNumber(schedule.commissionExpectedAmount),
        commissionReleased: decimalToNumber(schedule.commissionReleasedAmount),
        itemRatePercent: recordRatePercent,
      });

      inputs.push({
        lineId: `${record.id}:${schedule.id}`,
        recordId: record.id,
        scheduleId: schedule.id,
        commissionPersonId: record.commissionPersonId,
        commissionPersonName: record.commissionPerson.name,
        nomusSellerId: record.nomusSellerId,
        customerExternalId: record.customerExternalId,
        customerName: record.customerName,
        orderCode: record.orderCode,
        nfeNumber: record.nfeNumber,
        nomusNfeId: record.nomusNfeId,
        confirmedAt: record.confirmedAt?.toISOString() ?? null,
        documentKey: docKey,
        documentBaseAmount: docAgg.base,
        documentCommissionTotal: docAgg.commission,
        itemBaseAmount: decimalToNumber(record.baseAmount),
        itemCommissionAmount: recordCommissionAmount,
        itemRatePercent: exclusionView.itemRatePercent,
        productCode: record.productCode,
        nomusReceivableId: schedule.nomusReceivableId,
        installmentNumber: schedule.installmentNumber,
        dueDate: schedule.dueDate?.toISOString() ?? null,
        settlementDate,
        receivableAmount: roundMoney(
          ar?.amountReceivable ?? decimalToNumber(schedule.receivableAmount)
        ),
        receivedAmount: roundMoney(
          ar?.amountReceived ?? decimalToNumber(schedule.receivedAmount)
        ),
        openBalance: roundMoney(ar?.balanceReceivable ?? decimalToNumber(schedule.openBalance)),
        allocationPercent:
          schedule.allocationPercent != null
            ? decimalToNumber(schedule.allocationPercent)
            : null,
        commissionExpected: exclusionView.commissionExpected,
        commissionReleased: exclusionView.commissionReleased,
        hasArLink: ar != null,
        hasSchedule: true,
        customerNoCommission: exclusionView.customerNoCommission,
        isCommissionable: exclusionView.isCommissionable,
        exclusionReason: exclusionView.exclusionReason,
        exclusionRuleId: exclusionView.exclusionRuleId,
      });
    }
  }

  const identityCtx = await loadCommissionSellerIdentityContext(prisma);
  return enrichVisualAuditRowsWithSellerIdentity(inputs.map(buildVisualAuditRow), identityCtx);
}

async function listFilteredVisualAuditRows(
  query: CommissionVisualAuditQuery,
  scope: CommissionAccessScope
): Promise<VisualAuditRow[]> {
  let rows = await buildVisualAuditRows(query, scope);
  rows = applyRowFilters(rows, query);
  rows = filterRowsByAppraisalMode(rows, query.appraisalMode, resolvePeriodDateRange(query));
  return rows;
}

export type PayableVisualAuditRowsQuery = {
  year: number;
  month: number;
  commissionPersonId?: string | null;
  customer?: string | null;
  orderCode?: string | null;
  nfeNumber?: string | null;
  nomusReceivableId?: number | null;
  receivableTitleStatus?: string | null;
  commissionStatus?: string | null;
  onlyDivergences?: boolean;
};

export type ForecastVisualAuditRowsQuery = {
  commissionPersonId?: string | null;
  customer?: string | null;
  orderCode?: string | null;
  nfeNumber?: string | null;
  nomusReceivableId?: number | null;
  receivableTitleStatus?: string | null;
  commissionStatus?: string | null;
  dueDateFrom?: Date | null;
  dueDateTo?: Date | null;
  onlyDivergences?: boolean;
};

/** Linhas PAYABLE filtradas por settlementDate — base para auditoria mensal oficial. */
export async function listPayableVisualAuditRows(
  query: PayableVisualAuditRowsQuery,
  scope: CommissionAccessScope
): Promise<VisualAuditRow[]> {
  return listFilteredVisualAuditRows(
    {
      year: query.year,
      month: query.month,
      from: null,
      to: null,
      appraisalMode: "PAYABLE",
      commissionPersonId: query.commissionPersonId ?? null,
      customer: query.customer ?? null,
      orderCode: query.orderCode ?? null,
      nfeNumber: query.nfeNumber ?? null,
      sellerId: null,
      representativeId: null,
      nomusReceivableId: query.nomusReceivableId ?? null,
      dueDateFrom: null,
      dueDateTo: null,
      settlementDateFrom: null,
      settlementDateTo: null,
      onlySettled: false,
      onlyOpen: false,
      onlyDivergences: query.onlyDivergences ?? false,
      onlyZeroCommission: false,
      onlyMissingReceivableLink: false,
      receivableTitleStatus: query.receivableTitleStatus ?? null,
      commissionStatus: query.commissionStatus ?? null,
      nomusReferenceBase: null,
      nomusReferenceCommission: null,
      page: 1,
      pageSize: 100000,
    },
    scope
  );
}

/** Títulos em aberto — previsão por dueDate (sem filtro de confirmedAt). */
export async function listForecastVisualAuditRows(
  query: ForecastVisualAuditRowsQuery,
  scope: CommissionAccessScope
): Promise<VisualAuditRow[]> {
  return listFilteredVisualAuditRows(
    {
      year: null,
      month: null,
      from: null,
      to: null,
      appraisalMode: "FORECAST",
      commissionPersonId: query.commissionPersonId ?? null,
      customer: query.customer ?? null,
      orderCode: query.orderCode ?? null,
      nfeNumber: query.nfeNumber ?? null,
      sellerId: null,
      representativeId: null,
      nomusReceivableId: query.nomusReceivableId ?? null,
      dueDateFrom: query.dueDateFrom ?? null,
      dueDateTo: query.dueDateTo ?? null,
      settlementDateFrom: null,
      settlementDateTo: null,
      onlySettled: false,
      onlyOpen: true,
      onlyDivergences: query.onlyDivergences ?? false,
      onlyZeroCommission: false,
      onlyMissingReceivableLink: false,
      receivableTitleStatus: query.receivableTitleStatus ?? null,
      commissionStatus: query.commissionStatus ?? null,
      nomusReferenceBase: null,
      nomusReferenceCommission: null,
      page: 1,
      pageSize: 100000,
    },
    scope
  );
}

function buildPayableVisualAuditBaseQuery(
  year: number,
  month: number,
  overrides: Partial<CommissionVisualAuditQuery> = {}
): CommissionVisualAuditQuery {
  return {
    year,
    month,
    from: null,
    to: null,
    appraisalMode: "PAYABLE",
    commissionPersonId: null,
    customer: null,
    orderCode: null,
    nfeNumber: null,
    sellerId: null,
    representativeId: null,
    nomusReceivableId: null,
    dueDateFrom: null,
    dueDateTo: null,
    settlementDateFrom: null,
    settlementDateTo: null,
    onlySettled: false,
    onlyOpen: false,
    onlyDivergences: false,
    onlyZeroCommission: false,
    onlyMissingReceivableLink: false,
    receivableTitleStatus: null,
    commissionStatus: null,
    nomusReferenceBase: null,
    nomusReferenceCommission: null,
    auditCategory: null,
    status: null,
    statusIn: null,
    originStage: null,
    hasRule: null,
    includeSuperseded: false,
    page: 1,
    pageSize: 100000,
    ...overrides,
  };
}

function parseAuditCategory(value: string | null | undefined): VisualAuditOfficialCategory | null {
  if (!value?.trim()) return null;
  const raw = value.trim().toUpperCase();
  const allowed: VisualAuditOfficialCategory[] = [
    "COMMISSIONABLE",
    "CUSTOMER_EXCLUDED",
    "GROUP_COMPANY_EXCLUDED",
    "SELLER_UNRESOLVED",
    "NO_SELLER",
    "NO_SCHEDULE",
    "STALE_SCHEDULE",
    "NO_SALES_LINK",
    "DIVERGENT",
    "OTHER",
  ];
  return allowed.includes(raw as VisualAuditOfficialCategory)
    ? (raw as VisualAuditOfficialCategory)
    : null;
}

async function loadVisualAuditClosingUniverse(
  query: CommissionVisualAuditQuery
): Promise<ReceiptClosingPagePayload> {
  const year = query.year!;
  const month = query.month!;
  const filters: ReceiptClosingFilters = {
    year,
    month,
    seller: null,
    customer: null,
    nomusBase: query.nomusReferenceBase,
    nomusCommission: query.nomusReferenceCommission,
  };

  const closing = await findClosedReceiptClosing(prisma, year, month);
  if (closing) {
    const ledgerLines = await loadReceiptClosingLedgerLines(prisma, closing.closingId);
    return buildReceiptClosingPageFromLedger({
      closing,
      ledgerLines,
      nomusBase: filters.nomusBase,
      nomusCommission: filters.nomusCommission,
    });
  }

  const previewPayload = await previewCommissionReceiptClosing(filters);
  return buildReceiptClosingPageFromPreview({
    preview: previewPayload.preview,
    closing: previewPayload.existingClosing,
    canApply: previewPayload.canApply,
    applyBlockedReason: previewPayload.applyBlockedReason,
    nomusBase: filters.nomusBase,
    nomusCommission: filters.nomusCommission,
  });
}

async function listCommissionVisualAuditClosingPage(
  query: CommissionVisualAuditQuery,
  _scope: CommissionAccessScope
): Promise<CommissionVisualAuditPayload> {
  const closingPage = await loadVisualAuditClosingUniverse(query);
  const allRows = buildVisualAuditClosingRows(closingPage);
  const auditCategory = parseAuditCategory(query.auditCategory);
  const filtered = filterVisualAuditClosingRows(allRows, {
    commissionPersonId: query.commissionPersonId,
    customer: query.customer,
    orderCode: query.orderCode,
    nfeNumber: query.nfeNumber,
    nomusReceivableId: query.nomusReceivableId,
    auditCategory,
    onlyDivergences: query.onlyDivergences,
  });

  const cards = mapClosingMaterializationToVisualAuditCards(
    closingPage.materializationSummary,
    closingPage.cards,
    closingPage.reconciliation
  );
  const total = filtered.length;
  const skip = (query.page - 1) * query.pageSize;
  const pageRows = filtered.slice(skip, skip + query.pageSize);

  return {
    cards,
    rows: pageRows,
    pagination: paginatedMeta(total, query.page, query.pageSize),
    nomusReference: buildVisualAuditNomusReference({
      mode: "PAYABLE",
      cards,
      nomusBase: query.nomusReferenceBase,
      nomusCommission: query.nomusReferenceCommission,
    }),
    scopeNote: COMMISSION_VISUAL_AUDIT_CLOSING_SCOPE_NOTE,
    reconciliationNote: COMMISSION_VISUAL_AUDIT_CLOSING_RECONCILIATION_NOTE,
    materializationSummary: closingPage.materializationSummary,
    officialCards: closingPage.cards,
    reconciliation: closingPage.reconciliation,
    criticalDivergence: closingPage.criticalDivergence,
    criticalDivergenceReason: closingPage.criticalDivergenceReason,
    categoryRowCounts: countVisualAuditRowsByCategory(allRows),
    criticalDivergenceReceivableCount: countVisualAuditCriticalDivergenceReceivables(allRows),
  };
}

export async function listCommissionVisualAuditPage(
  query: CommissionVisualAuditQuery,
  scope: CommissionAccessScope
): Promise<CommissionVisualAuditPayload> {
  if (query.appraisalMode === "PAYABLE" && query.year != null && query.month != null) {
    return listCommissionVisualAuditClosingPage(query, scope);
  }

  const rows = await listFilteredVisualAuditRows(query, scope);
  const cards = computeVisualAuditCards(rows, query.appraisalMode);
  const total = rows.length;
  const skip = (query.page - 1) * query.pageSize;
  const pageRows = rows.slice(skip, skip + query.pageSize);

  return {
    cards,
    rows: pageRows,
    pagination: paginatedMeta(total, query.page, query.pageSize),
    nomusReference: buildVisualAuditNomusReference({
      mode: query.appraisalMode,
      cards,
      nomusBase: query.nomusReferenceBase,
      nomusCommission: query.nomusReferenceCommission,
    }),
  };
}

export async function exportCommissionVisualAuditCsv(
  query: CommissionVisualAuditQuery,
  scope: CommissionAccessScope
): Promise<string> {
  if (query.appraisalMode === "PAYABLE" && query.year != null && query.month != null) {
    const closingPage = await loadVisualAuditClosingUniverse(query);
    const allRows = buildVisualAuditClosingRows(closingPage);
    const auditCategory = parseAuditCategory(query.auditCategory);
    const filtered = filterVisualAuditClosingRows(allRows, {
      commissionPersonId: query.commissionPersonId,
      customer: query.customer,
      orderCode: query.orderCode,
      nfeNumber: query.nfeNumber,
      nomusReceivableId: query.nomusReceivableId,
      auditCategory,
      onlyDivergences: query.onlyDivergences,
    });
    return buildVisualAuditClosingCsv(filtered, closingPage);
  }

  const rows = await listFilteredVisualAuditRows(query, scope);
  const cards = computeVisualAuditCards(rows, query.appraisalMode);
  return buildVisualAuditCsv(rows, cards);
}

export async function getCommissionVisualAuditDetail(input: {
  lineId: string;
  scope: CommissionAccessScope;
  year?: number | null;
  month?: number | null;
  appraisalMode?: string | null;
}): Promise<{
  explanation: string;
  record: {
    id?: string;
    productCode: string | null;
    baseAmount: number;
    ratePercent: number;
    commissionAmount: number;
    metadataJson?: unknown;
  } | null;
  schedule: VisualAuditRow | VisualAuditClosingRow | null;
  documentTotals: { base: number; commission: number };
} | null> {
  if (
    (input.appraisalMode === "PAYABLE" || input.appraisalMode == null) &&
    input.year != null &&
    input.month != null
  ) {
    const closingPage = await loadVisualAuditClosingUniverse(
      buildPayableVisualAuditBaseQuery(input.year, input.month)
    );
    const row = buildVisualAuditClosingRows(closingPage).find((r) => r.lineId === input.lineId);
    if (row) {
      const detail = buildVisualAuditClosingDetail(row);
      return {
        explanation: detail.explanation,
        record: detail.record,
        schedule: row,
        documentTotals: detail.documentTotals,
      };
    }
  }

  const [recordId, scheduleId] = input.lineId.includes(":")
    ? input.lineId.split(":")
    : [input.lineId, null];

  const record = await prisma.commissionRecord.findUnique({
    where: { id: recordId },
    select: {
      id: true,
      productCode: true,
      baseAmount: true,
      ratePercent: true,
      commissionAmount: true,
      metadataJson: true,
      nfeNumber: true,
      orderCode: true,
      commissionPersonId: true,
      nomusNfeId: true,
    },
  });
  if (!record) return null;

  const rows = await buildVisualAuditRows(
    {
      year: null,
      month: null,
      from: null,
      to: null,
      appraisalMode: "GENERATED",
      commissionPersonId: record.commissionPersonId,
      customer: null,
      orderCode: record.orderCode,
      nfeNumber: record.nfeNumber,
      sellerId: null,
      representativeId: null,
      nomusReceivableId: null,
      dueDateFrom: null,
      dueDateTo: null,
      settlementDateFrom: null,
      settlementDateTo: null,
      onlySettled: false,
      onlyOpen: false,
      onlyDivergences: false,
      onlyZeroCommission: false,
      onlyMissingReceivableLink: false,
      receivableTitleStatus: null,
      commissionStatus: null,
      nomusReferenceBase: null,
      nomusReferenceCommission: null,
      auditCategory: null,
      page: 1,
      pageSize: 10000,
    },
    input.scope
  );

  const scheduleRow = scheduleId
    ? rows.find((r) => r.scheduleId === scheduleId) ?? null
    : rows.find((r) => r.recordId === recordId) ?? null;

  const docKey = documentKey(record);
  const docRows = rows.filter((r) => r.documentKey === docKey);
  const documentTotals = {
    base: docRows[0]?.documentBaseAmount ?? decimalToNumber(record.baseAmount),
    commission: docRows[0]?.documentCommissionTotal ?? decimalToNumber(record.commissionAmount),
  };

  let explanation = `NF ${record.nfeNumber ?? "—"} gerou R$ ${documentTotals.commission.toFixed(2)} de comissão total.`;
  if (scheduleRow?.nomusReceivableId) {
    const share = scheduleRow.allocationPercent ?? scheduleRow.financialSharePercent ?? 0;
    explanation += ` O título ${scheduleRow.nomusReceivableId} (parcela ${scheduleRow.installmentNumber ?? "—"}) representa ${share}% do valor financeiro vinculado, com base rateada de R$ ${scheduleRow.allocatedBaseAmount.toFixed(2)} e comissão prevista de R$ ${scheduleRow.commissionExpected.toFixed(2)}.`;
    if (scheduleRow.settlementDate) {
      explanation += ` Baixa em ${new Date(scheduleRow.settlementDate).toLocaleDateString("pt-BR")} — comissão liberada R$ ${scheduleRow.commissionReleased.toFixed(2)}.`;
    } else {
      explanation += " Aguardando baixa no Contas a Receber para liberação.";
    }
  }

  return {
    explanation,
    record: {
      id: record.id,
      productCode: record.productCode,
      baseAmount: decimalToNumber(record.baseAmount),
      ratePercent: decimalToNumber(record.ratePercent),
      commissionAmount: decimalToNumber(record.commissionAmount),
      metadataJson: record.metadataJson,
    },
    schedule: scheduleRow,
    documentTotals,
  };
}
