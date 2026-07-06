import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildIntelligenceMaterialsCsv,
  buildIntelligenceOrdersCsv,
  buildIntelligenceReviewCsv,
  buildIntelligenceUnservedCsv,
  INTELLIGENCE_CSV_CORE_HEADERS,
} from "./materialDemandIntelligenceExport.js";
import { emptyIntelligenceBlock } from "./materialDemandIntelligenceUi.js";

function readPanel(): string {
  return readFileSync(
    join(process.cwd(), "src/components/contextual/MaterialDemandPlannedRealizedPanel.tsx"),
    "utf8"
  );
}

function readDrawer(): string {
  return readFileSync(
    join(process.cwd(), "src/components/contextual/MaterialDemandIntelligenceDrilldownDrawer.tsx"),
    "utf8"
  );
}

describe("materialDemandIntelligenceExport", () => {
  it("CSV contém colunas obrigatórias", () => {
    const intel = emptyIntelligenceBlock();
    intel.materials.push({
      materialId: "m1",
      materialCode: "MP",
      materialName: "Aço",
      unit: "KG",
      unitKey: "kg",
      unitLabel: "KG",
      recommendedQuantity: 1,
      conservativeQuantity: 2,
      uncertaintyQuantity: 1,
      reviewQuantity: 0,
      recommendedValue: 10,
      conservativeValue: 20,
      relatedProductsCount: 1,
      relatedOrdersCount: 1,
      confidence: "HIGH",
      statusSummary: "ok",
    });
    const csv = buildIntelligenceMaterialsCsv(intel);
    for (const header of INTELLIGENCE_CSV_CORE_HEADERS) {
      assert.match(csv, new RegExp(header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("export pedidos e revisão não quebram com payload vazio", () => {
    const empty = emptyIntelligenceBlock();
    assert.ok(buildIntelligenceOrdersCsv(empty).startsWith("\uFEFF"));
    assert.ok(buildIntelligenceUnservedCsv(empty).includes("Pedido"));
    assert.ok(buildIntelligenceReviewCsv(empty).includes("Motivo de revisão"));
  });
});

function readSections(): string {
  return readFileSync(
    join(process.cwd(), "src/components/contextual/MaterialDemandIntelligenceSections.tsx"),
    "utf8"
  );
}

describe("materialDemandIntelligenceUi — drilldown e transparência", () => {
  it("drilldown drawer existe no painel", () => {
    const panel = readPanel();
    const sections = readSections();
    assert.match(panel, /MaterialDemandIntelligenceDrilldownDrawer/);
    assert.match(sections, /material-intelligence-material-detail-btn/);
    assert.match(sections, /material-intelligence-order-detail-btn/);
  });

  it("explicação do cálculo existe", () => {
    const drawer = readDrawer();
    assert.match(drawer, /material-intelligence-calculation-explainer/);
    assert.match(drawer, /Como este cálculo funciona/);
    assert.match(drawer, /material-intelligence-material-drilldown/);
    assert.match(drawer, /material-intelligence-order-drilldown/);
  });

  it("empty state existe", () => {
    const panel = readPanel();
    const sections = readSections();
    assert.match(panel, /MaterialDemandIntelligenceEmptyState/);
    assert.match(sections, /material-intelligence-empty-state/);
  });

  it("export CSV da inteligência existe", () => {
    const panel = readPanel();
    assert.match(panel, /material-intelligence-export-bar/);
    assert.match(panel, /material-intelligence-export-materials/);
  });

  it("não importa Prisma no frontend", () => {
    const panel = readPanel();
    const drawer = readDrawer();
    assert.doesNotMatch(panel, /@prisma\/client/);
    assert.doesNotMatch(drawer, /@prisma\/client/);
  });
});
