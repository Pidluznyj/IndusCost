import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { toPrismaDecimal } from "./commission-money.js";
import type { CommissionMonthlyPayableQuery, CommissionMonthlyPayableSummary } from "./commissionMonthlyPayable.js";
import { ensureCommissionMaterializationForReceiptMonth } from "./commissionMaterializationOrchestrator.server.js";
import { loadCommissionReceiptPreview } from "./commissionReceiptEngine.server.js";
import type { CommissionReceiptPreviewResult } from "./commissionReceiptEngine.js";
import type { CommissionReceiptEventScope } from "./commissionReceiptCompetence.server.js";
import {
  COMMISSION_PRE_CUTOVER_CLOSING_BLOCKED_REASON,
  formatCommissionYearMonthLabel,
  isCompetenceOfficialInIndusCost,
} from "./commissionCoverageCutover.js";
import {
  buildInduscostCoverageRows,
  collectCoveredReceiptIdsFromLines,
  findReceiptsInMultipleAnchors,
  mergeCarryoverLinesIntoPreview,
  type ReceiptEventForCoverage,
} from "./commissionReceiptCoverage.js";
import {
  loadCoveredReceiptIdsForCompetence,
  loadReceiptClosingCarryovers,
  type CoverageDb,
  type ReceiptClosingCarryoverEvaluation,
} from "./commissionReceiptCoverage.server.js";
import { COMMISSION_COVERAGE_SOURCE_LABELS } from "./commissionReceiptCoverage.shared.js";
import { toCivilDateKey } from "../financeCivilDate.js";
import { decimalToNumber } from "./commission-money.js";
import {
  aggregateMonthlyPayableFromLedgerLines,
  appendReceiptClosingNote,
  buildReceiptClosingHashFromPreview,
  buildReceiptClosingPreviewPayload,
  buildReceiptClosingReprocessPreview,
  buildReceiptClosingSnapshotFromPreview,
  formatReceiptClosingCancelNote,
  formatReceiptClosingReprocessNote,
  mapLedgerRowToSnapshot,
  mapPreviewLineToLedgerCreateData,
  sanitizeLedgerLineRuleRefs,
  ReceiptClosingDuplicateError,
  ReceiptClosingValidationError,
  RECEIPT_CLOSING_SOURCE,
  type ReceiptClosingApplyResult,
  type ReceiptClosingPreviewPayload,
  type ReceiptClosingReprocessPreview,
  type ReceiptClosingSnapshot,
  validateReceiptClosingCancelReason,
  validateReceiptClosingPreviewForApply,
} from "./commissionReceiptClosing.js";

export type ReceiptClosingFilters = {
  year: number;
  month: number;
  seller?: string | null;
  customer?: string | null;
  nomusBase?: number | null;
  nomusCommission?: number | null;
  includeExcluded?: boolean;
  includeExceptions?: boolean;
};

type DbClient = Pick<
  PrismaClient,
  | "commissionMonthlyClosing"
  | "commissionReceiptLedgerLine"
  | "commissionRule"
  | "commissionCustomerExclusionRule"
  | "$transaction"
>;

/** Fechamento com a camada de cobertura (anti-duplicidade por recebimento). */
type ClosingWithCoverageDb = DbClient &
  CoverageDb &
  Pick<PrismaClient, "commissionReceiptCoverage">;

async function loadValidLedgerRuleIdSets(
  db: Pick<PrismaClient, "commissionRule" | "commissionCustomerExclusionRule">,
  lines: Prisma.CommissionReceiptLedgerLineCreateManyInput[]
): Promise<{
  validRuleIds: Set<string>;
  validExclusionRuleIds: Set<string>;
}> {
  const ruleIds = [
    ...new Set(
      lines
        .map((l) => l.ruleId)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    ),
  ];
  const exclusionIds = [
    ...new Set(
      lines
        .map((l) => l.customerExclusionRuleId)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    ),
  ];
  const [rules, exclusions] = await Promise.all([
    ruleIds.length > 0
      ? db.commissionRule.findMany({
          where: { id: { in: ruleIds } },
          select: { id: true },
        })
      : Promise.resolve([] as { id: string }[]),
    exclusionIds.length > 0
      ? db.commissionCustomerExclusionRule.findMany({
          where: { id: { in: exclusionIds } },
          select: { id: true },
        })
      : Promise.resolve([] as { id: string }[]),
  ]);
  return {
    validRuleIds: new Set(rules.map((r) => r.id)),
    validExclusionRuleIds: new Set(exclusions.map((r) => r.id)),
  };
}

function mapClosingRowToSnapshot(row: {
  id: string;
  year: number;
  month: number;
  status: ReceiptClosingSnapshot["status"];
  calculationHash: string | null;
  totalReceivedAmount: Prisma.Decimal;
  totalCommissionableBase: Prisma.Decimal;
  totalExpectedCommission: Prisma.Decimal;
  totalReleasedCommission: Prisma.Decimal;
  totalExcludedAmount: Prisma.Decimal;
  totalExceptionAmount: Prisma.Decimal;
  lineCount: number;
  closedAt: Date | null;
  closedBy: string | null;
  notes: string | null;
}): ReceiptClosingSnapshot {
  return {
    closingId: row.id,
    year: row.year,
    month: row.month,
    status: row.status,
    calculationHash: row.calculationHash,
    totalReceivedAmount: Number(row.totalReceivedAmount),
    totalCommissionableBase: Number(row.totalCommissionableBase),
    totalExpectedCommission: Number(row.totalExpectedCommission),
    totalReleasedCommission: Number(row.totalReleasedCommission),
    totalExcludedAmount: Number(row.totalExcludedAmount),
    totalExceptionAmount: Number(row.totalExceptionAmount),
    lineCount: row.lineCount,
    closedAt: row.closedAt?.toISOString() ?? null,
    closedBy: row.closedBy,
    notes: row.notes,
  };
}

export async function findClosedReceiptClosing(
  db: DbClient,
  year: number,
  month: number
): Promise<ReceiptClosingSnapshot | null> {
  const row = await db.commissionMonthlyClosing.findFirst({
    where: {
      year,
      month,
      source: RECEIPT_CLOSING_SOURCE,
      status: "CLOSED",
    },
    orderBy: { closedAt: "desc" },
  });
  return row ? mapClosingRowToSnapshot(row) : null;
}

export async function loadReceiptClosingLedgerLines(
  db: Pick<PrismaClient, "commissionReceiptLedgerLine">,
  closingId: string
) {
  const rows = await db.commissionReceiptLedgerLine.findMany({
    where: { closingId },
    orderBy: [{ settlementDate: "asc" }, { nomusReceivableId: "asc" }, { productCode: "asc" }],
  });
  return rows.map(mapLedgerRowToSnapshot);
}

async function loadReceiptClosingPreviewWithMaterialization(
  filters: ReceiptClosingFilters,
  receiptScope: CommissionReceiptEventScope | null = null
): Promise<CommissionReceiptPreviewResult> {
  await ensureCommissionMaterializationForReceiptMonth(prisma, {
    year: filters.year,
    month: filters.month,
    apply: true,
  });
  return loadCommissionReceiptPreview(receiptScope ? { ...filters, receiptScope } : filters);
}

/** Eventos de recebimento (dia civil + valor) para a cobertura do fechamento. */
export async function loadReceiptEventsForCoverage(
  db: Pick<PrismaClient, "nomusReceivableReceipt">,
  receiptExternalIds: readonly number[]
): Promise<Map<number, ReceiptEventForCoverage>> {
  const map = new Map<number, ReceiptEventForCoverage>();
  if (receiptExternalIds.length === 0) return map;
  const rows = await db.nomusReceivableReceipt.findMany({
    where: { externalId: { in: [...receiptExternalIds] } },
    select: { externalId: true, receivableExternalId: true, receiptDate: true, receivedAmount: true },
  });
  for (const row of rows) {
    const receiptDate = toCivilDateKey(row.receiptDate);
    if (!receiptDate) continue;
    map.set(row.externalId, {
      receivableExternalId: row.receivableExternalId,
      receiptDate,
      receivedAmount: decimalToNumber(row.receivedAmount),
    });
  }
  return map;
}

/**
 * Pontos de I/O do fechamento — injetáveis em teste (banco falso + motor falso).
 * Em produção: motor oficial com materialização, pendências e cobertura reais.
 */
export type ReceiptClosingEngineDeps = {
  loadPreview: (
    filters: ReceiptClosingFilters,
    receiptScope: CommissionReceiptEventScope | null
  ) => Promise<CommissionReceiptPreviewResult>;
  loadCarryovers: (
    db: CoverageDb,
    input: Parameters<typeof loadReceiptClosingCarryovers>[1]
  ) => Promise<ReceiptClosingCarryoverEvaluation | null>;
  loadCoveredReceiptIds: (
    db: Pick<PrismaClient, "commissionReceiptCoverage">,
    year: number,
    month: number,
    options: { excludeClosingId?: string | null }
  ) => Promise<number[]>;
  loadReceiptEvents: (
    db: Pick<PrismaClient, "nomusReceivableReceipt">,
    receiptExternalIds: readonly number[]
  ) => Promise<Map<number, ReceiptEventForCoverage>>;
};

export const defaultReceiptClosingEngineDeps: ReceiptClosingEngineDeps = {
  loadPreview: loadReceiptClosingPreviewWithMaterialization,
  loadCarryovers: (db, input) => loadReceiptClosingCarryovers(db, input),
  loadCoveredReceiptIds: loadCoveredReceiptIdsForCompetence,
  loadReceiptEvents: loadReceiptEventsForCoverage,
};

export async function previewCommissionReceiptClosing(
  filters: ReceiptClosingFilters,
  options: {
    carryoverReceiptIds?: readonly number[];
    /**
     * Avalia as pendências de períodos anteriores (tela de fechamento). Default
     * false: auditorias e conciliações que reusam a prévia não pagam esse custo
     * nem materializam schedules de títulos de outros meses.
     */
    includeCarryover?: boolean;
  } = {},
  deps: ReceiptClosingEngineDeps = defaultReceiptClosingEngineDeps,
  db: ClosingWithCoverageDb = prisma
): Promise<ReceiptClosingPreviewPayload> {
  const official = isCompetenceOfficialInIndusCost(filters.year, filters.month);
  const existingClosing = await findClosedReceiptClosing(db, filters.year, filters.month);
  // Competência oficial no IndusCost: eventos já cobertos por OUTRO fechamento
  // (ex.: pendência incluída depois) ficam fora das linhas normais. Antes do
  // cutover a prévia segue idêntica (comparação com o Nomus).
  const coveredElsewhere = official
    ? await deps.loadCoveredReceiptIds(db, filters.year, filters.month, {
        excludeClosingId: existingClosing?.closingId ?? null,
      })
    : [];
  const normal = await deps.loadPreview(
    filters,
    coveredElsewhere.length > 0 ? { excludeReceiptExternalIds: coveredElsewhere } : null
  );
  const carryover =
    official && !existingClosing && options.includeCarryover === true
      ? await deps.loadCarryovers(db, {
          year: filters.year,
          month: filters.month,
          selectedReceiptIds: options.carryoverReceiptIds ?? [],
          materialize: true,
        })
      : null;
  const preview = mergeCarryoverLinesIntoPreview(normal, carryover?.selectedLines ?? []);
  const payload = buildReceiptClosingPreviewPayload(preview, existingClosing);
  return {
    ...payload,
    ...(official
      ? {}
      : { canApply: false, applyBlockedReason: COMMISSION_PRE_CUTOVER_CLOSING_BLOCKED_REASON }),
    carryover: carryover?.section ?? null,
  };
}

export async function getMonthlyPayableFromClosedReceiptLedger(
  query: CommissionMonthlyPayableQuery
): Promise<CommissionMonthlyPayableSummary | null> {
  const closing = await findClosedReceiptClosing(prisma, query.year, query.month);
  if (!closing) return null;
  const lines = await loadReceiptClosingLedgerLines(prisma, closing.closingId);
  return aggregateMonthlyPayableFromLedgerLines(lines, query);
}

type ClosingContent = {
  preview: CommissionReceiptPreviewResult;
  calculationHash: string;
  coveredReceiptIds: number[];
  receiptEvents: Map<number, ReceiptEventForCoverage>;
  carryoverLineCount: number;
};

function formatCarryoverErrors(errors: Array<{ receiptExternalId: number; reason: string }>): string {
  const preview = errors
    .slice(0, 5)
    .map((error) => `recebimento ${error.receiptExternalId}: ${error.reason}`)
    .join("; ");
  const more = errors.length > 5 ? ` (+${errors.length - 5})` : "";
  return `Pendência(s) não podem entrar no fechamento — ${preview}${more}`;
}

/**
 * Conteúdo do fechamento recalculado NO SERVIDOR: competência atual (sem eventos já
 * cobertos por outro fechamento) + pendências selecionadas revalidadas. Do
 * navegador só vêm IDs de recebimento — valores, vendedor e competência nunca.
 */
async function buildReceiptClosingContent(
  db: ClosingWithCoverageDb,
  input: {
    filters: ReceiptClosingFilters;
    carryoverReceiptIds: readonly number[];
    excludeCoverageClosingId: string | null;
  },
  deps: ReceiptClosingEngineDeps
): Promise<ClosingContent> {
  const { year, month } = input.filters;
  if (!isCompetenceOfficialInIndusCost(year, month)) {
    throw new ReceiptClosingValidationError(
      "PRE_CUTOVER_COMPETENCE",
      COMMISSION_PRE_CUTOVER_CLOSING_BLOCKED_REASON
    );
  }
  const coveredElsewhere = await deps.loadCoveredReceiptIds(db, year, month, {
    excludeClosingId: input.excludeCoverageClosingId,
  });
  const normal = await deps.loadPreview(
    input.filters,
    coveredElsewhere.length > 0 ? { excludeReceiptExternalIds: coveredElsewhere } : null
  );
  validateReceiptClosingPreviewForApply(normal);

  let carryoverLines: CommissionReceiptPreviewResult["lines"] = [];
  if (input.carryoverReceiptIds.length > 0) {
    const evaluation = await deps.loadCarryovers(db, {
      year,
      month,
      selectedReceiptIds: input.carryoverReceiptIds,
      excludeCoverageClosingId: input.excludeCoverageClosingId,
      materialize: true,
    });
    if (!evaluation) {
      throw new ReceiptClosingValidationError(
        "CARRYOVER_NOT_ALLOWED",
        "Pendências de períodos anteriores só entram em competências oficiais do IndusCost."
      );
    }
    if (evaluation.section.selectionErrors.length > 0) {
      throw new ReceiptClosingValidationError(
        "CARRYOVER_NOT_ALLOWED",
        formatCarryoverErrors(evaluation.section.selectionErrors)
      );
    }
    carryoverLines = evaluation.selectedLines;
  }

  const preview = mergeCarryoverLinesIntoPreview(normal, carryoverLines);
  // Camada C: o mesmo recebimento não pode entrar em duas linhas (âncoras) do
  // mesmo fechamento — ex.: como linha normal e como pendência.
  const repeated = findReceiptsInMultipleAnchors(preview.lines);
  if (repeated.length > 0) {
    throw new ReceiptClosingValidationError(
      "RECEIPT_DUPLICATED_IN_CLOSING",
      `Recebimento(s) em mais de uma linha do mesmo fechamento: ${repeated.slice(0, 10).join(", ")}.`
    );
  }
  const coveredReceiptIds = collectCoveredReceiptIdsFromLines(preview.lines);
  const receiptEvents = await deps.loadReceiptEvents(db, coveredReceiptIds);
  const missing = coveredReceiptIds.filter((id) => !receiptEvents.has(id));
  if (missing.length > 0) {
    throw new ReceiptClosingValidationError(
      "RECEIPT_EVENT_NOT_FOUND",
      `Recebimento(s) sem origem em NomusReceivableReceipt: ${missing.slice(0, 10).join(", ")}. Gere a prévia novamente.`
    );
  }
  return {
    preview,
    calculationHash: buildReceiptClosingHashFromPreview(preview),
    coveredReceiptIds,
    receiptEvents,
    carryoverLineCount: carryoverLines.length,
  };
}

type ClosingTx = Pick<
  PrismaClient,
  | "commissionMonthlyClosing"
  | "commissionReceiptLedgerLine"
  | "commissionRule"
  | "commissionCustomerExclusionRule"
  | "commissionReceiptCoverage"
>;

/**
 * Revalida dentro da transação: nenhum recebimento pode já estar coberto.
 *   A) cobertura COVERED (Nomus legado ou fechamento IndusCost);
 *   B) linha de ledger de um fechamento CLOSED que já contém o recebimento
 *      (defesa em profundidade — o CLOSED sempre grava a cobertura espelho).
 * O índice único parcial do banco é a última barreira (corrida entre transações).
 */
async function assertReceiptsNotCovered(
  tx: Pick<PrismaClient, "commissionReceiptCoverage" | "commissionReceiptLedgerLine">,
  receiptIds: readonly number[]
): Promise<void> {
  if (receiptIds.length === 0) return;
  const closedLines = await tx.commissionReceiptLedgerLine.findMany({
    where: { receiptExternalIds: { hasSome: [...receiptIds] }, closing: { status: "CLOSED" } },
    select: { closingId: true, year: true, month: true, receiptExternalIds: true },
  });
  if (closedLines.length > 0) {
    const wanted = new Set(receiptIds);
    const detail = closedLines
      .slice(0, 5)
      .map((line) => {
        const ids = (line.receiptExternalIds ?? []).filter((id) => wanted.has(id)).join(", ");
        return `recebimento ${ids} já está no fechamento CLOSED de ${formatCommissionYearMonthLabel({
          year: line.year,
          month: line.month,
        })}`;
      })
      .join("; ");
    throw new ReceiptClosingValidationError(
      "RECEIPT_ALREADY_COVERED",
      `Duplicidade bloqueada: ${detail}${closedLines.length > 5 ? ` (+${closedLines.length - 5})` : ""}.`
    );
  }
  const conflicts = await tx.commissionReceiptCoverage.findMany({
    where: { coverageStatus: "COVERED", receiptExternalId: { in: [...receiptIds] } },
    select: {
      receiptExternalId: true,
      coverageSource: true,
      coveredYear: true,
      coveredMonth: true,
      closingId: true,
    },
  });
  if (conflicts.length === 0) return;
  const detail = conflicts
    .slice(0, 5)
    .map((row) => {
      const where =
        row.coveredYear && row.coveredMonth
          ? ` em ${formatCommissionYearMonthLabel({ year: row.coveredYear, month: row.coveredMonth })}`
          : "";
      return `recebimento ${row.receiptExternalId} já coberto por ${COMMISSION_COVERAGE_SOURCE_LABELS[row.coverageSource]}${where}`;
    })
    .join("; ");
  throw new ReceiptClosingValidationError(
    "RECEIPT_ALREADY_COVERED",
    `Duplicidade bloqueada: ${detail}${conflicts.length > 5 ? ` (+${conflicts.length - 5})` : ""}.`
  );
}

async function createClosingWithLines(
  tx: ClosingTx,
  input: {
    preview: CommissionReceiptPreviewResult;
    userId: string;
    notes?: string | null;
    calculationHash: string;
    coveredReceiptIds: readonly number[];
    receiptEvents: ReadonlyMap<number, ReceiptEventForCoverage>;
    carryoverLineCount: number;
  }
): Promise<ReceiptClosingApplyResult> {
  await assertReceiptsNotCovered(tx, input.coveredReceiptIds);

  const closing = await tx.commissionMonthlyClosing.create({
    data: {
      year: input.preview.year,
      month: input.preview.month,
      status: "CLOSED",
      source: RECEIPT_CLOSING_SOURCE,
      totalReceivedAmount: toPrismaDecimal(input.preview.totalReceivedAmount),
      totalCommissionableBase: toPrismaDecimal(input.preview.totalCommissionableBase),
      totalExpectedCommission: toPrismaDecimal(input.preview.totalExpectedCommission),
      totalReleasedCommission: toPrismaDecimal(input.preview.totalReleasedCommission),
      totalExcludedAmount: toPrismaDecimal(input.preview.totalExcludedAmount),
      totalExceptionAmount: toPrismaDecimal(input.preview.totalExceptionAmount),
      lineCount: input.preview.lines.length,
      calculationHash: input.calculationHash,
      notes: input.notes ?? null,
      createdBy: input.userId,
      closedBy: input.userId,
      closedAt: new Date(),
    },
  });

  let coverageCount = 0;
  if (input.preview.lines.length > 0) {
    // Id gerado aqui: a cobertura aponta para a linha exata do ledger.
    const rawRows = input.preview.lines.map((line) => ({
      ...mapPreviewLineToLedgerCreateData(line, closing.id),
      id: randomUUID(),
    }));
    const { validRuleIds, validExclusionRuleIds } = await loadValidLedgerRuleIdSets(
      tx,
      rawRows
    );
    const sanitized = rawRows.map((row) => {
      const result = sanitizeLedgerLineRuleRefs(row, validRuleIds, validExclusionRuleIds);
      if (result.alerts.length > 0) {
        console.warn(
          "[commissionReceiptClosing] regra histórica sem CommissionRule ativa",
          {
            ledgerLineKey: result.data.ledgerLineKey,
            alerts: result.alerts,
            ruleIdClass: result.ruleIdClass,
          }
        );
      }
      return result.data;
    });
    await tx.commissionReceiptLedgerLine.createMany({ data: sanitized });

    const coverageRows = buildInduscostCoverageRows({
      closingId: closing.id,
      closing: { year: input.preview.year, month: input.preview.month },
      userId: input.userId,
      // Status do MOTOR (não o persistido): NO_MARGIN é gravado como ZERO_AMOUNT no
      // enum do banco, mas é exceção resolvível — não cobre. Assim a cobertura bate
      // com collectCoveredReceiptIdsFromLines (mesma lista de status finais).
      ledgerRows: sanitized.map((row, index) => ({
        id: row.id as string,
        nomusReceivableId: row.nomusReceivableId ?? null,
        receiptExternalIds: Array.isArray(row.receiptExternalIds) ? row.receiptExternalIds : [],
        status: input.preview.lines[index]?.status ?? row.status,
        releasedCommissionAmount: Number(row.releasedCommissionAmount ?? 0),
        inclusionType: row.inclusionType ?? "NORMAL",
      })),
      receiptEvents: input.receiptEvents,
    });
    if (coverageRows.length > 0) {
      await tx.commissionReceiptCoverage.createMany({
        data: coverageRows.map((row) => ({
          ...row,
          naturalReceiptDate: new Date(`${row.naturalReceiptDate}T00:00:00.000Z`),
          coveredReceivedAmount: toPrismaDecimal(row.coveredReceivedAmount),
          coveredCommissionAmount: toPrismaDecimal(row.coveredCommissionAmount),
        })),
      });
    }
    coverageCount = coverageRows.length;
  }

  return {
    closingId: closing.id,
    calculationHash: input.calculationHash,
    summary: buildReceiptClosingSnapshotFromPreview(input.preview, closing.id, "CLOSED", {
      calculationHash: input.calculationHash,
      closedBy: input.userId,
      closedAt: closing.closedAt,
      notes: input.notes ?? null,
    }),
    lineCount: input.preview.lines.length,
    carryoverLineCount: input.carryoverLineCount,
    coverageCount,
  };
}

function isUniqueViolation(error: unknown): error is { code: string; meta?: { target?: unknown } } {
  return (
    error != null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code: string }).code === "P2002"
  );
}

function isCoverageUniqueViolation(error: { meta?: { target?: unknown } }): boolean {
  const target = JSON.stringify(error.meta?.target ?? "");
  return target.includes("receiptExternalId") || target.includes("CommissionReceiptCoverage");
}

const RECEIPT_COVERAGE_RACE_MESSAGE =
  "Duplicidade bloqueada pelo banco: outro fechamento cobriu um destes recebimentos ao mesmo tempo. Atualize a prévia e tente novamente.";

export async function applyCommissionReceiptClosing(
  db: ClosingWithCoverageDb,
  input: ReceiptClosingFilters & {
    userId: string;
    notes?: string | null;
    /** IDs de recebimento de pendências anteriores escolhidas na prévia. */
    carryoverReceiptIds?: readonly number[];
  },
  deps: ReceiptClosingEngineDeps = defaultReceiptClosingEngineDeps
): Promise<ReceiptClosingApplyResult> {
  const existing = await findClosedReceiptClosing(db, input.year, input.month);
  if (existing) {
    throw new ReceiptClosingDuplicateError(existing.closingId);
  }

  const content = await buildReceiptClosingContent(
    db,
    {
      filters: input,
      carryoverReceiptIds: input.carryoverReceiptIds ?? [],
      excludeCoverageClosingId: null,
    },
    deps
  );

  try {
    return await db.$transaction(async (tx) => {
      const locked = await tx.commissionMonthlyClosing.findFirst({
        where: {
          year: input.year,
          month: input.month,
          source: RECEIPT_CLOSING_SOURCE,
          status: "CLOSED",
        },
      });
      if (locked) {
        throw new ReceiptClosingDuplicateError(locked.id);
      }
      return createClosingWithLines(tx, {
        preview: content.preview,
        userId: input.userId,
        notes: input.notes,
        calculationHash: content.calculationHash,
        coveredReceiptIds: content.coveredReceiptIds,
        receiptEvents: content.receiptEvents,
        carryoverLineCount: content.carryoverLineCount,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      if (isCoverageUniqueViolation(error)) {
        throw new ReceiptClosingValidationError("RECEIPT_ALREADY_COVERED", RECEIPT_COVERAGE_RACE_MESSAGE);
      }
      const duplicate = await findClosedReceiptClosing(db, input.year, input.month);
      throw new ReceiptClosingDuplicateError(
        duplicate?.closingId ?? "unknown",
        "Fechamento duplicado bloqueado pela constraint única do banco."
      );
    }
    throw error;
  }
}

/**
 * Cancelamento: o fechamento deixa de ser pagamento oficial. Na MESMA transação a
 * cobertura INDUSCOST_CLOSING dele vira SUPERSEDED (os recebimentos voltam a ser
 * pendência); o ledger fica intacto para auditoria.
 */
export async function cancelCommissionReceiptClosing(
  db: Pick<PrismaClient, "commissionMonthlyClosing" | "commissionReceiptCoverage" | "$transaction">,
  input: {
    closingId: string;
    userId: string;
    reason: string;
  }
): Promise<ReceiptClosingSnapshot> {
  const reason = validateReceiptClosingCancelReason(input.reason);
  return db.$transaction(async (tx) => {
    const existing = await tx.commissionMonthlyClosing.findUnique({
      where: { id: input.closingId },
    });
    if (!existing) {
      throw new ReceiptClosingValidationError("CLOSING_NOT_FOUND", "Fechamento não encontrado.");
    }
    if (existing.status !== "CLOSED") {
      throw new ReceiptClosingValidationError(
        "CLOSING_NOT_ACTIVE",
        `Somente fechamentos CLOSED podem ser cancelados (status atual: ${existing.status}).`
      );
    }

    const updated = await tx.commissionMonthlyClosing.update({
      where: { id: input.closingId },
      data: {
        status: "CANCELLED",
        notes: appendReceiptClosingNote(
          existing.notes,
          formatReceiptClosingCancelNote(input.userId, reason)
        ),
      },
    });

    await tx.commissionReceiptCoverage.updateMany({
      where: { closingId: input.closingId, coverageStatus: "COVERED" },
      data: {
        coverageStatus: "SUPERSEDED",
        notes: `Fechamento ${formatCommissionYearMonthLabel({ year: existing.year, month: existing.month })} cancelado por ${input.userId}: ${reason}`,
      },
    });

    return mapClosingRowToSnapshot(updated);
  });
}

/** Pendências que o fechamento CLOSED já pagou (carregadas no reprocessamento). */
async function loadCarryoverReceiptIdsOfClosing(
  db: Pick<PrismaClient, "commissionReceiptLedgerLine">,
  closingId: string
): Promise<number[]> {
  const rows = await db.commissionReceiptLedgerLine.findMany({
    where: { closingId, inclusionType: { not: "NORMAL" } },
    select: { receiptExternalIds: true },
  });
  const ids = new Set<number>();
  for (const row of rows) for (const id of row.receiptExternalIds ?? []) ids.add(id);
  return [...ids].sort((a, b) => a - b);
}

export async function reprocessCommissionReceiptClosingPreview(
  filters: ReceiptClosingFilters,
  deps: ReceiptClosingEngineDeps = defaultReceiptClosingEngineDeps,
  db: ClosingWithCoverageDb = prisma
): Promise<ReceiptClosingReprocessPreview> {
  const existingClosing = await findClosedReceiptClosing(db, filters.year, filters.month);
  if (!existingClosing) {
    throw new ReceiptClosingValidationError(
      "NO_CLOSED_CLOSING",
      "Nenhum fechamento CLOSED encontrado para reprocessar."
    );
  }
  const content = await buildReceiptClosingContent(
    db,
    {
      filters,
      carryoverReceiptIds: await loadCarryoverReceiptIdsOfClosing(db, existingClosing.closingId),
      excludeCoverageClosingId: existingClosing.closingId,
    },
    deps
  );
  return buildReceiptClosingReprocessPreview(existingClosing, content.preview);
}

/**
 * Reprocessamento: novo CLOSED substitui o atual. As pendências que o fechamento
 * atual já pagou são recalculadas e mantidas (nunca liberadas para pagar de novo);
 * a cobertura do fechamento antigo vira SUPERSEDED e a do novo é gravada na mesma
 * transação.
 */
export async function reprocessCommissionReceiptClosingApply(
  db: ClosingWithCoverageDb,
  input: ReceiptClosingFilters & {
    userId: string;
    reason: string;
  },
  deps: ReceiptClosingEngineDeps = defaultReceiptClosingEngineDeps
): Promise<ReceiptClosingApplyResult & { supersededClosingId: string }> {
  const reason = validateReceiptClosingCancelReason(input.reason);
  const current = await findClosedReceiptClosing(db, input.year, input.month);
  if (!current) {
    throw new ReceiptClosingValidationError(
      "NO_CLOSED_CLOSING",
      "Nenhum fechamento CLOSED encontrado para reprocessar."
    );
  }
  const content = await buildReceiptClosingContent(
    db,
    {
      filters: input,
      carryoverReceiptIds: await loadCarryoverReceiptIdsOfClosing(db, current.closingId),
      excludeCoverageClosingId: current.closingId,
    },
    deps
  );

  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.commissionMonthlyClosing.findFirst({
        where: {
          year: input.year,
          month: input.month,
          source: RECEIPT_CLOSING_SOURCE,
          status: "CLOSED",
        },
        orderBy: { closedAt: "desc" },
      });
      if (!existing) {
        throw new ReceiptClosingValidationError(
          "NO_CLOSED_CLOSING",
          "Nenhum fechamento CLOSED encontrado para reprocessar."
        );
      }
      if (existing.id !== current.closingId) {
        throw new ReceiptClosingValidationError(
          "REPROCESS_CONFLICT",
          "O fechamento CLOSED mudou durante o reprocessamento (possível operação simultânea). Atualize e tente novamente."
        );
      }

      // Rebaixa o fechamento atual para REPROCESSED ANTES de criar o novo.
      // O índice único parcial (year, month, source) WHERE status='CLOSED' só
      // admite um CLOSED por período — criar o novo antes de liberar o slot
      // causava violação de constraint (P2002) e 500 no reprocessamento.
      await tx.commissionMonthlyClosing.update({
        where: { id: existing.id },
        data: {
          status: "REPROCESSED",
          notes: appendReceiptClosingNote(
            existing.notes,
            formatReceiptClosingReprocessNote(input.userId, reason, "pending")
          ),
        },
      });

      // A cobertura do fechamento substituído deixa de valer (histórico) antes
      // de gravar a do novo — o índice único parcial admite uma COVERED por evento.
      await tx.commissionReceiptCoverage.updateMany({
        where: { closingId: existing.id, coverageStatus: "COVERED" },
        data: {
          coverageStatus: "SUPERSEDED",
          notes: `Fechamento ${formatCommissionYearMonthLabel({ year: existing.year, month: existing.month })} reprocessado por ${input.userId}: ${reason}`,
        },
      });

      const newClosing = await createClosingWithLines(tx, {
        preview: content.preview,
        userId: input.userId,
        notes: formatReceiptClosingReprocessNote(input.userId, reason, "pending"),
        calculationHash: content.calculationHash,
        coveredReceiptIds: content.coveredReceiptIds,
        receiptEvents: content.receiptEvents,
        carryoverLineCount: content.carryoverLineCount,
      });

      // Agora que o novo CLOSED existe, vincula o antigo a ele.
      await tx.commissionMonthlyClosing.update({
        where: { id: existing.id },
        data: {
          supersededByClosingId: newClosing.closingId,
          notes: appendReceiptClosingNote(
            existing.notes,
            formatReceiptClosingReprocessNote(input.userId, reason, newClosing.closingId)
          ),
        },
      });

      await tx.commissionMonthlyClosing.update({
        where: { id: newClosing.closingId },
        data: {
          notes: formatReceiptClosingReprocessNote(input.userId, reason, newClosing.closingId),
        },
      });

      return { ...newClosing, supersededClosingId: existing.id };
    });
  } catch (error) {
    // Reprocessamento concorrente do mesmo período: outro CLOSED foi criado
    // entre a leitura e a escrita → constraint parcial. Erro amigável (não 500).
    if (isUniqueViolation(error)) {
      if (isCoverageUniqueViolation(error)) {
        throw new ReceiptClosingValidationError("RECEIPT_ALREADY_COVERED", RECEIPT_COVERAGE_RACE_MESSAGE);
      }
      throw new ReceiptClosingValidationError(
        "REPROCESS_CONFLICT",
        "Não foi possível reprocessar: já existe outro fechamento CLOSED para o período (possível reprocessamento simultâneo). Atualize e tente novamente."
      );
    }
    throw error;
  }
}
