import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NomusBomAutoApplyProductResult } from "./nomusBomAutoApplyAfterSyncTypes";
import { classifyAutoApplyProduct } from "./nomusAutoApplyBomDashboard";
import {
  computeAutoApplyStatusTotals,
  computeFilterCounts,
  enrichDashboardProductRow,
} from "./nomusAutoApplyBomDashboardShared";

function product(
  parentCode: string,
  status: NomusBomAutoApplyProductResult["status"],
  blockingReasons: string[] = [],
  errorMessage?: string
): NomusBomAutoApplyProductResult {
  return {
    parentCode,
    productId: status === "SKIPPED" ? null : `p-${parentCode}`,
    status,
    canApply: status === "NO_CHANGES" || status === "APPLIED",
    blockingReasons,
    errorMessage,
  };
}

function mapRows(products: NomusBomAutoApplyProductResult[]) {
  return products.map((p) =>
    enrichDashboardProductRow({
      parentCode: p.parentCode,
      productId: p.productId,
      status: p.status,
      canApply: p.canApply,
      errorMessage: p.errorMessage,
      ...classifyAutoApplyProduct(p),
      pendingTypeLabel: "",
      recommendedAction: "",
      recommendedTab: "overview",
      severity: 0,
      actionsCount: 0,
      actionsSummaryLines: [],
    })
  );
}

describe("computeAutoApplyStatusTotals", () => {
  it("723/12/133/8/0 soma 876 — caso Central Engenharia", () => {
    const products: NomusBomAutoApplyProductResult[] = [
      ...Array.from({ length: 723 }, (_, i) => product(`NC${i}`, "NO_CHANGES")),
      ...Array.from({ length: 12 }, (_, i) => product(`AP${i}`, "APPLIED")),
      ...Array.from({ length: 133 }, (_, i) =>
        product(`BL${i}`, "BLOCKED", ["BOM efetiva bloqueada ou incompleta."])
      ),
      ...Array.from({ length: 8 }, (_, i) =>
        product(`SK${i}`, "SKIPPED", ["Produto não cadastrado no IndusCost."])
      ),
    ];

    const totals = computeAutoApplyStatusTotals(products, {
      parentsInNomusStage: 900,
      parentsEvaluated: 876,
      parentsApplied: 12,
      parentsNoChanges: 723,
      parentsBlocked: 0,
      parentsSkipped: 0,
      parentsErrored: 141,
      linesCreated: 0,
      linesUpdated: 0,
      linesRemoved: 0,
      linesKept: 0,
    });

    assert.equal(totals.parentsEvaluated, 876);
    assert.equal(totals.parentsNoChanges, 723);
    assert.equal(totals.parentsApplied, 12);
    assert.equal(totals.parentsBlocked, 133);
    assert.equal(totals.parentsSkipped, 8);
    assert.equal(totals.parentsErrored, 0);
    assert.equal(
      totals.parentsNoChanges +
        totals.parentsApplied +
        totals.parentsBlocked +
        totals.parentsSkipped +
        totals.parentsErrored,
      876
    );
  });

  it("BLOCKED e SKIPPED não entram em parentsErrored", () => {
    const products = [
      product("311.25AA", "BLOCKED", ["Existem itens locais pendentes."]),
      product("999.01XX", "SKIPPED", ["Produto não cadastrado no IndusCost."]),
      product("ERR.01", "ERROR", [], "timeout preview"),
    ];

    const totals = computeAutoApplyStatusTotals(products);
    assert.equal(totals.parentsBlocked, 1);
    assert.equal(totals.parentsSkipped, 1);
    assert.equal(totals.parentsErrored, 1);
  });

  it("ERROR real continua ERROR", () => {
    const totals = computeAutoApplyStatusTotals([
      product("X1", "ERROR", [], "Falha de preview"),
    ]);
    assert.equal(totals.parentsErrored, 1);
    assert.equal(totals.parentsBlocked, 0);
  });
});

describe("cards vs filtros", () => {
  it("totals.parentsBlocked bate com filterCounts.BLOCKED", () => {
    const products = [
      product("311.25AA", "BLOCKED", ["BOM efetiva bloqueada ou incompleta."]),
      product("308.05AB", "BLOCKED", ["Existem itens locais pendentes."]),
      product("100.01AA", "NO_CHANGES"),
      product("999.01XX", "SKIPPED", ["Produto não cadastrado no IndusCost."]),
    ];
    const rows = mapRows(products);
    const totals = computeAutoApplyStatusTotals(products);
    const filterCounts = computeFilterCounts(rows);

    assert.equal(totals.parentsBlocked, filterCounts.BLOCKED);
    assert.equal(totals.parentsBlocked, 2);
    assert.equal(totals.parentsSkipped, filterCounts.SKIPPED);
    assert.equal(totals.parentsSkipped, 1);
  });
});
