import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { PredictiveCashFlowDashboard } from "./PredictiveCashFlowDashboard.js";
import { PredictiveCashFlowAccountsPanel } from "./PredictiveCashFlowAccountsPanel.js";
import { createEmptyTreasurySimpleCashRiskFilters } from "@/src/lib/treasury/treasurySimpleCashRiskProjectionUi.js";

const here = dirname(fileURLToPath(import.meta.url));

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

const sampleAccounts = [
  {
    id: "a1",
    name: "Viacredi - Koppetel",
    initialBalance: 60351,
    institutionName: "Viacredi",
    includeInConsolidated: true,
    isActive: true,
  },
  {
    id: "a2",
    name: "Viacredi - Lazarios",
    initialBalance: 229727.02,
    institutionName: "Viacredi",
    includeInConsolidated: true,
    isActive: true,
  },
] as const;

describe("PredictiveCashFlowDashboard — saldo atual no topo", () => {
  it("não exibe Total a receber / a pagar; Contas fica no hero", () => {
    const html = render(
      <PredictiveCashFlowDashboard
        timeline={[]}
        accounts={[...sampleAccounts]}
        transactions={[]}
        filters={createEmptyTreasurySimpleCashRiskFilters()}
        companyCode="EMP1"
        riskSummary={{
          openingBalance: "100.00",
          plannedInflows: "50.00",
          plannedOutflows: "20.00",
          lowestBalance: "80.00",
          lowestBalanceDate: "2026-07-30",
          firstNegativeDate: null,
          largestDeficit: null,
          largestDeficitDate: null,
          firstDayBelowReserve: null,
          largestSurplusVsReserve: null,
          largestSurplusVsReserveDate: null,
          reserve: null,
          topImpacts: [],
        }}
        loading={false}
        error={null}
        staleMessage={null}
        onFiltersChange={() => {}}
        onRefresh={() => {}}
      />
    );
    assert.match(html, /predictive-cf-accounts/);
    assert.match(html, /data-variant="hero"/);
    assert.match(html, /Viacredi - Koppetel/);
    assert.match(html, /Viacredi - Lazarios/);
    assert.match(html, /Saldos canônicos/);
    assert.match(html, /predictive-cf-balance-kpis/);
    assert.match(html, /Saldos informados/);
    assert.match(html, /Saldos calculados/);
    assert.match(html, /predictive-cf-risk-strip/);
    assert.match(html, /Risco de caixa no horizonte/);
    assert.match(html, /predictive-cf-account-crcp/);
    assert.match(html, /CR e CP por conta/);
    assert.match(html, /predictive-cf-filter-year/);
    assert.match(html, /Horizonte/);
    assert.doesNotMatch(html, /Total A Receber/i);
    assert.doesNotMatch(html, /Total A Pagar/i);
    assert.match(html, /Informar saldos do dia — Viacredi - Koppetel/);
  });

  it("exibe filtro de empresa quando há 2+ companyCodes", () => {
    const html = render(
      <PredictiveCashFlowDashboard
        timeline={[]}
        accounts={[...sampleAccounts]}
        transactions={[]}
        filters={{
          ...createEmptyTreasurySimpleCashRiskFilters(),
          companyCode: "EMP1",
        }}
        companyCode="EMP1"
        companyCodes={["EMP1", "EMP2"]}
        riskSummary={null}
        loading={false}
        error={null}
        staleMessage={null}
        onFiltersChange={() => {}}
        onRefresh={() => {}}
      />
    );
    assert.match(html, /predictive-cf-filter-company/);
    assert.match(html, /EMP1/);
    assert.match(html, /EMP2/);
  });

  it("contas hero e dialog de saldos do dia estão wired", () => {
    const dash = readFileSync(join(here, "PredictiveCashFlowDashboard.tsx"), "utf8");
    const page = readFileSync(
      join(here, "..", "TreasurySimpleCashRiskProjectionPage.tsx"),
      "utf8"
    );
    const panel = readFileSync(
      join(here, "PredictiveCashFlowAccountsPanel.tsx"),
      "utf8"
    );
    const dialog = readFileSync(
      join(here, "PredictiveCashFlowBalanceCorrectDialog.tsx"),
      "utf8"
    );
    const recon = readFileSync(
      join(here, "PredictiveCashFlowReconciliationPanel.tsx"),
      "utf8"
    );
    assert.match(dash, /variant="hero"/);
    assert.match(dash, /isSuperAdmin=\{isSuperAdmin\}/);
    assert.match(dash, /PredictiveCashFlowBalanceKpis/);
    assert.match(dash, /PredictiveCashFlowRiskStrip/);
    assert.match(dash, /PredictiveCashFlowAccountCrCpPanel/);
    assert.match(dash, /companyCode=\{companyCode\}/);
    assert.match(dash, /predictive-cf-filter-year/);
    assert.match(dash, /predictive-cf-filter-company/);
    assert.doesNotMatch(dash, /kpis:/);
    assert.doesNotMatch(dash, /Total A Receber/);
    assert.doesNotMatch(dash, /Total A Pagar/);
    assert.match(page, /filters\.selectedCivilDate/);
    assert.match(page, /listTreasurySimpleCashRiskCompanyCodes/);
    assert.match(page, /buildTreasurySimpleCashRiskSummary/);
    assert.doesNotMatch(page, /buildPredictiveCashFlowKpis/);
    assert.match(panel, /PredictiveCashFlowBalanceCorrectDialog/);
    assert.match(dialog, /saveTreasuryTodayOpening/);
    assert.match(dialog, /saveTreasuryTodayClosing/);
    assert.match(dialog, /canEditTreasuryCivilDateBalances/);
    assert.match(dialog, /justification/);
    assert.match(recon, /Fechamento final \(todas as contas\)/);
    assert.match(recon, /fetchTreasuryTodayClosing/);
    assert.match(dash, /PredictiveCashFlowReconciliationPanel/);
    const crcp = readFileSync(
      join(here, "PredictiveCashFlowAccountCrCpPanel.tsx"),
      "utf8"
    );
    assert.match(crcp, /fetchTreasuryPredictiveCrCpByAccount/);
    assert.match(crcp, /Ver títulos/);
    assert.match(crcp, /Contas sem vínculo|isUnlinked/);
    const chart = readFileSync(
      join(here, "PredictiveCashFlowTimelineChart.tsx"),
      "utf8"
    );
    assert.match(chart, /Consolidado/);
    assert.match(chart, /Por banco/);
    assert.match(chart, /PREDICTIVE_EVOLUTION_START_SOURCE_LABELS/);
    assert.match(chart, /Limite \(R\$ 0\)/);
    assert.match(chart, /type="monotone"/);
    assert.match(chart, /chartReceivables/);
    assert.match(chart, /chartPayablesNeg/);
    assert.match(chart, /predictive-cf-chart-slicer/);
    assert.match(chart, /ComposedChart/);
    const kpisUi = readFileSync(
      join(here, "PredictiveCashFlowBalanceKpis.tsx"),
      "utf8"
    );
    assert.match(kpisUi, /lg:grid-cols-2/);
    assert.match(kpisUi, /Saldos informados/);
    assert.match(kpisUi, /Saldos calculados/);
  });

  it("lista Contas como botões clicáveis", () => {
    const html = render(
      <PredictiveCashFlowAccountsPanel
        accounts={[
          {
            id: "a1",
            name: "Conta Teste",
            initialBalance: 100,
            institutionName: "Banco",
            includeInConsolidated: true,
            isActive: true,
          },
        ]}
        companyCode="EMP1"
        onChanged={() => {}}
        variant="hero"
      />
    );
    assert.match(html, /predictive-cf-account-a1/);
    assert.match(html, /button/);
    assert.match(html, /Informar saldos do dia — Conta Teste/);
  });
});
