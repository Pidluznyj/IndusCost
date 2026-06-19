import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyNomusBomApplyStatus,
  hasMutatingApplyActions,
  hasUnappliedBomDiff,
  isNomusProductReadyToApply,
  reconcileReportProductStatus,
  summarizeApplyActions,
} from "./nomusBomApplyStatus";
import type { NomusBomAutoApplyProductResult } from "./nomusBomAutoApplyAfterSyncTypes";

function product(
  overrides: Partial<NomusBomAutoApplyProductResult> & Pick<NomusBomAutoApplyProductResult, "parentCode">
): NomusBomAutoApplyProductResult {
  return {
    productId: "p1",
    status: "BLOCKED",
    canApply: false,
    blockingReasons: [],
    ...overrides,
  };
}

describe("nomusBomApplyStatus", () => {
  it("produto bloqueado não entra em ready_to_apply", () => {
    const input = product({
      parentCode: "610.01AA",
      status: "BLOCKED",
      canApply: false,
      blockingReasons: ["Opcionais pendentes."],
      actionsPreview: [
        { actionType: "UPDATE_PRODUCT_BOM_QUANTITY", componentCode: "115.01--" },
      ],
    });
    const c = classifyNomusBomApplyStatus(input);
    assert.equal(c.uiStatus, "blocked");
    assert.equal(c.readyToApply, false);
    assert.equal(isNomusProductReadyToApply(input), false);
  });

  it("produto ignorado não entra em ready_to_apply", () => {
    const input = product({
      parentCode: "999.99",
      productId: null,
      status: "SKIPPED",
      canApply: false,
      blockingReasons: ["Produto não cadastrado no IndusCost."],
    });
    const c = classifyNomusBomApplyStatus(input);
    assert.equal(c.uiStatus, "ignored");
    assert.equal(c.readyToApply, false);
  });

  it("produto com erro não entra em ready_to_apply", () => {
    const input = product({
      parentCode: "610.02AA",
      status: "ERROR",
      errorMessage: "Falha técnica",
      canApply: false,
    });
    const c = classifyNomusBomApplyStatus(input);
    assert.equal(c.uiStatus, "error");
    assert.equal(c.readyToApply, false);
  });

  it("produto sem alteração fica unchanged", () => {
    const input = product({
      parentCode: "610.03AA",
      status: "NO_CHANGES",
      canApply: true,
      actionsPreview: [{ actionType: "KEEP_PRODUCT_BOM_LINE", componentCode: "980.01--" }],
    });
    const c = classifyNomusBomApplyStatus(input);
    assert.equal(c.uiStatus, "unchanged");
    assert.equal(c.readyToApply, false);
  });

  it("produto aplicado com applyRunId não entra em ready", () => {
    const input = product({
      parentCode: "610.04AA",
      status: "APPLIED",
      canApply: true,
      applyRunId: "run-123",
      resultStatus: "APPLIED",
      actionsPreview: [
        { actionType: "UPDATE_PRODUCT_BOM_QUANTITY", componentCode: "115.01--" },
      ],
    });
    const c = classifyNomusBomApplyStatus(input);
    assert.equal(c.uiStatus, "applied");
    assert.equal(c.appliedToOfficialBom, true);
    assert.equal(c.readyToApply, false);
  });

  it("produto sem bloqueio + diff não aplicado entra em ready_to_apply", () => {
    const input = product({
      parentCode: "610.05AA",
      status: "READY_TO_APPLY",
      canApply: true,
      actionsPreview: [
        { actionType: "UPDATE_PRODUCT_BOM_NOMUS_METADATA", componentCode: "132.01--" },
      ],
    });
    const c = classifyNomusBomApplyStatus(input);
    assert.equal(c.uiStatus, "ready_to_apply");
    assert.equal(c.readyToApply, true);
    assert.equal(c.hasUnappliedBomDiff, true);
    assert.equal(c.recommendation, "Aplicar atualização na ProductBOM");
  });

  it("mudança real de quantidade gera diff real", () => {
    const actions = [
      {
        actionType: "UPDATE_PRODUCT_BOM_QUANTITY",
        componentCode: "115.01--",
        currentQuantity: 1,
        effectiveQuantity: 2,
      },
    ];
    assert.equal(hasMutatingApplyActions(actions), true);
    assert.equal(hasUnappliedBomDiff({ canApply: true, actionsPreview: actions }), true);
    const summary = summarizeApplyActions(actions);
    assert.equal(summary.update, 1);
  });

  it("KEEP sozinho não gera diff falso", () => {
    const actions = [{ actionType: "KEEP_PRODUCT_BOM_LINE", componentCode: "980.01--" }];
    assert.equal(hasMutatingApplyActions(actions), false);
    assert.equal(hasUnappliedBomDiff({ canApply: true, actionsPreview: actions }), false);
  });

  it("reconcile converte APPLIED legado sem applyRunId para READY_TO_APPLY", () => {
    const reconciled = reconcileReportProductStatus(
      product({
        parentCode: "610.06AA",
        status: "APPLIED",
        canApply: true,
        actionsPreview: [
          { actionType: "CREATE_PRODUCT_BOM_LINE", componentCode: "121.25--", effectiveQuantity: 1 },
        ],
      })
    );
    assert.equal(reconciled.status, "READY_TO_APPLY");
  });
});
