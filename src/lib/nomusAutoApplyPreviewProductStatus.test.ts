import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ControlledApplyPreview } from "@/src/lib/nomusBomControlledApplyTypes";
import {
  mapControlledApplyPreviewToAutoApplyProduct,
  shouldRevalidateAutoApplyProductStatus,
} from "./nomusAutoApplyPreviewProductStatus";

function preview(overrides: Partial<ControlledApplyPreview>): ControlledApplyPreview {
  return {
    generatedAt: new Date().toISOString(),
    parentCode: "311.25AA",
    productId: "prod-311",
    canApply: true,
    blockingReasons: [],
    blockingDetails: [],
    warnings: [],
    planHash: "hash",
    effectiveBomHash: "ebom",
    confirmationRequiredText: "APLICAR BOM NOMUS 311.25AA",
    beforeSummary: { lineCount: 1, materialLines: 1, childProductLines: 0 },
    afterSummary: { lineCount: 1, materialLines: 1, childProductLines: 0 },
    actions: [],
    costImpactSummary: null,
    effectiveBomStatus: "READY_FOR_PRICING_PREVIEW",
    optionalPricingStatus: "RESOLVED",
    ...overrides,
  };
}

describe("mapControlledApplyPreviewToAutoApplyProduct", () => {
  it("311.25AA: canApply com só KEEP → NO_CHANGES (não bloqueado)", () => {
    const mapped = mapControlledApplyPreviewToAutoApplyProduct(
      preview({
        canApply: true,
        blockingReasons: [],
        actions: [
          {
            actionType: "KEEP_PRODUCT_BOM_LINE",
            componentCode: "980.01--",
            componentDescription: "Cromagem",
            componentKind: "Material",
            currentQuantity: 1,
            effectiveQuantity: 1,
            riskLevel: "LOW",
            reason: "Linha mantida.",
          },
        ],
      })
    );
    assert.equal(mapped.status, "NO_CHANGES");
    assert.equal(mapped.canApply, true);
    assert.equal(mapped.blockingReasons.length, 0);
  });

  it("bloqueio real por item local pendente permanece BLOCKED", () => {
    const mapped = mapControlledApplyPreviewToAutoApplyProduct(
      preview({
        canApply: false,
        blockingReasons: ["Existem itens locais (somente IndusCost) pendentes de decisão."],
        actions: [],
      })
    );
    assert.equal(mapped.status, "BLOCKED");
    assert.equal(mapped.canApply, false);
  });

  it("opcional pendente permanece BLOCKED", () => {
    const mapped = mapControlledApplyPreviewToAutoApplyProduct(
      preview({
        canApply: false,
        blockingReasons: ["Opcionais de precificação ainda não estão resolvidos."],
      })
    );
    assert.equal(mapped.status, "BLOCKED");
  });

  it("canApply com mutações → READY_TO_APPLY (não APPLIED)", () => {
    const mapped = mapControlledApplyPreviewToAutoApplyProduct(
      preview({
        canApply: true,
        actions: [
          {
            actionType: "UPDATE_PRODUCT_BOM_QUANTITY",
            componentCode: "115.01--",
            componentKind: "Material",
            currentQuantity: 1,
            effectiveQuantity: 2,
            riskLevel: "LOW",
            reason: "Divergência",
          },
        ],
      })
    );
    assert.equal(mapped.status, "READY_TO_APPLY");
    assert.equal(mapped.canApply, true);
  });
});

describe("shouldRevalidateAutoApplyProductStatus", () => {
  it("revalida BLOCKED, READY_TO_APPLY e APPLIED legado sem applyRunId", () => {
    assert.equal(
      shouldRevalidateAutoApplyProductStatus({
        parentCode: "X",
        productId: "p",
        status: "BLOCKED",
        canApply: false,
        blockingReasons: [],
      }),
      true
    );
    assert.equal(
      shouldRevalidateAutoApplyProductStatus({
        parentCode: "X",
        productId: "p",
        status: "READY_TO_APPLY",
        canApply: true,
        blockingReasons: [],
      }),
      true
    );
    assert.equal(
      shouldRevalidateAutoApplyProductStatus({
        parentCode: "X",
        productId: "p",
        status: "APPLIED",
        canApply: true,
        blockingReasons: [],
      }),
      true
    );
    assert.equal(
      shouldRevalidateAutoApplyProductStatus({
        parentCode: "X",
        productId: "p",
        status: "APPLIED",
        canApply: true,
        blockingReasons: [],
        applyRunId: "run-1",
      }),
      false
    );
    assert.equal(
      shouldRevalidateAutoApplyProductStatus({
        parentCode: "X",
        productId: "p",
        status: "NO_CHANGES",
        canApply: true,
        blockingReasons: [],
      }),
      false
    );
  });
});
