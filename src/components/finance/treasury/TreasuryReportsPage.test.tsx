import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TreasuryReportDto } from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_REPORTS_DENIED_MESSAGE,
  TREASURY_REPORTS_EMPTY_TITLE,
  TREASURY_REPORTS_PAGE_TITLE,
  createEmptyTreasuryReportsFilters,
} from "@/src/lib/treasury/treasuryReportsUi.js";
import { TreasuryReportsPanel } from "./TreasuryReportsPanel.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");

function noop() {}

function sampleReport(): TreasuryReportDto {
  return {
    ok: true,
    reportKey: "daily-position",
    period: { from: "2026-07-27", to: "2026-07-27" },
    accountIds: null,
    authorizedAccountIds: ["a1"],
    scenario: null,
    filters: {},
    totals: {
      amount: "100.00",
      count: 1,
      extras: { bucketAmountSum: "100.00", bucketCountSum: 1 },
    },
    composition: [
      {
        key: "observed",
        label: "Saldo observado",
        amount: "100.00",
        count: 1,
        sharePercent: "100.00",
      },
    ],
    rows: [{ id: "a1", label: "Caixa", amount: "100.00", accountId: "a1" }],
    pagination: null,
  };
}

describe("TreasuryReportsPage — wiring UI", () => {
  it("registra rota /reports no módulo e aba Relatórios", () => {
    const mod = readFileSync(join(here, "TreasuryModule.tsx"), "utf8");
    const feature = readFileSync(
      join(repoRoot, "src/lib/treasury/treasurySimpleNavigation.ts"),
      "utf8"
    );
    assert.match(mod, /path="reports"/);
    assert.match(mod, /TreasuryReportsPage/);
    assert.match(feature, /Relatórios/);
    assert.match(feature, /id: "reports"/);
    assert.match(feature, /\/reports/);
  });

  it("renderiza seleção, geração, filtros e ações de export/impressão", () => {
    const html = renderToStaticMarkup(
      <TreasuryReportsPanel
        viewKind="ready"
        report={sampleReport()}
        generatedAt="2026-07-27T18:00:00.000-03:00"
        error={null}
        filters={createEmptyTreasuryReportsFilters()}
        canExport
        onFiltersChange={noop}
        onRefresh={noop}
        onExport={noop}
        onPrint={noop}
      />
    );
    assert.match(html, /treasury-reports-report-key/);
    assert.match(html, /treasury-reports-generated-at/);
    assert.match(html, /treasury-reports-filter-chips/);
    assert.match(html, /treasury-reports-export-csv/);
    assert.match(html, /treasury-reports-export-xlsx/);
    assert.match(html, /treasury-reports-export-pdf/);
    assert.match(html, /treasury-reports-print/);
    assert.match(html, /Saldo observado/);
  });

  it("nega acesso e desabilita export sem permissão", () => {
    const denied = renderToStaticMarkup(
      <TreasuryReportsPanel
        viewKind="denied"
        report={null}
        generatedAt={null}
        error={null}
        filters={createEmptyTreasuryReportsFilters()}
        canExport={false}
        onFiltersChange={noop}
        onRefresh={noop}
        onExport={noop}
        onPrint={noop}
      />
    );
    assert.match(denied, new RegExp(TREASURY_REPORTS_DENIED_MESSAGE));

    const noExport = renderToStaticMarkup(
      <TreasuryReportsPanel
        viewKind="empty"
        report={null}
        generatedAt={null}
        error={null}
        filters={createEmptyTreasuryReportsFilters()}
        canExport={false}
        onFiltersChange={noop}
        onRefresh={noop}
        onExport={noop}
        onPrint={noop}
      />
    );
    assert.match(noExport, /disabled/);
    assert.match(noExport, new RegExp(TREASURY_REPORTS_EMPTY_TITLE));
    assert.ok(TREASURY_REPORTS_PAGE_TITLE.length > 0);
  });
});
