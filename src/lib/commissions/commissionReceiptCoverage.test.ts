/**
 * Cobertura de comissão, cutover Nomus → IndusCost e pendências de períodos
 * anteriores — CASOS 1–25 da especificação + regressões do fechamento.
 *
 * Banco falso em memória (com o índice único parcial da cobertura e rollback de
 * transação) e motor de comissão stub: o que está sob teste é a camada real de
 * cobertura, pendências, fechamento, cancelamento, reprocessamento e auditoria.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import {
  aggregateCommissionReceiptPreview,
  type CommissionReceiptPreviewLine,
} from "./commissionReceiptEngine.js";
import {
  loadCommissionReceiptCompetenceForScope,
  type CommissionReceiptEventScope,
} from "./commissionReceiptCompetence.server.js";
import { buildCommissionReceiptLedgerLineKey } from "./commissionReceiptLedger.js";
import {
  applyCommissionReceiptClosing,
  cancelCommissionReceiptClosing,
  findClosedReceiptClosing,
  loadReceiptClosingLedgerLines,
  loadReceiptEventsForCoverage,
  previewCommissionReceiptClosing,
  reprocessCommissionReceiptClosingApply,
  type ReceiptClosingEngineDeps,
} from "./commissionReceiptClosing.server.js";
import {
  ReceiptClosingDuplicateError,
  ReceiptClosingValidationError,
} from "./commissionReceiptClosing.js";
import {
  loadCoveredReceiptIdsForCompetence,
  loadReceiptClosingCarryovers,
  type CarryoverEvaluationDeps,
} from "./commissionReceiptCoverage.server.js";
import { findReceiptsInMultipleAnchors } from "./commissionReceiptCoverage.js";
import {
  formatCarryoverLineTag,
  resolveCommissionReceiptCoverageState,
  summarizeCarryoverRows,
} from "./commissionReceiptCoverage.shared.js";
import {
  COMMISSION_LEGACY_RECONCILIATION_START_DATE,
  COMMISSION_OFFICIAL_CUTOVER_DATE,
  COMMISSION_PRE_CUTOVER_CLOSING_BLOCKED_REASON,
  isCompetenceOfficialInIndusCost,
  resolveReceiptCutoverPeriod,
  resolveReceiptNaturalYearMonth,
} from "./commissionCoverageCutover.js";
import { buildCommissionCoverageAudit } from "./commissionCoverageAudit.server.js";
import {
  LEGACY_COVERAGE_IMPORT_CONFIRM,
  applyLegacyCoverageImport,
  previewLegacyCoverageImport,
} from "./commissionLegacyCoverageImport.server.js";
import {
  buildReceiptClosingPageFromLedger,
  buildReceiptClosingPageFromPreview,
} from "./commissionReceiptClosingApi.js";
import { buildReceiptClosingDetailExportWorkbook } from "./commissionReceiptClosingDetailExport.shared.js";
import { receiptClosingLineSellerKey } from "./commissionReceiptClosingSellerFilter.shared.js";

/* ------------------------------------------------------------------ */
/*  Banco falso                                                        */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

function toComparable(value: unknown): number {
  return value instanceof Date ? value.getTime() : Number(value);
}

function matches(
  row: Row,
  where: Row | undefined,
  relations: Record<string, (row: Row) => Row | null | undefined> = {}
): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (key === "OR") {
      if (!(cond as Row[]).some((item) => matches(row, item, relations))) return false;
      continue;
    }
    const relation = relations[key];
    if (relation) {
      const related = relation(row);
      if (!related || !matches(related, cond as Row)) return false;
      continue;
    }
    const value = row[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Row;
      if ("in" in c && !(c.in as unknown[]).includes(value)) return false;
      if ("notIn" in c && (c.notIn as unknown[]).includes(value)) return false;
      if ("not" in c && (c.not === null ? value == null : value === c.not)) return false;
      if (
        "hasSome" in c &&
        !(Array.isArray(value) && (c.hasSome as unknown[]).some((item) => (value as unknown[]).includes(item)))
      ) {
        return false;
      }
      if ("contains" in c && !(typeof value === "string" && value.includes(String(c.contains)))) return false;
      if ("gte" in c && !(value != null && toComparable(value) >= toComparable(c.gte))) return false;
      if ("gt" in c && !(value != null && toComparable(value) > toComparable(c.gt))) return false;
      if ("lt" in c && !(value != null && toComparable(value) < toComparable(c.lt))) return false;
      if ("lte" in c && !(value != null && toComparable(value) <= toComparable(c.lte))) return false;
      continue;
    }
    if (cond instanceof Date) {
      if (!(value instanceof Date) || value.getTime() !== cond.getTime()) return false;
      continue;
    }
    if (value !== cond) return false;
  }
  return true;
}

function uniqueViolation(target: string): Error {
  const error = new Error(`Unique constraint failed on ${target}`) as Error & {
    code: string;
    meta: { target: string };
  };
  error.code = "P2002";
  error.meta = { target };
  return error;
}

const day = (civil: string) => new Date(`${civil}T00:00:00.000Z`);
const round2 = (value: number) => Math.round(value * 100) / 100;
/** syncedAt claramente posterior ao fechamento feito no teste. */
const later = () => new Date(Date.now() + 60 * 60 * 1000);

type FakeCr = {
  externalId: number;
  nfe: string;
  customer: string;
  amount: number;
  scheduledCommission: number;
  sellerId: string | null;
  sellerName: string | null;
  sellerResolution?: string;
  scheduleId: string | null;
  status?: CommissionReceiptPreviewLine["status"];
  statusReason?: string | null;
  installmentNumber?: number;
  settlementDate?: string | null;
};

type FakeReceipt = {
  externalId: number;
  receivableExternalId: number;
  receiptDate: Date;
  receivedAmount: number;
  syncedAt: Date | null;
};

const JOSEANE = { sellerId: "seller-joseane", sellerName: "JOSEANE" };
const GISLENE = { sellerId: "seller-gislene", sellerName: "GISLENE" };
const RODRIGO = { sellerId: "seller-rodrigo", sellerName: "RODRIGO" };

function cr(
  externalId: number,
  seller: { sellerId: string | null; sellerName: string | null },
  overrides: Partial<FakeCr> = {}
): FakeCr {
  return {
    externalId,
    nfe: String(externalId - 40000),
    customer: `CLIENTE ${externalId}`,
    amount: 1000,
    scheduledCommission: 30,
    scheduleId: `sch-${externalId}`,
    installmentNumber: 1,
    ...seller,
    ...overrides,
  };
}

/** Casos reais de referência (pré-cutover). */
const CR_19236 = cr(19236, JOSEANE, {
  nfe: "7704",
  customer: "ACQUAPER BEBEDOUROS E EQUIPAMENTOS LTDA",
  amount: 499.35,
  scheduledCommission: 17.2,
  settlementDate: "2026-09-10",
});
const CR_19413 = cr(19413, JOSEANE, {
  nfe: "7752",
  customer: "ADNUSIA NOGUEIRA DE SOUZA NASCIMENTO",
  amount: 365.3,
  scheduledCommission: 10,
  settlementDate: "2026-09-02",
});

function engineLine(
  receivable: FakeCr,
  events: FakeReceipt[],
  year: number,
  month: number
): CommissionReceiptPreviewLine {
  const received = round2(events.reduce((sum, event) => sum + event.receivedAmount, 0));
  const status = receivable.status ?? "COMMISSIONABLE";
  const commission =
    status === "COMMISSIONABLE" ? round2((receivable.scheduledCommission * received) / receivable.amount) : 0;
  const lastDate = events
    .map((event) => event.receiptDate.toISOString().slice(0, 10))
    .sort()
    .at(-1)!;
  const installmentNumber = receivable.installmentNumber ?? 1;
  return {
    ledgerLineKey: buildCommissionReceiptLedgerLineKey({
      year,
      month,
      nomusReceivableId: receivable.externalId,
      commissionRecordId: null,
      commissionPaymentScheduleId: null,
      commissionReceivableScheduleId: receivable.scheduleId,
      installmentNumber,
      nomusOrderItemId: null,
      ruleId: null,
    }),
    year,
    month,
    nomusReceivableId: receivable.externalId,
    receivableNumber: String(receivable.externalId),
    installmentNumber,
    settlementDate: `${receivable.settlementDate ?? lastDate}T00:00:00.000Z`,
    receiptDate: lastDate,
    receiptIds: events.map((event) => event.externalId).sort((a, b) => a - b),
    dueDate: null,
    receivableAmount: receivable.amount,
    receivedAmount: received,
    receivedSharePercent: round2((received / receivable.amount) * 100),
    customerExternalId: null,
    customerId: null,
    customerName: receivable.customer,
    nomusNfeId: null,
    nfeNumber: receivable.nfe,
    orderCode: `PD-${receivable.externalId}`,
    localOrderId: null,
    nomusOrderItemId: null,
    localItemId: null,
    productCode: null,
    productName: null,
    rawSellerId: null,
    rawSellerName: receivable.sellerName,
    canonicalSellerId: receivable.sellerId,
    canonicalSellerName: receivable.sellerId ? receivable.sellerName : null,
    sellerResolutionStatus: receivable.sellerResolution ?? "OK_CANONICAL",
    commissionRecordId: null,
    commissionPaymentScheduleId: null,
    commissionReceivableScheduleId: receivable.scheduleId,
    ruleId: null,
    ruleName: null,
    ratePercent: round2((receivable.scheduledCommission / receivable.amount) * 100),
    commissionableBaseAmount: status === "COMMISSIONABLE" ? received : 0,
    expectedCommissionAmount: commission,
    releasedCommissionAmount: commission,
    grossCommissionAmount: commission,
    status,
    statusReason: receivable.statusReason ?? null,
    exclusionRuleId: null,
    exclusionReason: null,
    source: receivable.scheduleId ? "RECEIVABLE_SCHEDULE" : "EXCEPTION",
  };
}

function createWorld() {
  const crs = new Map<number, FakeCr>();
  const receipts: FakeReceipt[] = [];
  const closings = new Map<string, Row>();
  let ledger: Row[] = [];
  let coverage: Row[] = [];
  let imports: Row[] = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;
  const flags = { failCoverageCreateMany: false };

  const assertClosedUnique = (row: Row) => {
    if (row.status !== "CLOSED") return;
    for (const other of closings.values()) {
      if (other.id === row.id) continue;
      if (
        other.status === "CLOSED" &&
        other.year === row.year &&
        other.month === row.month &&
        other.source === row.source
      ) {
        throw uniqueViolation("CommissionMonthlyClosing_year_month_source_closed_key");
      }
    }
  };

  const receivableRow = (item: FakeCr): Row => ({
    externalId: item.externalId,
    sourceInvoiceNumber: item.nfe,
    personName: item.customer,
    amountReceivable: item.amount,
    settlementDate: item.settlementDate ? day(item.settlementDate) : null,
    sourceInvoiceId: null,
    dueDate: null,
  });

  const scheduleRow = (item: FakeCr): Row | null =>
    item.scheduleId
      ? {
          id: item.scheduleId,
          receivableId: item.externalId,
          status: "ACTIVE",
          installmentNumber: item.installmentNumber ?? 1,
          scheduledCommissionAmount: item.scheduledCommission,
          canonicalSeller: item.sellerId ? { name: item.sellerName } : null,
          createdAt: new Date(0),
        }
      : null;

  const db = {
    nomusReceivableReceipt: {
      findMany: async ({ where }: { where?: Row } = {}) =>
        receipts.filter((row) => matches(row as unknown as Row, where)).map((row) => ({ ...row })),
      count: async ({ where }: { where?: Row } = {}) =>
        receipts.filter((row) => matches(row as unknown as Row, where)).length,
    },
    nomusAccountsReceivable: {
      findMany: async ({ where }: { where?: Row } = {}) =>
        [...crs.values()].map(receivableRow).filter((row) => matches(row, where)),
    },
    commissionReceivableSchedule: {
      findMany: async ({ where }: { where?: Row } = {}) =>
        [...crs.values()]
          .map(scheduleRow)
          .filter((row): row is Row => row != null && matches(row, where)),
    },
    commissionReceiptCoverage: {
      findMany: async ({ where }: { where?: Row } = {}) =>
        coverage.filter((row) => matches(row, where)).map((row) => ({ ...row })),
      createMany: async ({ data }: { data: Row[] }) => {
        if (flags.failCoverageCreateMany) throw new Error("SIMULATED_COVERAGE_FAILURE");
        for (const row of data) {
          // Índice único parcial: uma cobertura COVERED por recebimento.
          if (
            row.coverageStatus === "COVERED" &&
            row.receiptExternalId != null &&
            coverage.some(
              (other) => other.coverageStatus === "COVERED" && other.receiptExternalId === row.receiptExternalId
            )
          ) {
            throw uniqueViolation("CommissionReceiptCoverage_receipt_covered_key");
          }
          coverage.push({ id: nextId("cov"), ...row });
        }
        return { count: data.length };
      },
      updateMany: async ({ where, data }: { where?: Row; data: Row }) => {
        let count = 0;
        coverage = coverage.map((row) => {
          if (!matches(row, where)) return row;
          count += 1;
          return { ...row, ...data };
        });
        return { count };
      },
    },
    commissionLegacyCoverageImport: {
      findMany: async ({ where }: { where?: Row } = {}) =>
        imports.filter((row) => matches(row, where)).map((row) => ({ ...row })),
      findUnique: async ({ where }: { where: { source_fileHash: { source: string; fileHash: string } } }) =>
        imports.find(
          (row) => row.source === where.source_fileHash.source && row.fileHash === where.source_fileHash.fileHash
        ) ?? null,
      create: async ({ data }: { data: Row }) => {
        if (imports.some((row) => row.source === data.source && row.fileHash === data.fileHash)) {
          throw uniqueViolation("CommissionLegacyCoverageImport_source_fileHash_key");
        }
        const row: Row = { id: nextId("import"), importedAt: new Date(), createdAt: new Date(), ...data };
        imports.push(row);
        return row;
      },
    },
    commissionMonthlyClosing: {
      findFirst: async ({ where }: { where?: Row } = {}) =>
        [...closings.values()].find((row) => matches(row, where)) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) => closings.get(where.id) ?? null,
      findMany: async ({ where }: { where?: Row } = {}) =>
        [...closings.values()].filter((row) => matches(row, where)),
      create: async ({ data }: { data: Row }) => {
        const row: Row = { id: nextId("closing"), supersededByClosingId: null, ...data };
        assertClosedUnique(row);
        closings.set(row.id as string, row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const existing = closings.get(where.id);
        if (!existing) throw new Error("closing not found");
        const row = { ...existing, ...data };
        assertClosedUnique(row);
        closings.set(where.id, row);
        return row;
      },
    },
    commissionReceiptLedgerLine: {
      createMany: async ({ data }: { data: Row[] }) => {
        for (const row of data) {
          if (ledger.some((line) => line.ledgerLineKey === row.ledgerLineKey)) {
            throw uniqueViolation("CommissionReceiptLedgerLine_ledgerLineKey_key");
          }
          ledger.push({ ...row });
        }
        return { count: data.length };
      },
      findMany: async ({ where }: { where?: Row } = {}) =>
        ledger
          .filter((row) =>
            matches(row, where, { closing: (line) => closings.get(line.closingId as string) ?? null })
          )
          .map((row) => ({ ...row })),
    },
    commissionRule: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id })),
    },
    commissionCustomerExclusionRule: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id })),
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const snapshot = {
        closings: new Map([...closings].map(([key, value]) => [key, { ...value }])),
        ledger: ledger.map((row) => ({ ...row })),
        coverage: coverage.map((row) => ({ ...row })),
        imports: imports.map((row) => ({ ...row })),
      };
      try {
        return await fn(db);
      } catch (error) {
        closings.clear();
        for (const [key, value] of snapshot.closings) closings.set(key, value);
        ledger = snapshot.ledger;
        coverage = snapshot.coverage;
        imports = snapshot.imports;
        throw error;
      }
    },
  };

  /** Motor stub: soma os eventos do mês por título (escopo include/exclude como o real). */
  function engineLines(
    year: number,
    month: number,
    scope: CommissionReceiptEventScope | null | undefined
  ): CommissionReceiptPreviewLine[] {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const include = scope?.includeReceiptExternalIds ? new Set(scope.includeReceiptExternalIds) : null;
    const exclude = new Set(scope?.excludeReceiptExternalIds ?? []);
    const byCr = new Map<number, FakeReceipt[]>();
    for (const receipt of receipts) {
      if (receipt.receiptDate.toISOString().slice(0, 7) !== key) continue;
      if (include && !include.has(receipt.externalId)) continue;
      if (exclude.has(receipt.externalId)) continue;
      const list = byCr.get(receipt.receivableExternalId) ?? [];
      list.push(receipt);
      byCr.set(receipt.receivableExternalId, list);
    }
    return [...byCr.entries()]
      .sort(([a], [b]) => a - b)
      .map(([crId, events]) => engineLine(crs.get(crId)!, events, year, month));
  }

  const carryoverDeps: CarryoverEvaluationDeps = {
    materialize: async () => {},
    evaluateNaturalMonth: async (natural, receiptExternalIds) =>
      engineLines(natural.year, natural.month, { includeReceiptExternalIds: receiptExternalIds }),
  };

  const deps: ReceiptClosingEngineDeps = {
    loadPreview: async (filters, scope) => {
      const lines = engineLines(filters.year, filters.month, scope);
      return aggregateCommissionReceiptPreview(
        lines,
        { year: filters.year, month: filters.month },
        new Set(lines.map((line) => line.nomusReceivableId)).size
      );
    },
    loadCarryovers: (coverageDb, input) => loadReceiptClosingCarryovers(coverageDb, input, carryoverDeps),
    loadCoveredReceiptIds: loadCoveredReceiptIdsForCompetence,
    loadReceiptEvents: loadReceiptEventsForCoverage,
  };

  return {
    db,
    deps,
    flags,
    closings,
    receipts,
    get ledger() {
      return ledger;
    },
    get coverage() {
      return coverage;
    },
    get imports() {
      return imports;
    },
    addCr(item: FakeCr) {
      crs.set(item.externalId, item);
    },
    addReceipt(externalId: number, receivableExternalId: number, civil: string, amount: number, syncedAt: Date | null = null) {
      receipts.push({ externalId, receivableExternalId, receiptDate: day(civil), receivedAmount: amount, syncedAt });
    },
    pushLedger(row: Row) {
      ledger.push(row);
    },
    /** Relatório do Nomus da competência importado (sem linhas — só confirma o mês). */
    markLegacyImported(year: number, month: number) {
      imports.push({
        id: nextId("import"),
        source: "NOMUS",
        referenceYear: year,
        referenceMonth: month,
        fileHash: `hash-${year}-${month}`,
        resultRowsJson: [],
      });
    },
    async addNomusCoverage(receiptExternalId: number) {
      const receipt = receipts.find((row) => row.externalId === receiptExternalId)!;
      const natural = resolveReceiptNaturalYearMonth(receipt.receiptDate)!;
      await db.commissionReceiptCoverage.createMany({
        data: [
          {
            receiptExternalId,
            receivableExternalId: receipt.receivableExternalId,
            coverageSource: "NOMUS_LEGACY",
            coverageStatus: "COVERED",
            naturalReceiptDate: receipt.receiptDate,
            naturalYear: natural.year,
            naturalMonth: natural.month,
            coveredYear: 2026,
            coveredMonth: 9,
            closingId: null,
            legacyImportId: null,
            coveredReceivedAmount: receipt.receivedAmount,
            coveredCommissionAmount: null,
            associationMethod: "RECEIVABLE_ID",
          },
        ],
      });
    },
    preview(year: number, month: number, carryoverReceiptIds: number[] = []) {
      return previewCommissionReceiptClosing(
        { year, month },
        { includeCarryover: true, carryoverReceiptIds },
        deps,
        db as never
      );
    },
    apply(year: number, month: number, carryoverReceiptIds: number[] = []) {
      return applyCommissionReceiptClosing(
        db as never,
        { year, month, userId: "tester", carryoverReceiptIds },
        deps
      );
    },
  };
}

type World = ReturnType<typeof createWorld>;

function coverageOf(world: World, receiptExternalId: number) {
  return world.coverage.filter((row) => row.receiptExternalId === receiptExternalId);
}

function activeCoverageOf(world: World, receiptExternalId: number) {
  return coverageOf(world, receiptExternalId).filter((row) => row.coverageStatus === "COVERED");
}

async function rejectsWithCode(promise: Promise<unknown>, code: string, pattern?: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ReceiptClosingValidationError, `esperava ReceiptClosingValidationError, veio ${String(error)}`);
    assert.equal(error.code, code);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

/** Planilha do relatório do Nomus (XLSX em memória). */
function nomusReportBuffer(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([["CR", "NF", "Cliente", "Valor", "Comissão"], ...rows]),
    "Comissões"
  );
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function importNomusReport(world: World, year: number, month: number, rows: unknown[][], filename = "nomus.xlsx") {
  const plan = await previewLegacyCoverageImport(world.db as never, {
    buffer: nomusReportBuffer(rows),
    filename,
    reference: { year, month },
  });
  const result = await applyLegacyCoverageImport(world.db as never, plan, {
    importedBy: "tester",
    confirm: LEGACY_COVERAGE_IMPORT_CONFIRM,
  });
  return { plan, result };
}

/* ------------------------------------------------------------------ */
/*  Casos                                                              */
/* ------------------------------------------------------------------ */

describe("cobertura de comissão — cutover e janela legada", () => {
  it("datas centralizadas: cutover 01/10/2026 e janela legada desde 01/08/2026", () => {
    assert.equal(COMMISSION_OFFICIAL_CUTOVER_DATE, "2026-10-01");
    assert.equal(COMMISSION_LEGACY_RECONCILIATION_START_DATE, "2026-08-01");
    assert.equal(resolveReceiptCutoverPeriod("2026-07-31"), "LEGACY_OUTSIDE_RECONCILIATION_WINDOW");
    assert.equal(resolveReceiptCutoverPeriod("2026-08-01"), "LEGACY_RECONCILIATION_WINDOW");
    assert.equal(resolveReceiptCutoverPeriod("2026-09-30"), "LEGACY_RECONCILIATION_WINDOW");
    assert.equal(resolveReceiptCutoverPeriod("2026-10-01"), "POST_CUTOVER");
    assert.equal(isCompetenceOfficialInIndusCost(2026, 9), false);
    assert.equal(isCompetenceOfficialInIndusCost(2026, 10), true);
  });

  it("estado de cobertura: cobertura ativa vence; sem cobertura, a janela decide", () => {
    assert.equal(
      resolveCommissionReceiptCoverageState({ receiptDate: "2026-08-26", activeCoverage: { coverageSource: "NOMUS_LEGACY" } }),
      "LEGACY_COVERED"
    );
    assert.equal(
      resolveCommissionReceiptCoverageState({ receiptDate: "2026-10-05", activeCoverage: { coverageSource: "INDUSCOST_CLOSING" } }),
      "INDUSCOST_COVERED"
    );
    assert.equal(resolveCommissionReceiptCoverageState({ receiptDate: "2026-07-10", activeCoverage: null }), "LEGACY_OUTSIDE_RECONCILIATION_WINDOW");
    assert.equal(resolveCommissionReceiptCoverageState({ receiptDate: "2026-08-26", activeCoverage: null }), "LEGACY_PENDING_CANDIDATE");
    assert.equal(
      resolveCommissionReceiptCoverageState({ receiptDate: "2026-08-26", activeCoverage: null, ambiguousLegacyAssociation: true }),
      "AMBIGUOUS"
    );
    assert.equal(resolveCommissionReceiptCoverageState({ receiptDate: "2026-10-31", activeCoverage: null }), "POST_CUTOVER_PENDING");
  });

  it("regressão: competência antes do cutover — prévia intacta, sem pendências e sem fechamento oficial", async () => {
    const world = createWorld();
    world.addCr(CR_19236);
    world.addReceipt(90001, 19236, "2026-08-26", 499.35);
    await world.addNomusCoverage(90001);
    const payload = await world.preview(2026, 8);
    // Antes do cutover a prévia não exclui cobertura (comparação com o Nomus).
    assert.equal(payload.preview.lines.length, 1);
    assert.equal(payload.canApply, false);
    assert.equal(payload.applyBlockedReason, COMMISSION_PRE_CUTOVER_CLOSING_BLOCKED_REASON);
    assert.equal(payload.carryover ?? null, null);
    await rejectsWithCode(world.apply(2026, 8), "COMMISSION_PERIOD_BEFORE_INDUSCOST_CUTOVER");
    assert.equal(world.closings.size, 0);
  });
});

describe("cobertura de comissão — CASOS 1 a 25", () => {
  it("CASO 1 — recebimento pós-cutover do mês, não coberto → linha normal", async () => {
    const world = createWorld();
    world.addCr(cr(50001, JOSEANE));
    world.addReceipt(70001, 50001, "2026-10-15", 1000);
    const payload = await world.preview(2026, 10);
    const line = payload.preview.lines.find((item) => item.nomusReceivableId === 50001);
    assert.ok(line);
    assert.deepEqual(line.receiptIds, [70001]);
    assert.equal(line.inclusionType ?? "NORMAL", "NORMAL");
    assert.equal(payload.canApply, true);
    assert.equal(payload.carryover?.rows.length, 0);
  });

  it("CASO 2 — outubro CLOSED: o recebimento não reaparece em novembro", async () => {
    const world = createWorld();
    world.addCr(cr(50001, JOSEANE));
    world.addReceipt(70001, 50001, "2026-10-15", 1000);
    await world.apply(2026, 10);
    const november = await world.preview(2026, 11);
    assert.equal(november.preview.lines.length, 0);
    assert.equal(november.carryover?.rows.length, 0);
    const active = activeCoverageOf(world, 70001);
    assert.equal(active.length, 1);
    assert.equal(active[0]!.coverageSource, "INDUSCOST_CLOSING");
    assert.equal(active[0]!.coveredMonth, 10);
  });

  it("CASO 3 — recebimento de outubro sincronizado depois do fechamento → pendência em novembro", async () => {
    const world = createWorld();
    world.addCr(cr(50001, JOSEANE));
    world.addCr(cr(50002, GISLENE, { amount: 2000, scheduledCommission: 50 }));
    world.addReceipt(70001, 50001, "2026-10-15", 1000);
    await world.apply(2026, 10);
    world.addReceipt(70002, 50002, "2026-10-31", 2000, later());

    const november = await world.preview(2026, 11);
    const row = november.carryover!.rows.find((item) => item.receivableExternalId === 50002);
    assert.ok(row);
    assert.equal(row.state, "POST_CUTOVER_PENDING");
    assert.equal(row.origin, "INDUSCOST");
    assert.equal(row.inclusionType, "LATE_CARRYOVER");
    assert.equal(row.situation, "Recebimento sincronizado após fechamento");
    assert.equal(row.includable, true);
    assert.equal(row.selected, false);
    assert.deepEqual(row.receiptExternalIds, [70002]);
    assert.equal(row.naturalMonth, 10);
    assert.equal(row.receiptDate, "2026-10-31");
    assert.equal(row.commissionAmount, 50);
    // Não entra sozinho: só aparece no grid até ser incluído.
    assert.ok(!november.preview.lines.some((line) => line.nomusReceivableId === 50002));
    assert.equal(november.carryover!.summary.eligibleCount, 1);
    assert.equal(november.carryover!.summary.eligibleCommissionAmount, 50);
  });

  it("CASO 4 — pendência de outubro incluída em novembro: natural = outubro, fechamento = novembro", async () => {
    const world = createWorld();
    world.addCr(cr(50001, JOSEANE));
    world.addCr(cr(50002, GISLENE, { amount: 2000, scheduledCommission: 50 }));
    world.addReceipt(70001, 50001, "2026-10-15", 1000);
    await world.apply(2026, 10);
    world.addReceipt(70002, 50002, "2026-10-31", 2000, later());
    world.addReceipt(70003, 50001, "2026-11-10", 1000);

    const result = await world.apply(2026, 11, [70002]);
    assert.equal(result.carryoverLineCount, 1);
    const line = world.ledger.find(
      (item) => item.closingId === result.closingId && item.nomusReceivableId === 50002
    );
    assert.ok(line);
    assert.equal(line.year, 2026);
    assert.equal(line.month, 11);
    assert.equal(line.naturalYear, 2026);
    assert.equal(line.naturalMonth, 10);
    assert.equal(line.inclusionType, "LATE_CARRYOVER");
    assert.deepEqual(line.receiptExternalIds, [70002]);
    assert.equal((line.receiptDate as Date).toISOString().slice(0, 10), "2026-10-31");

    const normal = world.ledger.find(
      (item) => item.closingId === result.closingId && item.nomusReceivableId === 50001
    );
    assert.equal(normal?.inclusionType, "NORMAL");
    assert.equal(normal?.naturalMonth, 11);

    const [covered] = activeCoverageOf(world, 70002);
    assert.equal(covered?.naturalMonth, 10);
    assert.equal(covered?.coveredMonth, 11);
    assert.equal(covered?.closingId, result.closingId);
    assert.equal(covered?.ledgerLineId, line.id);
    // receiptDate nunca é reescrito.
    assert.equal(
      world.receipts.find((receipt) => receipt.externalId === 70002)!.receiptDate.toISOString().slice(0, 10),
      "2026-10-31"
    );
  });

  it("CASO 5 — rodar novembro de novo após CLOSED não reapresenta a pendência", async () => {
    const world = createWorld();
    world.addCr(cr(50002, GISLENE, { amount: 2000, scheduledCommission: 50 }));
    world.addReceipt(70002, 50002, "2026-10-31", 2000, later());
    await world.apply(2026, 11, [70002]);

    const again = await world.preview(2026, 11);
    assert.equal(again.canApply, false);
    assert.equal(again.carryover ?? null, null);
    const december = await world.preview(2026, 12);
    assert.ok(!december.carryover!.rows.some((row) => row.receiptExternalIds.includes(70002)));
    await assert.rejects(world.apply(2026, 11, [70002]), ReceiptClosingDuplicateError);
  });

  it("CASO 6 — recebimentos parciais: A coberto, B pendente → só B (pós-cutover e legado)", async () => {
    const world = createWorld();
    world.addCr(cr(30000, JOSEANE, { amount: 1000, scheduledCommission: 30 }));
    world.addReceipt(80001, 30000, "2026-10-05", 400);
    await world.apply(2026, 10);
    world.addReceipt(80002, 30000, "2026-10-20", 600, later());
    const november = await world.preview(2026, 11);
    const row = november.carryover!.rows.find((item) => item.receivableExternalId === 30000);
    assert.ok(row);
    assert.deepEqual(row.receiptExternalIds, [80002]);
    assert.equal(row.receivedAmount, 600);
    assert.equal(row.commissionAmount, 18);

    // Legado: recebimento A pago pelo Nomus, B não encontrado na cobertura.
    const legacy = createWorld();
    legacy.addCr(cr(30001, JOSEANE, { amount: 1000, scheduledCommission: 30 }));
    legacy.addReceipt(81001, 30001, "2026-09-05", 400);
    legacy.addReceipt(81002, 30001, "2026-09-20", 600);
    legacy.markLegacyImported(2026, 8);
    legacy.markLegacyImported(2026, 9);
    await legacy.addNomusCoverage(81001);
    const october = await legacy.preview(2026, 10);
    const legacyRow = october.carryover!.rows.find((item) => item.receivableExternalId === 30001);
    assert.ok(legacyRow);
    assert.deepEqual(legacyRow.receiptExternalIds, [81002]);
    assert.equal(legacyRow.receivedAmount, 600);
    assert.equal(legacyRow.state, "LEGACY_PENDING_CANDIDATE");
    assert.equal(legacyRow.includable, true);
  });

  it("CASO 7 e 8 — CR 19236 e CR 19413 cobertos pelo relatório Nomus de setembro não aparecem em outubro", async () => {
    const world = createWorld();
    world.addCr(CR_19236);
    world.addCr(CR_19413);
    world.addReceipt(90001, 19236, "2026-08-26", 499.35);
    world.addReceipt(90002, 19413, "2026-08-31", 365.3);
    const { plan, result } = await importNomusReport(world, 2026, 9, [
      [19236, "7704", "ACQUAPER BEBEDOUROS E EQUIPAMENTOS LTDA", 499.35, 17.2],
      [19413, "7752", "ADNUSIA NOGUEIRA DE SOUZA NASCIMENTO", "365,30", "10,00"],
    ]);
    assert.equal(plan.counts.matchedCount, 2);
    assert.equal(result.created, true);
    assert.equal(result.coverageCount, 2);

    const october = await world.preview(2026, 10);
    assert.ok(!october.carryover!.rows.some((row) => row.receivableExternalId === 19236));
    assert.ok(!october.carryover!.rows.some((row) => row.receivableExternalId === 19413));

    const audit = await buildCommissionCoverageAudit(world.db as never, { receivableIds: [19236, 19413] });
    const a19236 = audit.rows.find((row) => row.receivableExternalId === 19236)!;
    assert.equal(a19236.state, "LEGACY_COVERED");
    assert.equal(a19236.coverageSource, "NOMUS_LEGACY");
    assert.equal(a19236.coveredYear, 2026);
    assert.equal(a19236.coveredMonth, 9);
    assert.equal(a19236.nfeNumber, "7704");
    assert.equal(a19236.receiptDate, "2026-08-26");
    assert.equal(a19236.settlementDate, "2026-09-10");
    assert.equal(a19236.naturalCompetence, "08/2026");
    assert.equal(a19236.scheduleStatus, "ACTIVE");
    assert.equal(a19236.installmentNumber, 1);
    assert.equal(a19236.commissionAmount, 17.2);
    const a19413 = audit.rows.find((row) => row.receivableExternalId === 19413)!;
    assert.equal(a19413.state, "LEGACY_COVERED");
    assert.equal(a19413.settlementDate, "2026-09-02");
    assert.equal(a19413.naturalCompetence, "08/2026");
    assert.equal(a19413.commissionAmount, 10);
    assert.equal(audit.totals.coveredByNomus, 2);
    assert.equal(audit.totals.pending, 0);
  });

  it("CASO 9 — CR 19236 sem cobertura importada → LEGACY_PENDING_CANDIDATE com aviso (não é dívida)", async () => {
    const world = createWorld();
    world.addCr(CR_19236);
    world.addReceipt(90001, 19236, "2026-08-26", 499.35);
    const october = await world.preview(2026, 10);
    const row = october.carryover!.rows.find((item) => item.receivableExternalId === 19236);
    assert.ok(row);
    assert.equal(row.state, "LEGACY_PENDING_CANDIDATE");
    assert.equal(row.origin, "LEGACY_NOMUS");
    assert.equal(row.inclusionType, "LEGACY_CARRYOVER");
    assert.equal(row.situation, "Não encontrado na cobertura Nomus");
    assert.equal(row.includable, false);
    assert.match(row.blockedReason ?? "", /Falta confirmação histórica: importe a cobertura do Nomus de 08\/2026, 09\/2026/);
    assert.equal(row.commissionAmount, 17.2);
    assert.equal(october.carryover!.summary.legacyAwaitingImportCount, 1);
    assert.deepEqual(
      october.carryover!.legacyImportStatus.map((item) => item.imported),
      [false, false]
    );

    const audit = await buildCommissionCoverageAudit(world.db as never, { receivableIds: [19236] });
    assert.equal(audit.rows[0]!.state, "LEGACY_PENDING_CANDIDATE");
    assert.match(audit.rows[0]!.reason, /falta importar 08\/2026, 09\/2026/);
    assert.match(audit.rows[0]!.reason, /Não é dívida confirmada/);
  });

  it("CASO 10 — recebimento de julho/2026 sem cobertura fica fora da janela e não polui o grid", async () => {
    const world = createWorld();
    world.addCr(cr(40010, JOSEANE));
    world.addReceipt(91010, 40010, "2026-07-20", 1000);
    const october = await world.preview(2026, 10);
    assert.equal(october.carryover!.rows.length, 0);
    const audit = await buildCommissionCoverageAudit(world.db as never, { receivableIds: [40010] });
    assert.equal(audit.rows[0]!.state, "LEGACY_OUTSIDE_RECONCILIATION_WINDOW");
    assert.equal(audit.totals.outsideWindow, 1);
    assert.equal(audit.totals.pending, 0);
  });

  it("CASO 11 — recebimento de setembro/2026 sem cobertura → candidato legado (inclusão só com setembro importado)", async () => {
    const world = createWorld();
    world.addCr(cr(40011, GISLENE));
    world.addReceipt(91011, 40011, "2026-09-15", 1000);
    const before = await world.preview(2026, 10);
    const blocked = before.carryover!.rows.find((row) => row.receivableExternalId === 40011)!;
    assert.equal(blocked.state, "LEGACY_PENDING_CANDIDATE");
    assert.equal(blocked.includable, false);
    assert.match(blocked.blockedReason ?? "", /09\/2026/);

    world.markLegacyImported(2026, 9);
    const after = await world.preview(2026, 10, [91011]);
    const row = after.carryover!.rows.find((item) => item.receivableExternalId === 40011)!;
    assert.equal(row.includable, true);
    assert.equal(row.selected, true);
    const result = await world.apply(2026, 10, [91011]);
    const line = world.ledger.find((item) => item.closingId === result.closingId && item.nomusReceivableId === 40011)!;
    assert.equal(line.inclusionType, "LEGACY_CARRYOVER");
    assert.equal(line.naturalMonth, 9);
    assert.equal(line.month, 10);
    const [covered] = activeCoverageOf(world, 91011);
    assert.equal(covered?.coverageSource, "INDUSCOST_CLOSING");
    assert.equal(covered?.naturalMonth, 9);
    assert.equal(covered?.coveredMonth, 10);
  });

  it("CASO 12 — vendedor não resolvido aparece como exceção e a inclusão é bloqueada", async () => {
    const world = createWorld();
    world.addCr(
      cr(50003, { sellerId: null, sellerName: "VENDEDOR X" }, {
        sellerResolution: "SELLER_UNRESOLVED",
        status: "SELLER_UNRESOLVED",
        statusReason: "Vendedor não resolvido (SELLER_UNRESOLVED)",
      })
    );
    world.addReceipt(70010, 50003, "2026-10-12", 1000);
    await world.apply(2026, 10);
    // Exceção resolvível não cobre: continua pendente.
    assert.equal(activeCoverageOf(world, 70010).length, 0);

    const november = await world.preview(2026, 11, [70010]);
    const row = november.carryover!.rows.find((item) => item.receivableExternalId === 50003)!;
    assert.equal(row.state, "POST_CUTOVER_PENDING");
    assert.equal(row.situation, "Não contemplado no fechamento de 10/2026");
    assert.equal(row.includable, false);
    assert.equal(row.selected, false);
    // Motivo do motor já traz o rótulo: não repete "Vendedor não resolvido: Vendedor não resolvido".
    assert.equal(row.blockedReason, "Vendedor não resolvido (SELLER_UNRESOLVED)");
    assert.equal(november.carryover!.selectionErrors.length, 1);
    await rejectsWithCode(world.apply(2026, 11, [70010]), "CARRYOVER_NOT_ALLOWED", /70010/);
  });

  it("CASO 13 — sem schedule: exceção diagnóstica, sem inventar comissão", async () => {
    const world = createWorld();
    world.addCr(cr(50001, JOSEANE));
    world.addCr(
      cr(50004, JOSEANE, { scheduleId: null, status: "NO_SCHEDULE", statusReason: "Título sem schedule materializado" })
    );
    world.addReceipt(70001, 50001, "2026-10-15", 1000);
    await world.apply(2026, 10);
    world.addReceipt(70011, 50004, "2026-10-28", 1000, later());
    const november = await world.preview(2026, 11);
    const row = november.carryover!.rows.find((item) => item.receivableExternalId === 50004)!;
    assert.equal(row.lineStatus, "NO_SCHEDULE");
    assert.equal(row.commissionAmount, 0);
    assert.equal(row.commissionReceivableScheduleId, null);
    assert.equal(row.includable, false);
    assert.equal(row.blockedReason, "Sem programação de comissão: Título sem schedule materializado");
  });

  it("CASO 14 — fechamento CANCELLED não conta como pagamento oficial", async () => {
    const world = createWorld();
    world.addCr(cr(50001, JOSEANE));
    world.addReceipt(70001, 50001, "2026-10-15", 1000);
    const october = await world.apply(2026, 10);
    const cancelled = await cancelCommissionReceiptClosing(world.db as never, {
      closingId: october.closingId,
      userId: "admin",
      reason: "Fechamento incorreto",
    });
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(activeCoverageOf(world, 70001).length, 0);
    assert.equal(coverageOf(world, 70001)[0]!.coverageStatus, "SUPERSEDED");
    // Ledger preservado para auditoria.
    assert.ok(world.ledger.some((line) => line.closingId === october.closingId));

    const november = await world.preview(2026, 11);
    const row = november.carryover!.rows.find((item) => item.receivableExternalId === 50001)!;
    assert.equal(row.situation, "Pendência de período anterior (10/2026 sem fechamento)");
    assert.equal(row.includable, true);
    const audit = await buildCommissionCoverageAudit(world.db as never, { receivableIds: [50001] });
    assert.equal(audit.rows[0]!.state, "POST_CUTOVER_PENDING");
    assert.equal(audit.rows[0]!.coverageHistoryCount, 1);
  });

  it("CASO 15 — fechamento CLOSED conta como cobertura oficial", async () => {
    const world = createWorld();
    world.addCr(cr(50001, JOSEANE));
    world.addReceipt(70001, 50001, "2026-10-15", 1000);
    const october = await world.apply(2026, 10);
    const audit = await buildCommissionCoverageAudit(world.db as never, { receivableIds: [50001] });
    const row = audit.rows[0]!;
    assert.equal(row.state, "INDUSCOST_COVERED");
    assert.equal(row.closingId, october.closingId);
    assert.equal(row.coveredMonth, 10);
    assert.equal(row.commissionAmount, 30);
    assert.deepEqual(row.closedLedgerClosingIds, [october.closingId]);
    assert.equal(row.duplicityRisk, false);
    assert.equal(audit.totals.coveredByInduscost, 1);
  });

  it("CASO 16 — incluir recebimento já coberto pelo Nomus → erro determinístico (app e banco)", async () => {
    const world = createWorld();
    world.addCr(cr(40016, JOSEANE));
    world.addReceipt(91016, 40016, "2026-09-10", 1000);
    world.markLegacyImported(2026, 9);
    await world.addNomusCoverage(91016);
    await rejectsWithCode(world.apply(2026, 10, [91016]), "CARRYOVER_NOT_ALLOWED", /91016/);
    assert.equal(world.closings.size, 0);
    // Segunda camada: o índice único parcial recusa outra cobertura COVERED.
    await assert.rejects(world.addNomusCoverage(91016), (error: unknown) => (error as { code?: string }).code === "P2002");

    // Corrida: cobertura gravada entre a prévia e a transação → revalidação barra.
    world.addCr(cr(40017, JOSEANE));
    world.addReceipt(91017, 40017, "2026-09-12", 1000);
    const racingDeps: ReceiptClosingEngineDeps = {
      ...world.deps,
      loadCarryovers: async (coverageDb, input) => {
        const evaluation = await world.deps.loadCarryovers(coverageDb, input);
        await world.addNomusCoverage(91017);
        return evaluation;
      },
    };
    await rejectsWithCode(
      applyCommissionReceiptClosing(
        world.db as never,
        { year: 2026, month: 10, userId: "tester", carryoverReceiptIds: [91017] },
        racingDeps
      ),
      "RECEIPT_ALREADY_COVERED",
      /91017/
    );
    assert.equal(world.closings.size, 0);
    assert.equal(world.ledger.length, 0);
  });

  it("CASO 17 — incluir recebimento já CLOSED no IndusCost → erro determinístico (cobertura e ledger)", async () => {
    const world = createWorld();
    world.addCr(cr(50001, JOSEANE));
    world.addReceipt(70001, 50001, "2026-10-15", 1000);
    await world.apply(2026, 10);
    await rejectsWithCode(world.apply(2026, 11, [70001]), "CARRYOVER_NOT_ALLOWED", /70001/);

    // Defesa em profundidade: ledger CLOSED com o recebimento, mesmo sem cobertura espelho.
    const other = createWorld();
    other.addCr(cr(50020, GISLENE));
    other.addReceipt(70020, 50020, "2026-10-20", 1000);
    other.closings.set("legacy-closed", {
      id: "legacy-closed",
      year: 2026,
      month: 12,
      status: "CLOSED",
      source: "RECEIPT_BASED",
    });
    other.pushLedger({
      id: "legacy-line",
      closingId: "legacy-closed",
      year: 2026,
      month: 12,
      ledgerLineKey: "legacy-key",
      receiptExternalIds: [70020],
    });
    await rejectsWithCode(other.apply(2026, 10), "RECEIPT_ALREADY_COVERED", /fechamento CLOSED de 12\/2026/);
  });

  it("CASO 18 — relatório legado importado duas vezes é idempotente", async () => {
    const world = createWorld();
    world.addCr(CR_19236);
    world.addReceipt(90001, 19236, "2026-08-26", 499.35);
    const rows = [[19236, "7704", "ACQUAPER BEBEDOUROS E EQUIPAMENTOS LTDA", 499.35, 17.2]];
    const first = await importNomusReport(world, 2026, 9, rows);
    assert.equal(first.result.coverageCount, 1);

    const second = await importNomusReport(world, 2026, 9, rows);
    assert.equal(second.plan.existingImportId, first.result.importId);
    assert.equal(second.result.created, false);
    assert.equal(second.result.coverageCount, 0);
    assert.equal(world.imports.length, 1);
    assert.equal(coverageOf(world, 90001).length, 1);

    // Outro arquivo com a mesma linha: vira ALREADY_COVERED, sem nova cobertura.
    const third = await importNomusReport(world, 2026, 9, [...rows, ["", "", "", "", ""]], "nomus-v2.xlsx");
    assert.equal(third.plan.counts.alreadyCoveredCount, 1);
    assert.equal(third.result.coverageCount, 0);
    assert.equal(coverageOf(world, 90001).length, 1);
  });

  it("CASO 19 — linha importada ambígua não cobre automaticamente", async () => {
    const world = createWorld();
    world.addCr(cr(60001, RODRIGO, { amount: 600, scheduledCommission: 18 }));
    world.addReceipt(92001, 60001, "2026-08-10", 300);
    world.addReceipt(92002, 60001, "2026-08-20", 300);
    const { plan, result } = await importNomusReport(world, 2026, 8, [[60001, "", "", 300, 9]]);
    assert.equal(plan.results[0]!.status, "AMBIGUOUS");
    assert.equal(plan.counts.ambiguousCount, 1);
    assert.equal(result.coverageCount, 0);
    assert.equal(world.coverage.length, 0);

    world.markLegacyImported(2026, 9);
    const october = await world.preview(2026, 10, [92001, 92002]);
    const row = october.carryover!.rows.find((item) => item.receivableExternalId === 60001)!;
    assert.equal(row.state, "AMBIGUOUS");
    assert.equal(row.situation, "Associação histórica ambígua");
    assert.equal(row.includable, false);
    assert.equal(row.selected, false);
    assert.equal(october.carryover!.summary.ambiguousCount, 1);
    await rejectsWithCode(world.apply(2026, 10, [92001, 92002]), "CARRYOVER_NOT_ALLOWED");
    const audit = await buildCommissionCoverageAudit(world.db as never, { receivableIds: [60001] });
    assert.ok(audit.rows.every((item) => item.state === "AMBIGUOUS"));
    assert.equal(audit.legacyImportRowsNotCovered[0]?.status, "AMBIGUOUS");
  });

  it("CASO 20 — vários vendedores: pendências independentes", async () => {
    const world = createWorld();
    world.addCr(cr(50001, JOSEANE));
    world.addCr(cr(50002, GISLENE, { amount: 2000, scheduledCommission: 50 }));
    world.addCr(cr(50005, RODRIGO, { amount: 500, scheduledCommission: 20 }));
    world.addReceipt(70001, 50001, "2026-10-03", 1000, later());
    world.addReceipt(70002, 50002, "2026-10-04", 2000, later());
    world.addReceipt(70005, 50005, "2026-10-05", 500, later());

    const november = await world.preview(2026, 11);
    const sellers = november.carryover!.rows.map((row) => row.canonicalSellerName).sort();
    assert.deepEqual(sellers, ["GISLENE", "JOSEANE", "RODRIGO"]);

    await world.apply(2026, 11, [70002]);
    assert.equal(activeCoverageOf(world, 70002).length, 1);
    assert.equal(activeCoverageOf(world, 70001).length, 0);
    assert.equal(activeCoverageOf(world, 70005).length, 0);
    const december = await world.preview(2026, 12);
    assert.deepEqual(
      december.carryover!.rows.map((row) => row.receivableExternalId).sort((a, b) => a - b),
      [50001, 50005]
    );
  });

  it("CASO 21 — filtro por vendedor não altera a cobertura global", async () => {
    const world = createWorld();
    world.addCr(cr(50001, JOSEANE));
    world.addCr(cr(50002, GISLENE, { amount: 2000, scheduledCommission: 50 }));
    world.addReceipt(70001, 50001, "2026-10-03", 1000, later());
    world.addReceipt(70002, 50002, "2026-10-04", 2000, later());
    const november = await world.preview(2026, 11);
    const section = november.carryover!;
    const gisleneKey = receiptClosingLineSellerKey({
      status: "COMMISSIONABLE",
      canonicalSellerId: GISLENE.sellerId,
      canonicalSellerName: GISLENE.sellerName,
      rawSellerName: GISLENE.sellerName,
      sellerResolutionStatus: "OK_CANONICAL",
    });
    const filtered = section.rows.filter(
      (row) => receiptClosingLineSellerKey({ ...row, status: row.lineStatus }) === gisleneKey
    );
    assert.equal(filtered.length, 1);
    assert.equal(summarizeCarryoverRows(filtered).eligibleCommissionAmount, 50);
    assert.equal(section.summary.eligibleCommissionAmount, 80);
    // Filtrar/visualizar não grava nada.
    assert.equal(world.coverage.length, 0);
    await world.apply(2026, 11, [70001, 70002]);
    assert.equal(activeCoverageOf(world, 70001).length, 1);
    assert.equal(activeCoverageOf(world, 70002).length, 1);
  });

  it("CASO 22 — XLSX mostra competência natural, fechamento e tipo de inclusão", async () => {
    const world = createWorld();
    world.addCr(cr(50001, JOSEANE));
    world.addCr(cr(50002, GISLENE, { amount: 2000, scheduledCommission: 50 }));
    world.addReceipt(70002, 50002, "2026-10-31", 2000, later());
    world.addReceipt(70003, 50001, "2026-11-10", 1000);
    const november = await world.preview(2026, 11, [70002]);
    const page = buildReceiptClosingPageFromPreview({
      preview: november.preview,
      closing: null,
      canApply: november.canApply,
      applyBlockedReason: november.applyBlockedReason,
      pendingCarryover: november.carryover,
    });
    // Composição: competência atual + pendências = total (= card de comissão final).
    assert.equal(page.composition?.currentCompetenceCommission, 30);
    assert.equal(page.composition?.carryoverCommission, 50);
    assert.equal(page.composition?.totalCommission, 80);
    assert.equal(page.cards.finalCommissionAmount, 80);

    const detail = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      buildReceiptClosingDetailExportWorkbook(page).Sheets["Analítico"]!
    );
    const carry = detail.find((row) => row["Competência original"] === "10/2026");
    assert.ok(carry);
    assert.equal(carry["Incluído no fechamento"], "11/2026");
    assert.equal(carry["Tipo de inclusão"], "Pendência pós-cutover");
    assert.equal(carry["Pendência retroativa?"], "Sim");
    assert.equal(carry["Origem da cobertura"], "Prévia — ainda não coberto");
    const normal = detail.find((row) => row["Competência original"] === "11/2026");
    assert.equal(normal?.["Pendência retroativa?"], "Não");

    await world.apply(2026, 11, [70002]);
    const closed = await findClosedReceiptClosing(world.db as never, 2026, 11);
    const ledgerLines = await loadReceiptClosingLedgerLines(world.db as never, closed!.closingId);
    const closedPage = buildReceiptClosingPageFromLedger({ closing: closed!, ledgerLines });
    const closedDetail = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      buildReceiptClosingDetailExportWorkbook(closedPage).Sheets["Analítico"]!
    );
    const closedCarry = closedDetail.find((row) => row["Competência original"] === "10/2026");
    assert.equal(closedCarry?.["Origem da cobertura"], "Fechamento IndusCost (CLOSED)");
    assert.equal(closedCarry?.["Incluído no fechamento"], "11/2026");
    assert.equal(closedPage.composition?.carryoverCommission, 50);
    assert.equal(closedPage.composition?.totalCommission, 80);
    assert.equal(formatCarryoverLineTag(closedPage.lines.find((line) => line.inclusionType === "LATE_CARRYOVER")!), "Retroativa 10/2026");
  });

  it("CASO 23 — prévia (com seleção) não marca cobertura definitiva", async () => {
    const world = createWorld();
    world.addCr(cr(50002, GISLENE, { amount: 2000, scheduledCommission: 50 }));
    world.addReceipt(70002, 50002, "2026-10-31", 2000, later());
    world.addReceipt(70004, 50002, "2026-11-05", 500);
    const payload = await world.preview(2026, 11, [70002]);
    assert.equal(payload.carryover!.rows[0]!.selected, true);
    assert.ok(payload.preview.lines.some((line) => line.inclusionType === "LATE_CARRYOVER"));
    await world.preview(2026, 11, [70002]);
    assert.equal(world.coverage.length, 0);
    assert.equal(world.ledger.length, 0);
    assert.equal(world.closings.size, 0);
  });

  it("CASO 24 — apply grava ledger e cobertura definitiva do fechamento", async () => {
    const world = createWorld();
    world.addCr(cr(50001, JOSEANE));
    world.addCr(cr(50002, GISLENE, { amount: 2000, scheduledCommission: 50 }));
    world.addReceipt(70002, 50002, "2026-10-31", 2000, later());
    world.addReceipt(70003, 50001, "2026-11-10", 1000);
    const result = await world.apply(2026, 11, [70002]);
    assert.equal(world.closings.get(result.closingId)?.status, "CLOSED");
    assert.equal(result.coverageCount, 2);
    for (const receiptId of [70002, 70003]) {
      const [covered] = activeCoverageOf(world, receiptId);
      assert.equal(covered?.coverageSource, "INDUSCOST_CLOSING");
      assert.equal(covered?.associationMethod, "INDUSCOST_LEDGER");
      assert.equal(covered?.closingId, result.closingId);
      assert.ok(world.ledger.some((line) => line.id === covered?.ledgerLineId && line.closingId === result.closingId));
    }
    assert.equal(Number(activeCoverageOf(world, 70002)[0]!.coveredCommissionAmount), 50);
  });

  it("CASO 25 — falha na transação não deixa nada parcialmente aplicado", async () => {
    const world = createWorld();
    world.addCr(cr(50001, JOSEANE));
    world.addReceipt(70001, 50001, "2026-10-15", 1000);
    world.flags.failCoverageCreateMany = true;
    await assert.rejects(world.apply(2026, 10), /SIMULATED_COVERAGE_FAILURE/);
    assert.equal(world.closings.size, 0);
    assert.equal(world.ledger.length, 0);
    assert.equal(world.coverage.length, 0);
  });
});

describe("cobertura de comissão — reprocessamento e anti-duplicidade", () => {
  it("reprocessar mantém as pendências já pagas e não libera a comissão duas vezes", async () => {
    const world = createWorld();
    world.addCr(cr(50001, JOSEANE));
    world.addCr(cr(50002, GISLENE, { amount: 2000, scheduledCommission: 50 }));
    world.addReceipt(70002, 50002, "2026-10-31", 2000, later());
    world.addReceipt(70003, 50001, "2026-11-10", 1000);
    const first = await world.apply(2026, 11, [70002]);
    const second = await reprocessCommissionReceiptClosingApply(
      world.db as never,
      { year: 2026, month: 11, userId: "tester", reason: "Correção de regra" },
      world.deps
    );
    assert.equal(second.supersededClosingId, first.closingId);
    assert.equal(second.carryoverLineCount, 1);
    assert.equal(world.closings.get(first.closingId)?.status, "REPROCESSED");
    const history = coverageOf(world, 70002);
    assert.equal(history.length, 2);
    assert.equal(history.filter((row) => row.coverageStatus === "COVERED").length, 1);
    assert.equal(activeCoverageOf(world, 70002)[0]!.closingId, second.closingId);
    assert.equal(second.summary.totalReleasedCommission, first.summary.totalReleasedCommission);
  });

  it("reprocessar outubro depois que a pendência entrou em novembro não a traz de volta", async () => {
    const world = createWorld();
    world.addCr(cr(50001, JOSEANE));
    world.addCr(cr(50002, GISLENE, { amount: 2000, scheduledCommission: 50 }));
    world.addReceipt(70001, 50001, "2026-10-15", 1000);
    await world.apply(2026, 10);
    world.addReceipt(70002, 50002, "2026-10-31", 2000, later());
    const november = await world.apply(2026, 11, [70002]);
    const october = await reprocessCommissionReceiptClosingApply(
      world.db as never,
      { year: 2026, month: 10, userId: "tester", reason: "Revisão" },
      world.deps
    );
    assert.ok(
      !world.ledger.some((line) => line.closingId === october.closingId && line.nomusReceivableId === 50002)
    );
    assert.equal(activeCoverageOf(world, 70002)[0]!.closingId, november.closingId);
    assert.equal(activeCoverageOf(world, 70001)[0]!.closingId, october.closingId);
  });

  it("pendência na competência natural: eventos já pagos (mesmo mês ou posteriores) entram como anteriores", async () => {
    const world = createWorld();
    world.addCr(cr(30002, JOSEANE, { amount: 1000, scheduledCommission: 30 }));
    world.addReceipt(83000, 30002, "2026-09-10", 100);
    world.addReceipt(83001, 30002, "2026-10-05", 600);
    world.addReceipt(83002, 30002, "2026-10-25", 600, later());
    world.addReceipt(83003, 30002, "2026-11-03", 50);
    world.addReceipt(83004, 30002, "2026-11-20", 70);
    const competence = (
      await loadCommissionReceiptCompetenceForScope(world.db as never, 2026, 10, {
        includeReceiptExternalIds: [83002],
        // 83001 (outubro) e 83003 (novembro) já pagos; 83004 ainda não.
        alreadyCoveredReceiptExternalIds: [83001, 83003],
      })
    ).get(30002);
    assert.ok(competence);
    assert.deepEqual(competence.receiptIds, [83002]);
    assert.equal(competence.periodReceivedAmount, 600);
    // 100 (setembro, anterior pela data) + 600 (83001) + 50 (83003, pago depois).
    assert.equal(competence.priorReceivedAmount, 750);
    // Recorte por exclusão (competência atual) não muda a regra: o excluído não é anterior.
    const excluded = (
      await loadCommissionReceiptCompetenceForScope(world.db as never, 2026, 10, {
        excludeReceiptExternalIds: [83002],
      })
    ).get(30002);
    assert.deepEqual(excluded?.receiptIds, [83001]);
    assert.equal(excluded?.priorReceivedAmount, 100);
  });

  it("pendências: o motor recebe os eventos já cobertos do mesmo título (qualquer mês da janela)", async () => {
    const world = createWorld();
    world.addCr(cr(30003, JOSEANE, { amount: 1000, scheduledCommission: 30 }));
    world.addCr(cr(30004, GISLENE));
    world.addReceipt(84001, 30003, "2026-10-05", 400);
    await world.apply(2026, 10);
    world.addReceipt(84002, 30003, "2026-10-25", 300, later());
    world.addReceipt(84003, 30004, "2026-10-26", 500, later());
    world.addReceipt(84004, 30003, "2026-11-04", 200);
    await world.apply(2026, 11);
    const calls: Array<{ month: number; ids: number[]; covered: number[] }> = [];
    await loadReceiptClosingCarryovers(
      world.db as never,
      { year: 2026, month: 12 },
      {
        materialize: async () => {},
        evaluateNaturalMonth: async (natural, ids, covered) => {
          calls.push({ month: natural.month, ids: [...ids].sort(), covered: [...covered].sort() });
          return [];
        },
      }
    );
    assert.deepEqual(calls, [
      // 84001 (out) e 84004 (nov) já pagos para o CR 30003; o CR 30004 não tem cobertura.
      { month: 10, ids: [84002, 84003], covered: [84001, 84004] },
    ]);
  });

  it("camada C: o mesmo recebimento em duas linhas (âncoras) do fechamento é detectado", () => {
    const base = { year: 2026, month: 11 };
    assert.deepEqual(
      findReceiptsInMultipleAnchors([
        { ...base, nomusReceivableId: 1, receiptIds: [10], inclusionType: "NORMAL" },
        // Outro item do mesmo título/competência: mesma âncora — permitido.
        { ...base, nomusReceivableId: 1, receiptIds: [10], inclusionType: "NORMAL" },
        { ...base, nomusReceivableId: 1, receiptIds: [10], inclusionType: "LATE_CARRYOVER", naturalYear: 2026, naturalMonth: 10 },
        { ...base, nomusReceivableId: 2, receiptIds: [20] },
      ]),
      [10]
    );
  });

  it("CR 19236/19413: competência natural = mês do receiptDate (agosto), não a baixa de setembro", () => {
    assert.deepEqual(resolveReceiptNaturalYearMonth("2026-08-26"), { year: 2026, month: 8 });
    assert.deepEqual(resolveReceiptNaturalYearMonth("2026-08-31"), { year: 2026, month: 8 });
    assert.equal(resolveReceiptCutoverPeriod("2026-08-26"), "LEGACY_RECONCILIATION_WINDOW");
  });
});
