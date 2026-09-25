/**
 * Auditoria de cobertura de comissão (somente leitura).
 *
 * Para cada evento de recebimento responde: quando foi recebido, competência
 * natural, se já foi contemplado, por quem (Nomus/IndusCost), em qual fechamento e
 * valor, por que não, e se há risco de duplicidade. Base do script
 * `npm run audit:commission:coverage` e do bootstrap preview.
 */
import type { PrismaClient } from "@prisma/client";
import { decimalToNumber } from "./commission-money.js";
import { toCivilDateKey } from "../financeCivilDate.js";
import {
  COMMISSION_LEGACY_RECONCILIATION_START_DATE,
  COMMISSION_LEGACY_RECONCILIATION_START_YEAR_MONTH,
  COMMISSION_OFFICIAL_CUTOVER_DATE,
  COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH,
  civilDateToUtcDate,
  formatCommissionYearMonthKey,
  formatCommissionYearMonthLabel,
  listCommissionYearMonths,
  previousCommissionYearMonth,
  resolveReceiptNaturalYearMonth,
  type CommissionYearMonth,
} from "./commissionCoverageCutover.js";
import {
  COMMISSION_COVERAGE_STATE_LABELS,
  resolveCommissionReceiptCoverageState,
  type CommissionCoverageSource,
  type CommissionCoverageState,
} from "./commissionReceiptCoverage.shared.js";
import {
  loadLegacyCoverageImportContext,
  resolveMissingLegacyImports,
} from "./commissionReceiptCoverage.server.js";

export type CoverageAuditDb = Pick<
  PrismaClient,
  | "nomusReceivableReceipt"
  | "nomusAccountsReceivable"
  | "commissionReceiptCoverage"
  | "commissionReceivableSchedule"
  | "commissionReceiptLedgerLine"
  | "commissionLegacyCoverageImport"
>;

export type CommissionCoverageAuditRow = {
  receivableExternalId: number;
  nfeNumber: string | null;
  receiptExternalId: number;
  receiptDate: string;
  settlementDate: string | null;
  naturalCompetence: string;
  receivedAmount: number;
  state: CommissionCoverageState;
  stateLabel: string;
  coverageSource: CommissionCoverageSource | null;
  coverageStatus: string | null;
  coveredYear: number | null;
  coveredMonth: number | null;
  closingId: string | null;
  legacyImportId: string | null;
  associationMethod: string | null;
  coverageHistoryCount: number;
  scheduleId: string | null;
  scheduleStatus: string | null;
  installmentNumber: number | null;
  sellerName: string | null;
  commissionAmount: number | null;
  closedLedgerClosingIds: string[];
  duplicityRisk: boolean;
  reason: string;
};

export type CommissionCoverageAuditReport = {
  generatedAt: string;
  filters: {
    year: number | null;
    month: number | null;
    receivableIds: number[];
    seller: string | null;
  };
  rows: CommissionCoverageAuditRow[];
  totals: {
    receipts: number;
    coveredByNomus: number;
    coveredByInduscost: number;
    pending: number;
    legacyPendingCandidates: number;
    postCutoverPending: number;
    ambiguous: number;
    outsideWindow: number;
    receiptsWithoutSchedule: number;
    schedulesWithoutReceipt: number;
    duplicityRisks: number;
  };
  legacyImportRowsNotCovered: Array<{
    importId: string;
    reference: string;
    rowNumber: number;
    status: string;
    cr: number | null;
    nf: string | null;
    message: string;
  }>;
};

type ImportResultRow = {
  rowNumber?: number;
  status?: string;
  receivableExternalId?: number | null;
  message?: string;
  input?: { cr?: number | null; nf?: string | null };
};

function describeReason(input: {
  state: CommissionCoverageState;
  natural: CommissionYearMonth;
  coverage: {
    coverageSource: CommissionCoverageSource;
    coveredYear: number | null;
    coveredMonth: number | null;
    closingId: string | null;
    associationMethod: string;
  } | null;
  hasSchedule: boolean;
  missingImports: CommissionYearMonth[];
}): string {
  const covered = input.coverage;
  const coveredAt =
    covered?.coveredYear && covered.coveredMonth
      ? formatCommissionYearMonthLabel({ year: covered.coveredYear, month: covered.coveredMonth })
      : "—";
  switch (input.state) {
    case "LEGACY_OUTSIDE_RECONCILIATION_WINDOW":
      return `Antes de ${COMMISSION_LEGACY_RECONCILIATION_START_DATE.split("-").reverse().join("/")} — histórico do Nomus fora da janela de transição; nunca vira pendência automática.`;
    case "LEGACY_COVERED":
      return `Coberto pelo relatório Nomus de ${coveredAt} (associação ${covered?.associationMethod}).`;
    case "INDUSCOST_COVERED":
      return `Coberto pelo fechamento IndusCost de ${coveredAt}${covered?.closingId ? ` (${covered.closingId})` : ""}.`;
    case "AMBIGUOUS":
      return "A importação do Nomus não associou este título com segurança (vários recebimentos) — revisão manual.";
    case "LEGACY_PENDING_CANDIDATE":
      return input.missingImports.length > 0
        ? `Não encontrado na cobertura Nomus importada — falta importar ${input.missingImports.map(formatCommissionYearMonthLabel).join(", ")}. Não é dívida confirmada.`
        : "Não encontrado na cobertura histórica importada do Nomus (candidato a pendência legada).";
    case "POST_CUTOVER_PENDING":
      return input.hasSchedule
        ? "Pós-cutover sem fechamento IndusCost CLOSED que o contemple — pendente."
        : "Pós-cutover sem schedule ACTIVE — exceção diagnóstica (não inventa comissão).";
    default:
      return COMMISSION_COVERAGE_STATE_LABELS[input.state];
  }
}

export async function buildCommissionCoverageAudit(
  db: CoverageAuditDb,
  input: {
    year?: number | null;
    month?: number | null;
    receivableIds?: readonly number[];
    seller?: string | null;
  } = {}
): Promise<CommissionCoverageAuditReport> {
  const receivableIds = [...new Set(input.receivableIds ?? [])].filter((id) => Number.isInteger(id) && id > 0);
  const where =
    receivableIds.length > 0
      ? { receivableExternalId: { in: receivableIds } }
      : input.year && input.month
        ? {
            receiptDate: {
              gte: new Date(Date.UTC(input.year, input.month - 1, 1)),
              lte: new Date(Date.UTC(input.year, input.month, 0)),
            },
          }
        : { receiptDate: { gte: civilDateToUtcDate(COMMISSION_LEGACY_RECONCILIATION_START_DATE) } };

  const receipts = await db.nomusReceivableReceipt.findMany({
    where,
    select: { externalId: true, receivableExternalId: true, receiptDate: true, receivedAmount: true },
    orderBy: [{ receiptDate: "asc" }, { externalId: "asc" }],
  });
  const receiptIds = receipts.map((row) => row.externalId);
  const crIds = [...new Set([...receipts.map((row) => row.receivableExternalId), ...receivableIds])];

  const [receivables, coverage, schedules, ledgerLines, legacy, imports] = await Promise.all([
    crIds.length > 0
      ? db.nomusAccountsReceivable.findMany({
          where: { externalId: { in: crIds } },
          select: { externalId: true, sourceInvoiceNumber: true, settlementDate: true },
        })
      : Promise.resolve([]),
    receiptIds.length > 0
      ? db.commissionReceiptCoverage.findMany({
          where: { receiptExternalId: { in: receiptIds } },
          select: {
            receiptExternalId: true,
            coverageSource: true,
            coverageStatus: true,
            coveredYear: true,
            coveredMonth: true,
            closingId: true,
            legacyImportId: true,
            associationMethod: true,
            coveredCommissionAmount: true,
          },
        })
      : Promise.resolve([]),
    crIds.length > 0
      ? db.commissionReceivableSchedule.findMany({
          where: { receivableId: { in: crIds } },
          select: {
            id: true,
            receivableId: true,
            status: true,
            installmentNumber: true,
            scheduledCommissionAmount: true,
            canonicalSeller: { select: { name: true } },
          },
          orderBy: [{ createdAt: "desc" }],
        })
      : Promise.resolve([]),
    receiptIds.length > 0
      ? db.commissionReceiptLedgerLine.findMany({
          where: { receiptExternalIds: { hasSome: receiptIds }, closing: { status: "CLOSED" } },
          select: { closingId: true, receiptExternalIds: true },
        })
      : Promise.resolve([]),
    loadLegacyCoverageImportContext(db),
    db.commissionLegacyCoverageImport.findMany({
      where: { source: "NOMUS" },
      select: { id: true, referenceYear: true, referenceMonth: true, resultRowsJson: true },
    }),
  ]);

  const receivableById = new Map(receivables.map((row) => [row.externalId, row]));
  const activeCoverage = new Map<number, (typeof coverage)[number]>();
  const historyCount = new Map<number, number>();
  for (const row of coverage) {
    if (row.receiptExternalId == null) continue;
    historyCount.set(row.receiptExternalId, (historyCount.get(row.receiptExternalId) ?? 0) + 1);
    if (row.coverageStatus === "COVERED") activeCoverage.set(row.receiptExternalId, row);
  }
  const scheduleByCr = new Map<number, (typeof schedules)[number]>();
  for (const schedule of schedules) {
    const current = scheduleByCr.get(schedule.receivableId);
    if (!current || (current.status !== "ACTIVE" && schedule.status === "ACTIVE")) {
      scheduleByCr.set(schedule.receivableId, schedule);
    }
  }
  const closedClosingsByReceipt = new Map<number, Set<string>>();
  for (const line of ledgerLines) {
    if (!line.closingId) continue;
    for (const id of line.receiptExternalIds ?? []) {
      const set = closedClosingsByReceipt.get(id) ?? new Set<string>();
      set.add(line.closingId);
      closedClosingsByReceipt.set(id, set);
    }
  }

  const sellerFilter = input.seller?.trim().toLowerCase() || null;
  const rows: CommissionCoverageAuditRow[] = [];
  for (const receipt of receipts) {
    const receiptDate = toCivilDateKey(receipt.receiptDate);
    const natural = resolveReceiptNaturalYearMonth(receiptDate);
    if (!receiptDate || !natural) continue;
    const schedule = scheduleByCr.get(receipt.receivableExternalId) ?? null;
    const sellerName = schedule?.canonicalSeller?.name ?? null;
    if (sellerFilter && !(sellerName ?? "").toLowerCase().includes(sellerFilter)) continue;
    const active = activeCoverage.get(receipt.externalId) ?? null;
    const state = resolveCommissionReceiptCoverageState({
      receiptDate,
      activeCoverage: active,
      ambiguousLegacyAssociation: legacy.ambiguousReceivableIds.has(receipt.receivableExternalId),
    });
    const closedIds = [...(closedClosingsByReceipt.get(receipt.externalId) ?? [])].sort();
    const duplicityRisk =
      closedIds.length > 1 ||
      (active?.coverageSource === "NOMUS_LEGACY" && closedIds.length > 0) ||
      (active?.coverageSource === "INDUSCOST_CLOSING" &&
        active.closingId != null &&
        closedIds.length > 0 &&
        !closedIds.includes(active.closingId));
    const hasSchedule = schedule?.status === "ACTIVE";
    const reason = describeReason({
      state,
      natural,
      coverage: active
        ? {
            coverageSource: active.coverageSource,
            coveredYear: active.coveredYear,
            coveredMonth: active.coveredMonth,
            closingId: active.closingId,
            associationMethod: active.associationMethod,
          }
        : null,
      hasSchedule,
      missingImports:
        state === "LEGACY_PENDING_CANDIDATE" ? resolveMissingLegacyImports(natural, legacy.importedMonths) : [],
    });
    const cr = receivableById.get(receipt.receivableExternalId);
    rows.push({
      receivableExternalId: receipt.receivableExternalId,
      nfeNumber: cr?.sourceInvoiceNumber ?? null,
      receiptExternalId: receipt.externalId,
      receiptDate,
      settlementDate: cr?.settlementDate ? toCivilDateKey(cr.settlementDate) : null,
      naturalCompetence: formatCommissionYearMonthLabel(natural),
      receivedAmount: decimalToNumber(receipt.receivedAmount),
      state,
      stateLabel: COMMISSION_COVERAGE_STATE_LABELS[state],
      coverageSource: active?.coverageSource ?? null,
      coverageStatus: active?.coverageStatus ?? null,
      coveredYear: active?.coveredYear ?? null,
      coveredMonth: active?.coveredMonth ?? null,
      closingId: active?.closingId ?? null,
      legacyImportId: active?.legacyImportId ?? null,
      associationMethod: active?.associationMethod ?? null,
      coverageHistoryCount: historyCount.get(receipt.externalId) ?? 0,
      scheduleId: schedule?.id ?? null,
      scheduleStatus: schedule?.status ?? null,
      installmentNumber: schedule?.installmentNumber ?? null,
      sellerName,
      commissionAmount:
        active?.coveredCommissionAmount != null
          ? decimalToNumber(active.coveredCommissionAmount)
          : schedule?.scheduledCommissionAmount != null
            ? decimalToNumber(schedule.scheduledCommissionAmount)
            : null,
      closedLedgerClosingIds: closedIds,
      duplicityRisk,
      reason: duplicityRisk ? `RISCO DE DUPLICIDADE — ${reason}` : reason,
    });
  }

  const crsWithReceipt = new Set(receipts.map((row) => row.receivableExternalId));
  const schedulesWithoutReceipt =
    receivableIds.length > 0
      ? [...scheduleByCr.values()].filter(
          (schedule) => schedule.status === "ACTIVE" && !crsWithReceipt.has(schedule.receivableId)
        ).length
      : 0;

  const scopeCrs = new Set(crIds);
  const legacyImportRowsNotCovered: CommissionCoverageAuditReport["legacyImportRowsNotCovered"] = [];
  for (const record of imports) {
    const results = Array.isArray(record.resultRowsJson) ? (record.resultRowsJson as ImportResultRow[]) : [];
    for (const result of results) {
      if (!result?.status || result.status === "MATCHED" || result.status === "ALREADY_COVERED") continue;
      const cr = result.receivableExternalId ?? result.input?.cr ?? null;
      if (receivableIds.length > 0 && (cr == null || !scopeCrs.has(cr))) continue;
      legacyImportRowsNotCovered.push({
        importId: record.id,
        reference: formatCommissionYearMonthLabel({ year: record.referenceYear, month: record.referenceMonth }),
        rowNumber: result.rowNumber ?? 0,
        status: result.status,
        cr,
        nf: result.input?.nf ?? null,
        message: result.message ?? "",
      });
    }
  }

  const count = (predicate: (row: CommissionCoverageAuditRow) => boolean) => rows.filter(predicate).length;
  return {
    generatedAt: new Date().toISOString(),
    filters: {
      year: input.year ?? null,
      month: input.month ?? null,
      receivableIds,
      seller: input.seller ?? null,
    },
    rows,
    totals: {
      receipts: rows.length,
      coveredByNomus: count((row) => row.state === "LEGACY_COVERED"),
      coveredByInduscost: count((row) => row.state === "INDUSCOST_COVERED"),
      pending: count((row) => row.state === "LEGACY_PENDING_CANDIDATE" || row.state === "POST_CUTOVER_PENDING"),
      legacyPendingCandidates: count((row) => row.state === "LEGACY_PENDING_CANDIDATE"),
      postCutoverPending: count((row) => row.state === "POST_CUTOVER_PENDING"),
      ambiguous: count((row) => row.state === "AMBIGUOUS"),
      outsideWindow: count((row) => row.state === "LEGACY_OUTSIDE_RECONCILIATION_WINDOW"),
      receiptsWithoutSchedule: count((row) => row.scheduleStatus !== "ACTIVE"),
      schedulesWithoutReceipt,
      duplicityRisks: count((row) => row.duplicityRisk),
    },
    legacyImportRowsNotCovered,
  };
}

export type CommissionCoverageBootstrapPreview = {
  generatedAt: string;
  cutoverDate: string;
  legacyReconciliationStartDate: string;
  beforeWindowReceipts: number;
  months: Array<{
    competence: string;
    receipts: number;
    coveredByNomusImport: number;
    notCovered: number;
    ambiguous: number;
    imported: boolean;
  }>;
  postCutover: { receipts: number; coveredByInduscost: number; pending: number };
  imports: Array<{ competence: string; imported: boolean }>;
};

/**
 * Bootstrap (somente leitura): como a base fica ao entrar em operação no cutover.
 * Nada é gravado — não há apply de bootstrap (a regra da janela não precisa de
 * dados; a cobertura legada entra pela importação do relatório do Nomus).
 */
export async function buildCommissionCoverageBootstrapPreview(
  db: Pick<
    PrismaClient,
    "nomusReceivableReceipt" | "commissionReceiptCoverage" | "commissionLegacyCoverageImport"
  >
): Promise<CommissionCoverageBootstrapPreview> {
  const windowStart = civilDateToUtcDate(COMMISSION_LEGACY_RECONCILIATION_START_DATE);
  const cutover = civilDateToUtcDate(COMMISSION_OFFICIAL_CUTOVER_DATE);
  const [beforeWindowReceipts, windowReceipts, postReceipts, coverage, legacy] = await Promise.all([
    db.nomusReceivableReceipt.count({ where: { receiptDate: { lt: windowStart } } }),
    db.nomusReceivableReceipt.findMany({
      where: { receiptDate: { gte: windowStart, lt: cutover } },
      select: { externalId: true, receivableExternalId: true, receiptDate: true },
    }),
    db.nomusReceivableReceipt.findMany({
      where: { receiptDate: { gte: cutover } },
      select: { externalId: true },
    }),
    db.commissionReceiptCoverage.findMany({
      where: { coverageStatus: "COVERED", receiptExternalId: { not: null }, naturalReceiptDate: { gte: windowStart } },
      select: { receiptExternalId: true, coverageSource: true },
    }),
    loadLegacyCoverageImportContext(db),
  ]);
  const coverageByReceipt = new Map(coverage.map((row) => [row.receiptExternalId!, row.coverageSource]));
  const lastNomusMonth = previousCommissionYearMonth(COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH);
  const months = listCommissionYearMonths(COMMISSION_LEGACY_RECONCILIATION_START_YEAR_MONTH, lastNomusMonth).map(
    (month) => {
      const key = formatCommissionYearMonthKey(month);
      const inMonth = windowReceipts.filter((row) => toCivilDateKey(row.receiptDate)?.slice(0, 7) === key);
      const covered = inMonth.filter((row) => coverageByReceipt.get(row.externalId) === "NOMUS_LEGACY").length;
      const ambiguous = inMonth.filter(
        (row) => !coverageByReceipt.has(row.externalId) && legacy.ambiguousReceivableIds.has(row.receivableExternalId)
      ).length;
      return {
        competence: formatCommissionYearMonthLabel(month),
        receipts: inMonth.length,
        coveredByNomusImport: covered,
        notCovered: inMonth.filter((row) => !coverageByReceipt.has(row.externalId)).length - ambiguous,
        ambiguous,
        imported: legacy.importedMonths.has(key),
      };
    }
  );
  const postCovered = postReceipts.filter(
    (row) => coverageByReceipt.get(row.externalId) === "INDUSCOST_CLOSING"
  ).length;
  return {
    generatedAt: new Date().toISOString(),
    cutoverDate: COMMISSION_OFFICIAL_CUTOVER_DATE,
    legacyReconciliationStartDate: COMMISSION_LEGACY_RECONCILIATION_START_DATE,
    beforeWindowReceipts,
    months,
    postCutover: {
      receipts: postReceipts.length,
      coveredByInduscost: postCovered,
      pending: postReceipts.length - postCovered,
    },
    imports: months.map((month) => ({ competence: month.competence, imported: month.imported })),
  };
}
