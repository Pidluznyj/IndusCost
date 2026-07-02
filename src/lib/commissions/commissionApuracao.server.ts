import type { CommissionRecordStatus, Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import type { CommissionAccessScope } from "./commissionAccessScope.js";
import {
  buildApuracaoLines,
  apuracaoLineToCsvRow,
  computeApuracaoTotals,
  type CommissionApuracaoDiagnostics,
  type CommissionApuracaoLine,
  type CommissionApuracaoLineStatus,
  type CommissionApuracaoRecordInput,
  type CommissionApuracaoTotals,
} from "./commissionApuracao.js";
import { decimalToNumber } from "./commission-money.js";
import {
  buildCommissionRecordsWhere,
  paginatedMeta,
  type CommissionApuracaoQuery,
} from "./commissionQuery.js";
import {
  COMMISSION_CONFIRMED_STATUSES,
  COMMISSION_FORECAST_STATUSES,
} from "./commissionQuery.js";

export type CommissionApuracaoPagePayload = {
  totals: CommissionApuracaoTotals;
  lines: CommissionApuracaoLine[];
  diagnostics: CommissionApuracaoDiagnostics;
  pagination: ReturnType<typeof paginatedMeta>;
};

const APURACAO_ACTIVE_STATUSES: CommissionRecordStatus[] = [
  ...COMMISSION_FORECAST_STATUSES,
  ...COMMISSION_CONFIRMED_STATUSES,
  "ERROR",
];

function resolveApuracaoStatusIn(query: CommissionApuracaoQuery): CommissionRecordStatus[] {
  if (query.apuracaoStatus) {
    return mapApuracaoFilterToRecordStatuses(query.apuracaoStatus);
  }
  return APURACAO_ACTIVE_STATUSES;
}

function mapApuracaoFilterToRecordStatuses(
  status: CommissionApuracaoLineStatus
): CommissionRecordStatus[] {
  switch (status) {
    case "CALCULADA":
      return ["FORECAST_FROM_ORDER", "WAITING_NFE", "CONFIRMED_BY_OUTPUT_DOCUMENT"];
    case "PENDENTE_RECEBIMENTO":
      return ["WAITING_RECEIVABLE", "WAITING_PAYMENT", "CONFIRMED_BY_OUTPUT_DOCUMENT"];
    case "LIBERADA":
      return ["PARTIALLY_RELEASED", "RELEASED"];
    case "PAGA":
      return ["PAID_PARTIAL", "PAID_TOTAL"];
    case "DIVERGENTE":
    case "BLOQUEADA":
      return ["ERROR", "CANCELLED", "REVERSED"];
    default:
      return APURACAO_ACTIVE_STATUSES;
  }
}

async function buildApuracaoWhere(
  query: CommissionApuracaoQuery,
  scope: CommissionAccessScope
): Promise<Prisma.CommissionRecordWhereInput> {
  const statusIn = resolveApuracaoStatusIn(query);
  const base = buildCommissionRecordsWhere(
    {
      ...query,
      statusIn,
      status: null,
    },
    scope,
    { periodBasis: query.periodBasis ?? "confirmedAt" }
  );

  const andParts: Prisma.CommissionRecordWhereInput[] = [base];

  if (query.receivableCode) {
    const receivableId = Number.parseInt(query.receivableCode, 10);
    if (Number.isFinite(receivableId)) {
      andParts.push({
        paymentSchedules: { some: { nomusReceivableId: receivableId } },
      });
    }
  }

  if (andParts.length === 1) return andParts[0]!;
  return { AND: andParts };
}

function expandRecordsToInputs(
  rows: Awaited<ReturnType<typeof fetchApuracaoRecords>>,
  auditByRecordId: Map<string, string[]>
): CommissionApuracaoRecordInput[] {
  const inputs: CommissionApuracaoRecordInput[] = [];

  for (const row of rows) {
    const base: Omit<CommissionApuracaoRecordInput, "schedule"> = {
      id: row.id,
      status: row.status,
      orderCode: row.orderCode,
      nfeNumber: row.nfeNumber,
      nomusNfeId: row.nomusNfeId,
      customerName: row.customerName,
      productCode: row.productCode,
      productName: row.productName,
      baseAmount: decimalToNumber(row.baseAmount),
      ratePercent: decimalToNumber(row.ratePercent),
      commissionAmount: decimalToNumber(row.commissionAmount),
      releasedAmount: decimalToNumber(row.releasedAmount),
      paidAmount: decimalToNumber(row.paidAmount),
      balanceAmount: decimalToNumber(row.balanceAmount),
      calculatedAt: row.calculatedAt.toISOString(),
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      commissionPersonId: row.commissionPersonId,
      commissionPersonName: row.commissionPerson.name,
      metadataJson: row.metadataJson,
      hasOpenAuditIssue: auditByRecordId.has(row.id),
      auditIssueTypes: auditByRecordId.get(row.id) ?? [],
    };

    const schedules = row.paymentSchedules.filter((s) => s.source === "ACCOUNTS_RECEIVABLE");
    if (schedules.length === 0) {
      inputs.push({ ...base, schedule: null });
      continue;
    }

    for (const schedule of schedules) {
      inputs.push({
        ...base,
        schedule: {
          id: schedule.id,
          nomusReceivableId: schedule.nomusReceivableId,
          installmentNumber: schedule.installmentNumber,
          dueDate: schedule.dueDate?.toISOString() ?? null,
          receivableAmount: decimalToNumber(schedule.receivableAmount),
          receivedAmount: decimalToNumber(schedule.receivedAmount),
          commissionExpectedAmount: decimalToNumber(schedule.commissionExpectedAmount),
          commissionReleasedAmount: decimalToNumber(schedule.commissionReleasedAmount),
        },
      });
    }
  }

  return inputs;
}

async function fetchApuracaoRecords(where: Prisma.CommissionRecordWhereInput) {
  return prisma.commissionRecord.findMany({
    where,
    include: {
      commissionPerson: { select: { id: true, name: true, nomusPersonId: true, source: true } },
      paymentSchedules: {
        orderBy: [{ dueDate: "asc" }, { installmentNumber: "asc" }],
      },
    },
    orderBy: [{ confirmedAt: "desc" }, { calculatedAt: "desc" }],
  });
}

async function loadAuditTypesByRecordIds(recordIds: string[]): Promise<Map<string, string[]>> {
  if (recordIds.length === 0) return new Map();
  const issues = await prisma.commissionAuditIssue.findMany({
    where: { resolved: false },
    select: { type: true, metadataJson: true },
    take: 2000,
  });
  const map = new Map<string, string[]>();
  const idSet = new Set(recordIds);
  for (const issue of issues) {
    const meta = issue.metadataJson as Record<string, unknown> | null;
    const recordId = typeof meta?.recordId === "string" ? meta.recordId : null;
    if (!recordId || !idSet.has(recordId)) continue;
    const list = map.get(recordId) ?? [];
    list.push(issue.type);
    map.set(recordId, list);
  }
  return map;
}

function applyLineFilters(
  lines: CommissionApuracaoLine[],
  query: CommissionApuracaoQuery
): CommissionApuracaoLine[] {
  let filtered = lines;
  if (query.apuracaoStatus) {
    filtered = filtered.filter((l) => l.apuracaoStatus === query.apuracaoStatus);
  }
  if (query.onlyDivergences) {
    filtered = filtered.filter((l) => l.apuracaoStatus === "DIVERGENTE");
  }
  if (query.onlyPayable) {
    filtered = filtered.filter((l) => l.isPayable);
  }
  return filtered;
}

function buildDiagnostics(
  rows: Awaited<ReturnType<typeof fetchApuracaoRecords>>,
  periodBasis: "confirmedAt" | "calculatedAt"
): CommissionApuracaoDiagnostics {
  const recordsInPeriod = rows.length;
  const recordsConfirmedStatus = rows.filter((r) =>
    COMMISSION_CONFIRMED_STATUSES.includes(r.status)
  ).length;
  const recordsForecastOnly = rows.filter((r) =>
    COMMISSION_FORECAST_STATUSES.includes(r.status)
  ).length;
  const recordsWithoutConfirmedAt = rows.filter((r) => !r.confirmedAt).length;

  let message: string | null = null;
  if (recordsInPeriod === 0) {
    message =
      "Nenhum registro encontrado no período. Verifique se o recálculo foi executado e se o filtro usa a data de confirmação (NF-e).";
  } else if (recordsForecastOnly > 0 && recordsConfirmedStatus === 0) {
    message = `${recordsForecastOnly} registro(s) previsto(s) no período, mas nenhum confirmado por NF-e. Execute recálculo após emissão das NF-es.`;
  } else if (recordsWithoutConfirmedAt > 0) {
    message = `${recordsWithoutConfirmedAt} registro(s) sem data de confirmação — filtro alternativo por data de cálculo pode ser necessário.`;
  }

  return {
    recordsInPeriod,
    recordsConfirmedStatus,
    recordsForecastOnly,
    recordsWithoutConfirmedAt,
    periodBasis,
    message,
  };
}

export async function listCommissionApuracaoPage(
  query: CommissionApuracaoQuery,
  scope: CommissionAccessScope
): Promise<CommissionApuracaoPagePayload> {
  const periodBasis = query.periodBasis ?? "confirmedAt";
  const where = await buildApuracaoWhere(query, scope);
  const rows = await fetchApuracaoRecords(where);
  const auditByRecordId = await loadAuditTypesByRecordIds(rows.map((r) => r.id));
  const inputs = expandRecordsToInputs(rows, auditByRecordId);
  let lines = buildApuracaoLines(inputs);
  lines = applyLineFilters(lines, query);

  const nomusReference =
    query.nomusReferenceBase != null || query.nomusReferenceCommission != null
      ? {
          base: query.nomusReferenceBase,
          commission: query.nomusReferenceCommission,
        }
      : undefined;

  const totals = computeApuracaoTotals(lines, nomusReference);
  const total = lines.length;
  const skip = (query.page - 1) * query.pageSize;
  const pageLines = lines.slice(skip, skip + query.pageSize);

  return {
    totals,
    lines: pageLines,
    diagnostics: buildDiagnostics(rows, periodBasis),
    pagination: paginatedMeta(total, query.page, query.pageSize),
  };
}

export function buildApuracaoCsv(lines: CommissionApuracaoLine[]): string {
  const headers = [
    "vendedor",
    "cliente",
    "pedido",
    "nfe",
    "contaReceber",
    "valorDuplicata",
    "baseCalculo",
    "percentual",
    "comissao",
    "comissaoLiberada",
    "comissaoPaga",
    "saldo",
    "faixa",
    "regra",
    "status",
    "motivo",
  ];
  const escape = (v: string | number) => {
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const rows = lines.map((line) => {
    const row = apuracaoLineToCsvRow(line);
    return headers.map((h) => escape(row[h] ?? "")).join(",");
  });
  return [headers.join(","), ...rows].join("\n");
}

export async function exportCommissionApuracaoCsv(
  query: CommissionApuracaoQuery,
  scope: CommissionAccessScope
): Promise<string> {
  const where = await buildApuracaoWhere(query, scope);
  const rows = await fetchApuracaoRecords(where);
  const auditByRecordId = await loadAuditTypesByRecordIds(rows.map((r) => r.id));
  const inputs = expandRecordsToInputs(rows, auditByRecordId);
  let lines = buildApuracaoLines(inputs);
  lines = applyLineFilters(lines, query);
  return buildApuracaoCsv(lines);
}
