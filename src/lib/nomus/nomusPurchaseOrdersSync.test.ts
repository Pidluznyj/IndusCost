/**
 * PURCH-MIRROR-01 — Testes de integração do orquestrador de sync usando um
 * Prisma FAKE em memória (sem banco real disponível neste ambiente — ver
 * docs/NOMUS_PURCHASE_ORDERS_MIRROR.md "Validação" para os comandos reais a
 * rodar contra Postgres local).
 *
 * O fake é embrulhado num Proxy que LANÇA para qualquer model não permitido
 * (accountsPayable, purchaseOrder interno, purchaseReceipt,
 * inventoryMovement, etc.) — isso prova, em teste, que o sync nunca toca
 * esses modelos (item "side effects proibidos" da missão).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { runNomusPurchaseOrdersSync } from "./nomusPurchaseOrdersSync.server.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "__fixtures__", "purchaseOrders");
function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}

const ALLOWED_MODELS = new Set([
  "financialSupplierAlias",
  "nomusProductCatalog",
  "material",
  "inventoryItem",
  "nomusPurchaseOrder",
  "nomusPurchaseOrderItem",
  "$transaction",
]);

type FakeOrderRow = Record<string, unknown> & { id: string; externalId: number };
type FakeItemRow = Record<string, unknown> & {
  id: string;
  purchaseOrderId: string;
  lineNumber: number;
};

function createFakePrisma() {
  const orders = new Map<number, FakeOrderRow>();
  const items = new Map<string, FakeItemRow>(); // key: purchaseOrderId:lineNumber

  const orderModel = {
    findMany: async ({ where }: { where?: { externalId?: { in: number[] } } }) => {
      const ids = where?.externalId?.in ?? [];
      return [...orders.values()].filter((o) => ids.includes(o.externalId));
    },
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: { externalId: number };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const existing = orders.get(where.externalId);
      if (existing) {
        const merged = { ...existing, ...update };
        orders.set(where.externalId, merged as FakeOrderRow);
        return merged;
      }
      const row: FakeOrderRow = { id: randomUUID(), externalId: where.externalId, ...create };
      orders.set(where.externalId, row);
      return row;
    },
  };

  const itemModel = {
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: { purchaseOrderId_lineNumber: { purchaseOrderId: string; lineNumber: number } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const key = `${where.purchaseOrderId_lineNumber.purchaseOrderId}:${where.purchaseOrderId_lineNumber.lineNumber}`;
      const existing = items.get(key);
      if (existing) {
        const merged = { ...existing, ...update };
        items.set(key, merged as FakeItemRow);
        return merged;
      }
      const row: FakeItemRow = {
        id: randomUUID(),
        purchaseOrderId: where.purchaseOrderId_lineNumber.purchaseOrderId,
        lineNumber: where.purchaseOrderId_lineNumber.lineNumber,
        ...create,
      };
      items.set(key, row);
      return row;
    },
  };

  const base = {
    financialSupplierAlias: { findMany: async () => [] as unknown[] },
    nomusProductCatalog: { findMany: async () => [] as unknown[] },
    material: { findMany: async () => [] as unknown[] },
    inventoryItem: { findMany: async () => [] as unknown[] },
    nomusPurchaseOrder: orderModel,
    nomusPurchaseOrderItem: itemModel,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(guardedTx),
  };

  function guard<T extends object>(target: T, label: string): T {
    return new Proxy(target, {
      get(obj, prop, receiver) {
        if (typeof prop === "string" && !ALLOWED_MODELS.has(prop) && prop in obj === false) {
          throw new Error(
            `SIDE_EFFECT_VIOLATION: acesso não permitido a "${String(prop)}" em ${label}`
          );
        }
        return Reflect.get(obj, prop, receiver);
      },
    });
  }

  const guardedTx = guard(
    { nomusPurchaseOrder: orderModel, nomusPurchaseOrderItem: itemModel },
    "transaction"
  );

  const guarded = new Proxy(base, {
    get(obj, prop, receiver) {
      if (typeof prop === "string" && !ALLOWED_MODELS.has(prop)) {
        throw new Error(`SIDE_EFFECT_VIOLATION: acesso não permitido a model "${String(prop)}"`);
      }
      return Reflect.get(obj, prop, receiver);
    },
  });

  return { prisma: guarded as unknown as import("@prisma/client").PrismaClient, orders, items };
}

function fetchJsonForFixtures(pages: unknown[][], detailByExternalId: Map<number, unknown>) {
  let listCall = 0;
  return async (url: URL) => {
    const isDetail = /\/rest\/pedidoscompra\/\d+$/.test(url.pathname);
    if (isDetail) {
      const idMatch = url.pathname.match(/(\d+)$/);
      const id = idMatch ? Number.parseInt(idMatch[1], 10) : NaN;
      const detail = detailByExternalId.get(id);
      if (!detail) throw new Error(`Falha HTTP 404 em ${url.toString()}`);
      return detail;
    }
    const page = pages[listCall];
    listCall += 1;
    if (!page) return { pedidosCompra: [], totalPaginas: pages.length };
    return { pedidosCompra: page, totalPaginas: pages.length };
  };
}

test("runNomusPurchaseOrdersSync — preview nunca grava (zero writes)", async () => {
  const { prisma, orders } = createFakePrisma();
  const listPage1 = (loadFixture("listPage1.json") as { pedidosCompra: unknown[] }).pedidosCompra;
  const detail90001 = loadFixture("detail90001Released.json");
  const detail90002 = loadFixture("detail90002Partial.json");
  const fetchJson = fetchJsonForFixtures(
    [listPage1],
    new Map<number, unknown>([
      [90001, detail90001],
      [90002, detail90002],
    ])
  );

  const summary = await runNomusPurchaseOrdersSync({
    prisma,
    mode: "preview",
    strategy: "backfill",
    months: 12,
    baseUrl: "http://example.test",
    maxPages: 5,
    fetchJson: fetchJson as any,
  });

  assert.equal(orders.size, 0, "preview não deve gravar nenhum pedido");
  assert.equal(summary.created, 2);
  assert.equal(summary.mode, "preview");
});

test("runNomusPurchaseOrdersSync — apply grava pedidos + itens; rerun idêntico é idempotente (0 duplicatas)", async () => {
  const { prisma, orders, items } = createFakePrisma();
  const listPage1 = (loadFixture("listPage1.json") as { pedidosCompra: unknown[] }).pedidosCompra;
  const detail90001 = loadFixture("detail90001Released.json");
  const detail90002 = loadFixture("detail90002Partial.json");
  const detailMap = new Map<number, unknown>([
    [90001, detail90001],
    [90002, detail90002],
  ]);

  const runOnce = () =>
    runNomusPurchaseOrdersSync({
      prisma,
      mode: "apply",
      strategy: "backfill",
      months: 12,
      baseUrl: "http://example.test",
      maxPages: 5,
      fetchJson: fetchJsonForFixtures([listPage1], detailMap) as any,
    });

  const first = await runOnce();
  assert.equal(first.created, 2);
  assert.equal(orders.size, 2);
  const itemsAfterFirst = items.size;
  assert.equal(itemsAfterFirst, 1 + 2); // 90001 tem 1 item, 90002 tem 2 itens

  const second = await runOnce();
  assert.equal(second.created, 0);
  assert.equal(second.unchanged, 2, "segunda execução idêntica deve ser UNCHANGED, não CREATE/UPDATE");
  assert.equal(orders.size, 2, "nenhuma duplicata de pedido");
  assert.equal(items.size, itemsAfterFirst, "nenhuma duplicata de item");
});

test("runNomusPurchaseOrdersSync — mudança de status/quantidade no rerun gera UPDATE, não duplicata", async () => {
  const { prisma, orders } = createFakePrisma();
  const listPage1 = (loadFixture("listPage1.json") as { pedidosCompra: unknown[] }).pedidosCompra;
  const detail90001 = loadFixture("detail90001Released.json") as Record<string, unknown>;
  const detail90002 = loadFixture("detail90002Partial.json");
  const detailMap = new Map<number, unknown>([
    [90001, detail90001],
    [90002, detail90002],
  ]);

  await runNomusPurchaseOrdersSync({
    prisma,
    mode: "apply",
    strategy: "backfill",
    months: 12,
    baseUrl: "http://example.test",
    maxPages: 5,
    fetchJson: fetchJsonForFixtures([listPage1], detailMap) as any,
  });

  const changedDetail = {
    ...detail90001,
    status: "4",
    itens: [{ ...(detail90001.itens as any[])[0], status: "4", quantidadeAtendida: 500 }],
  };
  detailMap.set(90001, changedDetail);

  const second = await runNomusPurchaseOrdersSync({
    prisma,
    mode: "apply",
    strategy: "backfill",
    months: 12,
    baseUrl: "http://example.test",
    maxPages: 5,
    fetchJson: fetchJsonForFixtures([listPage1], detailMap) as any,
  });

  assert.equal(second.updated, 1);
  assert.equal(orders.size, 2, "ainda apenas 2 pedidos — update não duplica");
});

test("runNomusPurchaseOrdersSync — detail incompleto (sem itens) NÃO apaga itens já existentes", async () => {
  const { prisma, items } = createFakePrisma();
  const listPage1 = (loadFixture("listPage1.json") as { pedidosCompra: unknown[] }).pedidosCompra;
  const detail90001 = loadFixture("detail90001Released.json");
  const detail90002 = loadFixture("detail90002Partial.json");
  const detailMap = new Map<number, unknown>([
    [90001, detail90001],
    [90002, detail90002],
  ]);

  await runNomusPurchaseOrdersSync({
    prisma,
    mode: "apply",
    strategy: "backfill",
    months: 12,
    baseUrl: "http://example.test",
    maxPages: 5,
    fetchJson: fetchJsonForFixtures([listPage1], detailMap) as any,
  });
  const itemsBefore = items.size;

  // Segunda execução: detail de 90002 volta incompleto (sem "itens").
  detailMap.set(90002, { id: 90002, codigoPedido: "PC-90002", idFornecedor: 5002 });
  await runNomusPurchaseOrdersSync({
    prisma,
    mode: "apply",
    strategy: "backfill",
    months: 12,
    baseUrl: "http://example.test",
    maxPages: 5,
    fetchJson: fetchJsonForFixtures([listPage1], detailMap) as any,
  });

  assert.equal(items.size, itemsBefore, "itens já persistidos não somem por causa de um detail incompleto");
});

test("runNomusPurchaseOrdersSync — nunca acessa AccountsPayable/PurchaseOrder interno/PurchaseReceipt/InventoryMovement", async () => {
  const { prisma } = createFakePrisma();
  const listPage1 = (loadFixture("listPage1.json") as { pedidosCompra: unknown[] }).pedidosCompra;
  const detail90001 = loadFixture("detail90001Released.json");
  const detail90002 = loadFixture("detail90002Partial.json");
  const detailMap = new Map<number, unknown>([
    [90001, detail90001],
    [90002, detail90002],
  ]);

  // Se o sync tentasse tocar qualquer model fora da allowlist, o Proxy
  // lançaria SIDE_EFFECT_VIOLATION e este teste falharia.
  await assert.doesNotReject(() =>
    runNomusPurchaseOrdersSync({
      prisma,
      mode: "apply",
      strategy: "backfill",
      months: 12,
      baseUrl: "http://example.test",
      maxPages: 5,
      fetchJson: fetchJsonForFixtures([listPage1], detailMap) as any,
    })
  );
});

test("runNomusPurchaseOrdersSync — pedido cancelado é importado normalmente (nunca excluído do lote)", async () => {
  const { prisma, orders } = createFakePrisma();
  const listPage = (loadFixture("listPage2.json") as { pedidosCompra: unknown[] }).pedidosCompra;
  const detail90003 = loadFixture("detail90003Canceled.json");
  const detailMap = new Map<number, unknown>([[90003, detail90003]]);

  const summary = await runNomusPurchaseOrdersSync({
    prisma,
    mode: "apply",
    strategy: "backfill",
    months: 12,
    baseUrl: "http://example.test",
    maxPages: 5,
    fetchJson: fetchJsonForFixtures([listPage], detailMap) as any,
  });

  assert.equal(summary.created, 1);
  const row = [...orders.values()][0];
  assert.equal(row.derivedStage, "CANCELADO");
  assert.equal(row.nomusStatusCode, "6");
});
