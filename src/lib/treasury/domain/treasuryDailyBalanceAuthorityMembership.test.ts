/**
 * RED — Autoridade única de saldos por dia civil (Tesouraria › Caixa).
 *
 * Escopo ESPECÍFICO deste arquivo: MEMBERSHIP TEMPORAL — "esta conta fazia
 * parte do consolidado NESTE dia?". O universo de contas esperadas varia por
 * dia civil (`TreasuryConsolidatedMembershipInterval[]`), e uma conta nova
 * entrando no consolidado (ex.: Sisprime - Koppetel a partir de 03/09/2026)
 * NUNCA contamina os dias anteriores — nem no cálculo de `accountsExpected`,
 * nem na regra de cobertura completa que decide se um saldo manual ancora.
 *
 * Não duplica os 25 casos de `treasuryDailyBalanceAuthority.test.ts` (esses
 * cobrem o resolvedor principal: cobertura parcial, abertura manual, gênese,
 * fechamento formal, HOJE). Aqui o eixo é só `resolveTreasuryExpectedAccountsOn`
 * e o efeito do membership temporal em `resolveTreasuryDailyBalanceAuthority`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveTreasuryDailyBalanceAuthority,
  resolveTreasuryExpectedAccountsOn,
  type TreasuryConsolidatedAccountMembershipView,
  type TreasuryConsolidatedAccountRef,
  type TreasuryConsolidatedMembershipInterval,
  type TreasuryDailyBalanceAuthorityInput,
  type TreasuryManualBalanceEvidenceInput,
} from "./treasuryDailyBalanceAuthority.js";

// ── Fixtures — contas reais do caso (02/09 e 03/09/2026) ────────────────────

const VK_REF: TreasuryConsolidatedAccountRef = {
  accountId: "acc-vk",
  accountName: "Viacredi - Koppetel",
  companyCode: "KOPPETEL",
};
const VL_REF: TreasuryConsolidatedAccountRef = {
  accountId: "acc-vl",
  accountName: "Viacredi - Lazarios",
  companyCode: "LAZARIOS",
};
const SK_REF: TreasuryConsolidatedAccountRef = {
  accountId: "acc-sk",
  accountName: "Sisprime - Koppetel",
  companyCode: "KOPPETEL",
};

function withMemberships(
  ref: TreasuryConsolidatedAccountRef,
  memberships: readonly TreasuryConsolidatedMembershipInterval[]
): TreasuryConsolidatedAccountMembershipView {
  return { ...ref, memberships, membershipSource: "TABLE" };
}

function closing(accountId: string, civilDate: string, amount: number): TreasuryManualBalanceEvidenceInput {
  return { accountId, civilDate, amount, informedAt: `${civilDate}T20:00:00.000Z`, version: 1 };
}

/**
 * Cenário base para os testes fim a fim (5)-(7): VK e VL sempre fizeram parte
 * do consolidado; SK (Sisprime - Koppetel) é conta NOVA, entrando só em
 * 2026-09-03 — o dia exato do segundo defeito observado em produção.
 */
function growingUniverseInput(
  over: Partial<TreasuryDailyBalanceAuthorityInput> = {}
): TreasuryDailyBalanceAuthorityInput {
  return {
    civilDates: ["2026-09-01", "2026-09-02", "2026-09-03"],
    genesisCivilDate: "2026-09-01",
    todayCivilDate: "2026-09-03",
    accounts: [
      withMemberships(VK_REF, [{ validFrom: "2026-01-01", validUntil: null }]),
      withMemberships(VL_REF, [{ validFrom: "2026-01-01", validUntil: null }]),
      withMemberships(SK_REF, [{ validFrom: "2026-09-03", validUntil: null }]),
    ],
    manualOpenings: [],
    manualClosings: [],
    genericSnapshots: [],
    formalClosings: [],
    flows: [
      { civilDate: "2026-09-01", inflows: 0, outflows: 0 },
      { civilDate: "2026-09-02", inflows: 0, outflows: 0 },
      { civilDate: "2026-09-03", inflows: 0, outflows: 0 },
    ],
    todayPredicted: null,
    ...over,
  };
}

// ── resolveTreasuryExpectedAccountsOn — membership temporal isolado ────────

describe("resolveTreasuryExpectedAccountsOn — membership temporal", () => {
  it("(1) conta vigente desde 2026-09-03 (sem validUntil) é esperada nesse dia e depois, NÃO antes", () => {
    const acc = withMemberships(VK_REF, [{ validFrom: "2026-09-03", validUntil: null }]);
    assert.equal(resolveTreasuryExpectedAccountsOn([acc], "2026-09-03").length, 1);
    assert.equal(resolveTreasuryExpectedAccountsOn([acc], "2026-09-10").length, 1);
    assert.equal(resolveTreasuryExpectedAccountsOn([acc], "2026-09-02").length, 0);
    assert.equal(resolveTreasuryExpectedAccountsOn([acc], "2026-09-01").length, 0);
  });

  it("(2) validUntil é INCLUSIVO: conta esperada no último dia de vigência, NÃO esperada no dia seguinte", () => {
    const acc = withMemberships(VK_REF, [{ validFrom: "2026-01-01", validUntil: "2026-08-31" }]);
    assert.equal(resolveTreasuryExpectedAccountsOn([acc], "2026-08-31").length, 1);
    assert.equal(resolveTreasuryExpectedAccountsOn([acc], "2026-09-01").length, 0);
  });

  it("(3) conta com múltiplos intervalos é esperada em cada janela e ausente entre elas", () => {
    const acc = withMemberships(VK_REF, [
      { validFrom: "2026-01-01", validUntil: "2026-03-31" },
      { validFrom: "2026-06-01", validUntil: null },
    ]);
    assert.equal(resolveTreasuryExpectedAccountsOn([acc], "2026-02-15").length, 1, "fevereiro está no 1º intervalo");
    assert.equal(resolveTreasuryExpectedAccountsOn([acc], "2026-04-15").length, 0, "abril está no hiato");
    assert.equal(resolveTreasuryExpectedAccountsOn([acc], "2026-05-15").length, 0, "maio ainda está no hiato");
    assert.equal(resolveTreasuryExpectedAccountsOn([acc], "2026-07-01").length, 1, "julho está no 2º intervalo (vigente)");
  });

  it("(4) conta sem NENHUM intervalo de membership nunca é esperada, em nenhuma data", () => {
    const acc = withMemberships(VK_REF, []);
    for (const civilDate of ["2026-01-01", "2026-09-03", "2030-12-31"]) {
      assert.equal(resolveTreasuryExpectedAccountsOn([acc], civilDate).length, 0, civilDate);
    }
  });

  it("(8) conta que sai do consolidado e VOLTA depois: ausente no meio, esperada antes e depois da reentrada", () => {
    const acc = withMemberships(VL_REF, [
      { validFrom: "2026-01-01", validUntil: "2026-04-30" },
      { validFrom: "2026-07-01", validUntil: null },
    ]);
    assert.equal(resolveTreasuryExpectedAccountsOn([acc], "2026-02-01").length, 1, "dentro do 1º intervalo");
    assert.equal(resolveTreasuryExpectedAccountsOn([acc], "2026-05-15").length, 0, "conta saiu do consolidado");
    assert.equal(resolveTreasuryExpectedAccountsOn([acc], "2026-06-30").length, 0, "véspera da reentrada, ainda fora");
    assert.equal(resolveTreasuryExpectedAccountsOn([acc], "2026-07-01").length, 1, "dia exato da reentrada");
    assert.equal(resolveTreasuryExpectedAccountsOn([acc], "2026-08-01").length, 1, "depois da reentrada, vigente");
  });

  it("(9) preserva accountId/accountName/companyCode integralmente — não só um subconjunto dos campos", () => {
    const acc = withMemberships(SK_REF, [{ validFrom: "2026-01-01", validUntil: null }]);
    const [result] = resolveTreasuryExpectedAccountsOn([acc], "2026-09-03");
    assert.deepEqual(result, { accountId: "acc-sk", accountName: "Sisprime - Koppetel", companyCode: "KOPPETEL" });
  });
});

// ── resolveTreasuryDailyBalanceAuthority — universo consolidado que CRESCE ──

describe("autoridade de saldos — universo consolidado cresce no meio da série (caso real 02/09 → 03/09/2026)", () => {
  it("(5) accountsExpected reflete a entrada de SK em 03/09: 2 contas em 01/09 e 02/09, 3 contas em 03/09", () => {
    const res = resolveTreasuryDailyBalanceAuthority(growingUniverseInput());
    const d1 = res.byCivilDate.get("2026-09-01")!;
    const d2 = res.byCivilDate.get("2026-09-02")!;
    const d3 = res.byCivilDate.get("2026-09-03")!;
    assert.equal(d1.closingCoverage.accountsExpected, 2);
    assert.deepEqual(d1.expectedAccounts.map((a) => a.accountId).sort(), ["acc-vk", "acc-vl"]);
    assert.equal(d2.closingCoverage.accountsExpected, 2);
    assert.deepEqual(d2.expectedAccounts.map((a) => a.accountId).sort(), ["acc-vk", "acc-vl"]);
    assert.equal(d3.closingCoverage.accountsExpected, 3);
    assert.deepEqual(d3.expectedAccounts.map((a) => a.accountId).sort(), ["acc-sk", "acc-vk", "acc-vl"]);
  });

  it("(6) fechamento manual de VK+VL em 02/09 ANCORA: SK ainda NÃO fazia parte do consolidado nesse dia (cobertura 2/2 completa)", () => {
    const res = resolveTreasuryDailyBalanceAuthority(
      growingUniverseInput({
        manualClosings: [closing("acc-vk", "2026-09-02", 125699.11), closing("acc-vl", "2026-09-02", 1844.22)],
      })
    );
    const d2 = res.byCivilDate.get("2026-09-02")!;
    assert.equal(d2.closingCoverage.accountsExpected, 2);
    assert.equal(d2.closingCoverage.accountsCovered, 2);
    assert.equal(d2.closingCoverage.complete, true);
    assert.equal(d2.closingCoverage.pendingAccounts.length, 0);
    assert.equal(d2.closingInformed, 127543.33);
    assert.equal(d2.closingSource, "MANUAL_CLOSING");
    assert.equal(d2.closingEffective, 127543.33);
  });

  it("(7) MESMA soma (127.543,33) NÃO ancora quando SK já fazia parte do consolidado o tempo todo — cobertura 2/3 parcial (contraste direto com (6): dinheiro idêntico, resultado oposto, porque o universo esperado mudou)", () => {
    const res = resolveTreasuryDailyBalanceAuthority(
      growingUniverseInput({
        accounts: [
          withMemberships(VK_REF, [{ validFrom: "2026-01-01", validUntil: null }]),
          withMemberships(VL_REF, [{ validFrom: "2026-01-01", validUntil: null }]),
          withMemberships(SK_REF, [{ validFrom: "2026-01-01", validUntil: null }]),
        ],
        manualClosings: [closing("acc-vk", "2026-09-02", 125699.11), closing("acc-vl", "2026-09-02", 1844.22)],
      })
    );
    const d2 = res.byCivilDate.get("2026-09-02")!;
    assert.equal(d2.closingCoverage.accountsExpected, 3);
    assert.equal(d2.closingCoverage.accountsCovered, 2);
    assert.equal(d2.closingCoverage.complete, false);
    assert.equal(d2.closingCoverage.partialSum, 127543.33);
    assert.deepEqual(d2.closingCoverage.pendingAccounts.map((a) => a.accountId), ["acc-sk"]);
    assert.equal(d2.closingInformed, null, "subtotal 127.543,33 não pode virar closingInformed quando SK também é esperada");
    assert.ok(d2.warnings.some((w) => w.code === "PARTIAL_CLOSING_COVERAGE"));
  });

  it("(10) closingCoverage.accountsExpected é 0 quando TODAS as contas têm validFrom no futuro em relação ao dia resolvido", () => {
    const res = resolveTreasuryDailyBalanceAuthority(
      growingUniverseInput({
        accounts: [
          withMemberships(VK_REF, [{ validFrom: "2026-10-01", validUntil: null }]),
          withMemberships(VL_REF, [{ validFrom: "2026-12-01", validUntil: null }]),
          withMemberships(SK_REF, [{ validFrom: "2027-01-01", validUntil: null }]),
        ],
      })
    );
    const d1 = res.byCivilDate.get("2026-09-01")!;
    assert.equal(d1.closingCoverage.accountsExpected, 0);
    assert.equal(d1.expectedAccounts.length, 0);
  });
});
