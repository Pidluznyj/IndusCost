/**
 * Timeline — camada visual de CR atrasado D+1..D+3.
 * A data reaparece sem virar TreasuryCaixaTimelineRow financeiro.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TreasuryCaixaTimeline } from "./TreasuryCaixaTimeline.js";
import type {
  TreasuryCaixaRecentOverdueDay,
  TreasuryCaixaTimeline as TreasuryCaixaTimelineData,
  TreasuryCaixaTimelineRow,
} from "../../../lib/treasury/domain/treasuryCaixaRules.js";

function financialRow(
  civilDate: string,
  over: Partial<TreasuryCaixaTimelineRow> = {}
): TreasuryCaixaTimelineRow {
  return {
    civilDate,
    kind: civilDate < "2026-09-21" ? "REALIZED" : civilDate > "2026-09-21" ? "FORECAST" : "TODAY",
    opening: 500000,
    inflows: 0,
    outflows: 0,
    closing: 500000,
    closingCalculated: 500000,
    closingInformed: null,
    divergence: null,
    negative: false,
    ...over,
  };
}

const britania: TreasuryCaixaRecentOverdueDay = {
  civilDate: "2026-09-20",
  amount: 162866,
  count: 1,
  daysOverdue: 1,
  titles: [
    {
      externalId: 18257,
      dueDate: "2026-09-20",
      personName: "Britânia Eletrodomésticos SA",
      balanceReceivable: 162866,
      daysOverdue: 1,
    },
  ],
};

function render(htmlTimeline: TreasuryCaixaTimelineData, recent = [britania]): string {
  return renderToStaticMarkup(
    <TreasuryCaixaTimeline timeline={htmlTimeline} recentOverdueReceivables={recent} />
  );
}

describe("TreasuryCaixaTimeline — atraso recente D+1 (Britânia 20/09)", () => {
  it("a data vencida reaparece mesmo sem linha financeira naquele dia", () => {
    const html = render({
      todayCivilDate: "2026-09-21",
      rows: [
        financialRow("2026-09-19", { closing: 500000 }),
        financialRow("2026-09-21", { kind: "TODAY", inflows: 30000, closing: 530000 }),
      ],
      realizedCount: 1,
      forecastCount: 0,
      firstNegativeDate: null,
    });

    assert.match(html, /data-testid="caixa-timeline-row-2026-09-20"/);
    assert.match(html, /data-kind="RECENT_OVERDUE"/);
    assert.match(html, /20\/09\/2026/);
    assert.match(html, /Atraso D\+1/);
    assert.match(html, /A receber pendente/);
    assert.match(html, /não recebido/);
    assert.match(html, /Britânia|162.866|162\.866/);
    assert.match(
      html,
      /data-testid="caixa-timeline-recent-overdue-inflows-2026-09-20"[^>]*>—/
    );
    assert.doesNotMatch(
      html,
      /data-testid="caixa-timeline-recent-overdue-inflows-2026-09-20"[^>]*>[^<]*162/
    );
  });

  it("a linha operacional pode existir sozinha, sem nenhum TreasuryCaixaTimelineRow", () => {
    const html = render({
      todayCivilDate: "2026-09-21",
      rows: [],
      realizedCount: 0,
      forecastCount: 0,
      firstNegativeDate: null,
    });
    assert.match(html, /data-kind="RECENT_OVERDUE"/);
    assert.match(html, /Atraso D\+1/);
    assert.doesNotMatch(html, /Sem dias no período selecionado/);
  });
});
