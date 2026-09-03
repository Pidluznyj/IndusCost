/**
 * RED — Autoridade única de saldos por dia civil (Tesouraria › Caixa).
 *
 * Prova os defeitos observados em produção (02/09 e 03/09/2026: subconjunto
 * das contas promovido a saldo consolidado) e fixa as regras não negociáveis
 * da missão: cobertura por conta, subtotal parcial nunca ancora, abertura
 * manual completa com ajuste auditável, fechamento formal por companyCode,
 * HOJE pela mesma autoridade e identidade matemática das colunas.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveTreasuryDailyBalanceAuthority,
  type TreasuryConsolidatedAccountMembershipView,
  type TreasuryDailyBalanceAuthorityDay,
  type TreasuryDailyBalanceAuthorityInput,
} from "./treasuryDailyBalanceAuthority.js";

// ── Fixtures — contas reais do caso ─────────────────────────────────────────

const VK: TreasuryConsolidatedAccountMembershipView = {
  accountId: "acc-vk",
  accountName: "Viacredi - Koppetel",
  companyCode: "KOPPETEL",
  memberships: [{ validFrom: "2026-01-01", validUntil: null }],
  membershipSource: "TABLE",
};
const VL: TreasuryConsolidatedAccountMembershipView = {
  accountId: "acc-vl",
  accountName: "Viacredi - Lazarios",
  companyCode: "LAZARIOS",
  memberships: [{ validFrom: "2026-01-01", validUntil: null }],
  membershipSource: "TABLE",
};
const SK: TreasuryConsolidatedAccountMembershipView = {
  accountId: "acc-sk",
  accountName: "Sisprime - Koppetel",
  companyCode: "KOPPETEL",
  memberships: [{ validFrom: "2026-01-01", validUntil: null }],
  membershipSource: "TABLE",
};

const T = "2026-09-03";

function closing(accountId: string, civilDate: string, amount: number) {
  return { accountId, civilDate, amount, informedAt: `${civilDate}T20:00:00.000Z`, version: 1 };
}
function opening(accountId: string, civilDate: string, amount: number) {
  return { accountId, civilDate, amount, informedAt: `${civilDate}T11:00:00.000Z`, version: 1 };
}

function base(over: Partial<TreasuryDailyBalanceAuthorityInput> = {}): TreasuryDailyBalanceAuthorityInput {
  return {
    civilDates: ["2026-09-01", "2026-09-02", "2026-09-03"],
    genesisCivilDate: "2026-01-01",
    todayCivilDate: T,
    accounts: [VK, VL, SK],
    manualOpenings: [],
    manualClosings: [],
    genericSnapshots: [],
    formalClosings: [],
    flows: [
      { civilDate: "2026-09-01", inflows: 494972.02, outflows: 0 },
      { civilDate: "2026-09-02", inflows: 1000, outflows: 250 },
      { civilDate: "2026-09-03", inflows: 0, outflows: 0 },
    ],
    todayPredicted: { inflows: 26540.28, outflows: 51523.12 },
    ...over,
  };
}

function day(res: ReturnType<typeof resolveTreasuryDailyBalanceAuthority>, d: string): TreasuryDailyBalanceAuthorityDay {
  const found = res.byCivilDate.get(d);
  assert.ok(found, `dia ${d} precisa existir na autoridade`);
  return found;
}

function assertIdentity(d: TreasuryDailyBalanceAuthorityDay) {
  assert.ok(d.opening != null && d.closingCalculated != null, `${d.civilDate}: opening/closingCalculated`);
  const expected = Math.round((d.opening! + d.inflows + d.predictedInflows - d.outflows - d.predictedOutflows) * 100) / 100;
  assert.equal(d.closingCalculated, expected, `${d.civilDate}: Começou + Entrou − Saiu = Terminou calculado`);
  assert.equal(d.closingEffective, d.closingInformed ?? d.closingCalculated, `${d.civilDate}: efetivo = informado ?? calculado`);
}

// ── Cobertura parcial NUNCA ancora ──────────────────────────────────────────

describe("autoridade de saldos — subtotal parcial nunca vira consolidado", () => {
  it("(1) 3 contas esperadas, só 2 com fechamento manual (caso 02/09) → NÃO ancora; subtotal fica só na auditoria", () => {
    const res = resolveTreasuryDailyBalanceAuthority(
      base({ manualClosings: [closing("acc-vk", "2026-09-02", 125699.11), closing("acc-vl", "2026-09-02", 1844.22)] })
    );
    const d2 = day(res, "2026-09-02");
    assert.equal(d2.closingCoverage.accountsExpected, 3);
    assert.equal(d2.closingCoverage.accountsCovered, 2);
    assert.equal(d2.closingCoverage.complete, false);
    assert.equal(d2.closingCoverage.partialSum, 127543.33);
    assert.deepEqual(d2.closingCoverage.pendingAccounts.map((a) => a.accountName), ["Sisprime - Koppetel"]);
    assert.equal(d2.closingInformed, null, "subtotal 127.543,33 não pode virar closingInformed");
    assert.equal(d2.closingSource, "CALCULATED");
    assert.equal(d2.closingEffective, d2.closingCalculated);
    assert.equal(d2.divergence, null);
    assert.ok(d2.warnings.some((w) => w.code === "PARTIAL_CLOSING_COVERAGE"));
    // (5)/(6) metadata das contas informadas preservada
    const informed = d2.closingCoverage.accounts.filter((a) => a.source === "MANUAL_CLOSING");
    assert.deepEqual(informed.map((a) => [a.accountId, a.amount]), [["acc-vk", 125699.11], ["acc-vl", 1844.22]]);
  });

  it("(2) só 1 conta com fechamento manual (caso 03/09 — Sisprime 271.077,10) → NÃO ancora", () => {
    const res = resolveTreasuryDailyBalanceAuthority(
      base({ manualClosings: [closing("acc-sk", "2026-09-03", 271077.1)] })
    );
    const d3 = day(res, "2026-09-03");
    assert.equal(d3.closingCoverage.accountsCovered, 1);
    assert.equal(d3.closingCoverage.complete, false);
    assert.equal(d3.closingInformed, null);
    assert.notEqual(d3.closingEffective, 271077.1, "saldo de UMA conta jamais é o consolidado");
    assert.equal(d3.closingCoverage.partialSum, 271077.1);
  });

  it("(4) manual de uma conta jamais é interpretado como consolidado, mesmo quando é a única conta esperada COM saldo e as outras existem", () => {
    const res = resolveTreasuryDailyBalanceAuthority(
      base({ manualClosings: [closing("acc-vk", "2026-09-01", 100)] })
    );
    const d1 = day(res, "2026-09-01");
    assert.equal(d1.closingEffective, d1.closingCalculated);
    assert.equal(d1.closingInformed, null);
  });

  it("(3) 3/3 contas com fechamento manual → soma ancora, divergência = informado − calculado, dia seguinte abre no informado", () => {
    const res = resolveTreasuryDailyBalanceAuthority(
      base({
        manualClosings: [
          closing("acc-vk", "2026-09-02", 125699.11),
          closing("acc-vl", "2026-09-02", 1844.22),
          closing("acc-sk", "2026-09-02", 271077.1),
        ],
      })
    );
    const d2 = day(res, "2026-09-02");
    assert.equal(d2.closingCoverage.complete, true);
    assert.equal(d2.closingCoverage.partialSum, null);
    assert.equal(d2.closingInformed, 398620.43);
    assert.equal(d2.closingSource, "MANUAL_CLOSING");
    assert.equal(d2.closingEffective, 398620.43);
    assert.equal(d2.divergenceBaseline, "CALCULATED");
    assert.equal(d2.divergence, Math.round((398620.43 - d2.closingCalculated!) * 100) / 100);
    const d3 = day(res, "2026-09-03");
    assert.equal(d3.previousEffectiveClosing, 398620.43);
    assert.equal(d3.opening, 398620.43);
    assert.equal(d3.openingSource, "PREVIOUS_CLOSING");
  });

  it("(9) fechamento efetivo CALCULADO de D alimenta a abertura de D+1 (sem manual)", () => {
    const res = resolveTreasuryDailyBalanceAuthority(base());
    const d1 = day(res, "2026-09-01");
    const d2 = day(res, "2026-09-02");
    assert.equal(d2.opening, d1.closingEffective);
    assert.equal(d2.openingSource, "PREVIOUS_CLOSING");
  });
});

// ── Abertura manual ─────────────────────────────────────────────────────────

describe("autoridade de saldos — abertura manual", () => {
  it("(7) abertura manual 3/3 altera Começou e (11) openingAdjustment registra a diferença contra o fechamento efetivo anterior", () => {
    const res = resolveTreasuryDailyBalanceAuthority(
      base({
        manualOpenings: [opening("acc-vk", "2026-09-02", 100000), opening("acc-vl", "2026-09-02", 2000), opening("acc-sk", "2026-09-02", 300000)],
      })
    );
    const d1 = day(res, "2026-09-01");
    const d2 = day(res, "2026-09-02");
    assert.equal(d2.openingCoverage.complete, true);
    assert.equal(d2.openingManual, 402000);
    assert.equal(d2.opening, 402000);
    assert.equal(d2.openingSource, "MANUAL_OPENING");
    assert.equal(d2.previousEffectiveClosing, d1.closingEffective);
    assert.equal(d2.openingAdjustment, Math.round((402000 - d1.closingEffective!) * 100) / 100);
    assert.ok(d2.warnings.some((w) => w.code === "OPENING_ADJUSTMENT"));
    assertIdentity(d2);
  });

  it("(8) abertura manual parcial (2/3) NÃO vira abertura consolidada — Começou segue o fechamento anterior", () => {
    const res = resolveTreasuryDailyBalanceAuthority(
      base({ manualOpenings: [opening("acc-vk", "2026-09-02", 100000), opening("acc-vl", "2026-09-02", 2000)] })
    );
    const d1 = day(res, "2026-09-01");
    const d2 = day(res, "2026-09-02");
    assert.equal(d2.openingCoverage.complete, false);
    assert.equal(d2.openingCoverage.partialSum, 102000);
    assert.equal(d2.openingManual, null);
    assert.equal(d2.opening, d1.closingEffective);
    assert.equal(d2.openingSource, "PREVIOUS_CLOSING");
    assert.equal(d2.openingAdjustment, null);
    assert.ok(d2.warnings.some((w) => w.code === "PARTIAL_OPENING_COVERAGE"));
  });

  it("(10) abertura manual completa em D+1 prevalece sobre o fechamento manual completo de D", () => {
    const res = resolveTreasuryDailyBalanceAuthority(
      base({
        manualClosings: [closing("acc-vk", "2026-09-01", 10), closing("acc-vl", "2026-09-01", 20), closing("acc-sk", "2026-09-01", 30)],
        manualOpenings: [opening("acc-vk", "2026-09-02", 100), opening("acc-vl", "2026-09-02", 200), opening("acc-sk", "2026-09-02", 300)],
      })
    );
    const d1 = day(res, "2026-09-01");
    const d2 = day(res, "2026-09-02");
    assert.equal(d1.closingEffective, 60);
    assert.equal(d2.opening, 600);
    assert.equal(d2.openingAdjustment, 540);
  });

  it("abertura manual NÃO é usada como fechamento do próprio dia (não inventar saldo)", () => {
    const res = resolveTreasuryDailyBalanceAuthority(
      base({ manualOpenings: [opening("acc-vk", "2026-09-02", 1), opening("acc-vl", "2026-09-02", 2), opening("acc-sk", "2026-09-02", 3)] })
    );
    const d2 = day(res, "2026-09-02");
    assert.equal(d2.closingCoverage.accountsCovered, 0, "abertura não é evidência de fechamento");
    assert.equal(d2.closingInformed, null);
    assert.equal(d2.closingEffective, d2.closingCalculated);
  });
});

// ── Gênese e dias sem contas ────────────────────────────────────────────────

describe("autoridade de saldos — gênese e universo vazio", () => {
  it("primeiro dia da gênese sem predecessor abre em 0 com openingSource GENESIS", () => {
    const res = resolveTreasuryDailyBalanceAuthority(
      base({ civilDates: ["2026-01-01", "2026-01-02"], flows: [{ civilDate: "2026-01-01", inflows: 50, outflows: 0 }] })
    );
    const g = day(res, "2026-01-01");
    assert.equal(g.opening, 0);
    assert.equal(g.openingSource, "GENESIS");
    assert.equal(g.previousEffectiveClosing, null);
    assert.equal(g.closingEffective, 50);
    assert.equal(day(res, "2026-01-02").opening, 50);
  });

  it("dia sem nenhuma conta esperada → nenhuma âncora possível, mesmo com snapshots soltos", () => {
    const res = resolveTreasuryDailyBalanceAuthority(
      base({ accounts: [], manualClosings: [closing("acc-vk", "2026-09-02", 999)] })
    );
    const d2 = day(res, "2026-09-02");
    assert.equal(d2.closingCoverage.accountsExpected, 0);
    assert.equal(d2.closingCoverage.complete, false);
    assert.equal(d2.closingInformed, null);
    assert.ok(d2.warnings.some((w) => w.code === "NO_EXPECTED_ACCOUNTS"));
  });

  it("(28) conta fora do consolidado (sem membership) nunca entra no total nem na contagem", () => {
    const OUT: TreasuryConsolidatedAccountMembershipView = { ...SK, accountId: "acc-out", accountName: "Aplicação", memberships: [] };
    const res = resolveTreasuryDailyBalanceAuthority(
      base({
        accounts: [VK, VL, OUT],
        manualClosings: [closing("acc-vk", "2026-09-02", 10), closing("acc-vl", "2026-09-02", 20), closing("acc-out", "2026-09-02", 1000)],
      })
    );
    const d2 = day(res, "2026-09-02");
    assert.equal(d2.closingCoverage.accountsExpected, 2);
    assert.equal(d2.closingCoverage.complete, true);
    assert.equal(d2.closingInformed, 30);
  });

  it("(29) conta inativa fora do intervalo válido não contamina a série", () => {
    const SK_OLD: TreasuryConsolidatedAccountMembershipView = { ...SK, memberships: [{ validFrom: "2026-01-01", validUntil: "2026-08-31" }] };
    const res = resolveTreasuryDailyBalanceAuthority(
      base({
        accounts: [VK, VL, SK_OLD],
        manualClosings: [closing("acc-vk", "2026-09-02", 10), closing("acc-vl", "2026-09-02", 20), closing("acc-sk", "2026-09-02", 5000)],
      })
    );
    const d2 = day(res, "2026-09-02");
    assert.equal(d2.closingCoverage.accountsExpected, 2);
    assert.equal(d2.closingInformed, 30, "saldo da conta fora do intervalo não soma");
  });
});

// ── Fechamento formal por companyCode ───────────────────────────────────────

describe("autoridade de saldos — fechamento formal por empresa", () => {
  it("(15) CLOSED de KOPPETEL não fecha LAZARIOS: cobertura fica parcial e não ancora", () => {
    const res = resolveTreasuryDailyBalanceAuthority(
      base({ formalClosings: [{ companyCode: "KOPPETEL", civilDate: "2026-09-02", observedBalance: 396776.21, openingBalance: null, closedAt: null, version: 1 }] })
    );
    const d2 = day(res, "2026-09-02");
    const formal = d2.closingCoverage.accounts.filter((a) => a.source === "FORMAL_CLOSING");
    assert.deepEqual(formal.map((a) => a.accountId).sort(), ["acc-sk", "acc-vk"]);
    assert.equal(d2.closingCoverage.accountsCovered, 2);
    assert.equal(d2.closingCoverage.complete, false);
    assert.deepEqual(d2.closingCoverage.pendingAccounts.map((a) => a.accountId), ["acc-vl"]);
    assert.equal(d2.closingInformed, null);
  });

  it("(16) formal de KOPPETEL + manual de LAZARIOS consolidam corretamente (formal + manual)", () => {
    const res = resolveTreasuryDailyBalanceAuthority(
      base({
        formalClosings: [{ companyCode: "KOPPETEL", civilDate: "2026-09-02", observedBalance: 396776.21, openingBalance: null, closedAt: "2026-09-02T22:00:00.000Z", version: 2 }],
        manualClosings: [closing("acc-vl", "2026-09-02", 1844.22)],
      })
    );
    const d2 = day(res, "2026-09-02");
    assert.equal(d2.closingCoverage.complete, true);
    assert.equal(d2.closingInformed, 398620.43);
    assert.equal(d2.closingSource, "FORMAL_CLOSING");
  });

  it("(14) formal CLOSED das duas empresas → consolidado = soma dos observados, sem manual", () => {
    const res = resolveTreasuryDailyBalanceAuthority(
      base({
        formalClosings: [
          { companyCode: "KOPPETEL", civilDate: "2026-09-02", observedBalance: 300, openingBalance: null, closedAt: null, version: 1 },
          { companyCode: "LAZARIOS", civilDate: "2026-09-02", observedBalance: 45, openingBalance: null, closedAt: null, version: 1 },
        ],
      })
    );
    const d2 = day(res, "2026-09-02");
    assert.equal(d2.closingInformed, 345);
    assert.equal(d2.closingCoverage.accountsCovered, 3);
  });

  it("formal CLOSED de uma empresa que não tem conta esperada no dia é ignorada com aviso", () => {
    const res = resolveTreasuryDailyBalanceAuthority(
      base({ formalClosings: [{ companyCode: "OUTRA", civilDate: "2026-09-02", observedBalance: 1, openingBalance: null, closedAt: null, version: 1 }] })
    );
    const d2 = day(res, "2026-09-02");
    assert.equal(d2.closingCoverage.accountsCovered, 0);
    assert.ok(d2.warnings.some((w) => w.code === "FORMAL_CLOSING_OTHER_COMPANY_IGNORED"));
  });
});

// ── Snapshot genérico ───────────────────────────────────────────────────────

describe("autoridade de saldos — snapshot genérico (tela 'Saldo')", () => {
  it("(20) política CLOSING_EVIDENCE: genérico vale como fechamento da conta no dia, com source GENERIC_MANUAL", () => {
    const res = resolveTreasuryDailyBalanceAuthority(
      base({
        manualClosings: [closing("acc-vk", "2026-09-02", 10), closing("acc-vl", "2026-09-02", 20)],
        genericSnapshots: [closing("acc-sk", "2026-09-02", 30)],
      })
    );
    const d2 = day(res, "2026-09-02");
    assert.equal(d2.closingCoverage.complete, true);
    assert.equal(d2.closingInformed, 60);
    assert.equal(d2.closingCoverage.accounts.find((a) => a.accountId === "acc-sk")?.source, "GENERIC_MANUAL");
  });

  it("(20) política IGNORE: genérico não conta e o dia avisa GENERIC_SNAPSHOT_IGNORED", () => {
    const res = resolveTreasuryDailyBalanceAuthority(
      base({
        genericSnapshotPolicy: "IGNORE",
        manualClosings: [closing("acc-vk", "2026-09-02", 10), closing("acc-vl", "2026-09-02", 20)],
        genericSnapshots: [closing("acc-sk", "2026-09-02", 30)],
      })
    );
    const d2 = day(res, "2026-09-02");
    assert.equal(d2.closingCoverage.complete, false);
    assert.ok(d2.warnings.some((w) => w.code === "GENERIC_SNAPSHOT_IGNORED"));
  });

  it("rotina 'daily-closing-bank' tem precedência sobre o genérico da mesma conta no mesmo dia", () => {
    const res = resolveTreasuryDailyBalanceAuthority(
      base({
        manualClosings: [closing("acc-vk", "2026-09-02", 10), closing("acc-vl", "2026-09-02", 20), closing("acc-sk", "2026-09-02", 30)],
        genericSnapshots: [closing("acc-sk", "2026-09-02", 999)],
      })
    );
    assert.equal(day(res, "2026-09-02").closingInformed, 60);
  });
});

// ── HOJE pela mesma autoridade ──────────────────────────────────────────────

describe("autoridade de saldos — HOJE (regra D+1) pela mesma autoridade", () => {
  it("(17) TODAY: calculado inclui previsto, realizado não; divergência contra o REALIZADO e declarada", () => {
    const res = resolveTreasuryDailyBalanceAuthority(
      base({
        manualClosings: [closing("acc-vk", T, 100), closing("acc-vl", T, 200), closing("acc-sk", T, 300)],
      })
    );
    const d3 = day(res, T);
    assert.equal(d3.kind, "TODAY");
    assert.equal(d3.predictedInflows, 26540.28);
    assert.equal(d3.predictedOutflows, 51523.12);
    assert.equal(d3.closingRealized, Math.round((d3.opening! + 0 - 0) * 100) / 100);
    assert.equal(d3.closingCalculated, Math.round((d3.closingRealized! + 26540.28 - 51523.12) * 100) / 100);
    assert.equal(d3.divergenceBaseline, "REALIZED");
    assert.equal(d3.divergence, Math.round((600 - d3.closingRealized!) * 100) / 100);
    assert.equal(d3.closingEffective, 600);
    assertIdentity(d3);
    // (26) as colunas exibidas fecham: opening + (realizado+previsto) − (realizado+previsto) = calculado
  });

  it("(17) TODAY sem manual: efetivo = projetado fim do dia (âncora da cadeia futura), divergência null", () => {
    const res = resolveTreasuryDailyBalanceAuthority(base());
    const d3 = day(res, T);
    assert.equal(d3.closingInformed, null);
    assert.equal(d3.closingEffective, d3.closingCalculated);
    assert.equal(d3.divergence, null);
    assert.equal(d3.divergenceBaseline, "REALIZED");
  });

  it("(18) o mesmo dia resolvido como passado (hoje = D+1) mantém opening e closingRealized; só kind/previsto mudam", () => {
    const fixture = base({
      civilDates: ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"],
      flows: [
        { civilDate: "2026-09-01", inflows: 494972.02, outflows: 0 },
        { civilDate: "2026-09-02", inflows: 1000, outflows: 250 },
        { civilDate: "2026-09-03", inflows: 700, outflows: 100 },
        { civilDate: "2026-09-04", inflows: 0, outflows: 0 },
      ],
    });
    const asToday = day(resolveTreasuryDailyBalanceAuthority({ ...fixture, todayCivilDate: "2026-09-03" }), "2026-09-03");
    const asPast = day(resolveTreasuryDailyBalanceAuthority({ ...fixture, todayCivilDate: "2026-09-04", todayPredicted: null }), "2026-09-03");
    assert.equal(asToday.kind, "TODAY");
    assert.equal(asPast.kind, "REALIZED");
    assert.equal(asPast.opening, asToday.opening);
    assert.equal(asPast.closingRealized, asToday.closingRealized);
    assert.equal(asPast.predictedInflows, 0);
    assert.equal(asPast.closingCalculated, asPast.closingRealized);
    assert.equal(asPast.divergenceBaseline, "CALCULATED");
  });

  it("(25) identidade Começou + Entrou − Saiu = Terminou calculado em toda linha realizada", () => {
    const res = resolveTreasuryDailyBalanceAuthority(
      base({ manualClosings: [closing("acc-vk", "2026-09-01", 1), closing("acc-vl", "2026-09-01", 2), closing("acc-sk", "2026-09-01", 3)] })
    );
    for (const d of res.days) assertIdentity(d);
    assert.equal(day(res, "2026-09-02").opening, 6, "dia seguinte abre no informado, e a identidade vale a partir dali");
  });

  it("(30) ampliar a lista de dias resolvidos não muda os saldos dos dias em comum", () => {
    const narrow = resolveTreasuryDailyBalanceAuthority(base());
    const wide = resolveTreasuryDailyBalanceAuthority(
      base({
        civilDates: ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03"],
        flows: [{ civilDate: "2026-08-31", inflows: 0, outflows: 0 }, ...base().flows],
      })
    );
    for (const d of ["2026-09-01", "2026-09-02", "2026-09-03"]) {
      assert.equal(day(wide, d).opening, day(narrow, d).opening, d);
      assert.equal(day(wide, d).closingEffective, day(narrow, d).closingEffective, d);
    }
  });
});
