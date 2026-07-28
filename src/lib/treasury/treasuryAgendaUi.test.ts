import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  TreasuryAgendaDayDto,
  TreasuryFinancialAccountDto,
} from "@/src/lib/treasury/contracts/index.js";
import {
  addCivilDays,
  buildTreasuryAgendaBalanceChartPoints,
  buildTreasuryAgendaDisplayRows,
  buildTreasuryAgendaQuery,
  createEmptyTreasuryAgendaFilters,
  resolveTreasuryAgendaPeriodRange,
  resolveTreasuryAgendaViewKind,
} from "./treasuryAgendaUi.js";
import { buildTreasuryAgendaUrl } from "./treasuryAgendaApi.js";
import { canViewTreasuryAgenda } from "./treasuryAgendaPermissions.js";

function sampleAccount(
  partial: Partial<TreasuryFinancialAccountDto> & { id: string; code: string }
): TreasuryFinancialAccountDto {
  return {
    id: partial.id,
    companyCode: partial.companyCode ?? "LAZARIOS",
    companyName: null,
    code: partial.code,
    name: partial.name ?? partial.code,
    institutionName: partial.institutionName ?? "Banco A",
    institutionCode: null,
    accountType: partial.accountType ?? "CHECKING",
    currency: "BRL",
    agencyMasked: "***",
    accountNumberMasked: "***",
    includeInConsolidated: true,
    minimumBalance: "0.00",
    allowNegativeBalance: false,
    liquidity: "IMMEDIATE",
    defaultBalanceOrigin: "MANUAL",
    sortOrder: 0,
    nomusBankAccountId: null,
    isActive: true,
    createdByUserId: "u",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    deactivatedAt: null,
    deactivatedByUserId: null,
    deactivationReason: null,
  };
}

function sampleDay(
  partial: Partial<TreasuryAgendaDayDto> & { civilDate: string }
): TreasuryAgendaDayDto {
  return {
    civilDate: partial.civilDate as TreasuryAgendaDayDto["civilDate"],
    accountId: partial.accountId ?? null,
    accountCode: partial.accountCode ?? null,
    accountName: partial.accountName ?? null,
    openingBalance: partial.openingBalance ?? "100.00",
    plannedInflows: partial.plannedInflows ?? "10.00",
    confirmedInflows: partial.confirmedInflows ?? "5.00",
    realizedInflows: partial.realizedInflows ?? "2.00",
    plannedOutflows: partial.plannedOutflows ?? "3.00",
    programmedOutflows: partial.programmedOutflows ?? "4.00",
    realizedOutflows: partial.realizedOutflows ?? "1.00",
    transfers: partial.transfers ?? "0.00",
    closingBalance: partial.closingBalance ?? "110.00",
    riskAmount: partial.riskAmount ?? "0.00",
    riskCode: partial.riskCode ?? "NONE",
    riskLabel: partial.riskLabel ?? "Sem risco material",
    inflows: partial.inflows ?? "10.00",
    outflows: partial.outflows ?? "3.00",
    net: partial.net ?? "7.00",
    realized: partial.realized ?? "1.00",
    itemCount: partial.itemCount ?? 0,
    items: partial.items ?? null,
    alerts: partial.alerts ?? [],
  };
}

describe("treasuryAgendaUi", () => {
  it("presets de período e datas civis", () => {
    assert.equal(addCivilDays("2026-07-27", 6), "2026-08-02");
    const today = resolveTreasuryAgendaPeriodRange(
      { period: "today", baseDate: "", endDate: "" },
      "2026-07-27"
    );
    assert.deepEqual(today, { baseDate: "2026-07-27", endDate: "2026-07-27" });
    const d7 = resolveTreasuryAgendaPeriodRange(
      { period: "7d", baseDate: "", endDate: "" },
      "2026-07-27"
    );
    assert.deepEqual(d7, { baseDate: "2026-07-27", endDate: "2026-08-02" });
    const custom = resolveTreasuryAgendaPeriodRange(
      { period: "custom", baseDate: "2026-08-10", endDate: "2026-08-01" },
      "2026-07-27"
    );
    assert.deepEqual(custom, { baseDate: "2026-08-01", endDate: "2026-08-10" });
  });

  it("query consolidada vs por conta", () => {
    const accounts = [sampleAccount({ id: "a1", code: "CX", companyCode: "LZ" })];
    const filters = createEmptyTreasuryAgendaFilters("2026-07-27");
    const cons = buildTreasuryAgendaQuery({ filters, accounts, today: "2026-07-27" });
    assert.equal(cons.consolidated, true);
    assert.equal(cons.companyCode, "LZ");
    const byAcc = buildTreasuryAgendaQuery({
      filters: { ...filters, viewMode: "byAccount", accountId: "a1" },
      accounts,
      today: "2026-07-27",
    });
    assert.equal(byAcc.consolidated, false);
    assert.deepEqual(byAcc.accountIds, ["a1"]);
  });

  it("agrupa por instituição sem perder rótulo textual de risco", () => {
    const accounts = [
      sampleAccount({ id: "a1", code: "CX1", institutionName: "Banco X" }),
      sampleAccount({ id: "a2", code: "CX2", institutionName: "Banco X" }),
    ];
    const rows = buildTreasuryAgendaDisplayRows({
      days: [
        sampleDay({
          civilDate: "2026-07-27",
          accountId: "a1",
          plannedInflows: "10.00",
          closingBalance: "50.00",
          riskCode: "LOW",
          riskAmount: "1.00",
          riskLabel: "Risco Baixo (LOW): 1.00",
        }),
        sampleDay({
          civilDate: "2026-07-27",
          accountId: "a2",
          plannedInflows: "15.00",
          closingBalance: "70.00",
          riskCode: "HIGH",
          riskAmount: "9.00",
          riskLabel: "Risco Alto (HIGH): 9.00",
        }),
      ],
      accounts,
      viewMode: "byGroup",
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.plannedInflows, "25.00");
    assert.equal(rows[0]!.closingBalance, "120.00");
    assert.equal(rows[0]!.riskCode, "HIGH");
    assert.match(rows[0]!.riskLabel, /Alto/);
    assert.equal(rows[0]!.accountName, "Banco X");
  });

  it("pontos do gráfico incluem status e risco textuais", () => {
    const points = buildTreasuryAgendaBalanceChartPoints(
      buildTreasuryAgendaDisplayRows({
        days: [
          sampleDay({
            civilDate: "2026-07-27",
            closingBalance: "-10.00",
            riskCode: "CRITICAL",
            riskAmount: "10.00",
          }),
        ],
        accounts: [],
        viewMode: "consolidated",
      })
    );
    assert.equal(points.length, 1);
    assert.equal(points[0]!.status, "negative");
    assert.match(points[0]!.riskLabel, /Crítico/);
    assert.ok(points[0]!.closingBalanceText.length > 0);
  });

  it("viewKind e permissão", () => {
    assert.equal(
      resolveTreasuryAgendaViewKind({
        canView: false,
        loading: false,
        error: null,
        hasData: false,
        hasFilters: false,
      }),
      "denied"
    );
    assert.equal(
      canViewTreasuryAgenda({
        canPerformAction: (resource, action) =>
          resource === "finance.treasury.agenda" && action === "view",
      }),
      true
    );
    assert.equal(
      canViewTreasuryAgenda({
        canPerformAction: () => false,
      }),
      false
    );
  });

  it("URL da agenda inclui companyCode e consolidação", () => {
    const url = buildTreasuryAgendaUrl({
      companyCode: "LAZARIOS",
      baseDate: "2026-07-27",
      endDate: "2026-08-02",
      consolidated: false,
      includeDayDetail: true,
      scenario: "PROBABLE",
    });
    assert.match(url, /\/api\/finance\/treasury\/agenda\?/);
    assert.match(url, /companyCode=LAZARIOS/);
    assert.match(url, /consolidated=false/);
    assert.match(url, /includeDayDetail=true/);
  });
});
