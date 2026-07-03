import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import type { CommissionAccessScope } from "./commissionAccessScope.js";
import { decimalToNumber, roundMoney } from "./commission-money.js";
import {
  buildVisualAuditCsv,
  buildVisualAuditNomusReference,
  buildVisualAuditRow,
  computeVisualAuditCards,
  filterRowsByAppraisalMode,
  type VisualAuditNomusReference,
  type VisualAuditRow,
  type VisualAuditRowInput,
} from "./commissionVisualAudit.js";
import {
  buildCommissionRecordsWhere,
  COMMISSION_CONFIRMED_STATUSES,
  paginatedMeta,
  resolvePeriodDateRange,
  type CommissionVisualAuditQuery,
} from "./commissionQuery.js";

export type CommissionVisualAuditPayload = {
  cards: ReturnType<typeof computeVisualAuditCards>;
  rows: VisualAuditRow[];
  pagination: ReturnType<typeof paginatedMeta>;
  nomusReference: VisualAuditNomusReference;
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
    const customerNoCommission =
      record.customerExternalId != null && exceptionCustomers.has(record.customerExternalId);

    if (schedules.length === 0) {
      inputs.push({
        lineId: record.id,
        recordId: record.id,
        scheduleId: null,
        commissionPersonId: record.commissionPersonId,
        commissionPersonName: record.commissionPerson.name,
        customerName: record.customerName,
        orderCode: record.orderCode,
        nfeNumber: record.nfeNumber,
        nomusNfeId: record.nomusNfeId,
        confirmedAt: record.confirmedAt?.toISOString() ?? null,
        documentKey: docKey,
        documentBaseAmount: docAgg.base,
        documentCommissionTotal: docAgg.commission,
        itemBaseAmount: decimalToNumber(record.baseAmount),
        itemCommissionAmount: decimalToNumber(record.commissionAmount),
        itemRatePercent: decimalToNumber(record.ratePercent),
        productCode: record.productCode,
        nomusReceivableId: null,
        installmentNumber: null,
        dueDate: null,
        settlementDate: null,
        receivableAmount: 0,
        receivedAmount: 0,
        openBalance: 0,
        allocationPercent: null,
        commissionExpected: 0,
        commissionReleased: decimalToNumber(record.releasedAmount),
        hasArLink: false,
        hasSchedule: false,
        customerNoCommission,
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

      inputs.push({
        lineId: `${record.id}:${schedule.id}`,
        recordId: record.id,
        scheduleId: schedule.id,
        commissionPersonId: record.commissionPersonId,
        commissionPersonName: record.commissionPerson.name,
        customerName: record.customerName,
        orderCode: record.orderCode,
        nfeNumber: record.nfeNumber,
        nomusNfeId: record.nomusNfeId,
        confirmedAt: record.confirmedAt?.toISOString() ?? null,
        documentKey: docKey,
        documentBaseAmount: docAgg.base,
        documentCommissionTotal: docAgg.commission,
        itemBaseAmount: decimalToNumber(record.baseAmount),
        itemCommissionAmount: decimalToNumber(record.commissionAmount),
        itemRatePercent: decimalToNumber(record.ratePercent),
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
        commissionExpected: decimalToNumber(schedule.commissionExpectedAmount),
        commissionReleased: decimalToNumber(schedule.commissionReleasedAmount),
        hasArLink: ar != null,
        hasSchedule: true,
        customerNoCommission,
      });
    }
  }

  return inputs.map(buildVisualAuditRow);
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
      page: 1,
      pageSize: 100000,
    },
    scope
  );
}

export async function listCommissionVisualAuditPage(
  query: CommissionVisualAuditQuery,
  scope: CommissionAccessScope
): Promise<CommissionVisualAuditPayload> {
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
  const rows = await listFilteredVisualAuditRows(query, scope);
  const cards = computeVisualAuditCards(rows, query.appraisalMode);
  return buildVisualAuditCsv(rows, cards);
}

export async function getCommissionVisualAuditDetail(input: {
  lineId: string;
  scope: CommissionAccessScope;
}): Promise<{
  explanation: string;
  record: {
    id: string;
    productCode: string | null;
    baseAmount: number;
    ratePercent: number;
    commissionAmount: number;
    metadataJson: unknown;
  } | null;
  schedule: VisualAuditRow | null;
  documentTotals: { base: number; commission: number };
} | null> {
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
