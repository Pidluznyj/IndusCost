import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatMaterialIntelligenceQuoteDate,
  MATERIAL_INTELLIGENCE_360_PLACEHOLDER_SECTIONS,
  MATERIAL_INTELLIGENCE_RECENT_QUOTES_EMPTY_MESSAGE,
} from "./materialIntelligence360Sections.js";

describe("materialIntelligence360Sections", () => {
  it("define todas as seções preparadas da visão 360º", () => {
    const ids = MATERIAL_INTELLIGENCE_360_PLACEHOLDER_SECTIONS.map((s) => s.id);
    assert.deepEqual(ids, [
      "priceHistory",
      "suppliers",
      "dollar",
      "brent",
      "impactedProducts",
      "timeline",
      "audit",
    ]);
  });

  it("mensagem amigável sem cotações", () => {
    assert.match(MATERIAL_INTELLIGENCE_RECENT_QUOTES_EMPTY_MESSAGE, /Nenhuma cotação/i);
  });

  it("formata data de cotação em pt-BR", () => {
    const formatted = formatMaterialIntelligenceQuoteDate("2026-01-15T12:00:00.000Z");
    assert.match(formatted, /2026/);
    assert.equal(formatMaterialIntelligenceQuoteDate(null), "—");
  });
});
