import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MaterialStockConferenceError } from "./materialStockConferenceRules.js";
import { materialStockConferenceHttpStatus } from "./materialStockConference.server.js";
import {
  listMaterialStockConferenceHistory,
  parseMaterialStockHistoryQuery,
} from "./materialStockHistory.server.js";

const MATERIAL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type ConfRow = {
  id: string;
  materialId: string;
  recordedAt: Date;
  userId: string;
  userName: string | null;
  previousQuantity: number;
  reportedQuantity: number;
  difference: number;
  unitSnapshot: string;
  reason: string;
  notes: string | null;
  source: string;
};

function createDb(rows: ConfRow[], materialExists = true) {
  return {
    material: {
      async findUnique({ where }: { where: { id: string } }) {
        if (!materialExists) return null;
        return where.id === MATERIAL_ID ? { id: MATERIAL_ID } : null;
      },
    },
    materialStockConference: {
      async findMany({
        where,
        orderBy,
        skip,
        take,
      }: {
        where: { materialId: string };
        orderBy: { recordedAt: "asc" | "desc" };
        skip: number;
        take: number;
      }) {
        const filtered = rows
          .filter((r) => r.materialId === where.materialId)
          .sort((a, b) =>
            orderBy.recordedAt === "desc"
              ? b.recordedAt.getTime() - a.recordedAt.getTime()
              : a.recordedAt.getTime() - b.recordedAt.getTime()
          );
        return filtered.slice(skip, skip + take).map((r) => ({ ...r }));
      },
      async count({ where }: { where: { materialId: string } }) {
        return rows.filter((r) => r.materialId === where.materialId).length;
      },
    },
  };
}

function conf(
  id: string,
  recordedAt: string,
  overrides: Partial<ConfRow> = {}
): ConfRow {
  return {
    id,
    materialId: MATERIAL_ID,
    recordedAt: new Date(recordedAt),
    userId: USER_ID,
    userName: "Operador",
    previousQuantity: 500,
    reportedQuantity: 450,
    difference: -50,
    unitSnapshot: "kg",
    reason: "CONFERENCIA_FISICA",
    notes: "ok",
    source: "TABLET_CONFERENCE",
    ...overrides,
  };
}

describe("parseMaterialStockHistoryQuery", () => {
  it("aplica paginação padrão e limites", () => {
    const q = parseMaterialStockHistoryQuery({});
    assert.equal(q.page, 1);
    assert.equal(q.pageSize, 30);
    assert.equal(q.skip, 0);
    const limited = parseMaterialStockHistoryQuery({ page: 2, pageSize: 999 });
    assert.equal(limited.page, 2);
    assert.equal(limited.pageSize, 50);
    assert.equal(limited.skip, 50);
  });
});

describe("listMaterialStockConferenceHistory", () => {
  it("retorna histórico paginado do mais recente para o mais antigo", async () => {
    const db = createDb([
      conf("1", "2026-07-01T10:00:00.000Z"),
      conf("2", "2026-07-10T10:00:00.000Z"),
      conf("3", "2026-07-20T10:00:00.000Z"),
      conf("x", "2026-07-20T12:00:00.000Z", { materialId: OTHER_ID }),
    ]);
    const page1 = await listMaterialStockConferenceHistory(db as any, {
      materialId: MATERIAL_ID,
      query: { page: 1, pageSize: 2 },
    });
    assert.equal(page1.total, 3);
    assert.equal(page1.pageSize, 2);
    assert.equal(page1.totalPages, 2);
    assert.deepEqual(
      page1.rows.map((r) => r.id),
      ["3", "2"]
    );
    assert.equal(page1.rows[0]?.previousQuantity, 500);
    assert.equal(page1.rows[0]?.reportedQuantity, 450);
    assert.equal(page1.rows[0]?.difference, -50);
    assert.equal(page1.rows[0]?.unit, "kg");
    assert.equal(page1.rows[0]?.reason, "CONFERENCIA_FISICA");
    assert.equal(page1.rows[0]?.notes, "ok");
    assert.equal(page1.rows[0]?.source, "TABLET_CONFERENCE");
    assert.equal(page1.rows[0]?.userId, USER_ID);

    const page2 = await listMaterialStockConferenceHistory(db as any, {
      materialId: MATERIAL_ID,
      query: { page: 2, pageSize: 2 },
    });
    assert.deepEqual(
      page2.rows.map((r) => r.id),
      ["1"]
    );
  });

  it("material inexistente retorna 404", async () => {
    const db = createDb([], false);
    await assert.rejects(
      () =>
        listMaterialStockConferenceHistory(db as any, {
          materialId: MATERIAL_ID,
          query: {},
        }),
      (err: unknown) => {
        assert.ok(err instanceof MaterialStockConferenceError);
        assert.equal(err.code, "NOT_FOUND");
        assert.equal(materialStockConferenceHttpStatus(err), 404);
        return true;
      }
    );
  });
});
