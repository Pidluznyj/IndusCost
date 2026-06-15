import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOtherCostNotes,
  computeOtherCostLineTotal,
  findOtherCostBatchItems,
  isGuidedOtherCostItem,
  loadOtherCostBatchLines,
  parseOtherCostLineDetail,
  parseOtherCostMeta,
  resolveOtherCostItemLineTotal,
  simulatedItemToOtherCostLine,
  sumOtherCostLines,
} from "./projectsOtherCostGroups.js";
import { listAmortizableCostSources, validateAmortizationSourceRef } from "./projectsCostAmortization.js";
import type { ProjectDetail, ProjectSimulatedItemRow } from "@/src/types/projects.js";

function otherCostItem(
  id: string,
  batchId: string,
  description: string,
  cost: number,
  detail?: { quantity: number; unitCost: number }
): ProjectSimulatedItemRow {
  return {
    id,
    provisionalCode: null,
    description,
    itemType: "OTHER",
    unit: "UN",
    estimatedUnitCost: cost,
    quotedUnitCost: cost,
    supplierName: detail ? "Interno" : null,
    leadTimeDays: null,
    estimatedWeight: null,
    lossPercent: 0,
    requiresQuotation: false,
    requiresEngineeringReview: false,
    canBecomeOfficial: false,
    notes: buildOtherCostNotes(
      "OTHER",
      batchId,
      detail ? { quantity: detail.quantity, unitCost: detail.unitCost } : undefined
    ),
  };
}

describe("projectsOtherCostGroups", () => {
  it("identifica itens guiados de outros custos", () => {
    assert.equal(isGuidedOtherCostItem(buildOtherCostNotes("FREIGHT", "b1")), true);
    assert.equal(isGuidedOtherCostItem("notas comuns"), false);
  });

  it("agrupa linhas por batch", () => {
    const items = [
      otherCostItem("a", "batch-1", "Try-out", 1000),
      otherCostItem("b", "batch-1", "Frete", 500),
      otherCostItem("c", "batch-2", "Outro", 200),
    ];
    const batch1 = loadOtherCostBatchLines(items, "batch-1");
    assert.equal(batch1.length, 2);
    assert.equal(findOtherCostBatchItems(items, "batch-1").length, 2);
  });

  it("linha com quantidade 1000 e valor unitário 123 calcula total 123000", () => {
    assert.equal(computeOtherCostLineTotal(1000, 123), 123_000);
  });

  it("serializa e restaura quantity e unitCost", () => {
    const notes = buildOtherCostNotes("OTHER", "batch-det", {
      quantity: 1000,
      unitCost: 123,
    });
    const detail = parseOtherCostLineDetail(notes);
    assert.deepEqual(detail, { quantity: 1000, unitCost: 123 });

    const item = otherCostItem("x", "batch-det", "Horas de engenharia", 123_000, {
      quantity: 1000,
      unitCost: 123,
    });
    const line = simulatedItemToOtherCostLine(item);
    assert.equal(line.quantity, 1000);
    assert.equal(line.unitCost, 123);
    assert.equal(line.totalCost, 123_000);
    assert.equal(line.description, "Horas de engenharia");
    assert.equal(line.supplierName, "Interno");
  });

  it("não transforma total salvo em valor unitário ao reabrir", () => {
    const item = otherCostItem("x", "batch-9", "Horas de engenharia", 123_000, {
      quantity: 1000,
      unitCost: 123,
    });
    const line = simulatedItemToOtherCostLine(item);
    assert.notEqual(line.unitCost, 123_000);
    assert.equal(line.unitCost, 123);
    assert.equal(line.quantity, 1000);
  });

  it("total do lote é soma de quantity × unitCost", () => {
    const items = [
      otherCostItem("a", "batch-sum", "A", 123_000, { quantity: 1000, unitCost: 123 }),
      otherCostItem("b", "batch-sum", "B", 500, { quantity: 1, unitCost: 500 }),
    ];
    const loaded = loadOtherCostBatchLines(items, "batch-sum");
    assert.equal(sumOtherCostLines(loaded), 123_500);
    assert.equal(
      findOtherCostBatchItems(items, "batch-sum").reduce(
        (acc, item) => acc + resolveOtherCostItemLineTotal(item),
        0
      ),
      123_500
    );
  });

  it("dados legados sem detalhamento usam fallback quantity=1 e unitCost=total", () => {
    const item: ProjectSimulatedItemRow = {
      ...otherCostItem("x", "batch-legacy", "Protótipo", 3200),
      notes: buildOtherCostNotes("TEST", "batch-legacy"),
    };
    const line = simulatedItemToOtherCostLine(item);
    assert.equal(line.description, "Protótipo");
    assert.equal(line.quantity, 1);
    assert.equal(line.unitCost, 3200);
    assert.equal(line.totalCost, 3200);
    assert.equal(parseOtherCostMeta(item.notes).group, "TEST");
  });

  it("não retorna NaN/Infinity no cálculo de linha", () => {
    assert.equal(Number.isFinite(computeOtherCostLineTotal(Number.NaN, 10)), true);
    assert.equal(Number.isFinite(computeOtherCostLineTotal(5, Number.POSITIVE_INFINITY)), true);
    assert.equal(computeOtherCostLineTotal(Number.NaN, 10), 0);
  });

  it("amortização OTHER_COST continua usando total do lote", () => {
    const batchId = "other-cost-batch-11111111-1111-1111-1111-111111111111";
    const detail = {
      id: "dddddddd-dddd-4111-8111-dddddddddddd",
      simulatedItems: [
        otherCostItem("a", batchId, "Projeto 3d", 123_000, { quantity: 1000, unitCost: 123 }),
      ],
      molds: [],
    } as unknown as ProjectDetail;

    const source = listAmortizableCostSources(detail).find((s) => s.sourceType === "OTHER_COST");
    assert.equal(source?.totalCost, 123_000);
    assert.equal(validateAmortizationSourceRef(detail, "OTHER_COST", batchId).ok, true);
  });
});
