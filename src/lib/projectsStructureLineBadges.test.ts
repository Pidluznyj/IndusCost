import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isLineRecalculatedFromRollup,
  resolveMissingCostReason,
  resolveStructureLineBadges,
} from "./projectsStructureLineBadges.js";
import type { ProjectStructureLineRow } from "@/src/types/projects.js";

function line(
  partial: Partial<ProjectStructureLineRow>
): ProjectStructureLineRow {
  return {
    id: "l1",
    simulatedProductId: null,
    parentLineId: null,
    level: 1,
    treePath: null,
    snapshotRootProductId: "root",
    lineType: "COMPONENT",
    sourceType: "EXISTING_PRODUCT",
    existingProductId: "p1",
    existingMaterialId: null,
    simulatedItemId: null,
    sourceOfficialBomId: null,
    sourceOfficialRoutingId: null,
    descriptionSnapshot: "612.04AA — Filho",
    unitSnapshot: "UN",
    quantity: 1,
    lossPercent: 0,
    officialQuantitySnapshot: 1,
    officialLossPercentSnapshot: 0,
    officialUnitCostSnapshot: 10,
    unitCostSnapshot: 10,
    totalCost: 10,
    costSource: "OFFICIAL_COST_ANALYSIS",
    isChangedFromOfficial: false,
    isMissingCost: false,
    countsInSimulatedProductCost: true,
    supplierNameSnapshot: null,
    notes: null,
    sortOrder: 1,
    ...partial,
  };
}

describe("projectsStructureLineBadges", () => {
  it("Alterado só quando isChangedFromOfficial=true", () => {
    const badges = resolveStructureLineBadges(line({ isChangedFromOfficial: true }));
    assert.ok(badges.some((b) => b.label === "Alterado"));
    assert.ok(!badges.some((b) => b.label === "Recalculado"));
  });

  it("rollup técnico exibe Recalculado quando total diverge sem flag manual", () => {
    const badges = resolveStructureLineBadges(
      line({
        officialUnitCostSnapshot: 10,
        unitCostSnapshot: 10,
        totalCost: 11,
        isChangedFromOfficial: false,
      })
    );
    assert.ok(badges.some((b) => b.label === "Recalculado"));
    assert.ok(!badges.some((b) => b.label === "Alterado"));
  });

  it("isLineRecalculatedFromRollup detecta delta propagado no totalCost", () => {
    assert.equal(
      isLineRecalculatedFromRollup(
        line({
          officialUnitCostSnapshot: 0.295645,
          unitCostSnapshot: 0.295645,
          totalCost: 0.305645,
          isChangedFromOfficial: false,
        })
      ),
      true
    );
  });

  it("Sem custo com motivo para material", () => {
    const reason = resolveMissingCostReason(
      line({
        lineType: "RAW_MATERIAL",
        sourceType: "EXISTING_MATERIAL",
        costSource: "MISSING",
        unitCostSnapshot: 0,
        isMissingCost: true,
      })
    );
    assert.equal(reason, "Material sem custo");
    const badges = resolveStructureLineBadges(
      line({
        lineType: "RAW_MATERIAL",
        sourceType: "EXISTING_MATERIAL",
        costSource: "MISSING",
        unitCostSnapshot: 0,
        isMissingCost: true,
      })
    );
    const missing = badges.find((b) => b.label === "Sem custo");
    assert.equal(missing?.title, "Material sem custo");
  });

  it("Material da base e Componente do projeto exibem badges de origem", () => {
    const materialBadges = resolveStructureLineBadges(
      line({
        sourceType: "EXISTING_MATERIAL",
        lineType: "RAW_MATERIAL",
        existingMaterialId: "mat-1",
        snapshotRootProductId: null,
        simulatedProductId: "sim-prod",
      })
    );
    assert.ok(materialBadges.some((b) => b.label === "Material da base"));
    assert.ok(materialBadges.some((b) => b.label === "Somente projeto"));

    const itemBadges = resolveStructureLineBadges(
      line({
        sourceType: "SIMULATED_ITEM",
        simulatedItemId: "item-1",
        snapshotRootProductId: null,
        simulatedProductId: "sim-prod",
      })
    );
    assert.ok(itemBadges.some((b) => b.label === "Componente do projeto"));
  });

  it("Sem custo com motivo para processo", () => {
    assert.equal(
      resolveMissingCostReason(
        line({
          lineType: "PROCESS",
          unitSnapshot: "HH",
          costSource: "OFFICIAL_ROUTING",
          unitCostSnapshot: 0,
          isMissingCost: true,
        })
      ),
      "Processo sem custo"
    );
  });
});
