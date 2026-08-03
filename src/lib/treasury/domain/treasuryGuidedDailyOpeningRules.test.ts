import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TreasuryDomainError } from "./treasuryErrors.js";
import {
  TREASURY_GUIDED_DAILY_OPENING_TITLE,
  assertTreasuryGuidedDailyOpeningJustification,
  buildTreasuryGuidedDailyOpeningWorkspace,
  computeTreasuryGuidedDailyOpeningDifference,
  planTreasuryGuidedDailyOpeningSaveItem,
  type TreasuryGuidedDailyOpeningAccountSeed,
} from "./treasuryGuidedDailyOpeningRules.js";

const CIVIL = "2026-07-28";
const SERVER_NOW = "2026-07-28T15:00:00.000Z";

function seed(
  partial: Partial<TreasuryGuidedDailyOpeningAccountSeed> &
    Pick<TreasuryGuidedDailyOpeningAccountSeed, "accountId">
): TreasuryGuidedDailyOpeningAccountSeed {
  return {
    accountCode: "CX1",
    accountName: "Caixa",
    bank: "Itaú",
    isActive: true,
    previousClosedPosition: null,
    currentOpening: null,
    ...partial,
  };
}

describe("treasuryGuidedDailyOpeningRules", () => {
  it("primeira abertura sem histórico exige valor manual (não assume zero)", () => {
    const workspace = buildTreasuryGuidedDailyOpeningWorkspace({
      civilDate: CIVIL,
      asOf: SERVER_NOW,
      accounts: [seed({ accountId: "acc-1" })],
    });
    assert.equal(workspace.title, TREASURY_GUIDED_DAILY_OPENING_TITLE);
    assert.equal(workspace.accounts[0]?.situation, "NEEDS_MANUAL");
    assert.equal(workspace.accounts[0]?.previousClosingBalance, null);
    assert.equal(workspace.accounts[0]?.requiresManualInput, true);

    assert.throws(
      () =>
        planTreasuryGuidedDailyOpeningSaveItem({
          seed: seed({ accountId: "acc-1" }),
          civilDate: CIVIL,
          item: {
            accountId: "acc-1",
            expectedVersion: 0,
            confirmSuggested: true,
          },
          actorUserId: "u1",
          recordedAt: SERVER_NOW,
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError &&
        /não há saldo sugerido/i.test(err.message)
    );
  });

  it("abertura com histórico permite confirmação em lote sem divergência", () => {
    const withHistory = seed({
      accountId: "acc-1",
      previousClosedPosition: {
        closingId: "c1",
        civilDate: "2026-07-27",
        observedBalance: "1500.50",
      },
    });
    const workspace = buildTreasuryGuidedDailyOpeningWorkspace({
      civilDate: CIVIL,
      accounts: [withHistory],
    });
    assert.equal(workspace.accounts[0]?.situation, "READY_TO_CONFIRM");
    assert.equal(workspace.accounts[0]?.canConfirmSuggested, true);
    assert.equal(workspace.confirmableCount, 1);

    const planned = planTreasuryGuidedDailyOpeningSaveItem({
      seed: withHistory,
      civilDate: CIVIL,
      item: {
        accountId: "acc-1",
        expectedVersion: 0,
        confirmSuggested: true,
      },
      actorUserId: "u1",
      recordedAt: SERVER_NOW,
    });
    assert.equal(planned.next.openingBalance?.amount, "1500.50");
    assert.equal(planned.next.openingBalance?.origin, "PREVIOUS_CLOSING");
    assert.equal(planned.difference, "0.00");
    assert.equal(planned.justificationCode, null);
    assert.equal(planned.snapshotIdempotencyKey, "daily-opening:2026-07-28:v1");
  });

  it("edição individual com diferença exige justificativa e Decimal", () => {
    const withHistory = seed({
      accountId: "acc-2",
      previousClosedPosition: {
        closingId: "c2",
        civilDate: "2026-07-27",
        observedBalance: "1000.00",
      },
    });

    const diff = computeTreasuryGuidedDailyOpeningDifference({
      previousClosingBalance: "1000.00",
      informedOpeningBalance: "990.25",
    });
    assert.equal(diff.hasDifference, true);
    assert.equal(diff.difference, "-9.75");

    assert.throws(
      () =>
        assertTreasuryGuidedDailyOpeningJustification({
          hasDifference: true,
          justificationCode: null,
        }),
      (err: unknown) => err instanceof TreasuryDomainError
    );

    const planned = planTreasuryGuidedDailyOpeningSaveItem({
      seed: withHistory,
      civilDate: CIVIL,
      item: {
        accountId: "acc-2",
        expectedVersion: 0,
        amount: "990.25",
        justificationCode: "FEE_OR_INTEREST",
        notes: "Tarifa noturna",
      },
      actorUserId: "u2",
      recordedAt: SERVER_NOW,
    });
    assert.equal(planned.next.openingBalance?.amount, "990.25");
    assert.equal(planned.next.openingBalance?.origin, "MANUAL");
    assert.equal(planned.justificationCode, "FEE_OR_INTEREST");
    assert.match(planned.audit.reason ?? "", /Tarifa ou juros/);
  });

  it("concorrência rejeita expectedVersion desatualizado", () => {
    const withHistory = seed({
      accountId: "acc-3",
      previousClosedPosition: {
        closingId: "c3",
        civilDate: "2026-07-27",
        observedBalance: "10.00",
      },
      currentOpening: { amount: "10.00", version: 1 },
    });

    assert.throws(
      () =>
        planTreasuryGuidedDailyOpeningSaveItem({
          seed: withHistory,
          civilDate: CIVIL,
          item: {
            accountId: "acc-3",
            expectedVersion: 0,
            amount: "11.00",
            justificationCode: "PREVIOUS_BALANCE_INCORRECT",
          },
          actorUserId: "u3",
          recordedAt: SERVER_NOW,
          currentState: {
            accountId: "acc-3",
            civilDate: CIVIL,
            status: "OPEN",
            openingBalance: {
              amount: "10.00",
              informedByUserId: "u0",
              informedAt: SERVER_NOW,
              origin: "PREVIOUS_CLOSING",
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
          },
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );
  });

  it("concorrência é detectada mesmo sem currentState explícito — reconstrói de seed.currentOpening", () => {
    // Reproduz o caso real: o serviço chama sem `currentState` (ver
    // treasuryGuidedDailyOpeningService.server.ts), só com `seed.currentOpening`.
    // Sem reconstruir `current` a partir do seed, a checagem de versão via
    // planTreasuryDailyOpeningBalance nunca via um estado existente e deixava
    // passar uma atualização com expectedVersion desatualizado.
    const withHistory = seed({
      accountId: "acc-4",
      previousClosedPosition: {
        closingId: "c4",
        civilDate: "2026-07-27",
        observedBalance: "10.00",
      },
      currentOpening: { amount: "10.00", version: 1 },
    });

    assert.throws(
      () =>
        planTreasuryGuidedDailyOpeningSaveItem({
          seed: withHistory,
          civilDate: CIVIL,
          item: {
            accountId: "acc-4",
            expectedVersion: 0,
            amount: "11.00",
            justificationCode: "PREVIOUS_BALANCE_INCORRECT",
          },
          actorUserId: "u4",
          recordedAt: SERVER_NOW,
          // Sem currentState — exatamente como o serviço chama em produção.
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );
  });

  it("timezone civil date permanece YYYY-MM-DD na chave", () => {
    const planned = planTreasuryGuidedDailyOpeningSaveItem({
      seed: seed({
        accountId: "acc-tz",
        previousClosedPosition: {
          closingId: "c-tz",
          civilDate: "2026-07-27",
          observedBalance: "1.00",
        },
      }),
      civilDate: CIVIL,
      item: {
        accountId: "acc-tz",
        expectedVersion: 0,
        confirmSuggested: true,
      },
      actorUserId: "u-tz",
      recordedAt: "2026-07-29T02:30:00.000Z",
    });
    assert.equal(planned.next.civilDate, CIVIL);
    assert.match(planned.snapshotIdempotencyKey, /^daily-opening:2026-07-28:v1$/);
    assert.equal(
      planned.next.openingBalance?.informedAt,
      "2026-07-29T02:30:00.000Z"
    );
  });
});
