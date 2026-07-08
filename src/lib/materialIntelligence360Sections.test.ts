import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatMaterialIntelligenceQuoteDate,
  MATERIAL_INTELLIGENCE_360_PLACEHOLDER_SECTIONS,
  MATERIAL_INTELLIGENCE_RECENT_QUOTES_EMPTY_MESSAGE,
} from "./materialIntelligence360Sections.js";

describe("materialIntelligence360Sections", () => {
  it("não mantém seções placeholder quando auditoria está implementada", () => {
    assert.deepEqual(MATERIAL_INTELLIGENCE_360_PLACEHOLDER_SECTIONS, []);
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
