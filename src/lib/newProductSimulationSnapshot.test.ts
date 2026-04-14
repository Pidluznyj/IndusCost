import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCloneDraftData,
  buildSnapshotSaveData,
  editorModeFromStatus,
  type NewProductSimulationSnapshot,
} from "./newProductSimulationSnapshot";
import { computeFinalProductFromComposition } from "./newProductSandbox";

function sampleSnapshot(): NewProductSimulationSnapshot {
  return {
    header: {
      simulationName: "Teste Snapshot",
      productName: "Produto X",
      productSku: "NP-001",
      notes: "Observacao",
      createdAt: "2026-04-14T12:00:00.000Z",
      savedAt: "2026-04-14T12:00:00.000Z",
      origin: "NEW_PRODUCT_SANDBOX",
    },
    commercial: {
      mode: "MARGIN",
      desiredMarginPct: 20,
      targetPrice: 0,
    },
    composition: {
      lines: [
        {
          id: "l1",
          type: "DIRECT_MATERIAL",
          description: "Resina",
          quantity: 2,
          unitCost: 5,
          lineTotal: 10,
          breakdown: { mp: 10, hh: 0, hm: 0 },
        },
      ],
      simulatedComponents: [],
    },
    result: {
      mp: 10,
      hh: 2,
      hm: 1,
      costBase: 13,
      mpPct: 76.9230769,
      hhPct: 15.3846153,
      hmPct: 7.6923076,
      price: 16.25,
      marginPct: 20,
      viability: "VIAVEL",
    },
  };
}

describe("newProductSimulationSnapshot TESTE 1", () => {
  it("salva snapshot com dados principais persistíveis", () => {
    const snapshot = sampleSnapshot();
    const data = buildSnapshotSaveData({
      simulationName: "Snapshot Abril",
      snapshot,
      origin: "NEW_PRODUCT_SANDBOX",
    });
    assert.equal(data.status, "SAVED");
    assert.equal(data.name, "Snapshot Abril");
    assert.equal(data.productName, "Produto X");
    assert.equal((data.snapshot as NewProductSimulationSnapshot).result.costBase, 13);
  });
});

describe("newProductSimulationSnapshot TESTE 2", () => {
  it("simulação salva abre como somente leitura", () => {
    assert.equal(editorModeFromStatus("SAVED"), "READONLY");
  });
});

describe("newProductSimulationSnapshot TESTE 3", () => {
  it("clona snapshot salvo para um draft editável", () => {
    const clone = buildCloneDraftData({
      id: "saved-1",
      name: "Sim Original",
      snapshot: sampleSnapshot(),
    });
    assert.equal(clone.status, "DRAFT");
    assert.equal(clone.sourceSimulationId, "saved-1");
    assert.ok(String(clone.name).includes("(cópia)"));
  });
});

describe("newProductSimulationSnapshot TESTE 4", () => {
  it("alterar clone não altera o snapshot original", () => {
    const original = sampleSnapshot();
    const clone = buildCloneDraftData({
      id: "saved-1",
      name: "Sim Original",
      snapshot: original,
    });
    const cloneSnapshot = clone.snapshot as NewProductSimulationSnapshot;
    cloneSnapshot.header.productName = "Produto Alterado";
    assert.equal(original.header.productName, "Produto X");
  });
});

describe("newProductSimulationSnapshot TESTE 5", () => {
  it("snapshot salvo mantém consolidados persistidos sem depender do formulário vivo", () => {
    const draft = sampleSnapshot();
    const saved = buildSnapshotSaveData({
      simulationName: "Snapshot congelado",
      snapshot: draft,
    });
    draft.result.costBase = 9999;
    const savedSnapshot = saved.snapshot as NewProductSimulationSnapshot;
    assert.equal(savedSnapshot.result.costBase, 13);
  });
});

describe("newProductSimulationSnapshot TESTE 6", () => {
  it("regressão: cálculo sandbox base continua funcionando", () => {
    const result = computeFinalProductFromComposition({
      lines: [{ id: "l1", type: "DIRECT_MATERIAL", description: "Resina", quantity: 2, unitCost: 5 }],
      existingComponents: [],
      simulatedComponents: [],
      mode: "MARGIN",
      desiredMarginPct: 10,
      targetPrice: 0,
    });
    assert.equal(result.costBase, 10);
    assert.ok(result.price > result.costBase);
  });
});
