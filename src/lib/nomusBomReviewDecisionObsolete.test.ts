import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyReviewDecisionsToEffectiveBom } from "./nomusBomReviewDecision";
import { AUTO_OBSOLETE_NOMUS_UNIVERSE_REASON } from "./nomusBomUniverse";
import type {
  EffectivePricingBomLine,
  EffectivePricingBomResult,
} from "./nomusEffectivePricingBomTypes";

function makeBaseResult(overrides?: Partial<EffectivePricingBomResult>): EffectivePricingBomResult {
  return {
    generatedAt: new Date().toISOString(),
    parentCode: "301.08AA",
    selectedList: null,
    optionalPricingStatus: "NO_OPTIONALS",
    status: "READY_FOR_PRICING_PREVIEW",
    summary: {
      includedLinesCount: 1,
      excludedLinesCount: 0,
      reviewLinesCount: 0,
      blockedLinesCount: 0,
      requiredIncludedCount: 1,
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
    directLines: [
      {
        componentCode: "301.04AA",
        quantity: 1,
        source: "NOMUS_REQUIRED",
        decision: "INCLUDE",
        includedForPricing: true,
        reason: "Obrigatório Nomus",
        flags: {
          hasOptionalNomusLines: false,
          hasAlternativeNomusLines: false,
          hasPreferredNomusLines: false,
          hasShipmentItemNomusLines: false,
        },
        nomusSourceLineIds: [1],
      },
    ],
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
  quantity = 0.5
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

describe("applyReviewDecisionsToEffectiveBom — linhas obsoletas Nomus", () => {
  const universe = new Set(["115.03--", "140.04--", "301.04AA"]);

  it("301.08AA: MPs no universo Nomus geram exclusão automática e não ficam pendentes", () => {
    const raw = [
      makeLocalLine("115.03--", "bom-115"),
      makeLocalLine("140.04--", "bom-140"),
    ];
    const result = applyReviewDecisionsToEffectiveBom(makeBaseResult(), [], raw, {
      nomusUniverse: universe,
    });

    assert.notEqual(result.status, "PENDING_LOCAL_REVIEW");
    assert.equal(result.summary.localReviewPendingCount, 0);
    assert.equal(result.excludedLines.length, 2);
    assert.deepEqual(
      result.excludedLines.map((l) => l.componentCode).sort(),
      ["115.03--", "140.04--"]
    );
    assert.ok(result.excludedLines.every((l) => l.source === "LOCAL_ONLY_OBSOLETE_NOMUS"));
    assert.ok(
      result.excludedLines.every((l) =>
        l.reason.includes(AUTO_OBSOLETE_NOMUS_UNIVERSE_REASON.slice(0, 20))
      )
    );
  });

  it("código fora do universo Nomus permanece em revisão pendente", () => {
    const raw = [makeLocalLine("LOCAL.99--", "bom-local")];
    const result = applyReviewDecisionsToEffectiveBom(makeBaseResult(), [], raw, {
      nomusUniverse: universe,
    });

    assert.equal(result.status, "PENDING_LOCAL_REVIEW");
    assert.equal(result.summary.localReviewPendingCount, 1);
    assert.equal(result.reviewLines.length, 1);
    assert.equal(result.reviewLines[0]?.source, "LOCAL_ONLY_INDUS_REVIEW");
    assert.equal(result.excludedLines.length, 0);
  });

  it("800.xx permanece incluído como exceção local, não obsoleto", () => {
    const raw = [makeLocalLine("800.01--", "bom-800")];
    const result = applyReviewDecisionsToEffectiveBom(makeBaseResult(), [], raw, {
      nomusUniverse: new Set(["800.01--"]),
    });

    assert.equal(result.directLines.some((l) => l.componentCode === "800.01--"), true);
    assert.equal(result.summary.localReviewPendingCount, 0);
    assert.equal(result.excludedLines.length, 0);
  });

  it("localException=true impede auto-remoção", () => {
    const raw = [makeLocalLine("115.03--", "bom-protected")];
    const result = applyReviewDecisionsToEffectiveBom(makeBaseResult(), [], raw, {
      nomusUniverse: universe,
      localRowFlags: new Map([["bom-protected", { localException: true }]]),
    });

    assert.equal(result.status, "PENDING_LOCAL_REVIEW");
    assert.equal(result.reviewLines.length, 1);
    assert.equal(result.excludedLines.length, 0);
  });

  it("decisão humana INCLUDE_AS_LOCAL_EXCEPTION impede auto-remoção", () => {
    const raw = [makeLocalLine("115.03--", "bom-keep")];
    const result = applyReviewDecisionsToEffectiveBom(
      makeBaseResult(),
      [
        {
          id: "dec-1",
          parentCode: "301.08AA",
          parentProductId: null,
          productBomLineId: "bom-keep",
          componentCode: "115.03--",
          componentDescription: null,
          quantitySnapshot: 0.5,
          decision: "INCLUDE_AS_LOCAL_EXCEPTION",
          includeForPricing: true,
          relatedNomusComponentCode: null,
          reason: "Manter por decisão humana",
          notes: null,
          decidedBy: "eng",
          decidedAt: new Date().toISOString(),
        },
      ],
      raw,
      { nomusUniverse: universe }
    );

    assert.equal(result.directLines.some((l) => l.componentCode === "115.03--"), true);
    assert.equal(result.excludedLines.length, 0);
    assert.equal(result.summary.localReviewPendingCount, 0);
  });

  it("decisão humana EXCLUDE manual usa LOCAL_ONLY_EXCLUDED_BY_REVIEW", () => {
    const raw = [makeLocalLine("115.03--", "bom-excluded")];
    const result = applyReviewDecisionsToEffectiveBom(
      makeBaseResult(),
      [
        {
          id: "dec-2",
          parentCode: "301.08AA",
          parentProductId: null,
          productBomLineId: "bom-excluded",
          componentCode: "115.03--",
          componentDescription: null,
          quantitySnapshot: 0.5,
          decision: "EXCLUDE_FROM_PRICING",
          includeForPricing: false,
          relatedNomusComponentCode: null,
          reason: "Excluído manualmente",
          notes: null,
          decidedBy: "eng",
          decidedAt: new Date().toISOString(),
        },
      ],
      raw,
      { nomusUniverse: universe }
    );

    assert.equal(result.excludedLines.length, 1);
    assert.equal(result.excludedLines[0]?.source, "LOCAL_ONLY_EXCLUDED_BY_REVIEW");
    assert.equal(result.summary.localReviewPendingCount, 0);
  });
});

describe("applyReviewDecisionsToEffectiveBom — apply simulado (linesRemoved)", () => {
  it("linhas obsoletas contam como excluídas resolvidas (removíveis no apply)", () => {
    const raw = [makeLocalLine("115.03--", "bom-115"), makeLocalLine("140.04--", "bom-140")];
    const result = applyReviewDecisionsToEffectiveBom(makeBaseResult(), [], raw, {
      nomusUniverse: new Set(["115.03--", "140.04--"]),
    });

    assert.equal(result.summary.localReviewResolvedCount, 2);
    assert.equal(result.summary.localExcludedByReviewCount, 2);
    assert.equal(result.summary.localReviewPendingCount, 0);
  });
});
