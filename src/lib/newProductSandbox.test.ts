import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeFinalProductFromComposition,
  computeSimulatedComponent,
  type ExistingComponentCost,
} from "./newProductSandbox";

describe("newProductSandbox híbrido TESTE 1", () => {
  it("adiciona componente existente e valida custo", () => {
    const existing: ExistingComponentCost[] = [
      { id: "ex-1", sku: "EX-001", name: "Componente A", mp: 8, hh: 2, hm: 1 },
    ];
    const r = computeFinalProductFromComposition({
      lines: [{ id: "l1", type: "EXISTING_COMPONENT", refId: "ex-1", quantity: 2 }],
      existingComponents: existing,
      simulatedComponents: [],
      mode: "MARGIN",
      desiredMarginPct: 30,
      targetPrice: 0,
    });
    assert.ok(Math.abs(r.costBase - 22) < 1e-9);
  });
});

describe("newProductSandbox híbrido TESTE 2", () => {
  it("cria componente novo simulado com MP + HH + HM", () => {
    const sim = computeSimulatedComponent({
      id: "sim-1",
      name: "Componente Simulado",
      materials: [
        { code: "M1", description: "Resina", quantity: 1, unit: "kg", unitCost: 10 },
        { code: "M2", description: "Aditivo", quantity: 2, unit: "kg", unitCost: 3 },
      ],
      hh: 5,
      hm: 2,
    });
    assert.ok(Math.abs(sim.breakdown.costBase - 23) < 1e-9);
  });
});

describe("newProductSandbox híbrido TESTE 3", () => {
  it("usa componente novo simulado no produto final", () => {
    const sim = computeSimulatedComponent({
      id: "sim-1",
      name: "Kit Novo",
      materials: [{ code: "M1", description: "MP", quantity: 2, unit: "kg", unitCost: 4 }],
      hh: 3,
      hm: 1,
    });
    const r = computeFinalProductFromComposition({
      lines: [{ id: "l1", type: "SIMULATED_COMPONENT", refId: "sim-1", quantity: 3 }],
      existingComponents: [],
      simulatedComponents: [sim],
      mode: "TARGET_PRICE",
      desiredMarginPct: 0,
      targetPrice: 100,
    });
    assert.ok(Math.abs(r.costBase - 36) < 1e-9);
  });
});

describe("newProductSandbox híbrido TESTE 4", () => {
  it("produto final misto soma corretamente", () => {
    const existing: ExistingComponentCost[] = [
      { id: "ex-1", sku: "EX-001", name: "Componente A", mp: 10, hh: 3, hm: 2 },
    ];
    const sim = computeSimulatedComponent({
      id: "sim-1",
      name: "Componente Simulado",
      materials: [{ code: "M1", description: "Resina", quantity: 1, unit: "kg", unitCost: 6 }],
      hh: 2,
      hm: 1,
    });
    const r = computeFinalProductFromComposition({
      lines: [
        { id: "l1", type: "EXISTING_COMPONENT", refId: "ex-1", quantity: 2 },
        { id: "l2", type: "SIMULATED_COMPONENT", refId: "sim-1", quantity: 1 },
      ],
      existingComponents: existing,
      simulatedComponents: [sim],
      mode: "MARGIN",
      desiredMarginPct: 20,
      targetPrice: 0,
    });
    assert.ok(Math.abs(r.costBase - 39) < 1e-9);
  });
});

describe("newProductSandbox híbrido TESTE 5", () => {
  it("percentuais MP + HH + HM fecham corretamente", () => {
    const sim = computeSimulatedComponent({
      id: "sim-1",
      name: "Componente Simulado",
      materials: [{ code: "M1", description: "Resina", quantity: 5, unit: "kg", unitCost: 2 }],
      hh: 4,
      hm: 1,
    });
    const r = computeFinalProductFromComposition({
      lines: [{ id: "l1", type: "SIMULATED_COMPONENT", refId: "sim-1", quantity: 1 }],
      existingComponents: [],
      simulatedComponents: [sim],
      mode: "MARGIN",
      desiredMarginPct: 10,
      targetPrice: 0,
    });
    assert.ok(Math.abs(r.mpPct + r.hhPct + r.hmPct - 100) < 1e-9);
  });
});
