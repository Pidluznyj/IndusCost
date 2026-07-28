/**
 * Testes — domínio da projeção simples de risco de caixa.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TreasuryAgendaDayDto } from "../contracts/treasuryDto.js";
import {
  buildTreasurySimpleCashRiskDayDetail,
  buildTreasurySimpleCashRiskSummary,
  computeSurplusPercentOverReserve,
  computeTreasurySimpleCashRiskReserveIndicator,
  periodDaysForTreasurySimpleCashRisk,
  resolveTreasurySimpleCashRiskReserve,
  TREASURY_SIMPLE_CASH_RISK_SCENARIO_LABELS,
  TREASURY_SIMPLE_CASH_RISK_UI_PATH,
} from "./treasurySimpleCashRiskProjectionRules.js";
import { addCivilDays } from "../treasuryAgendaUi.js";
import { findFirstNegativeCivilDate } from "./treasuryProjectionComparisonRules.js";

function day(
  partial: Partial<TreasuryAgendaDayDto> & { civilDate: string }
): TreasuryAgendaDayDto {
  return {
    civilDate: partial.civilDate,
    accountId: null,
    accountCode: null,
    accountName: null,
    openingBalance: partial.openingBalance ?? "100.00",
    plannedInflows: partial.plannedInflows ?? "0.00",
    confirmedInflows: "0.00",
    realizedInflows: "0.00",
    plannedOutflows: partial.plannedOutflows ?? "0.00",
    programmedOutflows: "0.00",
    realizedOutflows: "0.00",
    transfers: partial.transfers ?? "0.00",
    closingBalance: partial.closingBalance ?? "100.00",
    riskAmount: "0.00",
    riskCode: "NONE",
    riskLabel: "Sem risco",
    inflows: partial.plannedInflows ?? "0.00",
    outflows: partial.plannedOutflows ?? "0.00",
    net: "0.00",
    realized: "0.00",
    itemCount: partial.items?.length ?? 0,
    items: partial.items ?? null,
    alerts: partial.alerts ?? [],
  };
}

describe("treasurySimpleCashRiskProjectionRules", () => {
  it("rota UI e linguagem de cenários (sem probabilidade estatística inventada)", () => {
    assert.equal(TREASURY_SIMPLE_CASH_RISK_UI_PATH, "/finance/treasury/projection");
    assert.match(
      TREASURY_SIMPLE_CASH_RISK_SCENARIO_LABELS.CONTRACTUAL.description,
      /datas oficiais/i
    );
    assert.match(
      TREASURY_SIMPLE_CASH_RISK_SCENARIO_LABELS.PROBABLE.description,
      /expectativas informadas/i
    );
    assert.doesNotMatch(
      TREASURY_SIMPLE_CASH_RISK_SCENARIO_LABELS.PROBABLE.description,
      /%\s*de\s*chance|probabilidade estatística/i
    );
  });

  it("timezone civil: períodos usam dias inclusivos via addCivilDays UTC", () => {
    assert.equal(periodDaysForTreasurySimpleCashRisk("7d"), 7);
    assert.equal(periodDaysForTreasurySimpleCashRisk("30d"), 30);
    assert.equal(periodDaysForTreasurySimpleCashRisk("60d"), 60);
    assert.equal(periodDaysForTreasurySimpleCashRisk("90d"), 90);
    // 7 dias inclusivos: base + 6
    assert.equal(addCivilDays("2026-07-28", 6), "2026-08-03");
    assert.equal(addCivilDays("2026-12-31", 1), "2027-01-01");
  });

  it("reserva consolidada soma minimumBalance das contas ativas incluídas", () => {
    assert.equal(
      resolveTreasurySimpleCashRiskReserve([
        {
          isActive: true,
          includeInConsolidated: true,
          minimumBalance: "100000.00",
        },
        {
          isActive: true,
          includeInConsolidated: true,
          minimumBalance: "30000.00",
        },
        {
          isActive: false,
          includeInConsolidated: true,
          minimumBalance: "999.00",
        },
        {
          isActive: true,
          includeInConsolidated: false,
          minimumBalance: "50.00",
        },
      ]),
      "130000.00"
    );
  });

  it("superávit % = excedente ÷ reserva × 100; reserva zero não aplica %", () => {
    const ok = computeTreasurySimpleCashRiskReserveIndicator({
      projectedBalance: "130000.00",
      minimumReserve: "100000.00",
    });
    assert.equal(ok.kind, "SURPLUS");
    assert.equal(ok.surplusOrShortage, "30000.00");
    assert.equal(ok.surplusPercent, "30.00");
    assert.equal(
      computeSurplusPercentOverReserve("30000.00", "100000.00"),
      "30.00"
    );

    const zero = computeTreasurySimpleCashRiskReserveIndicator({
      projectedBalance: "5000.00",
      minimumReserve: "0.00",
    });
    assert.equal(zero.kind, "NO_RESERVE");
    assert.equal(zero.surplusPercent, null);
    assert.equal(computeSurplusPercentOverReserve("100.00", "0.00"), null);

    const shortage = computeTreasurySimpleCashRiskReserveIndicator({
      projectedBalance: "80000.00",
      minimumReserve: "100000.00",
    });
    assert.equal(shortage.kind, "SHORTAGE");
    assert.equal(shortage.surplusOrShortage, "-20000.00");
    assert.equal(shortage.surplusPercent, null);
  });

  it("primeira data negativa, maior déficit e menor saldo (Decimal)", () => {
    const days = [
      day({
        civilDate: "2026-07-28",
        openingBalance: "50.00",
        plannedInflows: "10.00",
        plannedOutflows: "5.00",
        closingBalance: "55.00",
      }),
      day({
        civilDate: "2026-07-29",
        openingBalance: "55.00",
        plannedOutflows: "80.00",
        closingBalance: "-25.00",
      }),
      day({
        civilDate: "2026-07-30",
        openingBalance: "-25.00",
        plannedOutflows: "40.00",
        closingBalance: "-65.00",
      }),
      day({
        civilDate: "2026-07-31",
        openingBalance: "-65.00",
        plannedInflows: "100.00",
        closingBalance: "35.00",
      }),
    ];

    const summary = buildTreasurySimpleCashRiskSummary({
      days,
      minimumReserve: "40.00",
      scenario: "CONTRACTUAL",
    });

    assert.equal(summary.openingBalance, "50.00");
    assert.equal(summary.plannedInflows, "110.00");
    assert.equal(summary.plannedOutflows, "125.00");
    assert.equal(summary.firstNegativeDate, "2026-07-29");
    assert.equal(
      findFirstNegativeCivilDate(
        days.map((d) => ({
          civilDate: d.civilDate,
          closingBalance: d.closingBalance!,
        }))
      ),
      "2026-07-29"
    );
    assert.equal(summary.lowestBalance, "-65.00");
    assert.equal(summary.lowestBalanceDate, "2026-07-30");
    assert.equal(summary.largestDeficit, "65.00");
    assert.equal(summary.largestDeficitDate, "2026-07-30");
    assert.equal(summary.firstDayBelowReserve, "2026-07-29");
    assert.equal(summary.largestSurplusVsReserve, "15.00");
    assert.equal(summary.largestSurplusVsReserveDate, "2026-07-28");
    assert.equal(summary.reserve?.projectedBalance, "35.00");
  });

  it("cenários contratual/provável e títulos de impacto no detalhe do dia", () => {
    const d = day({
      civilDate: "2026-08-01",
      openingBalance: "200.00",
      plannedInflows: "150.00",
      plannedOutflows: "40.00",
      transfers: "5.00",
      closingBalance: "315.00",
      items: [
        {
          id: "i1",
          dayLineId: "l1",
          accountId: "a1",
          civilDate: "2026-08-01",
          itemKind: "RECEIVABLE_DUE",
          amount: "150.00",
          label: "NF 10",
          officialTitleId: "t-nf10",
          nomusExternalId: 10,
          ledgerEntryId: null,
          transferGroupId: null,
          sourceRef: "CONTRACTUAL_DUE",
          sortOrder: 1,
        },
        {
          id: "i2",
          dayLineId: "l2",
          accountId: "a1",
          civilDate: "2026-08-01",
          itemKind: "PAYABLE_EXPECT",
          amount: "-40.00",
          label: "Fornecedor X",
          officialTitleId: "t-x",
          nomusExternalId: null,
          ledgerEntryId: null,
          transferGroupId: null,
          sourceRef: "PROBABLE_EXPECTATION",
          sortOrder: 2,
        },
      ],
    });

    const summary = buildTreasurySimpleCashRiskSummary({
      days: [d],
      minimumReserve: "100.00",
      scenario: "PROBABLE",
    });
    assert.equal(summary.topImpacts[0]?.label, "NF 10");
    assert.equal(summary.topImpacts[0]?.amount, "150.00");
    assert.equal(summary.reserve?.surplusPercent, "215.00");

    const detail = buildTreasurySimpleCashRiskDayDetail({
      day: d,
      scenario: "PROBABLE",
    });
    assert.equal(detail.previousBalance, "200.00");
    assert.equal(detail.receipts, "150.00");
    assert.equal(detail.payments, "40.00");
    assert.equal(detail.transfers, "5.00");
    assert.equal(detail.closingBalance, "315.00");
    assert.equal(detail.mainTitles[0]?.origin, "CONTRACTUAL");
    assert.equal(detail.mainTitles[1]?.origin, "PROBABLE");
    assert.match(detail.scenarioDescription, /expectativas informadas/i);
  });

  it("pendências: agenda sem itens e reserva zero no resumo", () => {
    const summary = buildTreasurySimpleCashRiskSummary({
      days: [
        day({
          civilDate: "2026-07-28",
          openingBalance: "10.00",
          closingBalance: "10.00",
          items: null,
        }),
      ],
      minimumReserve: "0.00",
      scenario: "CONTRACTUAL",
    });
    assert.equal(summary.topImpacts.length, 0);
    assert.equal(summary.firstNegativeDate, null);
    assert.equal(summary.firstDayBelowReserve, null);
    assert.equal(summary.largestSurplusVsReserve, null);
    assert.equal(summary.reserve?.kind, "NO_RESERVE");
    assert.equal(summary.reserve?.surplusPercent, null);
  });

  it("não cria segundo motor — regras reusam findFirstNegativeCivilDate do motor de comparação", () => {
    assert.equal(
      findFirstNegativeCivilDate([
        { civilDate: "2026-01-01", closingBalance: "1.00" },
        { civilDate: "2026-01-02", closingBalance: "-0.01" },
      ]),
      "2026-01-02"
    );
  });
});
