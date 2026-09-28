/**
 * Previsão de comissões — render estático real da página: abre em setembro/2026,
 * não aceita mês anterior e indica o Nomus para os meses antigos. Loader vazio
 * para `.css`.
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { before, describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { COMMISSION_PORTFOLIO_OUTLOOK_HISTORY_NOTE } from "./commissions/commissionPortfolioOutlook.js";

register(
  `data:text/javascript,${encodeURIComponent(
    'export async function load(url, context, next) { if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true }; return next(url, context); }'
  )}`,
  import.meta.url
);

let pageModule: typeof import("../components/commissions/pages/CommissionsPortfolioOutlookPage.js");

before(async () => {
  pageModule = await import("../components/commissions/pages/CommissionsPortfolioOutlookPage.js");
});

describe("Comissões › Previsão — período", () => {
  it("abre em setembro/2026, não aceita mês anterior e indica o Nomus", () => {
    const html = renderToStaticMarkup(<pageModule.CommissionsPortfolioOutlookPage />);
    const monthInputs = html.match(/<input type="month"[^>]*>/g) ?? [];
    assert.equal(monthInputs.length, 2);
    assert.match(monthInputs[0]!, /min="2026-09"/);
    assert.match(monthInputs[0]!, /value="2026-09"/);
    assert.match(monthInputs[1]!, /min="2026-09"/);
    assert.match(monthInputs[1]!, /value=""/);
    assert.ok(html.includes(COMMISSION_PORTFOLIO_OUTLOOK_HISTORY_NOTE));
    assert.match(html, /data-testid="commissions-outlook-history-note"/);
  });
});
