/**
 * Teste fino do comparador legado vs recurso (Prompt 16).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatComparisonMarkdown,
  runLegacyVsResourceComparison,
} from "../../../scripts/compareLegacyVsResourceNavAccess.ts";

describe("compareLegacyVsResourceNavAccess", () => {
  it("matriz de personas: zero revogação involuntária", () => {
    const result = runLegacyVsResourceComparison();
    assert.equal(
      result.ok,
      true,
      `revogações: ${JSON.stringify(result.involuntary, null, 2)}`
    );
    assert.equal(result.summary.involuntaryRevocations, 0);
    assert.ok(result.summary.modulesCompared > 100);
  });

  it("markdown de relatório contém PASS", () => {
    const md = formatComparisonMarkdown(runLegacyVsResourceComparison());
    assert.ok(md.includes("PASS"));
    assert.ok(md.includes("Revogações involuntárias | 0 |"));
  });
});
