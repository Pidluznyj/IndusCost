import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  NOMUS_INITIAL_STOCK_APPLY_CONFIRM,
  NomusStockItemCodeTakenError,
  assertNomusStockApplyRequest,
  executeNomusStockApply,
  resolveNomusStockAsOf,
  type NomusStockApplyActor,
  type NomusStockApplyPorts,
  type NomusStockNewItemData,
  type NomusStockPostInitialBalance,
} from "./nomusStockInitialLoadApply.ts";
import {
  classifyNomusStockPreview,
  type NomusStockBalanceSnapshot,
  type NomusStockItemSnapshot,
  type NomusStockMovementSnapshot,
  type NomusStockProductSnapshot,
  type NomusStockSourceRow,
  type NomusStockWarehouseSnapshot,
} from "./nomusStockInitialLoadPreview.ts";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const SHA = "ab".repeat(32);

const warehouses: NomusStockWarehouseSnapshot[] = [
  { id: "wh-pa", code: "PA", status: "ACTIVE", allowsMovements: true },
  { id: "wh-comp", code: "COMPONENTES", status: "ACTIVE", allowsMovements: true },
];

const actor: NomusStockApplyActor = {
  id: ACTOR_ID,
  role: "ADMIN",
  isActive: true,
  permissions: ["inventory.adjustment.create"],
};

type Memory = {
  products: NomusStockProductSnapshot[];
  items: NomusStockItemSnapshot[];
  warehouses: NomusStockWarehouseSnapshot[];
  balances: NomusStockBalanceSnapshot[];
  movements: NomusStockMovementSnapshot[];
  payloads: NomusStockNewItemData[];
  posts: NomusStockPostInitialBalance[];
  events: string[];
  failCodes: Set<string>;
};

function source(overrides: Partial<NomusStockSourceRow> = {}): NomusStockSourceRow {
  return {
    sourceRow: 2,
    sku: "622.03AA",
    description: "Peca",
    unit: "PC",
    oursInOurPower: 10,
    oursInThirdPower: null,
    thirdInOurPower: null,
    total: null,
    ...overrides,
  };
}

function product(overrides: Partial<NomusStockProductSnapshot> = {}): NomusStockProductSnapshot {
  return {
    id: "prod-1",
    sku: "622.03AA",
    name: "Peca oficial",
    type: "PRODUCT",
    status: "ACTIVE",
    sourceExternalId: "nomus-99",
    ...overrides,
  };
}

function memory(seed?: Partial<Memory>): Memory {
  return {
    products: [product()],
    items: [],
    warehouses: warehouses.map((warehouse) => ({ ...warehouse })),
    balances: [],
    movements: [],
    payloads: [],
    posts: [],
    events: [],
    failCodes: new Set(),
    ...seed,
  };
}

function ports(state: Memory): NomusStockApplyPorts {
  return {
    transaction: async (work) =>
      work({
        reloadSku: async () => ({
          products: state.products,
          items: state.items,
          warehouses: state.warehouses,
          balances: state.balances,
          movements: state.movements,
        }),
        createItem: async (data) => {
          assert.equal("materialId" in data, false);
          if (state.items.some((item) => item.code.toLocaleUpperCase("pt-BR") === data.code.toLocaleUpperCase("pt-BR"))) {
            throw new NomusStockItemCodeTakenError();
          }
          const created: NomusStockItemSnapshot = {
            id: `item-${state.items.length + 1}`,
            code: data.code,
            productId: data.productId,
            materialId: null,
            itemType: data.itemType,
            unit: data.unit,
            nomusProductCode: data.nomusProductCode,
          };
          state.items.push(created);
          state.payloads.push(data);
          state.events.push("create-item");
          return { id: created.id };
        },
      }),
    postInitialBalance: async (input) => {
      const item = state.items.find((candidate) => candidate.id === input.itemId);
      if (item && state.failCodes.has(item.code)) {
        state.events.push("post-failed");
        throw new Error("falha isolada do SKU");
      }
      state.posts.push(input);
      state.events.push("post-balance");
      const movement: NomusStockMovementSnapshot = {
        id: `mov-${state.movements.length + 1}`,
        itemId: input.itemId,
        movementType: "INITIAL_BALANCE",
        sourceWarehouseId: null,
        destinationWarehouseId: input.warehouseId,
        reversedMovementId: null,
        quantity: input.quantity,
        evidenceRef: input.evidenceRef,
        documentNumber: input.documentNumber,
        reason: input.justification,
      };
      state.movements.push(movement);
      state.balances.push({
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        physicalQuantity: input.quantity,
        availableQuantity: input.quantity,
      });
      return { movementId: movement.id, idempotent: false, quantity: input.quantity };
    },
  };
}

async function run(state: Memory, sourceRows: NomusStockSourceRow[]) {
  const preview = classifyNomusStockPreview({
    sourceRows,
    products: state.products,
    items: state.items,
    warehouses: state.warehouses,
    balances: state.balances,
    movements: state.movements,
  });
  return executeNomusStockApply({
    rows: preview.rows,
    sourceRows,
    movements: state.movements,
    warehouses: state.warehouses,
    sha256: SHA,
    sourceFileName: "RelatorioPosicaoEstoqueEmpresa.xls",
    asOf: "2026-09-24",
    actor,
    ports: ports(state),
  });
}

test("apply sem confirmação rejeita", () => {
  assert.throws(
    () => assertNomusStockApplyRequest({ confirm: null, actorUserId: ACTOR_ID, filePath: "estoque.xls" }),
    /confirm/
  );
  assert.throws(
    () => assertNomusStockApplyRequest({ confirm: "--apply", actorUserId: ACTOR_ID, filePath: "estoque.xls" }),
    /NOMUS_INITIAL_STOCK_LOAD/
  );
});

test("apply sem actor rejeita", () => {
  assert.throws(
    () =>
      assertNomusStockApplyRequest({
        confirm: NOMUS_INITIAL_STOCK_APPLY_CONFIRM,
        actorUserId: null,
        filePath: "estoque.xls",
      }),
    /actorUserId/
  );
});

test("apply sem data confiável rejeita e não inventa hoje", () => {
  const matrix = [["Código do Produto", "Materiais nossos em nosso poder"], ["622.03AA", 10]];
  assert.throws(() => resolveNomusStockAsOf({ matrix, headerRowNumber: 1, asOfArg: null }), /asOf/);
  assert.throws(() => resolveNomusStockAsOf({ matrix, headerRowNumber: 1, asOfArg: "hoje" }), /YYYY-MM-DD/);
  const dated = [["Posição em 24/09/2026"], ["Código do Produto", "Materiais nossos em nosso poder"]];
  assert.equal(resolveNomusStockAsOf({ matrix: dated, headerRowNumber: 2, asOfArg: null }), "2026-09-24");
});

test("criação de InventoryItem PRODUCT e COMPONENT usa o tipo e o almoxarifado certos", async () => {
  const finished = memory();
  const finishedResult = await run(finished, [source()]);
  assert.equal(finishedResult.appliedItemsCreated, 1);
  assert.equal(finishedResult.appliedInitialBalances, 1);
  assert.equal(finished.payloads[0]?.itemType, "FINISHED_PRODUCT");
  assert.equal(finished.payloads[0]?.defaultWarehouseId, "wh-pa");
  assert.equal(finished.payloads[0]?.productId, "prod-1");
  assert.equal(finished.payloads[0]?.nomusProductCode, "622.03AA");
  assert.equal(finished.payloads[0]?.nomusProductId, "nomus-99");
  assert.equal(finished.payloads[0]?.code, "622.03AA");
  assert.equal("materialId" in (finished.payloads[0] ?? {}), false);

  const component = memory({
    products: [product({ id: "prod-c", sku: "311.10", type: "COMPONENT", sourceExternalId: "  " })],
  });
  const componentResult = await run(component, [source({ sku: "311.10", unit: "UN" })]);
  assert.equal(componentResult.lines[0]?.finalAction, "APPLIED_ITEM_AND_BALANCE");
  assert.equal(component.payloads[0]?.itemType, "COMPONENT");
  assert.equal(component.payloads[0]?.defaultWarehouseId, "wh-comp");
  assert.equal(component.payloads[0]?.nomusProductId, null);
});

test("criação é seguida do saldo inicial canônico e o rerun fica idempotente", async () => {
  const state = memory();
  const rows = [source()];
  const first = await run(state, rows);
  assert.deepEqual(state.events, ["create-item", "post-balance"]);
  assert.equal(first.appliedInitialBalances, 1);
  assert.equal(state.posts[0]?.justification, "Carga inicial de estoque - posição Nomus");
  assert.equal(state.posts[0]?.evidenceRef, `sha256:${SHA}`);
  assert.equal(state.posts[0]?.documentNumber, "RelatorioPosicaoEstoqueEmpresa:2026-09-24");
  assert.match(state.posts[0]?.notes ?? "", /RelatorioPosicaoEstoqueEmpresa\.xls/);
  assert.doesNotMatch(state.posts[0]?.notes ?? "", /[A-Z]:\\/);
  assert.equal(state.posts[0]?.countDate.toISOString(), "2026-09-24T12:00:00.000Z");

  const second = await run(state, rows);
  assert.equal(second.idempotent, 1);
  assert.equal(second.appliedInitialBalances, 0);
  assert.equal(state.posts.length, 1);
  assert.equal(state.items.length, 1);
});

test("idempotência do motor com quantidade diferente não conta como sucesso", async () => {
  const state = memory();
  const preview = classifyNomusStockPreview({
    sourceRows: [source()],
    products: state.products,
    items: [],
    warehouses: state.warehouses,
    balances: [],
    movements: [],
  });
  const base = ports(state);
  const result = await executeNomusStockApply({
    rows: preview.rows,
    sourceRows: [source()],
    movements: [],
    warehouses: state.warehouses,
    sha256: SHA,
    sourceFileName: "RelatorioPosicaoEstoqueEmpresa.xls",
    asOf: "2026-09-24",
    actor,
    ports: {
      transaction: base.transaction,
      postInitialBalance: async () => ({ movementId: "mov-old", idempotent: true, quantity: 4 }),
    },
  });
  assert.equal(result.lines[0]?.finalAction, "BLOCKED");
  assert.equal(result.idempotent, 0);
  assert.equal(result.appliedInitialBalances, 0);
});

test("InventoryItem surgido entre a classificação e o apply é revalidado sem duplicar", async () => {
  const state = memory();
  const preview = classifyNomusStockPreview({
    sourceRows: [source()],
    products: state.products,
    items: [],
    warehouses: state.warehouses,
    balances: [],
    movements: [],
  });
  state.items.push({
    id: "item-existing",
    code: "622.03AA",
    productId: "prod-1",
    materialId: null,
    itemType: "FINISHED_PRODUCT",
    unit: "PC",
    nomusProductCode: "622.03AA",
  });
  const result = await executeNomusStockApply({
    rows: preview.rows,
    sourceRows: [source()],
    movements: [],
    warehouses: state.warehouses,
    sha256: SHA,
    sourceFileName: "RelatorioPosicaoEstoqueEmpresa.xls",
    asOf: "2026-09-24",
    actor,
    ports: ports(state),
  });
  assert.equal(state.payloads.length, 0);
  assert.equal(result.appliedItemsCreated, 0);
  assert.equal(result.appliedInitialBalances, 1);
  assert.equal(result.lines[0]?.inventoryItemId, "item-existing");
});

test("saldo ou ledger surgido entre a classificação e o apply bloqueia", async () => {
  const withStock = memory({
    items: [
      {
        id: "item-1",
        code: "622.03AA",
        productId: "prod-1",
        materialId: null,
        itemType: "FINISHED_PRODUCT",
        unit: "PC",
        nomusProductCode: null,
      },
    ],
  });
  const ready = classifyNomusStockPreview({
    sourceRows: [source()],
    products: withStock.products,
    items: withStock.items,
    warehouses: withStock.warehouses,
    balances: [],
    movements: [],
  });
  withStock.balances.push({ itemId: "item-1", warehouseId: "wh-pa", physicalQuantity: 4, availableQuantity: 4 });
  const stockResult = await executeNomusStockApply({
    rows: ready.rows,
    sourceRows: [source()],
    movements: [],
    warehouses: withStock.warehouses,
    sha256: SHA,
    sourceFileName: "relatorio.xls",
    asOf: "2026-09-24",
    actor,
    ports: ports(withStock),
  });
  assert.equal(stockResult.blocked, 1);
  assert.equal(withStock.posts.length, 0);

  const withLedger = memory({
    items: withStock.items.map((item) => ({ ...item })),
  });
  withLedger.movements.push({
    id: "mov-old",
    itemId: "item-1",
    movementType: "ADJUSTMENT",
    sourceWarehouseId: null,
    destinationWarehouseId: "wh-pa",
    reversedMovementId: null,
    quantity: 1,
  });
  const ledgerResult = await executeNomusStockApply({
    rows: ready.rows,
    sourceRows: [source()],
    movements: [],
    warehouses: withLedger.warehouses,
    sha256: SHA,
    sourceFileName: "relatorio.xls",
    asOf: "2026-09-24",
    actor,
    ports: ports(withLedger),
  });
  assert.equal(ledgerResult.blocked, 1);
  assert.equal(withLedger.posts.length, 0);
});

test("Product que muda de tipo ou almoxarifado inativo bloqueia", async () => {
  const state = memory();
  const preview = classifyNomusStockPreview({
    sourceRows: [source()],
    products: state.products,
    items: [],
    warehouses: state.warehouses,
    balances: [],
    movements: [],
  });
  state.products[0] = product({ type: "COMPONENT" });
  const changed = await executeNomusStockApply({
    rows: preview.rows,
    sourceRows: [source()],
    movements: [],
    warehouses: state.warehouses,
    sha256: SHA,
    sourceFileName: "relatorio.xls",
    asOf: "2026-09-24",
    actor,
    ports: ports(state),
  });
  assert.equal(changed.blocked, 1);
  assert.equal(state.payloads.length, 0);
  assert.equal(state.posts.length, 0);

  await assert.rejects(
    () =>
      executeNomusStockApply({
        rows: preview.rows,
        sourceRows: [source()],
        movements: [],
        warehouses: [{ ...warehouses[0]!, status: "INACTIVE" }, warehouses[1]!],
        sha256: SHA,
        sourceFileName: "relatorio.xls",
        asOf: "2026-09-24",
        actor,
        ports: ports(memory()),
      }),
    /PA/
  );
});

test("conflito com matéria-prima, saldo negativo e SKU ambíguo não aplicam", async () => {
  const material = memory({
    items: [
      {
        id: "item-mp",
        code: "622.03AA",
        productId: null,
        materialId: "mat-1",
        itemType: "RAW_MATERIAL",
        unit: "KG",
        nomusProductCode: null,
      },
    ],
  });
  const materialResult = await run(material, [source()]);
  assert.equal(materialResult.lines[0]?.classificationBeforeApply, "INVENTORY_ITEM_IDENTITY_CONFLICT");
  assert.equal(materialResult.blocked, 1);
  assert.equal(material.items[0]?.materialId, "mat-1");
  assert.equal(material.posts.length, 0);

  const negative = await run(memory(), [source({ oursInOurPower: -3 })]);
  assert.equal(negative.lines[0]?.classificationBeforeApply, "NEGATIVE_STOCK_REVIEW");
  assert.equal(negative.appliedInitialBalances, 0);

  const ambiguous = await run(memory(), [
    source({ sourceRow: 2, description: "Corpo A" }),
    source({ sourceRow: 3, description: "Corpo B" }),
  ]);
  assert.equal(ambiguous.lines.every((line) => line.classificationBeforeApply === "AMBIGUOUS_REPORT_IDENTITY"), true);
  assert.equal(ambiguous.blocked, 2);
  assert.equal(ambiguous.appliedInitialBalances, 0);
});

test("erro em um SKU não impede o outro", async () => {
  const state = memory({
    products: [product(), product({ id: "prod-c", sku: "311.10", type: "COMPONENT" })],
    failCodes: new Set(["622.03AA"]),
  });
  const result = await run(state, [source(), source({ sourceRow: 3, sku: "311.10", unit: "UN" })]);
  assert.equal(result.failed, 1);
  assert.equal(result.appliedItemsCreated, 1);
  assert.equal(result.appliedInitialBalances, 1);
  assert.equal(state.items.length, 2);
  assert.equal(state.movements.length, 1);
  assert.equal(state.movements[0]?.itemId, "item-2");
  assert.equal(result.lines.find((line) => line.sku === "622.03AA")?.finalAction, "FAILED");
});

test("actor inativo é recusado antes de qualquer escrita", async () => {
  const state = memory();
  await assert.rejects(
    () =>
      executeNomusStockApply({
        rows: [],
        sourceRows: [],
        movements: [],
        warehouses,
        sha256: SHA,
        sourceFileName: "relatorio.xls",
        asOf: "2026-09-24",
        actor: { ...actor, isActive: false },
        ports: ports(state),
      }),
    /inativo/
  );
  assert.equal(state.posts.length, 0);
});

test("não há escrita direta de saldo, Product ou Material", () => {
  const applyText = readFileSync(path.join(process.cwd(), "src", "lib", "inventory", "nomusStockInitialLoadApply.ts"), "utf8");
  const scriptText = readFileSync(path.join(process.cwd(), "scripts", "nomusStockInitialLoad.ts"), "utf8");
  assert.match(scriptText, /createInitialInventoryBalance\(/);
  assert.doesNotMatch(applyText, /inventoryBalance/);
  assert.doesNotMatch(scriptText, /inventoryBalance\.(create|update|upsert|delete|updateMany|deleteMany)\s*\(/);
  assert.doesNotMatch(scriptText, /\.product\.(create|update|delete|upsert|updateMany|deleteMany)\s*\(/);
  assert.doesNotMatch(scriptText, /\.material\.(create|update|delete|upsert|updateMany|deleteMany)\s*\(/);
  assert.doesNotMatch(applyText, /\.product\.(create|update|delete|upsert)\s*\(/);
  assert.doesNotMatch(applyText, /\.material\.(create|update|delete|upsert)\s*\(/);
});
