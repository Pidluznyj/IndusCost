import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TREASURY_DAILY_ACCOUNT_ROUTINE_STATUSES,
  TREASURY_DAILY_OPENING_BALANCE_ORIGINS,
} from "../contracts/treasuryEnums.js";
import type { TreasuryAccountActor } from "./treasuryAccountRules.js";
import { TreasuryDomainError } from "./treasuryErrors.js";
import {
  applyTreasuryDailyFormalClosingToRoutine,
  assertTreasuryDailyAccountRoutineCanMutate,
  assertTreasuryDailyAccountRoutineConcurrency,
  assertTreasuryDailyAccountRoutineCivilDate,
  assertTreasuryDailyRoutineServerTimestamp,
  buildTreasuryDailyClosingBankSnapshotIdempotencyKey,
  buildTreasuryDailyOpeningSnapshotIdempotencyKey,
  computeTreasuryDailyDivergence,
  computeTreasuryDailyPredictedClosingBalance,
  computeTreasuryDailyRealizedClosingBalance,
  deriveTreasuryDailyAccountRoutineStatus,
  emptyTreasuryDailyAccountRoutineDayFlow,
  parseTreasuryDailyRoutineSnapshotKey,
  planTreasuryDailyClosingBankBalance,
  planTreasuryDailyOpeningBalance,
  refreshTreasuryDailyAccountRoutineCalculations,
  suggestTreasuryDailyOpeningBalance,
  type TreasuryDailyAccountRoutineState,
} from "./treasuryDailyAccountRoutineRules.js";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const CIVIL = "2026-07-28";
const SERVER_NOW = new Date("2026-07-28T18:05:30.000Z");

function actor(partial?: Partial<TreasuryAccountActor>): TreasuryAccountActor {
  return {
    userId: "user-1",
    userName: "Operador",
    role: "ADMIN",
    isSuperAdmin: false,
    canViewAccounts: true,
    canManageAccounts: false,
    canManageBalances: true,
    ...partial,
  };
}

function access(mutate = true) {
  return {
    userId: "user-1",
    accessLevel: "OPERATE" as const,
    isActive: true,
    canViewBalance: true,
    canMutateBalance: mutate,
  };
}

describe("treasuryDailyAccountRoutineRules — catálogo", () => {
  it("expõe status e origens canônicos", () => {
    assert.deepEqual([...TREASURY_DAILY_ACCOUNT_ROUTINE_STATUSES], [
      "NOT_STARTED",
      "OPEN",
      "NEEDS_REVIEW",
      "READY_TO_CLOSE",
      "CLOSED",
      "REOPENED",
    ]);
    assert.deepEqual([...TREASURY_DAILY_OPENING_BALANCE_ORIGINS], [
      "PREVIOUS_CLOSING",
      "MANUAL",
      "SNAPSHOT",
    ]);
  });
});

describe("treasuryDailyAccountRoutineRules — abertura", () => {
  it("primeira abertura sem fechamento anterior exige valor manual (não assume zero)", () => {
    const suggestion = suggestTreasuryDailyOpeningBalance({
      accountIsActive: true,
      previousClosedPosition: null,
    });
    assert.equal(suggestion.requiresManualInput, true);
    assert.equal(suggestion.suggestedAmount, null);
    assert.equal(suggestion.reason, "NO_PREVIOUS_CLOSING");

    assert.throws(
      () =>
        planTreasuryDailyOpeningBalance({
          accountId: ACCOUNT_ID,
          civilDate: CIVIL,
          current: null,
          expectedVersion: 0,
          amount: null,
          suggestion,
          actorUserId: "user-1",
          recordedAt: SERVER_NOW,
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError &&
        err.code === "REQUIRED_FIELD" &&
        /não assumir zero/i.test(err.message)
    );

    const planned = planTreasuryDailyOpeningBalance({
      accountId: ACCOUNT_ID,
      civilDate: CIVIL,
      current: null,
      expectedVersion: 0,
      amount: "12500.50",
      suggestion,
      actorUserId: "user-1",
      recordedAt: SERVER_NOW,
      notes: "Abertura manual",
      reason: "Sem fechamento D-1",
    });

    assert.equal(planned.next.status, "OPEN");
    assert.equal(planned.next.openingBalance?.amount, "12500.50");
    assert.equal(planned.next.openingBalance?.origin, "MANUAL");
    assert.equal(planned.next.openingBalance?.informedByUserId, "user-1");
    assert.equal(
      planned.next.openingBalance?.informedAt,
      "2026-07-28T18:05:30.000Z"
    );
    assert.equal(planned.next.version, 1);
    assert.equal(
      planned.snapshotIdempotencyKey,
      "daily-opening:2026-07-28:v1"
    );
    assert.equal(planned.audit.previousValue, null);
    assert.equal(planned.audit.newValue, "12500.50");
    assert.equal(planned.audit.origin, "MANUAL");
  });

  it("abertura baseada no fechamento anterior pode ser confirmada ou corrigida", () => {
    const suggestion = suggestTreasuryDailyOpeningBalance({
      accountIsActive: true,
      previousClosedPosition: {
        closingId: "closing-prev",
        civilDate: "2026-07-27",
        observedBalance: "1000.00",
      },
    });
    assert.equal(suggestion.suggestedAmount, "1000.00");
    assert.equal(suggestion.requiresManualInput, false);
    assert.equal(suggestion.reason, "PREVIOUS_CLOSING_OBSERVED");

    const confirmed = planTreasuryDailyOpeningBalance({
      accountId: ACCOUNT_ID,
      civilDate: CIVIL,
      current: null,
      expectedVersion: 0,
      amount: null,
      confirmSuggestedAmount: "1000.00",
      suggestion,
      actorUserId: "user-1",
      recordedAt: SERVER_NOW,
    });
    assert.equal(confirmed.next.openingBalance?.origin, "PREVIOUS_CLOSING");
    assert.equal(confirmed.next.openingBalance?.amount, "1000.00");

    const corrected = planTreasuryDailyOpeningBalance({
      accountId: ACCOUNT_ID,
      civilDate: CIVIL,
      current: confirmed.next,
      expectedVersion: 1,
      amount: "990.25",
      suggestion,
      actorUserId: "user-2",
      recordedAt: "2026-07-28T19:00:00.000Z",
      reason: "Ajuste de caixa físico",
    });
    assert.equal(corrected.next.openingBalance?.amount, "990.25");
    assert.equal(corrected.next.openingBalance?.origin, "MANUAL");
    assert.equal(corrected.next.version, 2);
    assert.equal(corrected.audit.previousValue, "1000.00");
    assert.equal(corrected.audit.newValue, "990.25");
    assert.equal(corrected.audit.action, "DAILY_OPENING_CORRECTED");
    assert.equal(
      corrected.snapshotIdempotencyKey,
      "daily-opening:2026-07-28:v2"
    );
  });
});

describe("treasuryDailyAccountRoutineRules — fórmulas Decimal", () => {
  it("calcula previsto, realizado e divergência com strings decimais", () => {
    const dayFlow = {
      ...emptyTreasuryDailyAccountRoutineDayFlow(),
      plannedReceivables: "200.10",
      plannedPayables: "50.05",
      plannedTransferIn: "10.00",
      plannedTransferOut: "5.00",
      plannedManualEntries: "1.00",
      settledReceivables: "150.00",
      settledPayables: "40.00",
      realizedLocalInflows: "3.50",
      realizedLocalOutflows: "1.25",
      realizedTransferIn: "10.00",
      realizedTransferOut: "5.00",
    };

    const predicted = computeTreasuryDailyPredictedClosingBalance({
      openingBalance: "1000.00",
      dayFlow,
    });
    // 1000 + 200.10 - 50.05 + 10 - 5 + 1 = 1156.05
    assert.equal(predicted, "1156.05");

    const realized = computeTreasuryDailyRealizedClosingBalance({
      openingBalance: "1000.00",
      dayFlow,
    });
    // 1000 + 150 - 40 + 3.50 - 1.25 + 10 - 5 = 1117.25
    assert.equal(realized, "1117.25");

    assert.equal(
      computeTreasuryDailyDivergence({
        informedClosingBankBalance: "1120.00",
        realizedClosingBalance: realized,
      }),
      "2.75"
    );

    assert.throws(
      () =>
        computeTreasuryDailyPredictedClosingBalance({
          openingBalance: "10,5",
          dayFlow,
        }),
      TreasuryDomainError
    );
  });
});

describe("treasuryDailyAccountRoutineRules — data civil e servidor", () => {
  it("aceita data civil YYYY-MM-DD e rejeita datetime do navegador como civil", () => {
    assert.equal(assertTreasuryDailyAccountRoutineCivilDate(CIVIL), CIVIL);
    assert.throws(
      () =>
        assertTreasuryDailyAccountRoutineCivilDate("2026-07-28T15:00:00.000Z"),
      TreasuryDomainError
    );
    assert.equal(
      assertTreasuryDailyRoutineServerTimestamp(SERVER_NOW),
      "2026-07-28T18:05:30.000Z"
    );
    assert.throws(
      () => assertTreasuryDailyRoutineServerTimestamp("nao-e-data"),
      TreasuryDomainError
    );
  });

  it("chaves de snapshot preservam data civil e versão", () => {
    assert.equal(
      buildTreasuryDailyOpeningSnapshotIdempotencyKey({
        civilDate: CIVIL,
        version: 3,
      }),
      "daily-opening:2026-07-28:v3"
    );
    assert.equal(
      buildTreasuryDailyClosingBankSnapshotIdempotencyKey({
        civilDate: CIVIL,
        version: 4,
      }),
      "daily-closing-bank:2026-07-28:v4"
    );
    assert.deepEqual(
      parseTreasuryDailyRoutineSnapshotKey("daily-opening:2026-07-28:v3"),
      { kind: "opening", civilDate: CIVIL, version: 3 }
    );
  });
});

describe("treasuryDailyAccountRoutineRules — concorrência e auditoria", () => {
  it("bloqueia sobrescrita silenciosa com expectedVersion divergente", () => {
    assert.throws(
      () =>
        assertTreasuryDailyAccountRoutineConcurrency({
          currentVersion: 2,
          expectedVersion: 1,
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );

    const suggestion = suggestTreasuryDailyOpeningBalance({
      accountIsActive: true,
      previousClosedPosition: null,
    });
    const first = planTreasuryDailyOpeningBalance({
      accountId: ACCOUNT_ID,
      civilDate: CIVIL,
      current: null,
      expectedVersion: 0,
      amount: "10.00",
      suggestion,
      actorUserId: "user-1",
      recordedAt: SERVER_NOW,
    });
    assert.throws(
      () =>
        planTreasuryDailyOpeningBalance({
          accountId: ACCOUNT_ID,
          civilDate: CIVIL,
          current: first.next,
          expectedVersion: 0,
          amount: "11.00",
          suggestion,
          actorUserId: "user-2",
          recordedAt: SERVER_NOW,
        }),
      TreasuryDomainError
    );
  });

  it("auditoria carrega conta, valores, usuário, horário, motivo e origem", () => {
    const suggestion = suggestTreasuryDailyOpeningBalance({
      accountIsActive: true,
      previousClosedPosition: {
        closingId: "c1",
        civilDate: "2026-07-27",
        observedBalance: "50.00",
      },
    });
    const planned = planTreasuryDailyOpeningBalance({
      accountId: ACCOUNT_ID,
      civilDate: CIVIL,
      current: null,
      expectedVersion: 0,
      amount: "50.00",
      suggestion,
      actorUserId: "user-audit",
      recordedAt: SERVER_NOW,
      reason: "Confirmação D-1",
    });
    assert.equal(planned.audit.accountId, ACCOUNT_ID);
    assert.equal(planned.audit.previousValue, null);
    assert.equal(planned.audit.newValue, "50.00");
    assert.equal(planned.audit.userId, "user-audit");
    assert.equal(planned.audit.occurredAt, "2026-07-28T18:05:30.000Z");
    assert.equal(planned.audit.reason, "Confirmação D-1");
    assert.equal(planned.audit.origin, "PREVIOUS_CLOSING");
    assert.equal(planned.audit.entityType, "TreasuryDailyAccountRoutine");
  });
});

describe("treasuryDailyAccountRoutineRules — permissão e conta inativa", () => {
  it("rejeita conta inativa e usuário sem permissão", () => {
    assert.equal(
      suggestTreasuryDailyOpeningBalance({
        accountIsActive: false,
        previousClosedPosition: {
          closingId: "c1",
          civilDate: "2026-07-27",
          observedBalance: "1.00",
        },
      }).reason,
      "ACCOUNT_INACTIVE"
    );

    assert.throws(
      () =>
        assertTreasuryDailyAccountRoutineCanMutate({
          accountIsActive: false,
          actor: actor(),
          access: access(true),
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );

    assert.throws(
      () =>
        assertTreasuryDailyAccountRoutineCanMutate({
          accountIsActive: true,
          actor: actor({ canManageBalances: false }),
          access: access(false),
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "FORBIDDEN"
    );

    assert.doesNotThrow(() =>
      assertTreasuryDailyAccountRoutineCanMutate({
        accountIsActive: true,
        actor: actor(),
        access: access(true),
      })
    );
  });
});

describe("treasuryDailyAccountRoutineRules — status e fechamento formal", () => {
  it("derive status até READY_TO_CLOSE / NEEDS_REVIEW e mapeia CLOSED/REOPENED", () => {
    assert.equal(
      deriveTreasuryDailyAccountRoutineStatus({
        openingBalance: null,
        closingBankBalance: null,
        divergence: null,
        formalClosingStatus: null,
      }),
      "NOT_STARTED"
    );
    assert.equal(
      deriveTreasuryDailyAccountRoutineStatus({
        openingBalance: "1.00",
        closingBankBalance: null,
        divergence: null,
        formalClosingStatus: null,
      }),
      "OPEN"
    );
    assert.equal(
      deriveTreasuryDailyAccountRoutineStatus({
        openingBalance: "1.00",
        closingBankBalance: "1.00",
        divergence: "0.00",
        formalClosingStatus: null,
      }),
      "READY_TO_CLOSE"
    );
    assert.equal(
      deriveTreasuryDailyAccountRoutineStatus({
        openingBalance: "1.00",
        closingBankBalance: "2.00",
        divergence: "1.00",
        formalClosingStatus: null,
      }),
      "NEEDS_REVIEW"
    );

    const suggestion = suggestTreasuryDailyOpeningBalance({
      accountIsActive: true,
      previousClosedPosition: null,
    });
    const opened = planTreasuryDailyOpeningBalance({
      accountId: ACCOUNT_ID,
      civilDate: CIVIL,
      current: null,
      expectedVersion: 0,
      amount: "100.00",
      suggestion,
      actorUserId: "user-1",
      recordedAt: SERVER_NOW,
    });
    const withBank = planTreasuryDailyClosingBankBalance({
      accountId: ACCOUNT_ID,
      civilDate: CIVIL,
      current: opened.next,
      expectedVersion: 1,
      amount: "100.00",
      actorUserId: "user-1",
      recordedAt: SERVER_NOW,
      dayFlow: emptyTreasuryDailyAccountRoutineDayFlow(),
    });
    assert.equal(withBank.next.status, "READY_TO_CLOSE");
    assert.equal(withBank.next.divergence, "0.00");

    const closed = applyTreasuryDailyFormalClosingToRoutine({
      current: withBank.next,
      formalClosingId: "closing-1",
      formalClosingStatus: "CLOSED",
    });
    assert.equal(closed.status, "CLOSED");

    const reopened = applyTreasuryDailyFormalClosingToRoutine({
      current: closed,
      formalClosingId: "closing-1",
      formalClosingStatus: "REOPENED",
    });
    assert.equal(reopened.status, "REOPENED");

    assert.throws(
      () =>
        planTreasuryDailyClosingBankBalance({
          accountId: ACCOUNT_ID,
          civilDate: CIVIL,
          current: closed,
          expectedVersion: closed.version,
          amount: "101.00",
          actorUserId: "user-1",
          recordedAt: SERVER_NOW,
          dayFlow: emptyTreasuryDailyAccountRoutineDayFlow(),
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "DAY_CLOSED"
    );
  });

  it("refresh recalcula previsto/realizado sem apagar abertura", () => {
    const state: TreasuryDailyAccountRoutineState = {
      accountId: ACCOUNT_ID,
      civilDate: CIVIL,
      status: "OPEN",
      openingBalance: {
        amount: "100.00",
        informedByUserId: "user-1",
        informedAt: SERVER_NOW.toISOString(),
        origin: "MANUAL",
        version: 1,
      },
      closingBankBalance: null,
      predictedClosingBalance: null,
      realizedClosingBalance: null,
      divergence: null,
      notes: null,
      caveats: [],
      version: 1,
      formalClosingId: null,
      formalClosingStatus: null,
    };
    const refreshed = refreshTreasuryDailyAccountRoutineCalculations({
      current: state,
      dayFlow: {
        ...emptyTreasuryDailyAccountRoutineDayFlow(),
        settledReceivables: "20.00",
        settledPayables: "5.00",
      },
    });
    assert.equal(refreshed.realizedClosingBalance, "115.00");
    assert.equal(refreshed.predictedClosingBalance, "100.00");
    assert.equal(refreshed.openingBalance?.amount, "100.00");
  });
});
