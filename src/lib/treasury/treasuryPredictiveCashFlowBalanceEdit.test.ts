import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canEditTreasuryCivilDateBalances,
  canSubmitTreasuryBalanceEdit,
  parseMoneyInputPtBr,
  resolveTreasuryClosingInputValue,
  resolveTreasuryOpeningInputValue,
  shouldApplyTreasuryBalanceHydration,
  treasuryBalanceHydrationKey,
} from "./treasuryPredictiveCashFlowBalanceEdit.js";

describe("treasuryPredictiveCashFlowBalanceEdit", () => {
  it("permite o dia vigente para qualquer papel", () => {
    assert.deepEqual(
      canEditTreasuryCivilDateBalances({
        civilDate: "2026-07-29",
        todayCivilDate: "2026-07-29",
        isSuperAdmin: false,
      }),
      { allowed: true, reason: null }
    );
  });

  it("bloqueia dias passados para não SUPER_ADMIN", () => {
    const r = canEditTreasuryCivilDateBalances({
      civilDate: "2026-07-28",
      todayCivilDate: "2026-07-29",
      isSuperAdmin: false,
    });
    assert.equal(r.allowed, false);
    assert.match(String(r.reason), /SUPER_ADMIN/);
  });

  it("permite dias passados para SUPER_ADMIN", () => {
    assert.deepEqual(
      canEditTreasuryCivilDateBalances({
        civilDate: "2026-07-28",
        todayCivilDate: "2026-07-29",
        isSuperAdmin: true,
      }),
      { allowed: true, reason: null }
    );
  });

  it("bloqueia dias futuros", () => {
    const r = canEditTreasuryCivilDateBalances({
      civilDate: "2026-07-30",
      todayCivilDate: "2026-07-29",
      isSuperAdmin: true,
    });
    assert.equal(r.allowed, false);
    assert.match(String(r.reason), /futuros/);
  });

  it("parseia dinheiro pt-BR", () => {
    assert.equal(parseMoneyInputPtBr("60.351,00"), "60351.00");
    assert.equal(parseMoneyInputPtBr(""), null);
  });
});

describe("hidratação do modal de saldos do dia", () => {
  const KEY_A = treasuryBalanceHydrationKey({
    accountId: "acc-1",
    civilDate: "2026-09-03",
  });

  it("a chave identifica conta + data", () => {
    assert.equal(KEY_A, "acc-1|2026-09-03");
    assert.notEqual(
      KEY_A,
      treasuryBalanceHydrationKey({
        accountId: "acc-2",
        civilDate: "2026-09-03",
      })
    );
    assert.notEqual(
      KEY_A,
      treasuryBalanceHydrationKey({
        accountId: "acc-1",
        civilDate: "2026-09-02",
      })
    );
  });

  it("aplica o valor persistido quando é a conta/data atual e o campo está limpo", () => {
    assert.equal(
      shouldApplyTreasuryBalanceHydration({
        responseKey: KEY_A,
        currentKey: KEY_A,
        dirty: false,
      }),
      true
    );
  });

  it("resposta de outra conta não contamina a conta atual", () => {
    assert.equal(
      shouldApplyTreasuryBalanceHydration({
        responseKey: treasuryBalanceHydrationKey({
          accountId: "acc-2",
          civilDate: "2026-09-03",
        }),
        currentKey: KEY_A,
        dirty: false,
      }),
      false
    );
  });

  it("resposta de outra data não contamina a data atual", () => {
    assert.equal(
      shouldApplyTreasuryBalanceHydration({
        responseKey: treasuryBalanceHydrationKey({
          accountId: "acc-1",
          civilDate: "2026-09-02",
        }),
        currentKey: KEY_A,
        dirty: false,
      }),
      false
    );
  });

  it("não sobrescreve o que o usuário já digitou", () => {
    assert.equal(
      shouldApplyTreasuryBalanceHydration({
        responseKey: KEY_A,
        currentKey: KEY_A,
        dirty: true,
      }),
      false
    );
  });

  it("saldo inicial gravado tem precedência sobre a sugestão", () => {
    assert.equal(
      resolveTreasuryOpeningInputValue({
        amount: "125699.11",
        suggestedBalance: "100.00",
      }),
      "125.699,11"
    );
  });

  it("sem saldo inicial gravado usa a sugestão canônica", () => {
    assert.equal(
      resolveTreasuryOpeningInputValue({
        amount: null,
        suggestedBalance: "980.00",
      }),
      "980,00"
    );
  });

  it("sem saldo e sem sugestão o campo fica vazio (não assume zero)", () => {
    assert.equal(
      resolveTreasuryOpeningInputValue({
        amount: null,
        suggestedBalance: null,
      }),
      ""
    );
  });

  it("saldo final só mostra valor informado", () => {
    assert.equal(
      resolveTreasuryClosingInputValue({ amount: "61200.50" }),
      "61.200,50"
    );
    assert.equal(resolveTreasuryClosingInputValue({ amount: null }), "");
  });
});

describe("submit do modal de saldos do dia (optimistic lock)", () => {
  const KEY = "acc-1|2026-09-03";
  const base = {
    hydratedKey: KEY,
    currentKey: KEY,
    dateAllowed: true,
    saving: false,
  };

  it("libera o submit quando a versão da conta/data já foi hidratada", () => {
    assert.equal(canSubmitTreasuryBalanceEdit(base), true);
  });

  it("bloqueia o submit enquanto a versão persistida é desconhecida", () => {
    assert.equal(
      canSubmitTreasuryBalanceEdit({ ...base, hydratedKey: null }),
      false
    );
  });

  it("bloqueia o submit se a versão hidratada é de outra conta/data", () => {
    assert.equal(
      canSubmitTreasuryBalanceEdit({
        ...base,
        hydratedKey: "acc-2|2026-09-03",
      }),
      false
    );
    assert.equal(
      canSubmitTreasuryBalanceEdit({
        ...base,
        hydratedKey: "acc-1|2026-09-02",
      }),
      false
    );
  });

  it("bloqueia o submit durante a gravação, em data proibida e quando desabilitado", () => {
    assert.equal(canSubmitTreasuryBalanceEdit({ ...base, saving: true }), false);
    assert.equal(
      canSubmitTreasuryBalanceEdit({ ...base, dateAllowed: false }),
      false
    );
    assert.equal(
      canSubmitTreasuryBalanceEdit({ ...base, disabled: true }),
      false
    );
  });
});
