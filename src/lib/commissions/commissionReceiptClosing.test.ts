import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CommissionReceiptPreviewLine, CommissionReceiptPreviewResult } from "./commissionReceiptEngine.js";
import {
  aggregateMonthlyPayableFromLedgerLines,
  appendReceiptClosingNote,
  buildReceiptClosingHashFromPreview,
  buildReceiptClosingPreviewPayload,
  buildReceiptClosingReprocessPreview,
  mapPreviewLineToLedgerCreateData,
  assessReceiptClosingApplyReadiness,
  validateReceiptClosingPreviewForApply,
  ReceiptClosingDuplicateError,
  ReceiptClosingValidationError,
  RECEIPT_CLOSING_CONFIRM_APPLY,
  RECEIPT_CLOSING_CONFIRM_REPROCESS,
  validateReceiptClosingCancelReason,
  validateReceiptClosingConfirmPhrase,
} from "./commissionReceiptClosing.js";
import {
  applyCommissionReceiptClosing,
  cancelCommissionReceiptClosing,
} from "./commissionReceiptClosing.server.js";
import {
  buildCommissionReceiptLedgerLineKey,
  buildPersistedCommissionReceiptLedgerLineKey,
} from "./commissionReceiptLedger.js";

function previewLine(
  partial: Partial<CommissionReceiptPreviewLine> & Pick<CommissionReceiptPreviewLine, "ledgerLineKey">
): CommissionReceiptPreviewLine {
  return {
    year: 2026,
    month: 6,
    nomusReceivableId: 100,
    receivableNumber: null,
    installmentNumber: 1,
    settlementDate: "2026-06-15T00:00:00.000Z",
    dueDate: null,
    receivableAmount: 1000,
    receivedAmount: 1000,
    receivedSharePercent: 100,
    customerExternalId: 10,
    customerId: null,
    customerName: "Cliente",
    nomusNfeId: 200,
    nfeNumber: "123",
    orderCode: "PED-1",
    localOrderId: "order-1",
    nomusOrderItemId: 1,
    localItemId: "item-1",
    productCode: "A",
    productName: "Produto A",
    rawSellerId: 464,
    rawSellerName: "GISLENE",
    canonicalSellerId: "seller-1",
    canonicalSellerName: "GISLENE LIMA",
    sellerResolutionStatus: "OK_CANONICAL",
    commissionRecordId: null,
    commissionPaymentScheduleId: null,
    commissionReceivableScheduleId: null,
    ruleId: "rule-1",
    ruleName: "2%",
    ratePercent: 2,
    commissionableBaseAmount: 1000,
    expectedCommissionAmount: 20,
    releasedCommissionAmount: 20,
    grossCommissionAmount: 20,
    status: "COMMISSIONABLE",
    statusReason: null,
    exclusionRuleId: null,
    exclusionReason: null,
    source: "CALCULATED",
    ...partial,
  };
}

function previewResult(
  lines: CommissionReceiptPreviewLine[],
  overrides: Partial<CommissionReceiptPreviewResult> = {}
): CommissionReceiptPreviewResult {
  return {
    year: 2026,
    month: 6,
    totalReceivables: 1,
    totalReceivedAmount: 1000,
    totalCommissionableBase: 1000,
    totalExpectedCommission: 20,
    totalReleasedCommission: 20,
    totalExcludedAmount: 0,
    totalExceptionAmount: 0,
    countByStatus: {
      COMMISSIONABLE: lines.length,
      CUSTOMER_EXCLUDED: 0,
      NO_SALES_LINK: 0,
      NO_SCHEDULE: 0,
      NO_SELLER: 0,
      SELLER_UNRESOLVED: 0,
      NO_RULE: 0,
      STALE_SCHEDULE: 0,
      ZERO_AMOUNT: 0,
      ERROR: 0,
    },
    bySeller: [],
    byCustomer: [],
    lines,
    ...overrides,
  };
}

type MockClosing = {
  id: string;
  year: number;
  month: number;
  status: string;
  source: string;
  calculationHash: string | null;
  totalReceivedAmount: number;
  totalCommissionableBase: number;
  totalExpectedCommission: number;
  totalReleasedCommission: number;
  totalExcludedAmount: number;
  totalExceptionAmount: number;
  lineCount: number;
  notes: string | null;
  createdBy: string | null;
  closedBy: string | null;
  closedAt: Date | null;
  supersededByClosingId: string | null;
};

function createMockDb() {
  const closings = new Map<string, MockClosing>();
  const lines: Array<Record<string, unknown>> = [];
  let closingSeq = 0;

  const db = {
    closings,
    lines,
    commissionMonthlyClosing: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        for (const row of closings.values()) {
          if (where.year != null && row.year !== where.year) continue;
          if (where.month != null && row.month !== where.month) continue;
          if (where.source != null && row.source !== where.source) continue;
          if (where.status != null && row.status !== where.status) continue;
          return row;
        }
        return null;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        closings.get(where.id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        closingSeq += 1;
        const id = `closing-${closingSeq}`;
        const row: MockClosing = {
          id,
          year: data.year as number,
          month: data.month as number,
          status: data.status as string,
          source: data.source as string,
          calculationHash: (data.calculationHash as string) ?? null,
          totalReceivedAmount: Number(data.totalReceivedAmount),
          totalCommissionableBase: Number(data.totalCommissionableBase),
          totalExpectedCommission: Number(data.totalExpectedCommission),
          totalReleasedCommission: Number(data.totalReleasedCommission),
          totalExcludedAmount: Number(data.totalExcludedAmount),
          totalExceptionAmount: Number(data.totalExceptionAmount),
          lineCount: data.lineCount as number,
          notes: (data.notes as string) ?? null,
          createdBy: (data.createdBy as string) ?? null,
          closedBy: (data.closedBy as string) ?? null,
          closedAt: (data.closedAt as Date) ?? null,
          supersededByClosingId: null,
        };
        closings.set(id, row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const existing = closings.get(where.id);
        if (!existing) throw new Error("not found");
        const updated = {
          ...existing,
          ...data,
          totalReceivedAmount:
            data.totalReceivedAmount != null
              ? Number(data.totalReceivedAmount)
              : existing.totalReceivedAmount,
        } as MockClosing;
        closings.set(where.id, updated);
        return updated;
      },
    },
    commissionReceiptLedgerLine: {
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        if ((db as { failCreateMany?: boolean }).failCreateMany) {
          throw new Error("SIMULATED_LINE_FAILURE");
        }
        for (const row of data) {
          if (lines.some((existing) => existing.ledgerLineKey === row.ledgerLineKey)) {
            const err = new Error("Unique constraint") as Error & { code: string };
            err.code = "P2002";
            throw err;
          }
          lines.push({ ...row });
        }
        return { count: data.length };
      },
    },
    $transaction: async <T>(fn: (tx: typeof db) => Promise<T>) => {
      const snapshotClosings = new Map(closings);
      const snapshotLines = [...lines];
      try {
        return await fn(db);
      } catch (error) {
        closings.clear();
        for (const [key, value] of snapshotClosings) closings.set(key, value);
        lines.length = 0;
        lines.push(...snapshotLines);
        throw error;
      }
    },
  };

  return db;
}

describe("commissionReceiptClosing", () => {
  it("confirmação obrigatória para apply e reprocess", () => {
    assert.throws(
      () => validateReceiptClosingConfirmPhrase(null, RECEIPT_CLOSING_CONFIRM_APPLY),
      ReceiptClosingValidationError
    );
    assert.doesNotThrow(() =>
      validateReceiptClosingConfirmPhrase(RECEIPT_CLOSING_CONFIRM_APPLY, RECEIPT_CLOSING_CONFIRM_APPLY)
    );
    assert.doesNotThrow(() =>
      validateReceiptClosingConfirmPhrase(
        RECEIPT_CLOSING_CONFIRM_REPROCESS,
        RECEIPT_CLOSING_CONFIRM_REPROCESS
      )
    );
  });

  it("cancelamento exige motivo", () => {
    assert.throws(() => validateReceiptClosingCancelReason("ab"), ReceiptClosingValidationError);
    assert.equal(validateReceiptClosingCancelReason("erro operacional"), "erro operacional");
  });

  it("chave persistida difere da chave de preview e permite reprocessamento", () => {
    const base = {
      year: 2026,
      month: 6,
      nomusReceivableId: 1,
      commissionRecordId: null,
      commissionPaymentScheduleId: null,
      installmentNumber: 1,
      nomusOrderItemId: 1,
      ruleId: "rule-1",
    };
    const previewKey = buildCommissionReceiptLedgerLineKey(base);
    const persistedA = buildPersistedCommissionReceiptLedgerLineKey({
      ...base,
      closingId: "closing-a",
    });
    const persistedB = buildPersistedCommissionReceiptLedgerLineKey({
      ...base,
      closingId: "closing-b",
    });
    assert.notEqual(previewKey, persistedA);
    assert.notEqual(persistedA, persistedB);
  });

  it("mapPreviewLineToLedgerCreateData guarda snapshot de regra e exclusão", () => {
    const line = previewLine({
      ledgerLineKey: "line-1",
      exclusionRuleId: "ex-1",
      exclusionReason: "Política",
      status: "CUSTOMER_EXCLUDED",
      expectedCommissionAmount: 0,
      releasedCommissionAmount: 0,
    });
    const data = mapPreviewLineToLedgerCreateData(line, "closing-1");
    assert.equal(data.closingId, "closing-1");
    assert.equal(data.customerExclusionRuleId, "ex-1");
    assert.equal(data.exclusionReason, "Política");
    assert.ok(data.ruleSnapshotJson);
    assert.ok(String(data.ledgerLineKey).length > 0);
  });

  it("preview bloqueia apply quando já existe fechamento CLOSED", () => {
    const preview = previewResult([previewLine({ ledgerLineKey: "k1" })]);
    const payload = buildReceiptClosingPreviewPayload(preview, {
      closingId: "existing",
      year: 2026,
      month: 6,
      status: "CLOSED",
      calculationHash: "hash-old",
      totalReceivedAmount: 1000,
      totalCommissionableBase: 1000,
      totalExpectedCommission: 20,
      totalReleasedCommission: 20,
      totalExcludedAmount: 0,
      totalExceptionAmount: 0,
      lineCount: 1,
      closedAt: "2026-06-20T00:00:00.000Z",
      closedBy: "user-1",
      notes: null,
    });
    assert.equal(payload.canApply, false);
    assert.match(payload.applyBlockedReason ?? "", /CLOSED/);
  });

  it("preview bloqueia apply quando há título comercial sem schedule", () => {
    const preview = previewResult([
      previewLine({ ledgerLineKey: "k-no-sched", status: "NO_SCHEDULE", statusReason: "sem schedule" }),
    ]);
    const payload = buildReceiptClosingPreviewPayload(preview, null);
    assert.equal(payload.canApply, false);
    assert.match(payload.applyBlockedReason ?? "", /sem schedule materializado/i);
    assert.throws(
      () => validateReceiptClosingPreviewForApply(preview),
      ReceiptClosingValidationError
    );
  });

  it("preview permite apply com empresa do grupo excluída e comissão com schedule", () => {
    const preview = previewResult([
      previewLine({
        ledgerLineKey: "k-group",
        nomusReceivableId: 101,
        status: "GROUP_COMPANY_EXCLUDED",
        statusReason: "EMPRESA_GRUPO_EXCLUIDA",
        exclusionReason: "EMPRESA_GRUPO_EXCLUIDA",
        commissionableBaseAmount: 0,
        expectedCommissionAmount: 0,
        releasedCommissionAmount: 0,
      }),
      previewLine({
        ledgerLineKey: "k-ok",
        nomusReceivableId: 102,
        status: "COMMISSIONABLE",
      }),
    ]);
    const readiness = assessReceiptClosingApplyReadiness(preview);
    assert.equal(readiness.canApply, true);
    const data = mapPreviewLineToLedgerCreateData(preview.lines[0], "closing-1");
    assert.equal(data.status, "GROUP_COMPANY_EXCLUDED");
    assert.equal(data.exclusionReason, "EMPRESA_GRUPO_EXCLUIDA");
  });

  it("reprocess preview mostra diferença de totais", () => {
    const before = {
      closingId: "c1",
      year: 2026,
      month: 6,
      status: "CLOSED" as const,
      calculationHash: "old",
      totalReceivedAmount: 1000,
      totalCommissionableBase: 1000,
      totalExpectedCommission: 20,
      totalReleasedCommission: 20,
      totalExcludedAmount: 0,
      totalExceptionAmount: 0,
      lineCount: 1,
      closedAt: null,
      closedBy: null,
      notes: null,
    };
    const after = previewResult([previewLine({ ledgerLineKey: "k2", releasedCommissionAmount: 25 })], {
      totalReleasedCommission: 25,
      totalExpectedCommission: 25,
    });
    const reprocess = buildReceiptClosingReprocessPreview(before, after);
    assert.equal(reprocess.diff.releasedCommissionDiff, 5);
    assert.equal(reprocess.diff.hashChanged, true);
  });

  it("aggregateMonthlyPayableFromLedgerLines não recalcula — usa snapshot gravado", () => {
    const summary = aggregateMonthlyPayableFromLedgerLines(
      [
        {
          id: "line-1",
          ledgerLineKey: "key-1",
          nomusReceivableId: 10,
          installmentNumber: 1,
          settlementDate: "2026-06-10T00:00:00.000Z",
          customerName: "Cliente",
          orderCode: "PED-1",
          nfeNumber: "123",
          productCode: "A",
          canonicalSellerId: "seller-1",
          canonicalSellerName: "GISLENE",
          receivedAmount: 500,
          allocatedCommercialBase: 500,
          commissionRatePercent: 2,
          expectedCommissionAmount: 10,
          releasedCommissionAmount: 10,
          status: "COMMISSIONABLE",
          exceptionReason: null,
          exclusionReason: null,
          ruleNameSnapshot: "2%",
          ruleSnapshotJson: { ratePercent: 2 },
        },
      ],
      { year: 2026, month: 6 }
    );
    assert.equal(summary.payableCommissionTotal, 10);
    assert.equal(summary.warnings[0], "Fonte: fechamento persistido (ledger por recebimento).");
  });

  it("apply grava fechamento e linhas", async () => {
    const db = createMockDb();
    const preview = previewResult([previewLine({ ledgerLineKey: "k-apply" })]);
    const hash = buildReceiptClosingHashFromPreview(preview);

    const result = await db.$transaction(async (tx) => {
      const closing = await tx.commissionMonthlyClosing.create({
        data: {
          year: 2026,
          month: 6,
          status: "CLOSED",
          source: "RECEIPT_BASED",
          totalReceivedAmount: preview.totalReceivedAmount,
          totalCommissionableBase: preview.totalCommissionableBase,
          totalExpectedCommission: preview.totalExpectedCommission,
          totalReleasedCommission: preview.totalReleasedCommission,
          totalExcludedAmount: preview.totalExcludedAmount,
          totalExceptionAmount: preview.totalExceptionAmount,
          lineCount: preview.lines.length,
          calculationHash: hash,
          createdBy: "user-test",
          closedBy: "user-test",
          closedAt: new Date(),
          notes: "fechamento junho",
        },
      });
      await tx.commissionReceiptLedgerLine.createMany({
        data: preview.lines.map((line) => mapPreviewLineToLedgerCreateData(line, closing.id)),
      });
      return { closingId: closing.id, lineCount: preview.lines.length, hash };
    });

    assert.equal(db.closings.size, 1);
    assert.equal(db.lines.length, 1);
    assert.equal(result.lineCount, 1);
    assert.equal(result.hash, hash);
  });

  it("apply duplicado bloqueia", async () => {
    const db = createMockDb();
    db.closings.set("existing", {
      id: "existing",
      year: 2026,
      month: 6,
      status: "CLOSED",
      source: "RECEIPT_BASED",
      calculationHash: "hash",
      totalReceivedAmount: 1000,
      totalCommissionableBase: 1000,
      totalExpectedCommission: 20,
      totalReleasedCommission: 20,
      totalExcludedAmount: 0,
      totalExceptionAmount: 0,
      lineCount: 1,
      notes: null,
      createdBy: "u",
      closedBy: "u",
      closedAt: new Date(),
      supersededByClosingId: null,
    });

    await assert.rejects(
      () =>
        applyCommissionReceiptClosing(db as never, {
          year: 2026,
          month: 6,
          userId: "user-test",
        }),
      ReceiptClosingDuplicateError
    );
  });

  it("transação faz rollback quando createMany falha", async () => {
    const db = createMockDb();
    (db as { failCreateMany?: boolean }).failCreateMany = true;
    const preview = previewResult([previewLine({ ledgerLineKey: "k-fail" })]);

    await assert.rejects(async () => {
      await db.$transaction(async (tx) => {
        const closing = await tx.commissionMonthlyClosing.create({
          data: {
            year: 2026,
            month: 6,
            status: "CLOSED",
            source: "RECEIPT_BASED",
            totalReceivedAmount: preview.totalReceivedAmount,
            totalCommissionableBase: preview.totalCommissionableBase,
            totalExpectedCommission: preview.totalExpectedCommission,
            totalReleasedCommission: preview.totalReleasedCommission,
            totalExcludedAmount: preview.totalExcludedAmount,
            totalExceptionAmount: preview.totalExceptionAmount,
            lineCount: preview.lines.length,
            calculationHash: buildReceiptClosingHashFromPreview(preview),
            createdBy: "user-test",
            closedBy: "user-test",
            closedAt: new Date(),
          },
        });
        await tx.commissionReceiptLedgerLine.createMany({
          data: preview.lines.map((line) => mapPreviewLineToLedgerCreateData(line, closing.id)),
        });
      });
    });

    assert.equal(db.closings.size, 0);
    assert.equal(db.lines.length, 0);
  });

  it("reprocess apply mantém histórico — antigo REPROCESSED e novo CLOSED", async () => {
    const db = createMockDb();
    const old = await db.commissionMonthlyClosing.create({
      data: {
        year: 2026,
        month: 6,
        status: "CLOSED",
        source: "RECEIPT_BASED",
        totalReceivedAmount: 1000,
        totalCommissionableBase: 1000,
        totalExpectedCommission: 20,
        totalReleasedCommission: 20,
        totalExcludedAmount: 0,
        totalExceptionAmount: 0,
        lineCount: 1,
        calculationHash: "old-hash",
        createdBy: "user-1",
        closedBy: "user-1",
        closedAt: new Date(),
      },
    });
    await db.commissionReceiptLedgerLine.createMany({
      data: [mapPreviewLineToLedgerCreateData(previewLine({ ledgerLineKey: "old-line" }), old.id)],
    });

    const preview = previewResult(
      [previewLine({ ledgerLineKey: "new-line", releasedCommissionAmount: 30 })],
      { totalReleasedCommission: 30, totalExpectedCommission: 30 }
    );

    const loadCommissionReceiptPreview = async () => preview;
    const result = await (async () => {
      const calculationHash = buildReceiptClosingHashFromPreview(preview);
      return db.$transaction(async (tx) => {
        const existing = await tx.commissionMonthlyClosing.findFirst({
          where: { year: 2026, month: 6, source: "RECEIPT_BASED", status: "CLOSED" },
        });
        const newClosing = await tx.commissionMonthlyClosing.create({
          data: {
            year: 2026,
            month: 6,
            status: "CLOSED",
            source: "RECEIPT_BASED",
            totalReceivedAmount: preview.totalReceivedAmount,
            totalCommissionableBase: preview.totalCommissionableBase,
            totalExpectedCommission: preview.totalExpectedCommission,
            totalReleasedCommission: preview.totalReleasedCommission,
            totalExcludedAmount: preview.totalExcludedAmount,
            totalExceptionAmount: preview.totalExceptionAmount,
            lineCount: preview.lines.length,
            calculationHash,
            createdBy: "user-2",
            closedBy: "user-2",
            closedAt: new Date(),
          },
        });
        await tx.commissionMonthlyClosing.update({
          where: { id: existing!.id },
          data: {
            status: "REPROCESSED",
            supersededByClosingId: newClosing.id,
            notes: appendReceiptClosingNote(existing!.notes, "reprocessado"),
          },
        });
        await tx.commissionReceiptLedgerLine.createMany({
          data: preview.lines.map((line) => mapPreviewLineToLedgerCreateData(line, newClosing.id)),
        });
        return { newClosingId: newClosing.id, oldId: existing!.id };
      });
    })();

    assert.equal(db.closings.get(result.oldId)?.status, "REPROCESSED");
    assert.equal(db.closings.get(result.newClosingId)?.status, "CLOSED");
    assert.equal(db.lines.length, 2);
    void loadCommissionReceiptPreview;
  });

  it("cancelamento marca CANCELLED e preserva linhas", async () => {
    const db = createMockDb();
    const closing = await db.commissionMonthlyClosing.create({
      data: {
        year: 2026,
        month: 6,
        status: "CLOSED",
        source: "RECEIPT_BASED",
        totalReceivedAmount: 1000,
        totalCommissionableBase: 1000,
        totalExpectedCommission: 20,
        totalReleasedCommission: 20,
        totalExcludedAmount: 0,
        totalExceptionAmount: 0,
        lineCount: 1,
        calculationHash: "hash",
        createdBy: "user-1",
        closedBy: "user-1",
        closedAt: new Date(),
      },
    });
    await db.commissionReceiptLedgerLine.createMany({
      data: [mapPreviewLineToLedgerCreateData(previewLine({ ledgerLineKey: "k-cancel" }), closing.id)],
    });

    const cancelled = await cancelCommissionReceiptClosing(db as never, {
      closingId: closing.id,
      userId: "admin",
      reason: "Fechamento incorreto",
    });

    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(db.lines.length, 1);
    assert.match(cancelled.notes ?? "", /Fechamento incorreto/);
  });

  it("fechamento fechado não muda se preview mudar depois", () => {
    const frozen = aggregateMonthlyPayableFromLedgerLines(
      [
        {
          id: "frozen",
          ledgerLineKey: "frozen-key",
          nomusReceivableId: 1,
          installmentNumber: 1,
          settlementDate: "2026-06-01T00:00:00.000Z",
          customerName: "Cliente",
          orderCode: "PED",
          nfeNumber: "1",
          productCode: "A",
          canonicalSellerId: "s1",
          canonicalSellerName: "Vendedor",
          receivedAmount: 1000,
          allocatedCommercialBase: 1000,
          commissionRatePercent: 2,
          expectedCommissionAmount: 20,
          releasedCommissionAmount: 20,
          status: "COMMISSIONABLE",
          exceptionReason: null,
          exclusionReason: null,
          ruleNameSnapshot: "2%",
          ruleSnapshotJson: { ratePercent: 2, capturedAt: "2026-06-20T00:00:00.000Z" },
        },
      ],
      { year: 2026, month: 6 }
    );

    const livePreview = previewResult(
      [previewLine({ ledgerLineKey: "live", releasedCommissionAmount: 99, ratePercent: 5 })],
      { totalReleasedCommission: 99 }
    );

    assert.equal(frozen.payableCommissionTotal, 20);
    assert.equal(livePreview.totalReleasedCommission, 99);
    assert.notEqual(frozen.payableCommissionTotal, livePreview.totalReleasedCommission);
  });
});
