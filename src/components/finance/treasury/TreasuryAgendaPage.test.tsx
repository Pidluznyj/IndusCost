import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TreasuryAgendaDto } from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_AGENDA_COLUMN_LABELS,
  TREASURY_AGENDA_DENIED_MESSAGE,
  TREASURY_AGENDA_EMPTY_TITLE,
  TREASURY_AGENDA_PAGE_TITLE,
  createEmptyTreasuryAgendaFilters,
} from "@/src/lib/treasury/treasuryAgendaUi.js";
import { TreasuryAgendaPanel } from "./TreasuryAgendaPanel.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");

function noop() {}

function sampleAgenda(): TreasuryAgendaDto {
  return {
    ok: true,
    runId: "run-1",
    companyCode: "LAZARIOS",
    scenario: "PROBABLE",
    baseDate: "2026-07-27",
    endDate: "2026-07-28",
    consolidated: true,
    accountIds: null,
    sourceVersion: "src-abcdef0123456789",
    algorithmVersion: "algo-1",
    freshness: {
      asOf: "2026-07-27T18:00:00.000-03:00",
      sources: [
        {
          source: "PROJECTION_RUN",
          label: "Projeção persistida",
          lastSuccessAt: "2026-07-20T12:00:00.000-03:00",
          isStale: true,
          detail: "status=SUCCEEDED",
        },
      ],
      hasStaleSource: true,
      staleSourceCount: 1,
    },
    days: [
      {
        civilDate: "2026-07-27",
        accountId: null,
        accountCode: null,
        accountName: null,
        openingBalance: "1000.00",
        plannedInflows: "200.00",
        confirmedInflows: "100.00",
        realizedInflows: "50.00",
        plannedOutflows: "80.00",
        programmedOutflows: "60.00",
        realizedOutflows: "20.00",
        transfers: "0.00",
        closingBalance: "1120.00",
        riskAmount: "15.00",
        riskCode: "MEDIUM",
        riskLabel: "Risco Médio (MEDIUM): 15.00",
        inflows: "180.00",
        outflows: "60.00",
        net: "120.00",
        realized: "30.00",
        itemCount: 2,
        items: [
          {
            id: "i1",
            dayLineId: "d1",
            accountId: "acc-1",
            civilDate: "2026-07-27",
            itemKind: "RECEIVABLE",
            amount: "100.00",
            label: "Cliente X",
            officialTitleId: "t1",
            nomusExternalId: null,
            ledgerEntryId: null,
            transferGroupId: null,
            sourceRef: null,
            sortOrder: 0,
          },
        ],
        alerts: [],
      },
    ],
    alerts: [
      {
        id: "alert:NEGATIVE_BALANCE:proj:consolidated:2026-07-27",
        kind: "NEGATIVE_BALANCE",
        severity: "CRITICAL",
        title: "Saldo negativo",
        description: "Projeção negativa em 2026-07-27.",
        amount: "-10.00",
        accountId: null,
        civilDate: "2026-07-27",
        entityId: "consolidated",
        metadata: null,
      },
    ],
    maxHorizonDays: 90,
  };
}

describe("TreasuryAgendaPage / Panel", () => {
  it("nega acesso com mensagem textual", () => {
    const html = renderToStaticMarkup(
      <TreasuryAgendaPanel
        viewKind="denied"
        agenda={null}
        accounts={[]}
        error={null}
        staleMessage={null}
        filters={createEmptyTreasuryAgendaFilters("2026-07-27")}
        onFiltersChange={noop}
        onRefresh={noop}
        onClearFilters={noop}
      />
    );
    assert.match(html, new RegExp(TREASURY_AGENDA_DENIED_MESSAGE));
    assert.match(html, /treasury-agenda-permission-denied/);
  });

  it("estado vazio", () => {
    const html = renderToStaticMarkup(
      <TreasuryAgendaPanel
        viewKind="empty"
        agenda={null}
        accounts={[]}
        error={null}
        staleMessage={null}
        filters={createEmptyTreasuryAgendaFilters("2026-07-27")}
        onFiltersChange={noop}
        onRefresh={noop}
        onClearFilters={noop}
      />
    );
    assert.match(html, new RegExp(TREASURY_AGENDA_EMPTY_TITLE));
  });

  it("renderiza colunas, risco textual, gráfico e stale (não só cor)", () => {
    const html = renderToStaticMarkup(
      <TreasuryAgendaPanel
        viewKind="ready"
        agenda={sampleAgenda()}
        accounts={[]}
        error={null}
        staleMessage="Dados desatualizados: a projeção da agenda está stale."
        filters={createEmptyTreasuryAgendaFilters("2026-07-27")}
        onFiltersChange={noop}
        onRefresh={noop}
        onClearFilters={noop}
      />
    );
    assert.match(html, /treasury-agenda-panel/);
    assert.match(html, /treasury-agenda-balance-chart/);
    assert.match(html, /treasury-agenda-table/);
    assert.match(html, /treasury-agenda-stale-banner/);
    assert.match(html, new RegExp(TREASURY_AGENDA_COLUMN_LABELS.plannedInflows));
    assert.match(html, new RegExp(TREASURY_AGENDA_COLUMN_LABELS.programmedOutflows));
    assert.match(html, /Risco Médio \(MEDIUM\): 15\.00/);
    assert.match(html, /Entradas previstas/);
    assert.match(html, /Saídas programadas/);
    assert.match(html, /Evolução do Saldo Final/i);
  });

  it("módulo registra rota agenda e página exportada", () => {
    const moduleSrc = readFileSync(join(here, "TreasuryModule.tsx"), "utf8");
    assert.match(moduleSrc, /TreasuryAgendaPage/);
    assert.match(moduleSrc, /path="agenda"/);
    const featureUi = readFileSync(
      join(repoRoot, "src/lib/treasury/treasurySimpleNavigation.ts"),
      "utf8"
    );
    assert.match(featureUi, /Agenda financeira/);
    assert.match(featureUi, /\/agenda/);
    const pageSrc = readFileSync(join(here, "TreasuryAgendaPage.tsx"), "utf8");
    assert.match(pageSrc, new RegExp(TREASURY_AGENDA_PAGE_TITLE));
    const indexSrc = readFileSync(join(here, "index.ts"), "utf8");
    assert.match(indexSrc, /TreasuryAgendaPage/);
    const appSrc = readFileSync(join(repoRoot, "src/App.tsx"), "utf8");
    assert.match(appSrc, /TreasuryModule/);
  });

  it("FE da agenda não importa Prisma/server", () => {
    for (const file of [
      "TreasuryAgendaPage.tsx",
      "TreasuryAgendaPanel.tsx",
      "TreasuryAgendaBalanceChart.tsx",
    ]) {
      const src = readFileSync(join(here, file), "utf8");
      assert.doesNotMatch(src, /@prisma\/client|\.server\.js|\.server["']/);
    }
  });
});
