import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  materialStockConferenceHttpStatus,
  recordMaterialStockConference,
} from "./materialStockConference.server.js";
import {
  MaterialStockConferenceError,
  parseMaterialStockConferenceCommand,
} from "./materialStockConferenceRules.js";
import { directMaterialLineFromBom } from "./openBookMaterialExplosion.js";
import { resolveMaterialLineCostForEngine } from "./materialCostEngineResolver.js";

type MaterialRow = {
  id: string;
  code: string;
  unit: string;
  quantity: number;
  contingencyQuantity: number | null;
  minimumQuantity: number | null;
  recommendedQuantity: number | null;
  stockConferenceVersion: number;
  lastStockConferenceAt: Date | null;
  lastStockConferenceUserId: string | null;
  updatedAt: Date;
  currentCost: number;
  averageCost: number;
  standardCost: number;
  freight: number;
  standardLoss: number;
  status: string;
};

type ConferenceRow = {
  id: string;
  materialId: string;
  previousQuantity: number;
  reportedQuantity: number;
  difference: number;
  unitSnapshot: string;
  reason: string;
  notes: string | null;
  userId: string;
  userName: string | null;
  recordedAt: Date;
  source: string;
  previousVersion: number | null;
  previousUpdatedAt: Date | null;
  idempotencyKey: string | null;
  createdAt: Date;
};

function createTxDb(seed: MaterialRow) {
  const materials = new Map<string, MaterialRow>([[seed.id, { ...seed }]]);
  const conferences: ConferenceRow[] = [];
  let confSeq = 0;
  const updatePayloads: unknown[] = [];
  let failAfterCreate = false;

  const api = {
    setFailAfterCreate(v: boolean) {
      failAfterCreate = v;
    },
    getMaterial() {
      return materials.get(seed.id)!;
    },
    getConferences() {
      return conferences;
    },
    getUpdatePayloads() {
      return updatePayloads;
    },
    material: {
      async findUnique({ where, select }: { where: { id: string }; select?: object }) {
        const row = materials.get(where.id);
        if (!row) return null;
        if (!select) return { ...row };
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(select)) {
          out[key] = (row as Record<string, unknown>)[key];
        }
        return out;
      },
      async findUniqueOrThrow(args: { where: { id: string }; select?: object }) {
        const row = await api.material.findUnique(args);
        if (!row) throw new Error("not found");
        return row;
      },
      async updateMany({
        where,
        data,
      }: {
        where: { id: string; stockConferenceVersion: number };
        data: Record<string, unknown>;
      }) {
        if (failAfterCreate) {
          return { count: 0 };
        }
        const row = materials.get(where.id);
        if (!row || row.stockConferenceVersion !== where.stockConferenceVersion) {
          return { count: 0 };
        }
        updatePayloads.push(data);
        row.quantity = Number(data.quantity);
        row.stockConferenceVersion = Number(data.stockConferenceVersion);
        row.lastStockConferenceAt = data.lastStockConferenceAt as Date;
        row.lastStockConferenceUserId = data.lastStockConferenceUserId as string;
        row.updatedAt = new Date(row.updatedAt.getTime() + 1000);
        return { count: 1 };
      },
    },
    materialStockConference: {
      async findUnique({ where }: { where: { idempotencyKey?: string; id?: string } }) {
        if (where.idempotencyKey) {
          return conferences.find((c) => c.idempotencyKey === where.idempotencyKey) ?? null;
        }
        if (where.id) {
          return conferences.find((c) => c.id === where.id) ?? null;
        }
        return null;
      },
      async findUniqueOrThrow(args: { where: { id: string } }) {
        const row = await api.materialStockConference.findUnique(args);
        if (!row) throw new Error("conference not found");
        return row;
      },
      async create({ data }: { data: Omit<ConferenceRow, "id" | "createdAt"> }) {
        if (
          data.idempotencyKey &&
          conferences.some((c) => c.idempotencyKey === data.idempotencyKey)
        ) {
          const err = new Error("Unique constraint");
          (err as { code: string }).code = "P2002";
          throw err;
        }
        const row: ConferenceRow = {
          id: `conf-${++confSeq}`,
          createdAt: new Date(),
          ...data,
        };
        conferences.push(row);
        return row;
      },
    },
    async $transaction(fn: (tx: typeof api) => Promise<unknown>) {
      const snapshotMaterial = { ...materials.get(seed.id)! };
      const snapshotConf = [...conferences];
      try {
        return await fn(api);
      } catch (e) {
        materials.set(seed.id, snapshotMaterial);
        conferences.length = 0;
        conferences.push(...snapshotConf);
        throw e;
      }
    },
  };

  return api;
}

const MATERIAL_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function baseMaterial(overrides: Partial<MaterialRow> = {}): MaterialRow {
  return {
    id: MATERIAL_ID,
    code: "010.AA",
    unit: "KG",
    quantity: 500,
    contingencyQuantity: 50,
    minimumQuantity: 100,
    recommendedQuantity: 400,
    stockConferenceVersion: 3,
    lastStockConferenceAt: null,
    lastStockConferenceUserId: null,
    updatedAt: new Date("2026-07-28T10:00:00.000Z"),
    currentCost: 5.17,
    averageCost: 5.0,
    standardCost: 4.8,
    freight: 0.25,
    standardLoss: 10,
    status: "ACTIVE",
    ...overrides,
  };
}

describe("materialStockConferenceRules — parse", () => {
  it("exige saldo final e motivo válido", () => {
    const cmd = parseMaterialStockConferenceCommand({
      materialId: MATERIAL_ID,
      reportedQuantity: 450,
      reason: "CONFERÊNCIA_FÍSICA",
      expectedVersion: 3,
    });
    assert.equal(cmd.reportedQuantity, 450);
    assert.equal(cmd.reason, "CONFERENCIA_FISICA");
  });
});

describe("recordMaterialStockConference", () => {
  const actor = { id: USER_ID, name: "Operador Tablet", email: "op@test.local" };

  it("atualiza saldo oficial, registra diferença negativa e histórico", async () => {
    const db = createTxDb(baseMaterial());
    const result = await recordMaterialStockConference(db as any, {
      body: {
        materialId: MATERIAL_ID,
        reportedQuantity: 450,
        reason: "CONFERENCIA_FISICA",
        expectedVersion: 3,
        userId: "should-be-ignored",
      },
      idempotencyKeyHeader: "key-neg-1",
      actor,
      now: new Date("2026-07-28T12:00:00.000Z"),
    });
    assert.equal(result.created, true);
    assert.equal(result.conference.previousQuantity, 500);
    assert.equal(result.conference.reportedQuantity, 450);
    assert.equal(result.conference.difference, -50);
    assert.equal(result.material.quantity, 450);
    assert.equal(result.material.stockConferenceVersion, 4);
    assert.equal(result.conference.userId, USER_ID);
    assert.equal(db.getConferences().length, 1);
    assert.equal(db.getMaterial().currentCost, 5.17);
  });

  it("diferença positiva, saldo igual e Decimal", async () => {
    const dbPos = createTxDb(baseMaterial({ quantity: 10.5, stockConferenceVersion: 1 }));
    const pos = await recordMaterialStockConference(dbPos as any, {
      body: {
        materialId: MATERIAL_ID,
        reportedQuantity: "12.750000",
        reason: "ENTRADA_MANUAL",
        expectedVersion: 1,
      },
      idempotencyKeyHeader: "key-pos",
      actor,
    });
    assert.equal(pos.conference.difference, 2.25);

    const dbEq = createTxDb(baseMaterial({ quantity: 100, stockConferenceVersion: 1 }));
    const eq = await recordMaterialStockConference(dbEq as any, {
      body: {
        materialId: MATERIAL_ID,
        reportedQuantity: 100,
        reason: "AJUSTE_DE_INVENTARIO",
        expectedVersion: 1,
      },
      idempotencyKeyHeader: "key-eq",
      actor,
    });
    assert.equal(eq.conference.difference, 0);
  });

  it("conflito 409 quando versão diverge", async () => {
    const db = createTxDb(baseMaterial({ stockConferenceVersion: 5 }));
    await assert.rejects(
      () =>
        recordMaterialStockConference(db as any, {
          body: {
            materialId: MATERIAL_ID,
            reportedQuantity: 400,
            reason: "PERDA",
            expectedVersion: 3,
          },
          idempotencyKeyHeader: "key-conflict",
          actor,
        }),
      (err: unknown) => {
        assert.ok(err instanceof MaterialStockConferenceError);
        assert.equal(err.code, "CONFLICT");
        assert.equal(materialStockConferenceHttpStatus(err), 409);
        assert.equal(err.details?.currentQuantity, 500);
        assert.equal(err.details?.stockConferenceVersion, 5);
        return true;
      }
    );
    assert.equal(db.getConferences().length, 0);
    assert.equal(db.getMaterial().quantity, 500);
  });

  it("rollback: histórico não fica se update falhar", async () => {
    const db = createTxDb(baseMaterial());
    db.setFailAfterCreate(true);
    await assert.rejects(() =>
      recordMaterialStockConference(db as any, {
        body: {
          materialId: MATERIAL_ID,
          reportedQuantity: 450,
          reason: "CONFERENCIA_FISICA",
          expectedVersion: 3,
        },
        idempotencyKeyHeader: "key-rollback",
        actor,
      })
    );
    assert.equal(db.getConferences().length, 0);
    assert.equal(db.getMaterial().quantity, 500);
  });

  it("duplo envio com mesma Idempotency-Key não duplica", async () => {
    const db = createTxDb(baseMaterial());
    const first = await recordMaterialStockConference(db as any, {
      body: {
        materialId: MATERIAL_ID,
        reportedQuantity: 450,
        reason: "CONFERENCIA_FISICA",
        expectedVersion: 3,
      },
      idempotencyKeyHeader: "key-idem",
      actor,
    });
    const second = await recordMaterialStockConference(db as any, {
      body: {
        materialId: MATERIAL_ID,
        reportedQuantity: 100,
        reason: "PERDA",
        expectedVersion: 99,
      },
      idempotencyKeyHeader: "key-idem",
      actor,
    });
    assert.equal(first.created, true);
    assert.equal(second.idempotent, true);
    assert.equal(second.created, false);
    assert.equal(db.getConferences().length, 1);
    assert.equal(db.getMaterial().quantity, 450);
  });

  it("custo da MP e custo unitário do produto permanecem inalterados", async () => {
    const mat = baseMaterial();
    const costBefore = resolveMaterialLineCostForEngine({
      id: mat.id,
      code: mat.code,
      description: "x",
      currentCost: mat.currentCost,
      freight: mat.freight,
      standardLoss: mat.standardLoss,
    });
    assert.equal(costBefore.ok, true);
    if (!costBefore.ok) return;
    const lineBefore = directMaterialLineFromBom(
      costBefore.landedCost,
      costBefore.standardLossPct,
      2,
      0
    );

    const db = createTxDb(mat);
    await recordMaterialStockConference(db as any, {
      body: {
        materialId: MATERIAL_ID,
        reportedQuantity: 450,
        reason: "SAIDA_MANUAL",
        expectedVersion: 3,
      },
      idempotencyKeyHeader: "key-cost",
      actor,
    });

    const after = db.getMaterial();
    assert.equal(after.currentCost, 5.17);
    assert.equal(after.averageCost, 5.0);
    assert.equal(after.standardCost, 4.8);
    assert.equal(after.freight, 0.25);
    assert.equal(after.standardLoss, 10);
    for (const payload of db.getUpdatePayloads()) {
      const keys = Object.keys(payload as object);
      assert.ok(!keys.includes("currentCost"));
      assert.ok(!keys.includes("averageCost"));
      assert.ok(!keys.includes("standardCost"));
      assert.ok(!keys.includes("freight"));
      assert.ok(!keys.includes("standardLoss"));
    }

    const costAfter = resolveMaterialLineCostForEngine({
      id: after.id,
      code: after.code,
      description: "x",
      currentCost: after.currentCost,
      freight: after.freight,
      standardLoss: after.standardLoss,
    });
    assert.equal(costAfter.ok, true);
    if (!costAfter.ok) return;
    const lineAfter = directMaterialLineFromBom(
      costAfter.landedCost,
      costAfter.standardLossPct,
      2,
      0
    );
    assert.deepEqual(lineAfter, lineBefore);
  });

  it("exige Idempotency-Key", async () => {
    const db = createTxDb(baseMaterial());
    await assert.rejects(
      () =>
        recordMaterialStockConference(db as any, {
          body: {
            materialId: MATERIAL_ID,
            reportedQuantity: 450,
            reason: "OUTRO",
            expectedVersion: 3,
          },
          idempotencyKeyHeader: null,
          actor,
        }),
      (err: unknown) =>
        err instanceof MaterialStockConferenceError && err.code === "REQUIRED_FIELD"
    );
  });
});
