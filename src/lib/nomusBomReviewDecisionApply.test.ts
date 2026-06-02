import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyReviewDecisionsToEffectiveBom } from "./nomusBomReviewDecision";
import { isProductBomRowEligibleForExcludedComponentRemoval } from "./nomusBomControlledApplyRemoval";
import type {
  EffectivePricingBomLine,
  EffectivePricingBomResult,
  ReviewDecisionView,
} from "./nomusEffectivePricingBomTypes";

function makeBaseResult(overrides?: Partial<EffectivePricingBomResult>): EffectivePricingBomResult {
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
    ...overrides,
  };
}

function makeLocalLine(
  componentCode: string,
  bomLineId: string,
  quantity = 1
): EffectivePricingBomLine {
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
  decision: ReviewDecisionView["decision"]
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
  };
}

describe("applyReviewDecisionsToEffectiveBom — decisões locais (apply)", () => {
  const universe = new Set(["307.07A", "309.02A", "610.04AA"]);

  it("INCLUDE_AS_LOCAL_EXCEPTION → directLines, não pendente, preserva REMOVE", () => {
    const raw = [makeLocalLine("307.07A", "bom-child")];
    const result = applyReviewDecisionsToEffectiveBom(
      makeBaseResult(),
      [savedDecision("bom-child", "307.07A", "INCLUDE_AS_LOCAL_EXCEPTION")],
      raw,
      {
        nomusUniverse: universe,
        lineComponentKinds: new Map([["bom-child", "PRODUCT"]]),
      }
    );

    const included = result.directLines.find((l) => l.componentCode === "307.07A");
    assert.ok(included);
    assert.equal(included?.source, "LOCAL_ONLY_INCLUDED_BY_REVIEW");
    assert.equal(included?.includedForPricing, true);
    assert.equal(result.status, "READY_WITH_LOCAL_REVIEW");
    assert.equal(result.summary.localReviewPendingCount, 0);
    assert.equal(
      isProductBomRowEligibleForExcludedComponentRemoval({
        componentCode: "307.07A",
        reviewDecisionType: "INCLUDE_AS_LOCAL_EXCEPTION",
      }),
      false
    );
  });

  it("EXCLUDE_FROM_PRICING → excludedLines, elegível a REMOVE", () => {
    const raw = [makeLocalLine("309.02A", "bom-mp")];
    const result = applyReviewDecisionsToEffectiveBom(
      makeBaseResult(),
      [savedDecision("bom-mp", "309.02A", "EXCLUDE_FROM_PRICING")],
      raw,
      { nomusUniverse: universe, lineComponentKinds: new Map([["bom-mp", "MATERIAL"]]) }
    );

    assert.equal(result.excludedLines.length, 1);
    assert.equal(result.excludedLines[0]?.source, "LOCAL_ONLY_EXCLUDED_BY_REVIEW");
    assert.equal(result.directLines.some((l) => l.componentCode === "309.02A"), false);
    assert.equal(
      isProductBomRowEligibleForExcludedComponentRemoval({
        componentCode: "309.02A",
        reviewDecisionType: "EXCLUDE_FROM_PRICING",
      }),
      true
    );
  });

  it("NEEDS_ENGINEERING_REVIEW → catalog engineering_review, não incluído na BOM efetiva", () => {
    const raw = [makeLocalLine("309.71A", "bom-eng")];
    const result = applyReviewDecisionsToEffectiveBom(
      makeBaseResult(),
      [savedDecision("bom-eng", "309.71A", "NEEDS_ENGINEERING_REVIEW")],
      raw,
      { nomusUniverse: universe }
    );

    const catalog = result.localReviewCatalog[0];
    assert.equal(catalog?.placement, "engineering_review");
    assert.equal(catalog?.savedDecision?.decision, "NEEDS_ENGINEERING_REVIEW");
    assert.equal(result.directLines.some((l) => l.includedForPricing && l.componentCode === "309.71A"), false);
    assert.equal(result.summary.localReviewPendingCount, 0);
  });

  it("subproduto (PRODUCT) no universo Nomus não recebe auto-exclusão", () => {
    const raw = [makeLocalLine("309.02A", "bom-prod")];
    const result = applyReviewDecisionsToEffectiveBom(makeBaseResult(), [], raw, {
      nomusUniverse: universe,
      lineComponentKinds: new Map([["bom-prod", "PRODUCT"]]),
    });

    assert.equal(result.status, "PENDING_LOCAL_REVIEW");
    assert.equal(result.summary.localReviewPendingCount, 1);
    assert.equal(result.excludedLines.length, 0);
    assert.equal(result.localReviewCatalog[0]?.indusComponentKind, "PRODUCT");
    assert.equal(result.localReviewCatalog[0]?.placement, "pending_review");
    const saved = result.localReviewCatalog[0]?.savedDecision;
    assert.ok(!saved || saved.decision === "PENDING");
  });
});
