import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TreasuryProjectionComparisonDto } from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_COMPARISON_DENIED_MESSAGE,
  TREASURY_COMPARISON_PAGE_TITLE,
  createEmptyTreasuryComparisonFilters,
} from "@/src/lib/treasury/treasuryProjectionComparisonUi.js";
import { TreasuryProjectionComparisonPanel } from "./TreasuryProjectionComparisonPanel.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");

function noop() {}

function sampleComparison(): TreasuryProjectionComparisonDto {
  return {
    ok: true,
    companyCode: "LAZARIOS",
    baseDate: "2026-07-27",
    endDate: "2026-07-28",
    consolidated: true,
    accountIds: null,
    recalculated: false,
    scenarios: [
      {
        scenario: "CONTRACTUAL",
        runId: "r1",
        sourceVersion: "s1",
        algorithmVersion: "a1",
        available: true,
        freshness: null,
        firstNegativeDate: null,
        minimumBalance: "1000.00",
        minimumBalanceDate: "2026-07-27",
        dayCount: 2,
      },
      {
        scenario: "PROBABLE",
        runId: "r2",
        sourceVersion: "s2",
        algorithmVersion: "a1",
        available: true,
        freshness: null,
        firstNegativeDate: "2026-07-28",
        minimumBalance: "-10.00",
        minimumBalanceDate: "2026-07-28",
        dayCount: 2,
      },
      {
        scenario: "CONFIRMED",
        runId: "r3",
        sourceVersion: "s3",
        algorithmVersion: "a1",
        available: true,
        freshness: null,
        firstNegativeDate: null,
        minimumBalance: "900.00",
        minimumBalanceDate: "2026-07-28",
        dayCount: 2,
      },
    ],
    days: [
      {
        civilDate: "2026-07-27",
        balances: {
          CONTRACTUAL: "1000.00",
          PROBABLE: "1100.00",
          CONFIRMED: "1050.00",
        },
        differences: {
          probableMinusContractual: "100.00",
          confirmedMinusProbable: "-50.00",
          confirmedMinusContractual: "50.00",
        },
        uncertainReceivables: {
          CONTRACTUAL: "40.00",
          PROBABLE: "20.00",
          CONFIRMED: "0.00",
          max: "40.00",
          primary: "40.00",
        },
        highestRisk: {
          riskCode: "MEDIUM",
          riskAmount: "15.00",
          riskLabel: "Risco Médio (MEDIUM): 15.00",
          scenario: "CONTRACTUAL",
        },
      },
    ],
    summary: {
      firstNegativeDateOverall: "2026-07-28",
      minimumBalanceOverall: "-10.00",
      minimumBalanceOverallDate: "2026-07-28",
      minimumBalanceOverallScenario: "PROBABLE",
    },
    freshness: {
      asOf: "2026-07-27T18:00:00.000Z",
      sources: [],
      hasStaleSource: false,
      staleSourceCount: 0,
    },
    maxHorizonDays: 90,
  };
}

describe("TreasuryProjectionComparisonPage / Panel", () => {
  it("nega acesso com mensagem textual", () => {
    const html = renderToStaticMarkup(
      <TreasuryProjectionComparisonPanel
        viewKind="denied"
        comparison={null}
        accounts={[]}
        error={null}
        staleMessage={null}
        filters={createEmptyTreasuryComparisonFilters("2026-07-27")}
        onFiltersChange={noop}
        onRefresh={noop}
        onClearFilters={noop}
      />
    );
    assert.match(html, new RegExp(TREASURY_COMPARISON_DENIED_MESSAGE));
  });

  it("renderiza saldos, diferenças, incerteza, risco textual e toggles", () => {
    const html = renderToStaticMarkup(
      <TreasuryProjectionComparisonPanel
        viewKind="ready"
        comparison={sampleComparison()}
        accounts={[]}
        error={null}
        staleMessage={null}
        filters={createEmptyTreasuryComparisonFilters("2026-07-27")}
        onFiltersChange={noop}
        onRefresh={noop}
        onClearFilters={noop}
      />
    );
    assert.match(html, /treasury-comparison-panel/);
    assert.match(html, /treasury-comparison-table/);
    assert.match(html, /treasury-comparison-chart/);
    assert.match(html, /Δ Provável − Contratual/);
    assert.match(html, /Recebíveis s\/ previsão confiável/);
    assert.match(html, /Risco Médio \(MEDIUM\): 15\.00/);
    assert.match(html, /Alternar não dispara recálculo/);
    assert.match(html, /recalculated=false/);
    assert.match(html, /1ª data negativa/);
    assert.match(html, /Menor saldo/);
  });

  it("módulo registra rota projections e FE sem Prisma", () => {
    const moduleSrc = readFileSync(join(here, "TreasuryModule.tsx"), "utf8");
    assert.match(moduleSrc, /TreasuryProjectionComparisonPage/);
    assert.match(moduleSrc, /path="projections"/);
    const featureUi = readFileSync(join(here, "treasuryFeatureUi.ts"), "utf8");
    assert.match(featureUi, /Comparação de cenários/);
    const pageSrc = readFileSync(
      join(here, "TreasuryProjectionComparisonPage.tsx"),
      "utf8"
    );
    assert.match(pageSrc, new RegExp(TREASURY_COMPARISON_PAGE_TITLE));
    assert.match(pageSrc, /visibleScenarios intencionalmente ignorado/);
    for (const file of [
      "TreasuryProjectionComparisonPage.tsx",
      "TreasuryProjectionComparisonPanel.tsx",
      "TreasuryProjectionComparisonChart.tsx",
    ]) {
      const src = readFileSync(join(here, file), "utf8");
      assert.doesNotMatch(src, /@prisma\/client|\.server\.js|\.server["']/);
    }
    const routes = readFileSync(
      join(repoRoot, "src/lib/treasury/treasuryRoutes.ts"),
      "utf8"
    );
    assert.match(routes, /PROJECTIONS_PATH\}\/compare/);
    assert.match(routes, /compareScenarios/);
  });
});
