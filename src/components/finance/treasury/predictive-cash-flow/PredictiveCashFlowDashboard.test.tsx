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

describe("PredictiveCashFlowDashboard — saldo atual no topo", () => {
  it("não exibe Total a receber / a pagar; Contas fica no hero", () => {
    const html = render(
      <PredictiveCashFlowDashboard
        kpis={{
          baseBalance: 290078.02,
          totalReceivables: 0,
          totalPayables: 0,
          finalProjection: 290078.02,
        }}
        timeline={[]}
        accounts={[
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
        ]}
        transactions={[]}
        filters={createEmptyTreasurySimpleCashRiskFilters()}
        companyCode="EMP1"
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
    assert.match(html, /Projeção Final/);
    assert.match(html, /Saldo Base Atual/);
    assert.doesNotMatch(html, /Total A Receber/i);
    assert.doesNotMatch(html, /Total A Pagar/i);
    assert.match(html, /Informar saldos do dia — Viacredi - Koppetel/);
  });

  it("contas hero e dialog de saldos do dia estão wired", () => {
    const dash = readFileSync(join(here, "PredictiveCashFlowDashboard.tsx"), "utf8");
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
    assert.doesNotMatch(dash, /Total A Receber/);
    assert.doesNotMatch(dash, /Total A Pagar/);
    assert.match(panel, /PredictiveCashFlowBalanceCorrectDialog/);
    assert.match(dialog, /saveTreasuryTodayOpening/);
    assert.match(dialog, /saveTreasuryTodayClosing/);
    assert.match(dialog, /canEditTreasuryCivilDateBalances/);
    assert.match(dialog, /justification/);
    assert.match(recon, /Fechamento final \(todas as contas\)/);
    assert.match(recon, /fetchTreasuryTodayClosing/);
    assert.match(dash, /PredictiveCashFlowReconciliationPanel/);
    const chart = readFileSync(
      join(here, "PredictiveCashFlowTimelineChart.tsx"),
      "utf8"
    );
    assert.match(chart, /Consolidado/);
    assert.match(chart, /Por banco/);
    assert.match(chart, /Abertura informada/);
    assert.match(chart, /Limite \(R\$ 0\)/);
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
