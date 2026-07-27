import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allowsTreasuryExceptionSafeAutoResolve,
  runTreasuryExceptionEngine,
  TREASURY_EXCEPTION_ALGORITHM_VERSION,
  TREASURY_EXCEPTION_AUTO_RESOLVE_RESOLUTION,
  type TreasuryExceptionEngineInput,
} from "./treasuryExceptionEngine.js";

const NOW = Date.parse("2026-08-14T15:00:00.000Z");

function base(
  partial: Partial<TreasuryExceptionEngineInput> = {}
): TreasuryExceptionEngineInput {
  return {
    companyCode: "EMP1",
    asOfCivilDate: "2026-08-14",
    detectedAtIso: "2026-08-14T15:00:00.000Z",
    nowEpochMs: NOW,
    ...partial,
  };
}

function byType(type: string, result: ReturnType<typeof runTreasuryExceptionEngine>) {
  return result.candidates.filter((c) => c.type === type);
}

describe("treasuryExceptionEngine — contrato", () => {
  it("versão do algoritmo estável", () => {
    assert.equal(TREASURY_EXCEPTION_ALGORITHM_VERSION, "1.0.0");
  });

  it("nunca auto-resolve duplicidade e mudança pós-fechamento", () => {
    assert.equal(allowsTreasuryExceptionSafeAutoResolve("SUSPECTED_DUPLICATE"), false);
    assert.equal(
      allowsTreasuryExceptionSafeAutoResolve("FINANCIAL_CHANGE_AFTER_CLOSING"),
      false
    );
    assert.equal(
      allowsTreasuryExceptionSafeAutoResolve("EXPECTED_RECEIPT_NOT_RECEIVED"),
      true
    );
  });

  it("ordenação determinística por uniqueKey", () => {
    const a = runTreasuryExceptionEngine(
      base({
        receivables: [
          {
            officialTitleId: "r-b",
            openAmount: "10.00",
            expectedDate: "2026-08-10",
            dueDate: "2026-08-10",
            hasCollectionAction: true,
            responsibleUserId: "u1",
          },
          {
            officialTitleId: "r-a",
            openAmount: "10.00",
            expectedDate: "2026-08-10",
            dueDate: "2026-08-10",
            hasCollectionAction: true,
            responsibleUserId: "u1",
          },
        ],
      })
    );
    const keys = a.candidates.map((c) => c.uniqueKey);
    const sorted = [...keys].sort();
    assert.deepEqual(keys, sorted);
  });
});

describe("treasuryExceptionEngine — EXPECTED_RECEIPT_NOT_RECEIVED", () => {
  it("gera quando expectedDate <= asOf e saldo aberto", () => {
    const result = runTreasuryExceptionEngine(
      base({
        receivables: [
          {
            officialTitleId: "ar-1",
            nomusExternalId: 99,
            openAmount: "100.00",
            expectedDate: "2026-08-14",
            dueDate: "2026-08-20",
            hasCollectionAction: false,
            responsibleUserId: "u1",
          },
        ],
      })
    );
    const rows = byType("EXPECTED_RECEIPT_NOT_RECEIVED", result);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.amount, "100.00");
    assert.match(rows[0]!.uniqueKey, /EXPECTED_RECEIPT_NOT_RECEIVED\|EMP1\|ar-1/);
  });

  it("não gera se futuro, liquidado ou cancelado", () => {
    const result = runTreasuryExceptionEngine(
      base({
        receivables: [
          {
            officialTitleId: "ar-f",
            openAmount: "10.00",
            expectedDate: "2026-08-20",
            dueDate: "2026-08-20",
            hasCollectionAction: false,
          },
          {
            officialTitleId: "ar-s",
            openAmount: "10.00",
            expectedDate: "2026-08-10",
            dueDate: "2026-08-10",
            hasCollectionAction: false,
            isSettled: true,
          },
          {
            officialTitleId: "ar-c",
            openAmount: "10.00",
            expectedDate: "2026-08-10",
            dueDate: "2026-08-10",
            hasCollectionAction: false,
            isCancelled: true,
          },
        ],
      })
    );
    assert.equal(byType("EXPECTED_RECEIPT_NOT_RECEIVED", result).length, 0);
  });
});

describe("treasuryExceptionEngine — EXPECTED_PAYMENT_NOT_MADE", () => {
  it("gera pagamento esperado não realizado", () => {
    const result = runTreasuryExceptionEngine(
      base({
        payables: [
          {
            officialTitleId: "ap-1",
            openAmount: "50.00",
            expectedDate: "2026-08-13",
            dueDate: "2026-08-13",
            isProgrammed: true,
            isCritical: false,
            responsibleUserId: "u1",
          },
        ],
      })
    );
    assert.equal(byType("EXPECTED_PAYMENT_NOT_MADE", result).length, 1);
  });
});

describe("treasuryExceptionEngine — OVERDUE_RECEIVABLE_WITHOUT_ACTION", () => {
  it("gera vencido sem ação e não gera com ação", () => {
    const result = runTreasuryExceptionEngine(
      base({
        receivables: [
          {
            officialTitleId: "ar-over",
            openAmount: "20.00",
            expectedDate: null,
            dueDate: "2026-08-01",
            hasCollectionAction: false,
            responsibleUserId: "u1",
          },
          {
            officialTitleId: "ar-ok",
            openAmount: "20.00",
            expectedDate: null,
            dueDate: "2026-08-01",
            hasCollectionAction: true,
            responsibleUserId: "u1",
          },
        ],
      })
    );
    const rows = byType("OVERDUE_RECEIVABLE_WITHOUT_ACTION", result);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.entityId, "ar-over");
    assert.equal(rows[0]!.severity, "CRITICAL");
  });
});

describe("treasuryExceptionEngine — EXPIRED_PROMISE", () => {
  it("gera promessa vencida ativa", () => {
    const result = runTreasuryExceptionEngine(
      base({
        promises: [
          {
            id: "pr-1",
            officialTitleId: "ar-1",
            promisedDate: "2026-08-10",
            status: "ACTIVE",
            promisedAmount: "30.00",
          },
          {
            id: "pr-2",
            officialTitleId: "ar-1",
            promisedDate: "2026-08-10",
            status: "FULFILLED",
            promisedAmount: "30.00",
          },
        ],
      })
    );
    const rows = byType("EXPIRED_PROMISE", result);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.metadata.promiseId, "pr-1");
  });
});

describe("treasuryExceptionEngine — CRITICAL_PAYMENT_NOT_PROGRAMMED", () => {
  it("gera crítico sem programação", () => {
    const result = runTreasuryExceptionEngine(
      base({
        payables: [
          {
            officialTitleId: "ap-c",
            openAmount: "999.00",
            expectedDate: null,
            dueDate: "2026-08-15",
            isProgrammed: false,
            isCritical: true,
            responsibleUserId: "u1",
          },
          {
            officialTitleId: "ap-p",
            openAmount: "999.00",
            expectedDate: null,
            dueDate: "2026-08-15",
            isProgrammed: true,
            isCritical: true,
            responsibleUserId: "u1",
          },
        ],
      })
    );
    const rows = byType("CRITICAL_PAYMENT_NOT_PROGRAMMED", result);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.entityId, "ap-c");
  });
});

describe("treasuryExceptionEngine — ACCOUNT_BELOW_MINIMUM", () => {
  it("gera quando disponível < mínimo", () => {
    const result = runTreasuryExceptionEngine(
      base({
        accounts: [
          {
            accountId: "acc-1",
            availableBalance: "100.00",
            minimumBalance: "250.00",
            lastBalanceAtIso: "2026-08-14T12:00:00.000Z",
            staleAfterHours: 48,
          },
        ],
      })
    );
    const rows = byType("ACCOUNT_BELOW_MINIMUM", result);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.severity, "CRITICAL");
  });
});

describe("treasuryExceptionEngine — ACCOUNT_PROJECTION_NEGATIVE", () => {
  it("gera projeção negativa por conta", () => {
    const result = runTreasuryExceptionEngine(
      base({
        projectionDays: [
          {
            accountId: "acc-1",
            civilDate: "2026-08-20",
            closingBalance: "-10.00",
          },
        ],
      })
    );
    assert.equal(byType("ACCOUNT_PROJECTION_NEGATIVE", result).length, 1);
  });
});

describe("treasuryExceptionEngine — CONSOLIDATED_PROJECTION_NEGATIVE", () => {
  it("gera projeção consolidada negativa", () => {
    const result = runTreasuryExceptionEngine(
      base({
        projectionDays: [
          {
            accountId: null,
            civilDate: "2026-08-21",
            closingBalance: "-1.00",
          },
        ],
      })
    );
    assert.equal(byType("CONSOLIDATED_PROJECTION_NEGATIVE", result).length, 1);
  });
});

describe("treasuryExceptionEngine — STALE_BALANCE", () => {
  it("gera saldo desatualizado além do limiar", () => {
    const result = runTreasuryExceptionEngine(
      base({
        accounts: [
          {
            accountId: "acc-stale",
            availableBalance: "10.00",
            minimumBalance: "0.00",
            lastBalanceAtIso: "2026-08-10T15:00:00.000Z",
            staleAfterHours: 24,
          },
        ],
      })
    );
    assert.equal(byType("STALE_BALANCE", result).length, 1);
  });
});

describe("treasuryExceptionEngine — BANK_MOVEMENT_UNIDENTIFIED", () => {
  it("gera movimento sem identificação", () => {
    const result = runTreasuryExceptionEngine(
      base({
        bankMovements: [
          {
            id: "mv-1",
            accountId: "acc-1",
            amount: "15.00",
            identified: false,
          },
          {
            id: "mv-2",
            accountId: "acc-1",
            amount: "15.00",
            identified: true,
          },
        ],
      })
    );
    const rows = byType("BANK_MOVEMENT_UNIDENTIFIED", result);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.entityId, "mv-1");
  });
});

describe("treasuryExceptionEngine — RECONCILIATION_DIFFERENCE", () => {
  it("gera diferença diferente de zero", () => {
    const result = runTreasuryExceptionEngine(
      base({
        reconciliationDiffs: [
          { id: "diff-1", accountId: "acc-1", differenceAmount: "3.50" },
          { id: "diff-0", accountId: "acc-1", differenceAmount: "0.00" },
        ],
      })
    );
    assert.equal(byType("RECONCILIATION_DIFFERENCE", result).length, 1);
  });
});

describe("treasuryExceptionEngine — TRANSFER_IN_TRANSIT", () => {
  it("gera apenas status SENT", () => {
    const result = runTreasuryExceptionEngine(
      base({
        transfers: [
          {
            id: "tr-1",
            status: "SENT",
            amount: "80.00",
            fromAccountId: "a",
            toAccountId: "b",
          },
          {
            id: "tr-2",
            status: "RECEIVED",
            amount: "80.00",
            fromAccountId: "a",
            toAccountId: "b",
          },
        ],
      })
    );
    assert.equal(byType("TRANSFER_IN_TRANSIT", result).length, 1);
  });
});

describe("treasuryExceptionEngine — TITLE_WITHOUT_RESPONSIBLE", () => {
  it("gera título sem responsável (AR e AP)", () => {
    const result = runTreasuryExceptionEngine(
      base({
        receivables: [
          {
            officialTitleId: "ar-nr",
            openAmount: "10.00",
            expectedDate: null,
            dueDate: "2026-08-20",
            hasCollectionAction: true,
            responsibleUserId: null,
          },
        ],
        payables: [
          {
            officialTitleId: "ap-nr",
            openAmount: "10.00",
            expectedDate: null,
            dueDate: "2026-08-20",
            isProgrammed: true,
            isCritical: false,
            responsibleUserId: "  ",
          },
        ],
      })
    );
    assert.equal(byType("TITLE_WITHOUT_RESPONSIBLE", result).length, 2);
  });
});

describe("treasuryExceptionEngine — SYNC_DELAYED", () => {
  it("gera sync atrasado ou sem sucesso", () => {
    const result = runTreasuryExceptionEngine(
      base({
        syncFreshness: [
          {
            side: "AR",
            lastSuccessAtIso: "2026-08-01T00:00:00.000Z",
            maxAgeHours: 12,
          },
          {
            side: "AP",
            lastSuccessAtIso: null,
            maxAgeHours: 12,
          },
        ],
      })
    );
    assert.equal(byType("SYNC_DELAYED", result).length, 2);
  });
});

describe("treasuryExceptionEngine — SUSPECTED_DUPLICATE", () => {
  it("gera duplicidade suspeita e não auto-resolve", () => {
    const result = runTreasuryExceptionEngine(
      base({
        duplicateSuspects: [
          {
            key: "amt:100|due:2026-08-01",
            entityKind: "RECEIVABLE",
            entityIds: ["t2", "t1"],
            amount: "100.00",
          },
        ],
        openExceptions: [
          {
            id: "ex-dup",
            uniqueKey: "SUSPECTED_DUPLICATE|EMP1|amt:100|due:2026-08-01",
            type: "SUSPECTED_DUPLICATE",
            status: "OPEN",
            version: 1,
          },
        ],
      })
    );
    const rows = byType("SUSPECTED_DUPLICATE", result);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.allowsSafeAutoResolve, false);
    // Causa ainda ativa — sem auto-resolve
    assert.equal(result.plan.autoResolves.length, 0);

    const cleared = runTreasuryExceptionEngine(
      base({
        duplicateSuspects: [],
        openExceptions: [
          {
            id: "ex-dup",
            uniqueKey: "SUSPECTED_DUPLICATE|EMP1|amt:100|due:2026-08-01",
            type: "SUSPECTED_DUPLICATE",
            status: "OPEN",
            version: 1,
          },
        ],
      })
    );
    // Mesmo sem candidato, não auto-resolve
    assert.equal(cleared.plan.autoResolves.length, 0);
  });
});

describe("treasuryExceptionEngine — FINANCIAL_CHANGE_AFTER_CLOSING", () => {
  it("gera mudança pós-fechamento e nunca auto-resolve", () => {
    const result = runTreasuryExceptionEngine(
      base({
        postClosingChanges: [
          {
            id: "chg-1",
            entityKind: "LEDGER_ENTRY",
            entityId: "le-1",
            closedCivilDate: "2026-08-10",
            changedAtIso: "2026-08-12T10:00:00.000Z",
            amount: "5.00",
          },
        ],
        openExceptions: [
          {
            id: "ex-chg",
            uniqueKey: "FINANCIAL_CHANGE_AFTER_CLOSING|EMP1|chg-1",
            type: "FINANCIAL_CHANGE_AFTER_CLOSING",
            status: "OPEN",
            version: 2,
          },
        ],
      })
    );
    assert.equal(byType("FINANCIAL_CHANGE_AFTER_CLOSING", result).length, 1);
    assert.equal(result.plan.autoResolves.length, 0);

    const cleared = runTreasuryExceptionEngine(
      base({
        postClosingChanges: [],
        openExceptions: [
          {
            id: "ex-chg",
            uniqueKey: "FINANCIAL_CHANGE_AFTER_CLOSING|EMP1|chg-1",
            type: "FINANCIAL_CHANGE_AFTER_CLOSING",
            status: "OPEN",
            version: 2,
          },
        ],
      })
    );
    assert.equal(cleared.plan.autoResolves.length, 0);
  });
});

describe("treasuryExceptionEngine — plano upsert/auto-resolve", () => {
  it("auto-resolve seguro quando causa some (OPEN)", () => {
    const key =
      "EXPECTED_RECEIPT_NOT_RECEIVED|EMP1|ar-gone|2026-08-10";
    const result = runTreasuryExceptionEngine(
      base({
        receivables: [],
        openExceptions: [
          {
            id: "ex-1",
            uniqueKey: key,
            type: "EXPECTED_RECEIPT_NOT_RECEIVED",
            status: "OPEN",
            version: 3,
          },
        ],
      })
    );
    assert.equal(result.plan.upserts.length, 0);
    assert.equal(result.plan.autoResolves.length, 1);
    assert.equal(result.plan.autoResolves[0]!.id, "ex-1");
    assert.equal(
      result.plan.autoResolves[0]!.resolution,
      TREASURY_EXCEPTION_AUTO_RESOLVE_RESOLUTION
    );
  });

  it("não auto-resolve ACK inseguro; auto-resolve ACK seguro", () => {
    const safe = runTreasuryExceptionEngine(
      base({
        openExceptions: [
          {
            id: "ex-ack",
            uniqueKey: "STALE_BALANCE|EMP1|acc-x",
            type: "STALE_BALANCE",
            status: "ACK",
            version: 1,
          },
        ],
      })
    );
    assert.equal(safe.plan.autoResolves.length, 1);

    const unsafe = runTreasuryExceptionEngine(
      base({
        openExceptions: [
          {
            id: "ex-ack-u",
            uniqueKey: "SUSPECTED_DUPLICATE|EMP1|k",
            type: "SUSPECTED_DUPLICATE",
            status: "ACK",
            version: 1,
          },
        ],
      })
    );
    assert.equal(unsafe.plan.autoResolves.length, 0);
  });

  it("mantém upsert enquanto causa permanece", () => {
    const result = runTreasuryExceptionEngine(
      base({
        transfers: [
          {
            id: "tr-keep",
            status: "SENT",
            amount: "1.00",
            fromAccountId: "a",
            toAccountId: "b",
          },
        ],
        openExceptions: [
          {
            id: "ex-tr",
            uniqueKey: "TRANSFER_IN_TRANSIT|EMP1|tr-keep",
            type: "TRANSFER_IN_TRANSIT",
            status: "OPEN",
            version: 1,
          },
        ],
      })
    );
    assert.equal(result.plan.upserts.length, 1);
    assert.equal(result.plan.autoResolves.length, 0);
  });
});
