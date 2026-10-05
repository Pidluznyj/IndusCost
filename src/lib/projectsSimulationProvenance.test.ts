/**
 * Simulação → Projeto: o projeto COPIA o custo do snapshot congelado e registra a origem.
 * Não há referência viva, e o item nunca vira oficial sozinho.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import type { ProjectDetail, ProjectSimulatedItemRow } from "@/src/types/projects.js";
import { buildProjectGuidedItems } from "./projectsGuidedFlow.js";
import { addSimulationReferenceToProject } from "./projectsSimulationItemService.js";
import { serializeSimulationLookupRow } from "./projectsSimulationLookup.js";
import {
  buildProjectSimulationProvenance,
  describeSimulationOrigin,
  isSimulationOriginItem,
  parseSimulationIdFromNotes,
  preserveSimulationRefNotes,
} from "./projectsSimulationRefs.js";
import {
  createFakeDb,
  requestJson,
  startSimulationsTestApp,
  TEST_IDS,
} from "./simulationsTestSupport.js";

const SIM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COPIED_AT = new Date("2026-10-05T18:00:00.000Z");

function savedSimulation(overrides: Record<string, unknown> = {}) {
  return {
    id: SIM_ID,
    name: "S1 — Novo corpo XYZ",
    status: "SAVED",
    productName: "Novo corpo XYZ",
    productSku: "SIM-001",
    savedAt: new Date("2026-10-05T15:00:00.000Z"),
    snapshotHash: "a".repeat(64),
    snapshot: { schemaVersion: 2, result: { costBase: 10, price: 12.5, marginPct: 20 } },
    ...overrides,
  };
}

function setup(simulation = savedSimulation()) {
  const db = createFakeDb();
  db.tables.newProductSimulation.push(simulation as never);
  const recalculated: string[] = [];
  const deps = {
    db: db.prisma as never,
    recalculateVersionCosts: async (versionId: string) => {
      recalculated.push(versionId);
    },
    now: () => COPIED_AT,
  };
  return { db, deps, recalculated };
}

const input = { projectId: "proj-1", versionId: "ver-1", simulationId: SIM_ID };

describe("addSimulationReferenceToProject", () => {
  it("TESTE 5 e 6 — copia costBase do snapshot e nunca marca como promovível a oficial", async () => {
    const { db, deps, recalculated } = setup();
    const row = await addSimulationReferenceToProject(input, deps);
    assert.equal(row.estimatedUnitCost, 10);
    assert.equal(row.quotedUnitCost, 10);
    assert.equal(row.canBecomeOfficial, false);
    assert.equal(row.description, "Novo corpo XYZ");
    assert.equal(row.provisionalCode, "SIM-001");
    assert.deepEqual(recalculated, ["ver-1"]);
    // rastreabilidade em colunas — não só em notes
    assert.equal(row.sourceSimulationId, SIM_ID);
    assert.equal(row.sourceSimulationName, "S1 — Novo corpo XYZ");
    assert.equal(row.sourceSimulationSnapshotHash, "a".repeat(64));
    assert.equal(row.sourceSimulationCostBase, 10);
    assert.equal(row.sourceSimulationCopiedAt, COPIED_AT.toISOString());
    assert.equal(parseSimulationIdFromNotes(row.notes), SIM_ID, "marcador legado em notes mantido");
    assert.equal(db.tables.projectSimulatedItem.length, 1);
  });

  it("TESTE 7 — alterar/arquivar a simulação depois não muda o item já criado", async () => {
    const { db, deps } = setup();
    await addSimulationReferenceToProject(input, deps);
    const sim = db.tables.newProductSimulation[0];
    sim.status = "ARCHIVED";
    sim.name = "renomeada";
    sim.snapshot = { schemaVersion: 2, result: { costBase: 12 } };
    sim.snapshotHash = "b".repeat(64);
    const item = db.tables.projectSimulatedItem[0];
    assert.equal(item.estimatedUnitCost, 10);
    assert.equal(item.sourceSimulationCostBase, 10);
    assert.equal(item.sourceSimulationName, "S1 — Novo corpo XYZ");
    assert.equal(item.sourceSimulationSnapshotHash, "a".repeat(64));
  });

  it("só simulação congelada é aceita; rascunho e arquivada são recusados", async () => {
    for (const status of ["DRAFT", "ARCHIVED"]) {
      const { db, deps } = setup(savedSimulation({ status, savedAt: null }));
      await assert.rejects(() => addSimulationReferenceToProject(input, deps), /Somente simulações salvas/);
      assert.equal(db.tables.projectSimulatedItem.length, 0);
    }
    const noCost = setup(savedSimulation({ snapshot: { result: {} } }));
    await assert.rejects(() => addSimulationReferenceToProject(input, noCost.deps), /sem custo industrial/);
    const missing = setup();
    await assert.rejects(
      () => addSimulationReferenceToProject({ ...input, simulationId: TEST_IDS.missing }, missing.deps),
      /não encontrada/
    );
  });

  it("snapshot legado (sem hash do servidor) continua aceito, com hash nulo", async () => {
    const { deps } = setup(savedSimulation({ snapshotHash: null, snapshot: { result: { costBase: 7.5 } } }));
    const row = await addSimulationReferenceToProject(input, deps);
    assert.equal(row.estimatedUnitCost, 7.5);
    assert.equal(row.sourceSimulationSnapshotHash, null);
    assert.equal(row.sourceSimulationId, SIM_ID);
  });

  it("a mesma simulação não entra duas vezes na versão (coluna nova ou marcador legado)", async () => {
    const { db, deps } = setup();
    await addSimulationReferenceToProject(input, deps);
    const duplicateWhere = { sourceSimulationId: SIM_ID };
    assert.ok(db.tables.projectSimulatedItem.some((r) => r.sourceSimulationId === duplicateWhere.sourceSimulationId));
    const service = readFileSync(resolve(process.cwd(), "src/lib/projectsSimulationItemService.ts"), "utf8");
    assert.match(service, /OR:\s*\[\s*\{ sourceSimulationId: input\.simulationId \}/);
    assert.match(service, /canBecomeOfficial: false/);
  });

  it("custo copiado vem de simulação calculada pelo servidor (fluxo ponta a ponta)", async () => {
    const app = await startSimulationsTestApp();
    try {
      const saved = await requestJson(app, "POST", "/api/new-product-simulations/save", {
        inputs: {
          simulationName: "S2",
          productName: "Kit",
          productSku: null,
          notes: null,
          commercial: { mode: "MARGIN", desiredMarginPct: 20, targetPrice: 0, premises: null },
          lines: [{ id: "l1", type: "DIRECT_MATERIAL", description: "Peça", unit: "UN", quantity: 2, unitCost: 4.25 }],
          simulatedComponents: [],
          result: { costBase: 0.01 },
        },
      });
      assert.equal(saved.status, 201);
      const recalculated: string[] = [];
      const row = await addSimulationReferenceToProject(
        { ...input, simulationId: saved.json.id },
        {
          db: app.db.prisma as never,
          recalculateVersionCosts: async (id) => {
            recalculated.push(id);
          },
          now: () => COPIED_AT,
        }
      );
      assert.equal(row.estimatedUnitCost, 8.5, "custo do servidor, não o 0,01 enviado pelo cliente");
      assert.equal(row.sourceSimulationSnapshotHash, saved.json.snapshotHash);
      assert.deepEqual([...new Set(app.db.writes.map((w) => w.model))].sort(), [
        "newProductSimulation",
        "projectSimulatedItem",
      ]);
    } finally {
      await app.close();
    }
  });
});

describe("origem do item no projeto", () => {
  const baseItem: ProjectSimulatedItemRow = {
    id: "it-1",
    provisionalCode: "SIM-001",
    description: "Novo corpo XYZ",
    itemType: "FINISHED_PRODUCT",
    unit: "UN",
    estimatedUnitCost: 8.5,
    quotedUnitCost: 8.5,
    supplierName: null,
    leadTimeDays: null,
    estimatedWeight: null,
    lossPercent: 0,
    requiresQuotation: false,
    requiresEngineeringReview: false,
    canBecomeOfficial: false,
    notes: null,
  };

  it("coluna de origem identifica o item mesmo sem marcador em notes", () => {
    assert.equal(isSimulationOriginItem({ sourceSimulationId: SIM_ID, notes: null }), true);
    assert.equal(isSimulationOriginItem({ notes: `guided-origin:SIMULATION\nguided-simulation-id:${SIM_ID}` }), true);
    assert.equal(isSimulationOriginItem({ notes: "cotação fornecedor" }), false);
    const provenance = buildProjectSimulationProvenance({ id: SIM_ID, name: "S1" }, 8.5, COPIED_AT);
    assert.equal(provenance.sourceSimulationSnapshotHash, null);
    assert.equal(provenance.sourceSimulationCostBase, 8.5);
  });

  it("editar notes não apaga a origem de um item vindo de simulação", () => {
    const previous = `guided-origin:SIMULATION\nguided-simulation-id:${SIM_ID}`;
    const kept = preserveSimulationRefNotes(previous, "ajuste comercial", null);
    assert.equal(parseSimulationIdFromNotes(kept), SIM_ID);
    assert.match(kept ?? "", /ajuste comercial/);
    assert.equal(parseSimulationIdFromNotes(preserveSimulationRefNotes(previous, null, null)), SIM_ID);
    assert.equal(parseSimulationIdFromNotes(preserveSimulationRefNotes(null, "x", SIM_ID)), SIM_ID);
    assert.equal(preserveSimulationRefNotes("livre", "novo texto", null), "novo texto");
    const routes = readFileSync(resolve(process.cwd(), "src/lib/projectsRoutes.ts"), "utf8");
    assert.match(routes, /canBecomeOfficial: fromSimulation \? false/);
    assert.match(routes, /preserveSimulationRefNotes\(/);
  });

  it("TESTE 8 — projeto lista junto item oficial, item de simulação e estimativa, cada um com sua origem", () => {
    const detail = {
      id: "p1",
      code: "PRJ-001",
      title: "Projeto X",
      customerName: "Cliente",
      customerDocument: null,
      description: null,
      projectType: "NEW_PRODUCT",
      status: "DRAFT",
      commercialOwner: null,
      technicalOwner: null,
      expectedMonthlyVolume: null,
      targetPrice: null,
      targetMarginPercent: 20,
      notes: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-10-05T00:00:00.000Z",
      currentVersion: null,
      versions: [],
      simulatedProducts: [
        {
          id: "sp-official",
          provisionalCode: "610.01AA",
          description: "Produto oficial 610.01AA",
          unit: "UN",
          estimatedWeight: null,
          expectedVolume: null,
          batchSize: null,
          notes: "guided-origin:REFERENCE",
        },
      ],
      simulatedItems: [
        {
          ...baseItem,
          sourceSimulationId: SIM_ID,
          sourceSimulationName: "S1",
          sourceSimulationCostBase: 8.5,
          sourceSimulationCopiedAt: COPIED_AT.toISOString(),
        },
      ],
      structureLines: [],
      molds: [],
      costBreakdown: { unitCost: 2.3, separateMoldCost: 0 },
    } as unknown as ProjectDetail;
    const items = buildProjectGuidedItems(detail);
    const official = items.find((i) => i.productId === "sp-official");
    const simulated = items.find((i) => i.entityKind === "simulation_ref");
    assert.equal(official?.origin, "OFFICIAL_REFERENCE");
    assert.equal(simulated?.origin, "FROM_SIMULATION");
    assert.equal(simulated?.estimatedCost, 8.5, "custo da simulação preservado ao lado do item oficial");
    assert.equal(simulated?.originDetail, "S1 · snapshot 2026-10-05");
    assert.notEqual(official?.originLabel, simulated?.originLabel);
    assert.equal(describeSimulationOrigin({ sourceSimulationName: null }), null);
  });

  it("lookup do projeto bloqueia simulação arquivada e rascunho", () => {
    const record = {
      id: SIM_ID,
      name: "S1",
      productName: "Kit",
      productSku: null,
      notes: null,
      savedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      snapshot: { result: { costBase: 10, price: null, marginPct: null } },
    };
    const archived = serializeSimulationLookupRow({ ...record, status: "ARCHIVED" });
    assert.equal(archived.selectable, false);
    assert.equal(archived.statusLabel, "Arquivada");
    const saved = serializeSimulationLookupRow({ ...record, status: "SAVED" });
    assert.equal(saved.selectable, true);
    assert.equal(saved.totalCost, null, "preço nulo (premissas impossíveis) não vira 0");
    assert.equal(serializeSimulationLookupRow({ ...record, status: "DRAFT", savedAt: null }).selectable, false);
  });
});
