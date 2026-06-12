import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyReviewDecisionsToEffectiveBom } from "./nomusBomReviewDecision.js";
import type {
  EffectivePricingBomLine,
  EffectivePricingBomResult,
  ReviewDecisionView,
} from "./nomusEffectivePricingBomTypes.js";

function makeBaseResult(): EffectivePricingBomResult {
  return {
    generatedAt: new Date().toISOString(),
    parentCode: "610.04AA",
    selectedList: null,
    optionalPricingStatus: "NO_OPTIONALS",
    status: "READY_FOR_PRICING_PREVIEW",
    summary: {
      includedLinesCount: 0,
      excludedLinesCount: 0,
      reviewLinesCount: 0,
      blockedLinesCount: 0,
      requiredIncludedCount: 0,
      optionalSelectedCount: 0,
      optionalExcludedCount: 0,
      unresolvedComponentsCount: 0,
      recursiveNodesCount: 0,
      localReviewPendingCount: 0,
      localReviewResolvedCount: 0,
      localIncludedByReviewCount: 0,
      localExcludedByReviewCount: 0,
      operationalRoutingReviewCount: 0,
    },
    directLines: [],
    excludedLines: [],
    reviewLines: [],
    localReviewCatalog: [],
    warnings: [],
  };
}

function makeLocalLine(componentCode: string, bomLineId: string, quantity = 1): EffectivePricingBomLine {
  return {
    componentCode,
    quantity,
    source: "LOCAL_ONLY_INDUS_REVIEW",
    decision: "REVIEW",
    includedForPricing: false,
    reason: "Somente IndusCost",
    flags: {
      hasOptionalNomusLines: false,
      hasAlternativeNomusLines: false,
      hasPreferredNomusLines: false,
      hasShipmentItemNomusLines: false,
    },
    nomusSourceLineIds: [],
    productBomLineId: bomLineId,
    resolution: `indus_bom:${bomLineId}`,
  };
}

function savedDecision(
  bomLineId: string,
  componentCode: string,
  decision: ReviewDecisionView["decision"],
  fingerprint: string | null = "hash-old"
): ReviewDecisionView {
  return {
    id: `dec-${bomLineId}`,
    parentCode: "610.04AA",
    parentProductId: null,
    productBomLineId: bomLineId,
    componentCode,
    componentDescription: null,
    quantitySnapshot: 1,
    decision,
    includeForPricing: decision === "INCLUDE_AS_LOCAL_EXCEPTION",
    relatedNomusComponentCode: null,
    reason: null,
    notes: null,
    decidedBy: "eng",
    decidedAt: new Date().toISOString(),
    nomusStructureFingerprint: fingerprint,
  };
}

describe("decisão persistida com fingerprint — governança", () => {
  const universe = new Set(["307.07A", "610.04AA"]);

  it("mesma estrutura: decisão INCLUDE herdada não volta pendente", () => {
    const raw = [makeLocalLine("307.07A", "bom-child")];
    const result = applyReviewDecisionsToEffectiveBom(
      makeBaseResult(),
      [savedDecision("bom-child", "307.07A", "INCLUDE_AS_LOCAL_EXCEPTION", "fp-same")],
      raw,
      { nomusUniverse: universe, lineComponentKinds: new Map([["bom-child", "PRODUCT"]]) },
      "fp-same"
    );
    assert.equal(result.summary.localReviewPendingCount, 0);
    assert.ok(result.directLines.some((l) => l.componentCode === "307.07A"));
  });

  it("fingerprint mudou mas linha local igual: decisão ainda vale", () => {
    const raw = [makeLocalLine("307.07A", "bom-child")];
    const result = applyReviewDecisionsToEffectiveBom(
      makeBaseResult(),
      [savedDecision("bom-child", "307.07A", "INCLUDE_AS_LOCAL_EXCEPTION", "fp-old")],
      raw,
      { nomusUniverse: universe, lineComponentKinds: new Map([["bom-child", "PRODUCT"]]) },
      "fp-new"
    );
    assert.equal(result.summary.localReviewPendingCount, 0);
  });

  it("fingerprint mudou e quantidade local mudou: volta pendente", () => {
    const raw = [makeLocalLine("307.07A", "bom-child", 5)];
    const result = applyReviewDecisionsToEffectiveBom(
      makeBaseResult(),
      [savedDecision("bom-child", "307.07A", "INCLUDE_AS_LOCAL_EXCEPTION", "fp-old")],
      raw,
      { nomusUniverse: universe, lineComponentKinds: new Map([["bom-child", "PRODUCT"]]) },
      "fp-new"
    );
    assert.equal(result.summary.localReviewPendingCount, 1);
  });
});
