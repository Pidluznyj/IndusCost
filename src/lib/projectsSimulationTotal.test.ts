/**
 * Total do projeto com itens vindos de simulação.
 *
 * Regra: o item vindo de simulação compõe o custo unitário do projeto — como o produto
 * oficial — pelo valor COPIADO e CONGELADO no próprio ProjectSimulatedItem, exatamente uma
 * vez. Nada é relido da Simulation, do custo LIVE ou do custo publicado.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import type { ProjectDetail, ProjectSimulatedItemRow } from "@/src/types/projects.js";
import {
  buildProjectGuidedItems,
  computeProjectGuidedCosts,
  resolveProjectEstimatedTotalCost,
  resolveSimulationOriginItemUnitCost,
  sumSimulationOriginItemsUnitCost,
} from "./projectsGuidedFlow.js";
import { buildOtherCostNotes } from "./projectsOtherCostGroups.js";
import { computeProjectListEstimatedValue } from "./projectsService.js";
import { addSimulationReferenceToProject } from "./projectsSimulationItemService.js";
import { createFakeDb } from "./simulationsTestSupport.js";

const SIM_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SIM_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function baseItem(overrides: Partial<ProjectSimulatedItemRow>): ProjectSimulatedItemRow {
  return {
    id: "item",
    provisionalCode: null,
    description: "Item",
    itemType: "FINISHED_PRODUCT",
    unit: "UN",
    estimatedUnitCost: null,
    quotedUnitCost: null,
    supplierName: null,
    leadTimeDays: null,
    estimatedWeight: null,
    lossPercent: 0,
    requiresQuotation: false,
    requiresEngineeringReview: false,
    canBecomeOfficial: false,
    notes: null,
    ...overrides,
  };
}

/** Item copiado de uma simulação congelada (coluna de origem + marcador legado). */
function simulatedItem(id: string, cost: number, simulationId = SIM_A): ProjectSimulatedItemRow {
  return baseItem({
    id,
    description: `Simulado ${id}`,
    estimatedUnitCost: cost,
    quotedUnitCost: cost,
    notes: `guided-origin:SIMULATION\nguided-simulation-id:${simulationId}`,
    sourceSimulationId: simulationId,
    sourceSimulationName: `Simulação ${id}`,
    sourceSimulationCostBase: cost,
    sourceSimulationCopiedAt: "2026-10-05T18:00:00.000Z",
  });
}

function otherCost(id: string, cost: number): ProjectSimulatedItemRow {
  return baseItem({
    id,
    description: "Try-out",
    itemType: "OTHER",
    estimatedUnitCost: cost,
    quotedUnitCost: cost,
    notes: buildOtherCostNotes("TEST", `batch-${id}`),
  });
}

/**
 * `officialUnitCost` = custo unitário da estrutura (produtos oficiais do projeto), que é o
 * que `costBreakdown.unitCost` carrega hoje.
 */
function detail(input: {
  officialUnitCost?: number | null;
  items?: ProjectSimulatedItemRow[];
  separateMoldCost?: number;
  structureLines?: Array<{ simulatedItemId: string | null }>;
}): ProjectDetail {
  return {
    id: "p1",
    status: "DRAFT",
    updatedAt: "2026-10-05T00:00:00.000Z",
    simulatedProducts: [],
    simulatedItems: input.items ?? [],
    structureLines: input.structureLines ?? [],
    molds: [],
    costBreakdown: { unitCost: input.officialUnitCost ?? 0, separateMoldCost: input.separateMoldCost ?? 0 },
  } as unknown as ProjectDetail;
}

const total = (d: ProjectDetail) => computeProjectGuidedCosts(d).totalProjectCost;

describe("total do projeto — itens oficiais e itens vindos de simulação", () => {
  it("A — só item oficial: total = item oficial", () => {
    assert.equal(total(detail({ officialUnitCost: 100 })), 100);
  });

  it("B — só item simulado: total = item simulado", () => {
    const costs = computeProjectGuidedCosts(detail({ items: [simulatedItem("s1", 50)] }));
    assert.equal(costs.totalProjectCost, 50);
    assert.equal(costs.simulationItemsUnitCost, 50);
    assert.equal(costs.estimatedUnitCost, 50);
  });

  it("C — oficial 100 + simulado 50: total = 150", () => {
    const costs = computeProjectGuidedCosts(detail({ officialUnitCost: 100, items: [simulatedItem("s1", 50)] }));
    assert.equal(costs.totalProjectCost, 150);
    assert.equal(costs.estimatedUnitCost, 150, "os cards somam exatamente o total");
    assert.equal(costs.simulationItemsUnitCost, 50);
    assert.equal(
      costs.estimatedUnitCost + costs.initialInvestment + costs.otherProjectCosts,
      costs.totalProjectCost
    );
  });

  it("D, E — alterar/arquivar a Simulation, o LIVE ou o custo publicado depois não muda o total", async () => {
    const db = createFakeDb();
    db.tables.newProductSimulation.push({
      id: SIM_A,
      name: "S1",
      status: "SAVED",
      productName: "Novo corpo",
      productSku: "SIM-1",
      savedAt: new Date(),
      snapshotHash: "a".repeat(64),
      snapshot: { schemaVersion: 2, result: { costBase: 50 } },
    } as never);
    const row = await addSimulationReferenceToProject(
      { projectId: "p1", versionId: "v1", simulationId: SIM_A },
      { db: db.prisma as never, recalculateVersionCosts: async () => undefined }
    );
    const before = total(detail({ officialUnitCost: 100, items: [row] }));
    assert.equal(before, 150);

    // Simulation alterada e arquivada depois da cópia
    const sim = db.tables.newProductSimulation[0];
    sim.status = "ARCHIVED";
    sim.snapshot = { schemaVersion: 2, result: { costBase: 999 } };
    sim.snapshotHash = "b".repeat(64);
    const touchedBefore = new Set(db.touched);

    assert.equal(total(detail({ officialUnitCost: 100, items: [row] })), 150);
    // O cálculo do total é puro: não acessa banco (Simulation, custo publicado) nem motor (LIVE).
    assert.deepEqual([...db.touched], [...touchedBefore]);
    const source = readFileSync(resolve(process.cwd(), "src/lib/projectsGuidedFlow.ts"), "utf8");
    assert.doesNotMatch(source, /prisma|getProductCostAnalysis|getEffectiveProductProductionCost|resolveProductCostBaseline|newProductSimulation\./);
  });

  it("F — editar custo do item segue a semântica do item: cotado prevalece sobre estimado", () => {
    const edited = { ...simulatedItem("s1", 50), quotedUnitCost: 60 };
    assert.equal(total(detail({ officialUnitCost: 100, items: [edited] })), 160);
    const estimatedOnly = { ...simulatedItem("s1", 50), estimatedUnitCost: 70 };
    assert.equal(total(detail({ officialUnitCost: 100, items: [estimatedOnly] })), 150, "cotado continua valendo");
    const noQuote = { ...simulatedItem("s1", 50), quotedUnitCost: null, estimatedUnitCost: 70 };
    assert.equal(total(detail({ officialUnitCost: 100, items: [noQuote] })), 170);
    // a origem copiada não muda com a edição do custo
    assert.equal(edited.sourceSimulationCostBase, 50);
    assert.equal(resolveSimulationOriginItemUnitCost(edited), 60);
  });

  it("G — dois itens simulados diferentes: sem colisão nem duplicação", () => {
    const items = [simulatedItem("s1", 50, SIM_A), simulatedItem("s2", 30, SIM_B)];
    const costs = computeProjectGuidedCosts(detail({ officialUnitCost: 100, items }));
    assert.equal(costs.totalProjectCost, 180);
    assert.equal(costs.simulationItemsUnitCost, 80);
    assert.equal(buildProjectGuidedItems(detail({ items })).filter((i) => i.entityKind === "simulation_ref").length, 2);
  });

  it("H — remover um item simulado diminui o total exatamente uma vez", () => {
    const both = [simulatedItem("s1", 50, SIM_A), simulatedItem("s2", 30, SIM_B)];
    assert.equal(total(detail({ officialUnitCost: 100, items: both })), 180);
    assert.equal(total(detail({ officialUnitCost: 100, items: [both[0]] })), 150);
    assert.equal(total(detail({ officialUnitCost: 100, items: [] })), 100);
  });

  it("I — item sem quantidade própria: custo unitário conta uma vez; custo zero/ausente soma zero", () => {
    // ProjectSimulatedItem não tem campo de quantidade: o item é 1 produto do projeto.
    assert.equal(total(detail({ officialUnitCost: 100, items: [simulatedItem("s0", 0)] })), 100);
    const noCost = { ...simulatedItem("s0", 0), quotedUnitCost: null, estimatedUnitCost: null };
    assert.equal(total(detail({ officialUnitCost: 100, items: [noCost] })), 100);
    const invalid = { ...simulatedItem("sx", 0), quotedUnitCost: Number.NaN };
    assert.equal(resolveSimulationOriginItemUnitCost(invalid), 0);
  });

  it("J — oficial + simulado + ferramental + outros custos coexistem e somam pela regra existente", () => {
    const costs = computeProjectGuidedCosts(
      detail({
        officialUnitCost: 100,
        separateMoldCost: 1000,
        items: [simulatedItem("s1", 50), otherCost("o1", 200)],
      })
    );
    assert.equal(costs.estimatedUnitCost, 150);
    assert.equal(costs.initialInvestment, 1000);
    assert.equal(costs.otherProjectCosts, 200);
    assert.equal(costs.totalProjectCost, 1350);
  });
});

describe("total do projeto — sem dupla contagem e compatibilidade", () => {
  it("item já referenciado por linha de estrutura não é somado de novo", () => {
    const item = simulatedItem("s1", 50);
    // a estrutura já inclui os 50 do item (linha com simulatedItemId)
    const d = detail({ officialUnitCost: 150, items: [item], structureLines: [{ simulatedItemId: "s1" }] });
    const costs = computeProjectGuidedCosts(d);
    assert.equal(costs.simulationItemsUnitCost, 0);
    assert.equal(costs.totalProjectCost, 150);
    assert.equal(sumSimulationOriginItemsUnitCost([item], [{ simulatedItemId: "outro" }]), 50);
  });

  it("item legado (só marcador em notes) também entra; item manual comum não muda de regra", () => {
    const legacy = baseItem({
      id: "legado",
      estimatedUnitCost: 40,
      quotedUnitCost: 40,
      notes: `guided-origin:SIMULATION\nguided-simulation-id:${SIM_A}`,
    });
    assert.equal(total(detail({ officialUnitCost: 100, items: [legacy] })), 140);
    // componente criado no projeto continua entrando só quando usado na estrutura (regra existente)
    const manual = baseItem({ id: "manual", itemType: "COMPONENT", estimatedUnitCost: 25, quotedUnitCost: 25 });
    assert.equal(total(detail({ officialUnitCost: 100, items: [manual] })), 100);
  });

  it("totais de projeto sem item de simulação ficam idênticos ao comportamento anterior", () => {
    const costs = computeProjectGuidedCosts(
      detail({ officialUnitCost: 12.5, separateMoldCost: 85000, items: [otherCost("o1", 2500), otherCost("o2", 2000)] })
    );
    assert.equal(costs.simulationItemsUnitCost, 0);
    assert.equal(costs.estimatedUnitCost, 12.5);
    assert.equal(costs.totalProjectCost, 12.5 + 85000 + 4500);
    assert.equal(
      resolveProjectEstimatedTotalCost({ unitCost: 12.5, separateMoldCost: 85000 }, [otherCost("o1", 4500)]),
      12.5 + 85000 + 4500
    );
  });

  it("valor estimado da listagem de projetos usa a mesma regra", () => {
    const version = {
      id: "v1",
      projectId: "p1",
      versionNumber: 1,
      title: null,
      status: "DRAFT",
      assumptionsJson: null,
      totalEstimatedCost: 100,
      totalMoldCost: null,
      totalAmortizedMoldCost: null,
      unitCost: 100,
      suggestedPrice: null,
      marginPercent: null,
      markupPercent: null,
      expectedVolume: null,
      notes: null,
      isCurrent: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      molds: [],
    };
    const dbItem = {
      id: "s1",
      projectId: "p1",
      versionId: "v1",
      provisionalCode: null,
      description: "Simulado",
      itemType: "FINISHED_PRODUCT",
      unit: "UN",
      estimatedUnitCost: 50,
      quotedUnitCost: 50,
      supplierName: null,
      leadTimeDays: null,
      estimatedWeight: null,
      lossPercent: 0,
      requiresQuotation: false,
      requiresEngineeringReview: false,
      canBecomeOfficial: false,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      sourceSimulationId: SIM_A,
      sourceSimulationName: "S1",
      sourceSimulationSnapshotHash: null,
      sourceSimulationCostBase: 50,
      sourceSimulationCopiedAt: new Date(),
    };
    assert.equal(computeProjectListEstimatedValue({ ...version, simulatedItems: [dbItem] } as never), 150);
    assert.equal(
      computeProjectListEstimatedValue({
        ...version,
        unitCost: 150,
        totalEstimatedCost: 150,
        simulatedItems: [dbItem],
        structureLines: [{ simulatedItemId: "s1" }],
      } as never),
      150,
      "linha de estrutura já contém o item"
    );
    assert.equal(
      computeProjectListEstimatedValue({ ...version, unitCost: null, totalEstimatedCost: null, simulatedItems: [dbItem] } as never),
      50,
      "projeto só com item simulado tem valor estimado"
    );
  });

  it("canBecomeOfficial permanece false e o total não promove nada a oficial", () => {
    const item = simulatedItem("s1", 50);
    computeProjectGuidedCosts(detail({ officialUnitCost: 100, items: [item] }));
    assert.equal(item.canBecomeOfficial, false);
    const guided = buildProjectGuidedItems(detail({ items: [item] })).find((i) => i.entityKind === "simulation_ref");
    assert.equal(guided?.origin, "FROM_SIMULATION");
    assert.equal(guided?.estimatedCost, 50);
  });
});
