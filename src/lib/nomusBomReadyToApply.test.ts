import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyAutoApplyProduct,
} from "./nomusAutoApplyBomDashboard";
import {
  computeAutoApplyStatusTotals,
  computeFilterCounts,
  enrichDashboardProductRow,
  filterDashboardProducts,
} from "./nomusAutoApplyBomDashboardShared";
import { isEligibleForBatchApply } from "./nomusBomApplyStatus";
import type { NomusBomAutoApplyProductResult } from "./nomusBomAutoApplyAfterSyncTypes";
import type { AutoApplyBomDashboardProductRow } from "./nomusAutoApplyBomDashboardTypes";

function readyRow(parentCode: string): AutoApplyBomDashboardProductRow {
  const product: NomusBomAutoApplyProductResult = {
    parentCode,
    productId: "p1",
    status: "READY_TO_APPLY",
    canApply: true,
    blockingReasons: [],
    actionsPreview: [
      { actionType: "UPDATE_PRODUCT_BOM_QUANTITY", componentCode: "115.01--", currentQuantity: 1, effectiveQuantity: 2 },
    ],
  };
  const classified = classifyAutoApplyProduct(product);
  return enrichDashboardProductRow({
    parentCode: product.parentCode,
    productId: product.productId,
    status: product.status,
    canApply: product.canApply,
    blockingReasons: product.blockingReasons,
    ...classified,
    pendingTypeLabel: "",
    recommendedAction: "",
    recommendedTab: "overview",
    severity: 0,
    actionsCount: 0,
    actionsSummaryLines: [],
    readyToApply: false,
    hasUnappliedBomDiff: false,
    appliedToOfficialBom: false,
    planHash: null,
    confirmationRequiredText: null,
    diffSummary: "",
  });
}

describe("nomusBomReadyToApply — dashboard", () => {
  it("card Prontos para aplicar soma corretamente", () => {
    const products: NomusBomAutoApplyProductResult[] = [
      {
        parentCode: "A",
        productId: "1",
        status: "READY_TO_APPLY",
        canApply: true,
        blockingReasons: [],
        actionsPreview: [{ actionType: "CREATE_PRODUCT_BOM_LINE", componentCode: "X" }],
      },
      {
        parentCode: "B",
        productId: "2",
        status: "NO_CHANGES",
        canApply: true,
        blockingReasons: [],
      },
    ];
    const totals = computeAutoApplyStatusTotals(products);
    assert.equal(totals.parentsReadyToApply, 1);
    assert.equal(totals.parentsNoChanges, 1);
  });

  it("filtro READY_TO_APPLY mostra somente prontos", () => {
    const rows = [readyRow("610.01AA"), readyRow("610.02AA")];
    rows.push(
      enrichDashboardProductRow({
        ...readyRow("610.03AA"),
        status: "BLOCKED",
        canApply: false,
        blockingReasons: ["Bloqueado"],
        filterBuckets: ["BLOCKED"],
        readyToApply: false,
      })
    );
    const filtered = filterDashboardProducts(rows, { filter: "READY_TO_APPLY" });
    assert.equal(filtered.length, 2);
    assert.ok(filtered.every((r) => r.readyToApply));
  });

  it("computeFilterCounts inclui READY_TO_APPLY", () => {
    const counts = computeFilterCounts([readyRow("610.01AA")]);
    assert.equal(counts.READY_TO_APPLY, 1);
  });

  it("linha ready mostra recomendação de aplicar ProductBOM", () => {
    const row = readyRow("610.10AA");
    assert.equal(row.readyToApply, true);
    assert.ok(/aplicar/i.test(row.recommendedAction));
    assert.equal(row.pendingTypeLabel, "Corrigido / aguardando apply");
  });

  it("bloqueados não são elegíveis para lote", () => {
    assert.equal(
      isEligibleForBatchApply({
        parentCode: "X",
        productId: "p",
        status: "BLOCKED",
        canApply: false,
        blockingReasons: ["bloqueio"],
      }),
      false
    );
    assert.equal(
      isEligibleForBatchApply({
        parentCode: "Y",
        productId: "p",
        status: "READY_TO_APPLY",
        canApply: true,
        blockingReasons: [],
        actionsPreview: [{ actionType: "UPDATE_PRODUCT_BOM_QUANTITY", componentCode: "A" }],
      }),
      true
    );
  });
});
