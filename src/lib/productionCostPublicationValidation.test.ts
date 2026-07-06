import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertPositiveProductionUnitCost,
  classifyProductionCostItemForPublication,
  formatProductionCostPublicationFieldError,
  isPublishableProductionUnitCost,
  productionCostDecimalToNumber,
} from "./productionCostVersioning.js";
import {
  publishProductionCostTableVersion,
  addOrUpdateProductionCostTableDraftItem,
  createProductionCostTableDraft,
} from "./productionCostTables.server.js";
import { civilDateToLocalDate } from "./financeCivilDate.js";

describe("productionCostPublicationValidation", () => {
  it('SKU numérico "63020" é identificador — validação atua só em unitProductionCost', () => {
    const issue = classifyProductionCostItemForPublication({
      id: "i1",
      productId: "p1",
      productCodeSnapshot: "63020",
      productNameSnapshot: "Peça X",
      unitProductionCost: 0,
    });
    assert.ok(issue);
    assert.equal(issue?.productCode, "63020");
    assert.equal(issue?.field, "unitProductionCost");
  });

  it('SKU alfanumérico "301.06AA" permanece identificador textual', () => {
    const issue = classifyProductionCostItemForPublication({
      id: "i2",
      productId: "p2",
      productCodeSnapshot: "301.06AA",
      productNameSnapshot: "Componente",
      unitProductionCost: 0,
    });
    assert.ok(issue);
    assert.equal(issue?.productCode, "301.06AA");
    assert.match(
      formatProductionCostPublicationFieldError("301.06AA", "unitProductionCost", "Componente"),
      /Produto 301\.06AA/
    );
    assert.doesNotMatch(
      formatProductionCostPublicationFieldError("301.06AA", "unitProductionCost", "Componente"),
      /301\.06AA deve ser um número/
    );
  });

  it("custo NaN, Infinity, zero e negativo não são publicáveis", () => {
    assert.equal(isPublishableProductionUnitCost(NaN), false);
    assert.equal(isPublishableProductionUnitCost(Infinity), false);
    assert.equal(isPublishableProductionUnitCost(0), false);
    assert.equal(isPublishableProductionUnitCost(-1), false);
    assert.equal(isPublishableProductionUnitCost(0.01), true);
  });

  it("mensagem de erro identifica campo de custo, não SKU como valor", () => {
    assert.throws(
      () => assertPositiveProductionUnitCost(0, "unitProductionCost", "63020", "Peça"),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : "";
        assert.match(message, /Produto 63020/);
        assert.match(message, /unitProductionCost inválido/);
        assert.doesNotMatch(message, /63020 deve ser um número finito/);
        return true;
      }
    );
  });

  it("productionCostDecimalToNumber não confunde SKU com custo quando campos estão separados", () => {
    assert.equal(productionCostDecimalToNumber(12.34), 12.34);
    assert.equal(Number.isNaN(productionCostDecimalToNumber("ABC123")), true);
  });
});

describe("productionCostPublicationValidation — publicação parcial", () => {
  it("publica itens válidos e exclui inválidos do DRAFT publicado", async () => {
    const versions = new Map<string, Record<string, unknown>>();
    const items = new Map<string, Record<string, unknown>>();
    let versionSeq = 0;
    let itemSeq = 0;
    const itemKey = (versionId: string, productId: string) => `${versionId}:${productId}`;

    const db = {
      productionCostTableVersion: {
        findUnique: async ({ where, include }: { where: { id: string }; include?: unknown }) => {
          const row = versions.get(where.id);
          if (!row) return null;
          if (include) {
            return {
              ...row,
              items: [...items.values()].filter((i) => i.costTableVersionId === row.id),
            };
          }
          return row;
        },
        update: async ({
          where,
          data,
          include,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
          include?: unknown;
        }) => {
          const row = versions.get(where.id)!;
          Object.assign(row, data);
          if (include) {
            return {
              ...row,
              items: [...items.values()].filter((i) => i.costTableVersionId === row.id),
            };
          }
          return row;
        },
      },
      productionCostTableItem: {
        deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
          for (const id of where.id.in) {
            for (const [key, row] of items.entries()) {
              if (row.id === id) items.delete(key);
            }
          }
          return { count: where.id.in.length };
        },
        findMany: async () => [],
      },
      $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
    };

    versionSeq += 1;
    const versionId = `ver-${versionSeq}`;
    versions.set(versionId, {
      id: versionId,
      code: "2026-07",
      name: "Jul",
      effectiveDate: civilDateToLocalDate("2026-07-01"),
      status: "DRAFT",
      revision: 1,
      supersedesVersionId: null,
      notes: null,
    });

    const addItem = (
      productId: string,
      sku: string,
      unitProductionCost: number
    ) => {
      itemSeq += 1;
      const row = {
        id: `item-${itemSeq}`,
        costTableVersionId: versionId,
        productId,
        productCodeSnapshot: sku,
        productNameSnapshot: `Nome ${sku}`,
        unitProductionCost,
      };
      items.set(itemKey(versionId, productId), row);
    };

    addItem("good", "301.06AA", 10.5);
    addItem("bad-zero", "63020", 0);
    addItem("bad-nan", "ABC-1", NaN);

    const result = await publishProductionCostTableVersion(db as never, { versionId });

    assert.equal(result.partialPublication, true);
    assert.equal(result.itemsPublished, 1);
    assert.equal(result.itemsExcluded, 2);
    assert.equal(result.version.status, "PUBLISHED");
    assert.equal(result.version.items.length, 1);
    assert.equal(result.version.items[0]?.productCodeSnapshot, "301.06AA");
    assert.equal(result.pendencies.length, 2);
    assert.equal(result.pendencies.some((p) => p.productCode === "63020"), true);
  });

  it("falha apenas quando nenhum item tem custo válido", async () => {
    const { db } = await (async () => {
      const versions = new Map<string, Record<string, unknown>>();
      const items = new Map<string, Record<string, unknown>>();
      const draft = await createProductionCostTableDraft(
        {
          productionCostTableVersion: {
            findFirst: async () => null,
            create: async ({ data }: { data: Record<string, unknown> }) => {
              const id = "ver-empty";
              const row = { id, ...data };
              versions.set(id, row);
              return row;
            },
          },
          $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
            fn({
              productionCostTableVersion: {
                findFirst: async () => null,
                create: async ({ data }: { data: Record<string, unknown> }) => {
                  const id = "ver-empty";
                  const row = { id, ...data };
                  versions.set(id, row);
                  return row;
                },
              },
            }),
        } as never,
        {
          code: "2026-07",
          name: "Jul",
          effectiveDate: civilDateToLocalDate("2026-07-01"),
        }
      );

      await addOrUpdateProductionCostTableDraftItem(
        {
          productionCostTableVersion: {
            findUnique: async ({ where }: { where: { id: string } }) =>
              versions.get(where.id) ?? null,
          },
          product: { findUnique: async () => ({ id: "p1" }) },
          productionCostTableItem: {
            upsert: async ({ create }: { create: Record<string, unknown> }) => {
              items.set("k", { id: "item-1", ...create });
              return items.get("k");
            },
          },
        } as never,
        draft.id,
        {
          productId: "p1",
          productCodeSnapshot: "63020",
          productNameSnapshot: "Sem custo",
          unitProductionCost: 0,
        }
      );

      const mockDb = {
        productionCostTableVersion: {
          findUnique: async ({ where, include }: { where: { id: string }; include?: unknown }) => {
            const row = versions.get(where.id);
            if (!row) return null;
            if (include) {
              return {
                ...row,
                items: [...items.values()].filter((i) => i.costTableVersionId === row.id),
              };
            }
            return row;
          },
        },
        productionCostTableItem: { deleteMany: async () => ({ count: 0 }), findMany: async () => [] },
        $transaction: async (fn: (tx: typeof mockDb) => Promise<unknown>) => fn(mockDb),
      };
      return { db: mockDb, draft };
    })();

    await assert.rejects(
      () => publishProductionCostTableVersion(db as never, { versionId: "ver-empty" }),
      /nenhum item com custo unitário válido/i
    );
  });
});
