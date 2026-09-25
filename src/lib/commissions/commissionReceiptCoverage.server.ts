/**
 * Cobertura de comissão — acesso a dados (somente leitura, exceto a materialização
 * de schedules que a prévia já fazia) e pendências de períodos anteriores.
 *
 * Consultas em lote por janela de datas; o motor de comissão é o MESMO da prévia,
 * restrito aos eventos pendentes da competência natural.
 */
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { decimalToNumber } from "./commission-money.js";
import { toCivilDateKey } from "../financeCivilDate.js";
import {
  COMMISSION_LEGACY_RECONCILIATION_START_DATE,
  COMMISSION_LEGACY_RECONCILIATION_START_YEAR_MONTH,
  COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH,
  civilDateToUtcDate,
  compareCommissionYearMonth,
  firstDayOfCompetenceUtc,
  formatCommissionYearMonthKey,
  isCompetenceOfficialInIndusCost,
  listCommissionYearMonths,
  previousCommissionYearMonth,
  resolveReceiptNaturalYearMonth,
  type CommissionYearMonth,
} from "./commissionCoverageCutover.js";
import {
  resolveCarryoverSelection,
  resolveCommissionReceiptCoverageState,
  summarizeCarryoverRows,
  type ReceiptClosingCarryoverSection,
} from "./commissionReceiptCoverage.shared.js";
import {
  buildCarryoverRows,
  toCarryoverPreviewLine,
  type CarryoverCandidateEvent,
} from "./commissionReceiptCoverage.js";
import type { CommissionReceiptPreviewLine } from "./commissionReceiptEngine.js";
import { formatCommissionReceiptLineStatus } from "./commissionReceiptLineStatusLabels.js";
import { resolveReceiptClosingInstallmentTotal } from "./commissionReceiptInstallment.shared.js";
import { loadReceivableInstallmentPositions } from "./commissionReceiptInstallment.server.js";

export type CoverageDb = Pick<
  PrismaClient,
  | "commissionReceiptCoverage"
  | "commissionLegacyCoverageImport"
  | "nomusReceivableReceipt"
  | "nomusAccountsReceivable"
  | "commissionMonthlyClosing"
>;

/**
 * Eventos da competência já cobertos (COVERED) por outra fonte/fechamento: ficam
 * fora das linhas normais do mês (anti-duplicidade). `excludeClosingId` = o
 * fechamento que está sendo reprocessado (sua cobertura será substituída).
 */
export async function loadCoveredReceiptIdsForCompetence(
  db: Pick<PrismaClient, "commissionReceiptCoverage">,
  year: number,
  month: number,
  options: { excludeClosingId?: string | null } = {}
): Promise<number[]> {
  const rows = await db.commissionReceiptCoverage.findMany({
    where: {
      coverageStatus: "COVERED",
      naturalYear: year,
      naturalMonth: month,
      receiptExternalId: { not: null },
    },
    select: { receiptExternalId: true, closingId: true },
  });
  const ids = new Set<number>();
  for (const row of rows) {
    if (row.receiptExternalId == null) continue;
    if (options.excludeClosingId && row.closingId === options.excludeClosingId) continue;
    ids.add(row.receiptExternalId);
  }
  return [...ids].sort((a, b) => a - b);
}

type LegacyImportResultRow = {
  status?: string;
  receivableExternalId?: number | null;
};

/** Meses do Nomus já importados e títulos com associação ambígua. */
export async function loadLegacyCoverageImportContext(
  db: Pick<PrismaClient, "commissionLegacyCoverageImport">
): Promise<{ importedMonths: Set<string>; ambiguousReceivableIds: Set<number> }> {
  const imports = await db.commissionLegacyCoverageImport.findMany({
    where: { source: "NOMUS" },
    select: { referenceYear: true, referenceMonth: true, resultRowsJson: true },
  });
  const importedMonths = new Set<string>();
  const ambiguousReceivableIds = new Set<number>();
  for (const row of imports) {
    importedMonths.add(formatCommissionYearMonthKey({ year: row.referenceYear, month: row.referenceMonth }));
    const results = Array.isArray(row.resultRowsJson) ? (row.resultRowsJson as LegacyImportResultRow[]) : [];
    for (const result of results) {
      if (result?.status === "AMBIGUOUS" && typeof result.receivableExternalId === "number") {
        ambiguousReceivableIds.add(result.receivableExternalId);
      }
    }
  }
  return { importedMonths, ambiguousReceivableIds };
}

/**
 * Para confirmar que um recebimento pré-cutover NÃO foi pago pelo Nomus, é preciso
 * a cobertura importada de todos os meses da competência natural até o último mês
 * do Nomus (o relatório de setembro pode contemplar um recebimento de agosto).
 */
export function resolveMissingLegacyImports(
  natural: CommissionYearMonth,
  importedMonths: ReadonlySet<string>
): CommissionYearMonth[] {
  const lastNomusMonth = previousCommissionYearMonth(COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH);
  if (compareCommissionYearMonth(natural, lastNomusMonth) > 0) return [];
  return listCommissionYearMonths(natural, lastNomusMonth).filter(
    (month) => !importedMonths.has(formatCommissionYearMonthKey(month))
  );
}

export type CarryoverEvaluationDeps = {
  /** Garante schedules dos títulos pendentes (mesma materialização da prévia). */
  materialize: (db: CoverageDb, receivableIds: number[]) => Promise<void>;
  /**
   * Motor oficial na competência natural, restrito aos eventos pendentes; os já
   * cobertos dos mesmos títulos entram como anteriores no cap incremental.
   */
  evaluateNaturalMonth: (
    natural: CommissionYearMonth,
    receiptExternalIds: number[],
    alreadyCoveredReceiptExternalIds: number[]
  ) => Promise<CommissionReceiptPreviewLine[]>;
};

export const defaultCarryoverEvaluationDeps: CarryoverEvaluationDeps = {
  materialize: async (db, receivableIds) => {
    if (receivableIds.length === 0) return;
    const [{ ensureCommissionMaterializationForReceivableRefs }, refs] = await Promise.all([
      import("./commissionMaterializationOrchestrator.server.js"),
      db.nomusAccountsReceivable.findMany({
        where: { externalId: { in: receivableIds } },
        select: { externalId: true, sourceInvoiceId: true },
      }),
    ]);
    await ensureCommissionMaterializationForReceivableRefs(
      prisma,
      refs.map((row) => ({ receivableId: row.externalId, sourceInvoiceId: row.sourceInvoiceId })),
      { apply: true }
    );
  },
  evaluateNaturalMonth: async (natural, receiptExternalIds, alreadyCoveredReceiptExternalIds) => {
    const { loadCommissionReceiptPreview } = await import("./commissionReceiptEngine.server.js");
    const preview = await loadCommissionReceiptPreview({
      year: natural.year,
      month: natural.month,
      receiptScope: {
        includeReceiptExternalIds: receiptExternalIds,
        alreadyCoveredReceiptExternalIds,
      },
    });
    return preview.lines;
  },
};

export type ReceiptClosingCarryoverEvaluation = {
  section: ReceiptClosingCarryoverSection;
  /** Linhas do motor das pendências selecionadas, já como linhas do fechamento. */
  selectedLines: CommissionReceiptPreviewLine[];
};

/**
 * Pendências de períodos anteriores de um fechamento (competência >= cutover):
 * eventos entre o início da janela legada e o 1º dia do mês do fechamento que não
 * têm cobertura COVERED. Fechamentos antes do cutover não têm pendências (o Nomus é
 * a fonte oficial dessas competências).
 */
export async function loadReceiptClosingCarryovers(
  db: CoverageDb,
  input: {
    year: number;
    month: number;
    selectedReceiptIds?: readonly number[];
    /** Reprocessamento: a cobertura deste fechamento será substituída. */
    excludeCoverageClosingId?: string | null;
    materialize?: boolean;
  },
  deps: CarryoverEvaluationDeps = defaultCarryoverEvaluationDeps
): Promise<ReceiptClosingCarryoverEvaluation | null> {
  if (!isCompetenceOfficialInIndusCost(input.year, input.month)) return null;
  const closing: CommissionYearMonth = { year: input.year, month: input.month };
  const from = civilDateToUtcDate(COMMISSION_LEGACY_RECONCILIATION_START_DATE);
  const to = firstDayOfCompetenceUtc(closing);

  const [events, coverage, legacy] = await Promise.all([
    db.nomusReceivableReceipt.findMany({
      where: { receiptDate: { gte: from, lt: to } },
      select: {
        externalId: true,
        receivableExternalId: true,
        receiptDate: true,
        receivedAmount: true,
        syncedAt: true,
      },
    }),
    db.commissionReceiptCoverage.findMany({
      where: {
        coverageStatus: "COVERED",
        receiptExternalId: { not: null },
        naturalReceiptDate: { gte: from, lt: to },
      },
      select: { receiptExternalId: true, receivableExternalId: true, closingId: true },
    }),
    loadLegacyCoverageImportContext(db),
  ]);

  const covered = new Set<number>();
  const coveredByReceivable = new Map<number, number[]>();
  for (const row of coverage) {
    if (row.receiptExternalId == null) continue;
    if (input.excludeCoverageClosingId && row.closingId === input.excludeCoverageClosingId) continue;
    covered.add(row.receiptExternalId);
    const list = coveredByReceivable.get(row.receivableExternalId) ?? [];
    list.push(row.receiptExternalId);
    coveredByReceivable.set(row.receivableExternalId, list);
  }

  const candidates: CarryoverCandidateEvent[] = [];
  for (const event of events) {
    if (covered.has(event.externalId)) continue;
    const receiptDate = toCivilDateKey(event.receiptDate);
    if (!receiptDate) continue;
    const state = resolveCommissionReceiptCoverageState({
      receiptDate,
      activeCoverage: null,
      ambiguousLegacyAssociation: legacy.ambiguousReceivableIds.has(event.receivableExternalId),
    });
    candidates.push({
      receiptExternalId: event.externalId,
      receivableExternalId: event.receivableExternalId,
      receiptDate,
      receivedAmount: decimalToNumber(event.receivedAmount),
      syncedAt: event.syncedAt ?? null,
      state,
    });
  }

  const idsByMonth = new Map<string, number[]>();
  const receivablesByMonth = new Map<string, Set<number>>();
  for (const candidate of candidates) {
    const natural = resolveReceiptNaturalYearMonth(candidate.receiptDate);
    if (!natural) continue;
    const key = formatCommissionYearMonthKey(natural);
    const list = idsByMonth.get(key) ?? [];
    list.push(candidate.receiptExternalId);
    idsByMonth.set(key, list);
    const crs = receivablesByMonth.get(key) ?? new Set<number>();
    crs.add(candidate.receivableExternalId);
    receivablesByMonth.set(key, crs);
  }

  if (input.materialize && candidates.length > 0) {
    await deps.materialize(db, [...new Set(candidates.map((c) => c.receivableExternalId))]);
  }

  const linesByNaturalMonth = new Map<string, CommissionReceiptPreviewLine[]>();
  for (const key of [...idsByMonth.keys()].sort()) {
    const natural = { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) };
    const alreadyCovered = [...(receivablesByMonth.get(key) ?? [])].flatMap(
      (receivableId) => coveredByReceivable.get(receivableId) ?? []
    );
    linesByNaturalMonth.set(
      key,
      await deps.evaluateNaturalMonth(natural, idsByMonth.get(key) ?? [], alreadyCovered)
    );
  }

  const monthKeys = [...idsByMonth.keys()];
  const naturalClosingRows =
    monthKeys.length > 0
      ? await db.commissionMonthlyClosing.findMany({
          where: {
            status: "CLOSED",
            source: "RECEIPT_BASED",
            OR: monthKeys.map((key) => ({ year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) })),
          },
          select: { year: true, month: true, closedAt: true },
        })
      : [];
  const naturalMonthClosings = new Map(
    naturalClosingRows.map((row) => [
      formatCommissionYearMonthKey({ year: row.year, month: row.month }),
      { closedAt: row.closedAt?.toISOString() ?? null },
    ])
  );

  const selectedIds = new Set(input.selectedReceiptIds ?? []);
  let rows = buildCarryoverRows({
    candidates,
    linesByNaturalMonth,
    naturalMonthClosings,
    missingLegacyImports: (natural) => resolveMissingLegacyImports(natural, legacy.importedMonths),
    selectedReceiptIds: selectedIds,
    statusLabel: formatCommissionReceiptLineStatus,
  });

  // Parcela n/total no grid (mesma regra da coluna do detalhamento).
  if (rows.length > 0) {
    const positions = await loadReceivableInstallmentPositions(
      db,
      rows.map((row) => row.receivableExternalId)
    ).catch(() => new Map());
    rows = rows.map((row) => ({
      ...row,
      installmentTotal: resolveReceiptClosingInstallmentTotal(
        { nomusReceivableId: row.receivableExternalId, installmentNumber: row.installmentNumber },
        positions
      ),
    }));
  }

  const selection = resolveCarryoverSelection(rows, [...selectedIds]);
  const selectedKeys = new Set(selection.selectedRows.map((row) => row.rowKey));
  rows = rows.map((row) => ({ ...row, selected: selectedKeys.has(row.rowKey) }));

  const selectedLines: CommissionReceiptPreviewLine[] = [];
  for (const row of selection.selectedRows) {
    const monthKey = formatCommissionYearMonthKey({ year: row.naturalYear, month: row.naturalMonth });
    for (const line of linesByNaturalMonth.get(monthKey) ?? []) {
      if (line.nomusReceivableId !== row.receivableExternalId) continue;
      selectedLines.push(toCarryoverPreviewLine(line, closing, row.inclusionType));
    }
  }

  const lastNomusMonth = previousCommissionYearMonth(COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH);
  const legacyImportStatus = listCommissionYearMonths(
    COMMISSION_LEGACY_RECONCILIATION_START_YEAR_MONTH,
    lastNomusMonth
  ).map((month) => ({
    ...month,
    imported: legacy.importedMonths.has(formatCommissionYearMonthKey(month)),
  }));

  return {
    section: {
      closingYear: closing.year,
      closingMonth: closing.month,
      rows,
      summary: summarizeCarryoverRows(rows),
      legacyImportStatus,
      selectionErrors: selection.errors,
    },
    selectedLines,
  };
}
