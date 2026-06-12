import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { sumSimulatedRootProductCost } from "./projectsEngineeringCostRollup.js";
import {
  buildProjectStructureSnapshotGroups,
  filterPrimaryStructureTableLines,
} from "./projectsStructureSnapshotGroups.js";
import type { ProjectStructureLineRow } from "@/src/types/projects.js";

const ROOT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ROOT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function line(
  partial: Partial<ProjectStructureLineRow> & Pick<ProjectStructureLineRow, "id">
): ProjectStructureLineRow {
  return {
    simulatedProductId: null,
    parentLineId: null,
    level: 0,
    treePath: null,
    snapshotRootProductId: null,
    lineType: "COMPONENT",
    sourceType: "EXISTING_PRODUCT",
    existingProductId: null,
    existingMaterialId: null,
    simulatedItemId: null,
    sourceOfficialBomId: null,
    sourceOfficialRoutingId: null,
    descriptionSnapshot: "CODE — Desc",
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
    sortOrder: 0,
    ...partial,
  };
}

describe("projectsStructureSnapshotGroups", () => {
  it("linhas com mesmo snapshotRootProductId viram um grupo", () => {
    const lines = [
      line({
        id: "l1",
        snapshotRootProductId: ROOT_A,
        parentLineId: null,
        countsInSimulatedProductCost: true,
        totalCost: 50,
      }),
      line({
        id: "l2",
        snapshotRootProductId: ROOT_A,
        parentLineId: "l1",
        countsInSimulatedProductCost: false,
        totalCost: 20,
      }),
      line({
        id: "manual",
        snapshotRootProductId: null,
        sourceType: "MANUAL",
        descriptionSnapshot: "Manual line",
      }),
    ];

    const { snapshotGroups, manualLines } = buildProjectStructureSnapshotGroups(lines, {
      rootProducts: { [ROOT_A]: { sku: "612.02AA", name: "Torneira EGM30 Direita" } },
    });

    assert.equal(snapshotGroups.length, 1);
    assert.equal(snapshotGroups[0]!.rootCode, "612.02AA");
    assert.equal(snapshotGroups[0]!.itemCount, 2);
    assert.equal(manualLines.length, 1);
    assert.equal(manualLines[0]!.id, "manual");
  });

  it("dois produtos importados viram dois grupos", () => {
    const lines = [
      line({ id: "a1", snapshotRootProductId: ROOT_A, totalCost: 10 }),
      line({ id: "b1", snapshotRootProductId: ROOT_B, totalCost: 20 }),
    ];
    const { snapshotGroups } = buildProjectStructureSnapshotGroups(lines, {
      rootProducts: {
        [ROOT_A]: { sku: "612.02AA", name: "Direita" },
        [ROOT_B]: { sku: "612.03AA", name: "Esquerda" },
      },
    });
    assert.equal(snapshotGroups.length, 2);
    assert.deepEqual(
      snapshotGroups.map((g) => g.rootCode).sort(),
      ["612.02AA", "612.03AA"]
    );
  });

  it("linhas internas não aparecem como linhas principais", () => {
    const lines = [
      line({
        id: "root-comp",
        snapshotRootProductId: ROOT_A,
        parentLineId: null,
        countsInSimulatedProductCost: true,
      }),
      line({
        id: "child-mat",
        snapshotRootProductId: ROOT_A,
        parentLineId: "root-comp",
        lineType: "RAW_MATERIAL",
        countsInSimulatedProductCost: false,
      }),
      line({ id: "manual", sourceType: "MANUAL" }),
    ];

    const primary = filterPrimaryStructureTableLines(lines);
    assert.equal(primary.length, 1);
    assert.equal(primary[0]!.id, "manual");
    assert.equal(primary.some((l) => l.id === "child-mat"), false);
  });

  it("agrupamento visual não altera total simulado do projeto", () => {
    const lines = [
      line({
        id: "c1",
        snapshotRootProductId: ROOT_A,
        countsInSimulatedProductCost: true,
        unitCostSnapshot: 50,
        officialUnitCostSnapshot: 50,
        totalCost: 50,
      }),
      line({
        id: "m1",
        snapshotRootProductId: ROOT_A,
        parentLineId: "c1",
        countsInSimulatedProductCost: false,
        unitCostSnapshot: 10,
        totalCost: 20,
        quantity: 2,
      }),
    ];

    const { snapshotGroups } = buildProjectStructureSnapshotGroups(lines);
    const groupTotal = snapshotGroups[0]!.simulatedCost;
    const rollupTotal = sumSimulatedRootProductCost(
      lines.map((l) => ({
        id: l.id,
        parentLineId: l.parentLineId,
        snapshotRootProductId: l.snapshotRootProductId,
        lineType: l.lineType,
        quantity: l.quantity,
        lossPercent: l.lossPercent ?? 0,
        unitCostSnapshot: l.unitCostSnapshot,
        totalCost: l.totalCost,
        officialQuantitySnapshot: l.officialQuantitySnapshot,
        officialLossPercentSnapshot: l.officialLossPercentSnapshot,
        officialUnitCostSnapshot: l.officialUnitCostSnapshot,
        countsInSimulatedProductCost: l.countsInSimulatedProductCost,
        isChangedFromOfficial: l.isChangedFromOfficial,
      }))
    );
    assert.equal(groupTotal, rollupTotal);
    assert.equal(groupTotal, 50);
  });

  it("status ALTERADO quando há linha alterada no grupo", () => {
    const lines = [
      line({
        id: "c1",
        snapshotRootProductId: ROOT_A,
        isChangedFromOfficial: true,
      }),
    ];
    const { snapshotGroups } = buildProjectStructureSnapshotGroups(lines, {
      rootProducts: { [ROOT_A]: { sku: "612.02AA", name: "Direita" } },
    });
    assert.equal(snapshotGroups[0]!.status, "ALTERADO");
    assert.equal(snapshotGroups[0]!.hasChanges, true);
  });

  it("agrupa linhas de produto simulado do projeto separadamente", () => {
    const SIM_PRODUCT = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const lines = [
      line({
        id: "sp1",
        simulatedProductId: SIM_PRODUCT,
        sourceType: "EXISTING_MATERIAL",
        lineType: "RAW_MATERIAL",
        existingMaterialId: "mat-1",
        quantity: 0.04,
        unitCostSnapshot: 10,
        totalCost: 0.42,
        lossPercent: 5,
      }),
      line({ id: "manual", sourceType: "MANUAL", descriptionSnapshot: "Avulso" }),
    ];
    const { simulatedProductGroups, manualLines } = buildProjectStructureSnapshotGroups(lines, {
      simulatedProducts: [
        {
          id: SIM_PRODUCT,
          provisionalCode: "PRJ-TOR",
          description: "Torneira teste",
          unit: "UN",
          estimatedWeight: null,
          expectedVolume: null,
          batchSize: null,
          notes: null,
        },
      ],
    });
    assert.equal(simulatedProductGroups.length, 1);
    assert.equal(simulatedProductGroups[0]!.rootCode, "PRJ-TOR");
    assert.equal(simulatedProductGroups[0]!.totalCost, 0.42);
    assert.equal(manualLines.length, 1);
    assert.equal(manualLines[0]!.id, "manual");
  });

  it("accordion UI existe e grupos começam fechados", () => {
    const accordion = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectStructureSnapshotAccordion.tsx"),
      "utf8"
    );
    assert.match(accordion, /expandedGroups/);
    assert.match(accordion, /Abrir estrutura/);
    assert.match(accordion, /Clique em Abrir estrutura/);
    assert.match(accordion, /Produtos do projeto \(engenharia isolada\)/);
    assert.match(accordion, /onAddToSimulatedProduct/);
    assert.match(accordion, /buildProjectStructureSnapshotGroups/);
  });

  it("aba estrutura usa título Estrutura / Árvore", () => {
    const tree = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectEngineeringTree.tsx"),
      "utf8"
    );
    assert.match(tree, /Estrutura \/ Árvore/);
  });

  it("composição BOM no editor mostra só 1º nível", () => {
    const panel = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectProductSimulationPanel.tsx"),
      "utf8"
    );
    assert.match(panel, /parentLineId == null/);
    assert.match(panel, /Composição de 1º nível/);
  });

  it("edição filtra por snapshotRootProductId no painel de simulação", () => {
    const panel = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectProductSimulationPanel.tsx"),
      "utf8"
    );
    assert.match(panel, /snapshotRootProductId === productId/);
  });

  it("exclusão de snapshot usa rota dedicada sem gravar cadastro oficial", () => {
    const routes = readFileSync(join(process.cwd(), "src", "lib", "projectsRoutes.ts"), "utf8");
    const module = readFileSync(join(process.cwd(), "src", "components", "ProjectsModule.tsx"), "utf8");
    assert.match(routes, /structure-snapshot/);
    assert.match(routes, /snapshotRootProductId/);
    assert.match(module, /structureSnapshot/);
    assert.equal(routes.includes("prisma.product.update"), false);
    assert.equal(routes.includes("prisma.productBOM.delete"), false);
  });
});
