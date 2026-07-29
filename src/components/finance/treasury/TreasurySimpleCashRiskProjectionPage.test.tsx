/**
 * Testes — UI / wiring da projeção simples (Próximos dias).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { TreasuryAgendaDayDto } from "@/src/lib/treasury/contracts/index.js";
import {
  buildTreasurySimpleCashRiskDayDetail,
  buildTreasurySimpleCashRiskSummary,
} from "@/src/lib/treasury/domain/treasurySimpleCashRiskProjectionRules.js";
import {
  TREASURY_SIMPLE_CASH_RISK_ADVANCED_HINT,
  TREASURY_SIMPLE_CASH_RISK_DENIED,
  TREASURY_SIMPLE_CASH_RISK_TITLE,
  createEmptyTreasurySimpleCashRiskFilters,
} from "@/src/lib/treasury/treasurySimpleCashRiskProjectionUi.js";
import { TreasurySimpleCashRiskProjectionPanel } from "./TreasurySimpleCashRiskProjectionPanel.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");

function noop() {}

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

function sampleDay(
  civilDate: string,
  closing: string,
  opening = "100000.00"
): TreasuryAgendaDayDto {
  return {
    civilDate,
    accountId: null,
    accountCode: null,
    accountName: null,
    openingBalance: opening,
    plannedInflows: "10000.00",
    confirmedInflows: "0.00",
    realizedInflows: "0.00",
    plannedOutflows: "5000.00",
    programmedOutflows: "0.00",
    realizedOutflows: "0.00",
    transfers: "0.00",
    closingBalance: closing,
    riskAmount: "0.00",
    riskCode: "NONE",
    riskLabel: "Sem risco",
    inflows: "10000.00",
    outflows: "5000.00",
    net: "5000.00",
    realized: "0.00",
    itemCount: 1,
    items: [
      {
        id: "i1",
        dayLineId: "l1",
        accountId: "a1",
        civilDate,
        itemKind: "RECEIVABLE_DUE",
        amount: "10000.00",
        label: "Cliente A",
        officialTitleId: "t1",
        nomusExternalId: 1,
        ledgerEntryId: null,
        transferGroupId: null,
        sourceRef: "CONTRACTUAL",
        sortOrder: 1,
      },
    ],
    alerts: [],
  };
}

describe("TreasurySimpleCashRiskProjection — UI", () => {
  it("estados denied/ready, cenários e reserva com superávit", () => {
    assert.match(
      render(
        <TreasurySimpleCashRiskProjectionPanel
          viewKind="denied"
          agenda={null}
          days={[]}
          summary={null}
          dayDetail={null}
          filters={createEmptyTreasurySimpleCashRiskFilters("2026-07-28")}
          error={null}
          staleMessage={null}
          pendingAlertCount={0}
          onFiltersChange={noop}
          onSelectDay={noop}
          onRefresh={noop}
        />
      ),
      new RegExp(TREASURY_SIMPLE_CASH_RISK_DENIED)
    );

    const days = [sampleDay("2026-07-28", "130000.00", "100000.00")];
    const summary = buildTreasurySimpleCashRiskSummary({
      days,
      minimumReserve: "100000.00",
      scenario: "PROBABLE",
    });
    const dayDetail = buildTreasurySimpleCashRiskDayDetail({
      day: days[0]!,
      scenario: "PROBABLE",
    });

    const html = render(
      <TreasurySimpleCashRiskProjectionPanel
        viewKind="ready"
        agenda={{
          ok: true,
          runId: "run-1",
          companyCode: "LAZARIOS",
          scenario: "PROBABLE",
          baseDate: "2026-07-28",
          endDate: "2026-07-28",
          consolidated: true,
          accountIds: null,
          sourceVersion: "1",
          algorithmVersion: "1",
          freshness: {
            asOf: "2026-07-28T12:00:00.000Z",
            sources: [],
            hasStaleSource: false,
            staleSourceCount: 0,
          },
          days,
          alerts: [
            {
              id: "a1",
              kind: "PENDENCY",
              severity: "WARNING",
              title: "Pendência",
              description: "Título sem expectativa",
              amount: null,
              accountId: null,
              civilDate: "2026-07-28",
              entityId: null,
              metadata: null,
            },
          ],
          maxHorizonDays: 90,
        }}
        days={days}
        summary={summary}
        dayDetail={dayDetail}
        filters={{
          ...createEmptyTreasurySimpleCashRiskFilters("2026-07-28"),
          selectedCivilDate: "2026-07-28",
        }}
        error={null}
        staleMessage={null}
        pendingAlertCount={1}
        onFiltersChange={noop}
        onSelectDay={noop}
        onRefresh={noop}
      />
    );

    assert.match(html, /Contratual/);
    assert.match(html, /Provável/);
    assert.match(html, /Saldo esperado pelas datas oficiais/);
    assert.match(html, /Saldo mais provável pelas expectativas informadas/);
    assert.match(html, /Reserva mínima/);
    assert.match(html, /30,00%/);
    assert.match(html, /Pendências/);
    assert.match(html, /Detalhe do dia/);
    assert.match(html, /Cliente A/);
    assert.ok(html.includes(TREASURY_SIMPLE_CASH_RISK_ADVANCED_HINT));
    assert.equal(summary.reserve?.surplusPercent, "30.00");
  });

  it("página usa fetchTreasuryAgenda e Module aponta projection para tela simples", () => {
    const page = readFileSync(
      join(here, "TreasurySimpleCashRiskProjectionPage.tsx"),
      "utf8"
    );
    assert.match(page, /fetchTreasuryAgenda/);
    assert.match(page, /includeDayDetail:\s*true/);
    assert.match(page, /PredictiveCashFlowDashboard/);
    assert.doesNotMatch(page, /runTreasuryProjectionEngine/);
    assert.doesNotMatch(page, /dailyCashEngine/i);
    assert.doesNotMatch(page, /useLocalStorage/);

    const mod = readFileSync(join(here, "TreasuryModule.tsx"), "utf8");
    assert.match(mod, /TreasurySimpleCashRiskProjectionPage/);
    assert.match(
      mod,
      /path="projection"[\s\S]*TreasurySimpleCashRiskProjectionPage/
    );
    assert.match(mod, /path="agenda"[\s\S]*TreasuryAgendaPage/);

    assert.equal(TREASURY_SIMPLE_CASH_RISK_TITLE, "Fluxo Gerencial");

    const engineStillExists = readFileSync(
      join(
        repoRoot,
        "src/lib/treasury/domain/treasuryProjectionEngine.ts"
      ),
      "utf8"
    );
    assert.match(engineStillExists, /TREASURY_PROJECTION_ALGORITHM_VERSION/);
  });
});
