/**
 * RED — `composeTreasuryCaixaBalanceAuthority` (Tesouraria › Caixa).
 *
 * Prova que a composição PURA que junta universo de contas + evidências +
 * fluxos entrega exatamente o que `getBoard()` publica, sem I/O e sem
 * recalcular saldo por fora da autoridade única
 * (`resolveTreasuryDailyBalanceAuthority`). Fixa os defeitos observados em
 * produção (02/09 e 03/09/2026 — RC4/RC5 do diagnóstico prévio):
 *
 *  - RC4: a abertura do primeiro dia da JANELA EXIBIDA precisa vir do
 *    fechamento efetivo do dia anterior na CADEIA INTEIRA, mesmo quando esse
 *    dia anterior não aparece nos `realizedDays` recortados pelo período.
 *  - RC5: um subtotal de 2/3 (ou 1/3) das contas esperadas NUNCA vira saldo
 *    consolidado nem ancora o "Caixa hoje" — nem nos dias passados
 *    (`realizedDays`), nem em `officialTodayBalance`.
 *
 * Roda com: node --import tsx --test src/lib/treasury/services/treasuryCaixaServiceBalanceAuthority.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  composeTreasuryCaixaBalanceAuthority,
  type TreasuryCaixaBalanceAuthorityComposeInput,
} from "./treasuryCaixaService.server.js";
import {
  buildTreasuryCaixaRealizedDays,
  TREASURY_CAIXA_GENESIS_CIVIL_DATE,
  type TreasuryCaixaRealizedDay,
} from "../domain/treasuryCaixaRules.js";
import type { TreasuryConsolidatedAccountMembershipView } from "../domain/treasuryDailyBalanceAuthority.js";
import type { TreasuryConsolidatedAccountUniverse } from "./treasuryConsolidatedAccountUniverse.server.js";
import type {
  TreasuryAccountLatestPosition,
  TreasuryDailyBalanceEvidence,
} from "./treasuryDailyBalanceEvidence.server.js";

// ── Fixtures — mesmas contas reais do caso (02/09 e 03/09/2026) ────────────

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

const UNIVERSE: TreasuryConsolidatedAccountUniverse = {
  accounts: [VK, VL, SK],
  companyCodes: ["KOPPETEL", "LAZARIOS"],
  warnings: [],
};

const EMPTY_EVIDENCE: TreasuryDailyBalanceEvidence = {
  manualOpenings: [],
  manualClosings: [],
  genericSnapshots: [],
  formalClosings: [],
  latestPositions: [],
};

const T = "2026-09-03";

function manualClosing(accountId: string, civilDate: string, amount: number) {
  return {
    accountId,
    civilDate,
    amount,
    informedAt: `${civilDate}T20:00:00.000Z`,
    version: 1,
  };
}

/** Dia CRU (saída de `buildTreasuryCaixaRealizedDays`, antes do running balance). */
function rawDay(
  civilDate: string,
  inflows: number,
  outflows: number
): TreasuryCaixaRealizedDay {
  return {
    civilDate,
    inflows,
    outflows,
    receivableCount: inflows > 0 ? 1 : 0,
    payableCount: outflows > 0 ? 1 : 0,
    opening: null,
    closing: null,
    closingCalculated: null,
    closingInformed: null,
    divergence: null,
  };
}

function baseInput(
  over: Partial<TreasuryCaixaBalanceAuthorityComposeInput> = {}
): TreasuryCaixaBalanceAuthorityComposeInput {
  return {
    universe: UNIVERSE,
    evidence: EMPTY_EVIDENCE,
    realizedDaysAll: [],
    todayCivilDate: T,
    periodFrom: "2026-09-01",
    periodTo: T,
    todayRealized: { inflows: 0, outflows: 0 },
    todayPredicted: { inflows: 0, outflows: 0 },
    genesisCivilDate: TREASURY_CAIXA_GENESIS_CIVIL_DATE,
    genericSnapshotPolicy: "CLOSING_EVIDENCE",
    ...over,
  };
}

// ── (1) Janela: só dias < hoje E dentro de [periodFrom, periodTo] ──────────

describe("composeTreasuryCaixaBalanceAuthority — recorte da janela exibida", () => {
  it("(1) realizedDays só contém dias < hoje E dentro de [periodFrom, periodTo]", () => {
    const realizedDaysAll = buildTreasuryCaixaRealizedDays({
      receivables: [
        { settlementDate: "2026-08-30", amountReceived: 100 }, // antes do período
        { settlementDate: "2026-09-01", amountReceived: 200 }, // dentro
        { settlementDate: "2026-09-02", amountReceived: 150 }, // dentro
        { settlementDate: T, amountReceived: 999 }, // == hoje, excluído
        { settlementDate: "2026-09-05", amountReceived: 10 }, // depois de hoje
      ],
      payables: [],
    });

    const result = composeTreasuryCaixaBalanceAuthority(
      baseInput({
        realizedDaysAll,
        periodFrom: "2026-09-01",
        periodTo: "2026-09-02",
      })
    );

    assert.deepEqual(
      result.realizedDays.map((d) => d.civilDate),
      ["2026-09-01", "2026-09-02"]
    );
  });

  it("(2) cada item de realizedDays tem cobertura/proveniência preenchidas (não undefined)", () => {
    const result = composeTreasuryCaixaBalanceAuthority(
      baseInput({
        realizedDaysAll: [
          rawDay("2026-09-01", 300, 50),
          rawDay("2026-09-02", 120, 40),
        ],
        manualClosings: [manualClosing("acc-vk", "2026-09-01", 10)],
        periodFrom: "2026-09-01",
        periodTo: "2026-09-02",
      })
    );

    assert.ok(result.realizedDays.length > 0, "fixture precisa produzir dias");
    for (const d of result.realizedDays) {
      assert.notEqual(d.closingCoverage, undefined, `${d.civilDate}: closingCoverage`);
      assert.notEqual(d.openingCoverage, undefined, `${d.civilDate}: openingCoverage`);
      assert.notEqual(d.openingSource, undefined, `${d.civilDate}: openingSource`);
      assert.notEqual(d.closingSource, undefined, `${d.civilDate}: closingSource`);
      assert.notEqual(d.divergenceBaseline, undefined, `${d.civilDate}: divergenceBaseline`);
    }
  });
});

// ── (3) todayBalance é a mesma autoridade de HOJE ───────────────────────────

describe("composeTreasuryCaixaBalanceAuthority — todayBalance", () => {
  it("(3) todayBalance tem os mesmos valores que authority.byCivilDate.get(todayCivilDate)", () => {
    const result = composeTreasuryCaixaBalanceAuthority(
      baseInput({
        realizedDaysAll: [
          rawDay("2026-09-01", 100, 0),
          rawDay("2026-09-02", 50, 10),
        ],
        todayRealized: { inflows: 0, outflows: 0 },
        todayPredicted: { inflows: 100, outflows: 50 },
      })
    );

    const fromAuthority = result.authority.byCivilDate.get(T);
    assert.ok(fromAuthority, "hoje precisa existir na autoridade resolvida");
    assert.deepEqual(result.todayBalance, fromAuthority);
  });
});

// ── (4) RC4: abertura antes da janela usa a CADEIA INTEIRA, não o recorte ──

describe("composeTreasuryCaixaBalanceAuthority — RC4 (abertura antes da janela)", () => {
  it("(4) openingBalanceBefore(hoje) retorna o closingEffective de ontem, mesmo com a janela começando hoje", () => {
    const result = composeTreasuryCaixaBalanceAuthority(
      baseInput({
        realizedDaysAll: [
          rawDay("2026-09-01", 200, 0),
          rawDay("2026-09-02", 100, 20),
        ],
        // Janela exibida começa HOJE — 02/09 não deve aparecer em realizedDays.
        periodFrom: T,
        periodTo: T,
      })
    );

    assert.deepEqual(
      result.realizedDays.map((d) => d.civilDate),
      [],
      "com periodFrom = hoje, realizedDays fica vazio (nada é < hoje dentro da janela)"
    );

    const ontem = result.authority.byCivilDate.get("2026-09-02");
    assert.ok(ontem, "02/09 precisa existir na cadeia resolvida (fora da janela exibida)");
    assert.notEqual(ontem!.closingEffective, null, "02/09 tem fechamento efetivo (calculado, mesmo sem manual)");

    const opening = result.openingBalanceBefore(T);
    assert.notEqual(opening, null, "RC4: abertura antes de hoje não pode ficar null só porque 02/09 saiu da janela exibida");
    assert.equal(opening, ontem!.closingEffective);
  });
});

// ── (5) RC5: subtotal 2/3 nunca ancora — nem no passado, nem em hoje ───────

describe("composeTreasuryCaixaBalanceAuthority — RC5 (subtotal 2/3 nunca ancora)", () => {
  it("(5) Sisprime não informou 01/09 nem 02/09 (mas é esperada) → nenhum dos dois tem closingInformed; hoje segue a mesma regra", () => {
    const result = composeTreasuryCaixaBalanceAuthority(
      baseInput({
        realizedDaysAll: [
          rawDay("2026-09-01", 494972.02, 0),
          rawDay("2026-09-02", 1000, 250),
        ],
        manualClosings: [
          // Só Viacredi-K e Viacredi-L informam; Sisprime nunca informa,
          // nos três dias (mesmo padrão do bug real de produção).
          manualClosing("acc-vk", "2026-09-01", 125699.11),
          manualClosing("acc-vl", "2026-09-01", 1844.22),
          manualClosing("acc-vk", "2026-09-02", 126000),
          manualClosing("acc-vl", "2026-09-02", 1900),
          manualClosing("acc-vk", T, 126500),
          manualClosing("acc-vl", T, 1950),
        ],
        periodFrom: "2026-09-01",
        periodTo: "2026-09-02",
      })
    );

    assert.equal(result.realizedDays.length, 2);
    for (const d of result.realizedDays) {
      assert.equal(
        d.closingInformed,
        null,
        `${d.civilDate}: subtotal de 2/3 das contas (falta Sisprime) não pode virar closingInformed`
      );
      assert.equal(d.closingCoverage?.complete, false, `${d.civilDate}: cobertura incompleta`);
    }

    // A mesma regra de não-ancoragem vale para HOJE.
    assert.equal(
      result.officialTodayBalance.amount,
      null,
      "hoje também tem só 2/3 das contas — não pode ancorar o Caixa hoje"
    );
  });
});

// ── (6) officialTodayBalance: null com cobertura parcial, ancora só com 3/3 ─

describe("composeTreasuryCaixaBalanceAuthority — officialTodayBalance", () => {
  it("(6a) cobertura parcial de hoje (2/3) → amount null e source NONE (nunca ancora subtotal)", () => {
    const result = composeTreasuryCaixaBalanceAuthority(
      baseInput({
        manualClosings: [
          manualClosing("acc-vk", T, 100),
          manualClosing("acc-vl", T, 200),
          // acc-sk não informou.
        ],
      })
    );

    assert.equal(result.officialTodayBalance.amount, null);
    assert.equal(result.officialTodayBalance.source, "NONE");
  });

  it("(6b) cobertura completa de hoje (3/3) → amount = soma e source diferente de NONE", () => {
    const result = composeTreasuryCaixaBalanceAuthority(
      baseInput({
        manualClosings: [
          manualClosing("acc-vk", T, 100),
          manualClosing("acc-vl", T, 200),
          manualClosing("acc-sk", T, 300),
        ],
      })
    );

    assert.equal(result.officialTodayBalance.amount, 600);
    assert.notEqual(result.officialTodayBalance.source, "NONE");
  });
});

// ── (7) Sem evidência de hoje, mas com latestPositions: nunca vira âncora ──

describe("composeTreasuryCaixaBalanceAuthority — latestPosition nunca ancora", () => {
  it("(7) sem nenhuma evidência de hoje, com latestPositions em datas variadas → source NONE mas latestPosition preenchido", () => {
    const latestPositions: readonly TreasuryAccountLatestPosition[] = [
      { accountId: "acc-vk", amount: 1000, referenceAt: "2026-09-03T10:00:00.000Z", civilDate: T, origin: "NOMUS" },
      { accountId: "acc-vl", amount: 500, referenceAt: "2026-09-02T18:00:00.000Z", civilDate: "2026-09-02", origin: "NOMUS" },
      { accountId: "acc-sk", amount: 2000, referenceAt: "2026-08-30T09:00:00.000Z", civilDate: "2026-08-30", origin: "MANUAL" },
    ];

    const result = composeTreasuryCaixaBalanceAuthority(
      baseInput({
        evidence: { ...EMPTY_EVIDENCE, latestPositions },
      })
    );

    assert.equal(result.officialTodayBalance.amount, null);
    assert.equal(result.officialTodayBalance.source, "NONE");
    assert.notEqual(
      result.officialTodayBalance.latestPosition,
      null,
      "posição mais recente é informativa e precisa aparecer mesmo sem ancorar"
    );
    assert.notEqual(result.officialTodayBalance.latestPosition, undefined);
  });
});

// ── (8)/(30) Recorte de período não pode mudar os saldos dos dias em comum ─

describe("composeTreasuryCaixaBalanceAuthority — período não altera saldos já resolvidos", () => {
  it("(8) resolver o mesmo fixture com periodFrom/periodTo diferentes não muda opening/closingEffective de 01/09 e 02/09", () => {
    const fixture = baseInput({
      realizedDaysAll: [
        rawDay("2026-09-01", 300, 50),
        rawDay("2026-09-02", 120, 40),
      ],
      manualClosings: [
        manualClosing("acc-vk", "2026-09-01", 10),
        manualClosing("acc-vl", "2026-09-01", 20),
        manualClosing("acc-sk", "2026-09-01", 30),
      ],
    });

    const onlySeptember = composeTreasuryCaixaBalanceAuthority({
      ...fixture,
      periodFrom: "2026-09-01",
      periodTo: "2026-09-30",
    });
    const wholeYear = composeTreasuryCaixaBalanceAuthority({
      ...fixture,
      periodFrom: "2026-01-01",
      periodTo: "2026-12-31",
    });

    for (const civilDate of ["2026-09-01", "2026-09-02"]) {
      const a = onlySeptember.realizedDays.find((d) => d.civilDate === civilDate);
      const b = wholeYear.realizedDays.find((d) => d.civilDate === civilDate);
      assert.ok(a, `${civilDate} precisa existir no recorte de setembro`);
      assert.ok(b, `${civilDate} precisa existir no recorte do ano inteiro`);
      assert.equal(a!.opening, b!.opening, `${civilDate}: opening`);
      assert.equal(a!.closing, b!.closing, `${civilDate}: closingEffective (campo 'closing')`);
    }
  });
});

// ── (9) accountPositions: isToday/civilDate derivados de evidence ──────────

describe("composeTreasuryCaixaBalanceAuthority — accountPositions", () => {
  it("(9) accountPositions reflete isToday e civilDate de evidence.latestPositions", () => {
    const latestPositions: readonly TreasuryAccountLatestPosition[] = [
      { accountId: "acc-vk", amount: 1000, referenceAt: "2026-09-03T10:00:00.000Z", civilDate: T, origin: "NOMUS" },
      { accountId: "acc-vl", amount: 500, referenceAt: "2026-09-02T18:00:00.000Z", civilDate: "2026-09-02", origin: "NOMUS" },
      { accountId: "acc-sk", amount: 2000, referenceAt: "2026-09-01T09:00:00.000Z", civilDate: "2026-09-01", origin: "MANUAL" },
    ];

    const result = composeTreasuryCaixaBalanceAuthority(
      baseInput({
        evidence: { ...EMPTY_EVIDENCE, latestPositions },
      })
    );

    assert.ok(result.accountPositions, "accountPositions precisa ser publicado");
    assert.equal(result.accountPositions.length, 3);

    const vk = result.accountPositions.find((p) => p.accountId === "acc-vk");
    const vl = result.accountPositions.find((p) => p.accountId === "acc-vl");
    const sk = result.accountPositions.find((p) => p.accountId === "acc-sk");

    assert.ok(vk && vl && sk, "as três posições precisam estar presentes");
    assert.equal(vk!.civilDate, T);
    assert.equal(vk!.isToday, true, "posição de hoje: isToday true");
    assert.equal(vl!.civilDate, "2026-09-02");
    assert.equal(vl!.isToday, false, "posição de ontem: isToday false");
    assert.equal(sk!.civilDate, "2026-09-01");
    assert.equal(sk!.isToday, false, "posição de dois dias atrás: isToday false");

    // Nome/empresa vêm do universo consolidado, não da evidência crua.
    assert.equal(vk!.accountName, "Viacredi - Koppetel");
    assert.equal(vk!.companyCode, "KOPPETEL");
  });
});
