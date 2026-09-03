import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTreasuryAccountDailyBalanceDto,
  resolveTreasuryDailyRoutineBalance,
  type TreasuryAccountDailyBalanceSeed,
} from "./treasuryAccountDailyBalanceRules.js";
import {
  buildTreasuryGuidedDailyClosingAccountDto,
  type TreasuryGuidedDailyClosingAccountSeed,
} from "./treasuryGuidedDailyClosingRules.js";
import {
  buildTreasuryGuidedDailyOpeningWorkspace,
  type TreasuryGuidedDailyOpeningAccountSeed,
} from "./treasuryGuidedDailyOpeningRules.js";
import {
  emptyTreasuryDailyAccountRoutineDayFlow,
  resolveTreasuryDailyRoutineExpectedVersion,
} from "./treasuryDailyAccountRoutineRules.js";

const CIVIL = "2026-09-03" as const;

function seed(
  over: Partial<TreasuryAccountDailyBalanceSeed> = {}
): TreasuryAccountDailyBalanceSeed {
  return {
    accountId: "acc-1",
    accountCode: "CX",
    accountName: "Caixa Itaú",
    bank: "Itaú",
    isActive: true,
    civilDate: CIVIL,
    openingSnapshots: [],
    closingSnapshots: [],
    previousClosedPosition: null,
    ...over,
  };
}

describe("treasuryAccountDailyBalanceRules", () => {
  it("sem nada gravado: não existe saldo e versões começam em zero", () => {
    const dto = buildTreasuryAccountDailyBalanceDto(seed());
    assert.equal(dto.opening.exists, false);
    assert.equal(dto.opening.amount, null);
    assert.equal(dto.opening.expectedVersion, 0);
    assert.equal(dto.closing.exists, false);
    assert.equal(dto.closing.amount, null);
    assert.equal(dto.closing.expectedVersion, 0);
  });

  it("sem fechamento anterior a sugestão é null e exige digitação (não assume zero)", () => {
    const dto = buildTreasuryAccountDailyBalanceDto(seed());
    assert.equal(dto.opening.suggestedBalance, null);
    assert.equal(dto.opening.requiresManualInput, true);
  });

  it("sugere o observedBalance do último fechamento CLOSED anterior", () => {
    const dto = buildTreasuryAccountDailyBalanceDto(
      seed({
        previousClosedPosition: {
          closingId: "c-1",
          civilDate: "2026-09-02",
          observedBalance: "1250.75",
        },
      })
    );
    assert.equal(dto.opening.suggestedBalance, "1250.75");
    assert.equal(dto.opening.requiresManualInput, false);
    assert.equal(dto.opening.exists, false);
  });

  it("conta inativa não recebe sugestão (regra canônica preservada)", () => {
    const dto = buildTreasuryAccountDailyBalanceDto(
      seed({
        isActive: false,
        previousClosedPosition: {
          closingId: "c-1",
          civilDate: "2026-09-02",
          observedBalance: "1250.75",
        },
      })
    );
    assert.equal(dto.opening.suggestedBalance, null);
    assert.equal(dto.opening.requiresManualInput, true);
  });

  it("saldo inicial gravado aparece com a versão da chave idempotente", () => {
    const dto = buildTreasuryAccountDailyBalanceDto(
      seed({
        openingSnapshots: [
          { idempotencyKey: `daily-opening:${CIVIL}:v3`, amount: "125699.11" },
          { idempotencyKey: `daily-opening:${CIVIL}:v2`, amount: "100.00" },
        ],
      })
    );
    assert.equal(dto.opening.exists, true);
    assert.equal(dto.opening.amount, "125699.11");
    assert.equal(dto.opening.expectedVersion, 3);
    // Sem fechamento gravado, a versão do fechamento acompanha a abertura.
    assert.equal(dto.closing.exists, false);
    assert.equal(dto.closing.expectedVersion, 3);
  });

  it("saldo final gravado aparece e a versão é o max da rotina", () => {
    const dto = buildTreasuryAccountDailyBalanceDto(
      seed({
        openingSnapshots: [
          { idempotencyKey: `daily-opening:${CIVIL}:v1`, amount: "500.00" },
        ],
        closingSnapshots: [
          {
            idempotencyKey: `daily-closing-bank:${CIVIL}:v2`,
            amount: "612.50",
          },
        ],
      })
    );
    assert.equal(dto.opening.amount, "500.00");
    assert.equal(dto.opening.expectedVersion, 1);
    assert.equal(dto.closing.exists, true);
    assert.equal(dto.closing.amount, "612.50");
    assert.equal(dto.closing.expectedVersion, 2);
  });

  it("ignora snapshot de outra data ou de outra rotina", () => {
    const dto = buildTreasuryAccountDailyBalanceDto(
      seed({
        openingSnapshots: [
          { idempotencyKey: "daily-opening:2026-09-02:v9", amount: "9.99" },
          { idempotencyKey: `daily-closing-bank:${CIVIL}:v4`, amount: "4.44" },
          { idempotencyKey: `daily-opening:${CIVIL}:v1`, amount: "1.11" },
        ],
      })
    );
    assert.equal(dto.opening.amount, "1.11");
    assert.equal(dto.opening.expectedVersion, 1);
  });

  it("chave inválida não aborta a leitura: cai no próximo snapshot válido", () => {
    const resolved = resolveTreasuryDailyRoutineBalance({
      snapshots: [
        { idempotencyKey: "ofx-import-2026-09-03", amount: "7.77" },
        { idempotencyKey: `daily-opening:${CIVIL}:v2`, amount: "2.22" },
      ],
      civilDate: CIVIL,
      kind: "opening",
    });
    assert.deepEqual(resolved, { amount: "2.22", version: 2 });
  });

  it("expectedVersion da leitura leve é idêntico ao do workspace completo", () => {
    const opening = { amount: "500.00" as const, version: 1 };
    const closingBank = { amount: "612.50" as const, version: 2 };

    const closingSeed: TreasuryGuidedDailyClosingAccountSeed = {
      accountId: "acc-1",
      accountCode: "CX",
      accountName: "Caixa Itaú",
      bank: "Itaú",
      companyCode: "01",
      isActive: true,
      opening,
      closingBank,
      dayFlow: emptyTreasuryDailyAccountRoutineDayFlow(),
      formalClosingStatus: null,
    };
    const workspaceClosing =
      buildTreasuryGuidedDailyClosingAccountDto(closingSeed);

    const openingSeed: TreasuryGuidedDailyOpeningAccountSeed = {
      accountId: "acc-1",
      accountCode: "CX",
      accountName: "Caixa Itaú",
      bank: "Itaú",
      isActive: true,
      previousClosedPosition: null,
      currentOpening: opening,
    };
    const workspaceOpening = buildTreasuryGuidedDailyOpeningWorkspace({
      civilDate: CIVIL,
      asOf: new Date(0),
      accounts: [openingSeed],
    });

    const light = buildTreasuryAccountDailyBalanceDto(
      seed({
        openingSnapshots: [
          { idempotencyKey: `daily-opening:${CIVIL}:v1`, amount: "500.00" },
        ],
        closingSnapshots: [
          {
            idempotencyKey: `daily-closing-bank:${CIVIL}:v2`,
            amount: "612.50",
          },
        ],
      })
    );

    assert.equal(
      light.closing.expectedVersion,
      workspaceClosing.expectedVersion
    );
    assert.equal(
      light.opening.expectedVersion,
      workspaceOpening.accounts[0]!.expectedVersion
    );
    assert.equal(light.opening.amount, workspaceOpening.accounts[0]!.currentOpeningBalance);
    assert.equal(light.closing.amount, workspaceClosing.informedClosingBalance);
  });

  it("sugestão da leitura leve é idêntica ao suggestedOpeningBalance do workspace", () => {
    const previousClosedPosition = {
      closingId: "c-1",
      civilDate: "2026-09-02",
      observedBalance: "1250.75",
    };
    const workspace = buildTreasuryGuidedDailyOpeningWorkspace({
      civilDate: CIVIL,
      asOf: new Date(0),
      accounts: [
        {
          accountId: "acc-1",
          accountCode: "CX",
          accountName: "Caixa Itaú",
          bank: "Itaú",
          isActive: true,
          previousClosedPosition,
          currentOpening: null,
        },
      ],
    });
    const light = buildTreasuryAccountDailyBalanceDto(
      seed({ previousClosedPosition })
    );
    assert.equal(
      light.opening.suggestedBalance,
      workspace.accounts[0]!.suggestedOpeningBalance
    );
  });
});

describe("resolveTreasuryDailyRoutineExpectedVersion", () => {
  it("é o maior contador entre abertura e fechamento bancário", () => {
    assert.equal(
      resolveTreasuryDailyRoutineExpectedVersion({
        opening: { version: 1 },
        closingBank: { version: 2 },
      }),
      2
    );
    assert.equal(
      resolveTreasuryDailyRoutineExpectedVersion({
        opening: { version: 5 },
        closingBank: { version: 2 },
      }),
      5
    );
  });

  it("nada gravado é versão zero", () => {
    assert.equal(
      resolveTreasuryDailyRoutineExpectedVersion({
        opening: null,
        closingBank: null,
      }),
      0
    );
  });

  it("gravar abertura invalida o expectedVersion do fechamento da mesma conta/data", () => {
    // É por isso que salvar abertura + fechamento juntos precisa reconsultar
    // a versão: o contador da rotina é compartilhado.
    const before = resolveTreasuryDailyRoutineExpectedVersion({
      opening: { version: 1 },
      closingBank: null,
    });
    const afterOpeningSave = resolveTreasuryDailyRoutineExpectedVersion({
      opening: { version: 2 },
      closingBank: null,
    });
    assert.equal(before, 1);
    assert.equal(afterOpeningSave, 2);
    assert.notEqual(before, afterOpeningSave);
  });
});
