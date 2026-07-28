import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MaterialStockConferenceError } from "./materialStockConferenceRules.js";
import { materialStockConferenceHttpStatus } from "./materialStockConference.server.js";
import { parseMaterialStockParametersCommand } from "./materialStockParametersRules.js";
import { updateMaterialStockParameters } from "./materialStockParameters.server.js";
import { resolveMaterialLineCostForEngine } from "./materialCostEngineResolver.js";
import { directMaterialLineFromBom } from "./openBookMaterialExplosion.js";

const MATERIAL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type MaterialRow = {
  id: string;
  code: string;
  quantity: number;
  contingencyQuantity: number | null;
  minimumQuantity: number | null;
  recommendedQuantity: number | null;
  stockConferenceVersion: number;
  updatedAt: Date;
  currentCost: number;
  averageCost: number;
  standardCost: number;
  freight: number;
  standardLoss: number;
};

type AuditRow = {
  id: string;
  materialId: string;
  action: string;
  beforeJson: unknown;
  afterJson: unknown;
  userId: string | null;
  userName: string | null;
  reason: string | null;
  createdAt: Date;
};

function createDb(material: MaterialRow) {
  const audits: AuditRow[] = [];
  let row = { ...material };
  const updatePayloads: unknown[] = [];

  const api = {
    getMaterial: () => row,
    getAudits: () => audits,
    getUpdatePayloads: () => updatePayloads,
    material: {
      async findUnique({ where }: { where: { id: string } }) {
        return where.id === row.id ? { ...row } : null;
      },
      async update({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) {
        if (where.id !== row.id) throw new Error("not found");
        updatePayloads.push(data);
        row = {
          ...row,
          contingencyQuantity:
            data.contingencyQuantity === undefined
              ? row.contingencyQuantity
              : (data.contingencyQuantity as number | null),
          minimumQuantity:
            data.minimumQuantity === undefined
              ? row.minimumQuantity
              : (data.minimumQuantity as number | null),
          recommendedQuantity:
            data.recommendedQuantity === undefined
              ? row.recommendedQuantity
              : (data.recommendedQuantity as number | null),
          updatedAt: new Date(row.updatedAt.getTime() + 1000),
        };
        return { ...row };
      },
    },
    materialStockLevelAudit: {
      async create({ data }: { data: Omit<AuditRow, "id" | "createdAt"> }) {
        const created: AuditRow = {
          id: `audit-${audits.length + 1}`,
          createdAt: new Date(),
          ...data,
        };
        audits.push(created);
        return created;
      },
    },
    async $transaction<T>(fn: (tx: typeof api) => Promise<T>): Promise<T> {
      const snapshot = {
        row: { ...row },
        audits: audits.map((a) => ({ ...a })),
      };
      try {
        return await fn(api);
      } catch (err) {
        row = snapshot.row;
        audits.length = 0;
        audits.push(...snapshot.audits);
        throw err;
      }
    },
  };
  return api;
}

function baseMaterial(overrides: Partial<MaterialRow> = {}): MaterialRow {
  return {
    id: MATERIAL_ID,
    code: "MP-PARAMS",
    quantity: 500,
    contingencyQuantity: null,
    minimumQuantity: null,
    recommendedQuantity: null,
    stockConferenceVersion: 3,
    updatedAt: new Date("2026-07-28T10:00:00.000Z"),
    currentCost: 5.17,
    averageCost: 5.0,
    standardCost: 4.8,
    freight: 0.25,
    standardLoss: 10,
    ...overrides,
  };
}

describe("materialStockParametersRules", () => {
  it("aceita parâmetros válidos e zero configurado", () => {
    const cmd = parseMaterialStockParametersCommand({
      contingencyQuantity: 0,
      minimumQuantity: 10,
      recommendedQuantity: "20.5",
    });
    assert.equal(cmd.contingencyQuantity, 0);
    assert.equal(cmd.minimumQuantity, 10);
    assert.equal(cmd.recommendedQuantity, 20.5);
  });

  it("aceita parâmetros nulos (não configurado)", () => {
    const cmd = parseMaterialStockParametersCommand({
      contingencyQuantity: null,
      minimumQuantity: null,
      recommendedQuantity: null,
    });
    assert.equal(cmd.contingencyQuantity, null);
    assert.equal(cmd.minimumQuantity, null);
    assert.equal(cmd.recommendedQuantity, null);
  });

  it("rejeita hierarquia inválida", () => {
    assert.throws(
      () =>
        parseMaterialStockParametersCommand({
          contingencyQuantity: 100,
          minimumQuantity: 50,
          recommendedQuantity: 10,
        }),
      (err: unknown) =>
        err instanceof MaterialStockConferenceError && err.code === "INVALID_FIELD"
    );
  });
});

describe("updateMaterialStockParameters", () => {
  const actor = { id: USER_ID, name: "Gestor", email: "g@test.local" };

  it("atualiza parâmetros válidos sem mexer em estoque/custos e grava auditoria", async () => {
    const db = createDb(baseMaterial({ quantity: 500 }));
    const costBefore = resolveMaterialLineCostForEngine({
      id: MATERIAL_ID,
      code: "MP-PARAMS",
      description: "x",
      currentCost: 5.17,
      freight: 0.25,
      standardLoss: 10,
    });
    assert.equal(costBefore.ok, true);
    if (!costBefore.ok) return;
    const lineBefore = directMaterialLineFromBom(
      costBefore.landedCost,
      costBefore.standardLossPct,
      2,
      0
    );

    const result = await updateMaterialStockParameters(db as any, {
      materialId: MATERIAL_ID,
      body: {
        contingencyQuantity: 10,
        minimumQuantity: 20,
        recommendedQuantity: 50,
        reason: "ajuste de política",
      },
      actor,
    });

    assert.equal(result.material.quantity, 500);
    assert.equal(result.material.contingencyQuantity, 10);
    assert.equal(result.material.minimumQuantity, 20);
    assert.equal(result.material.recommendedQuantity, 50);
    assert.equal(db.getMaterial().quantity, 500);
    assert.equal(db.getMaterial().currentCost, 5.17);
    assert.equal(db.getAudits().length, 1);
    assert.equal(db.getAudits()[0]?.action, "UPDATE_LEVELS");
    assert.equal(db.getAudits()[0]?.userId, USER_ID);
    assert.deepEqual(db.getAudits()[0]?.afterJson, {
      contingencyQuantity: 10,
      minimumQuantity: 20,
      recommendedQuantity: 50,
    });
    for (const payload of db.getUpdatePayloads()) {
      const keys = Object.keys(payload as object);
      assert.ok(!keys.includes("quantity"));
      assert.ok(!keys.includes("currentCost"));
      assert.ok(!keys.includes("freight"));
      assert.ok(!keys.includes("standardLoss"));
    }

    const after = db.getMaterial();
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

  it("permite zerar/nular parâmetros", async () => {
    const db = createDb(
      baseMaterial({
        contingencyQuantity: 5,
        minimumQuantity: 10,
        recommendedQuantity: 20,
      })
    );
    const result = await updateMaterialStockParameters(db as any, {
      materialId: MATERIAL_ID,
      body: {
        contingencyQuantity: null,
        minimumQuantity: null,
        recommendedQuantity: null,
      },
      actor,
    });
    assert.equal(result.material.contingencyQuantity, null);
    assert.equal(result.material.minimumQuantity, null);
    assert.equal(result.material.recommendedQuantity, null);
    assert.equal(result.material.quantity, 500);
    assert.equal(db.getAudits().length, 1);
  });

  it("material inexistente retorna 404", async () => {
    const db = createDb(baseMaterial());
    await assert.rejects(
      () =>
        updateMaterialStockParameters(db as any, {
          materialId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          body: {
            contingencyQuantity: 1,
            minimumQuantity: 2,
            recommendedQuantity: 3,
          },
          actor,
        }),
      (err: unknown) => {
        assert.ok(err instanceof MaterialStockConferenceError);
        assert.equal(err.code, "NOT_FOUND");
        assert.equal(materialStockConferenceHttpStatus(err), 404);
        return true;
      }
    );
    assert.equal(db.getAudits().length, 0);
  });

  it("hierarquia inválida não grava auditoria", async () => {
    const db = createDb(baseMaterial());
    await assert.rejects(() =>
      updateMaterialStockParameters(db as any, {
        materialId: MATERIAL_ID,
        body: {
          contingencyQuantity: 30,
          minimumQuantity: 10,
          recommendedQuantity: 5,
        },
        actor,
      })
    );
    assert.equal(db.getMaterial().contingencyQuantity, null);
    assert.equal(db.getAudits().length, 0);
  });
});
