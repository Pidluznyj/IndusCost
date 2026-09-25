import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  NOMUS_STOCK_WAREHOUSE_BY_PRODUCT_TYPE,
  assertNomusStockPreviewCommand,
  classifyNomusStockPreview,
  locateNomusStockHeaders,
  parseNomusStockQuantity,
  parseUnambiguousCalendarDate,
  readNomusStockRows,
  type NomusStockItemSnapshot,
  type NomusStockProductSnapshot,
  type NomusStockSourceRow,
  type NomusStockWarehouseSnapshot,
} from "./nomusStockInitialLoadPreview.ts";

const warehouses: NomusStockWarehouseSnapshot[] = [
  { id: "wh-pa", code: "PA", status: "ACTIVE", allowsMovements: true },
  { id: "wh-comp", code: "COMPONENTES", status: "ACTIVE", allowsMovements: true },
  { id: "wh-mp", code: "MP", status: "ACTIVE", allowsMovements: true },
];

function product(overrides: Partial<NomusStockProductSnapshot> = {}): NomusStockProductSnapshot {
  return {
    id: "prod-1",
    sku: "622.03AA",
    name: "Peca oficial",
    type: "PRODUCT",
    status: "ACTIVE",
    ...overrides,
  };
}

function item(overrides: Partial<NomusStockItemSnapshot> = {}): NomusStockItemSnapshot {
  return {
    id: "item-1",
    code: "622.03AA",
    productId: "prod-1",
    materialId: null,
    itemType: "FINISHED_PRODUCT",
    unit: "PC",
    nomusProductCode: null,
    ...overrides,
  };
}

function source(overrides: Partial<NomusStockSourceRow> = {}): NomusStockSourceRow {
  return {
    sourceRow: 2,
    sku: "622.03AA",
    description: "Peca",
    unit: "PC",
    oursInOurPower: 10,
    oursInThirdPower: null,
    thirdInOurPower: null,
    total: 99,
    ...overrides,
  };
}

function classify(input: Partial<Parameters<typeof classifyNomusStockPreview>[0]> = {}) {
  return classifyNomusStockPreview({
    sourceRows: [source()],
    products: [product()],
    items: [],
    warehouses,
    balances: [],
    movements: [],
    ...input,
  });
}

test("PRODUCT positivo sem InventoryItem cria proposta de item e saldo inicial em PA", () => {
  const preview = classify();
  assert.equal(preview.rows[0]?.classification, "READY_CREATE_ITEM_AND_INITIAL_BALANCE");
  assert.equal(preview.rows[0]?.warehouseCode, "PA");
  assert.equal(preview.rows[0]?.inventoryItemType, "FINISHED_PRODUCT");
  assert.equal(preview.rows[0]?.physicalQuantity, 0);
  assert.equal(preview.rows[0]?.projected, true);
  assert.equal(preview.rows[0]?.nomusQuantity, 10);
  assert.equal(preview.summary.totalReady, 1);
});

test("COMPONENT positivo sem InventoryItem cria proposta em COMPONENTES", () => {
  const preview = classify({
    sourceRows: [source({ sku: "311.10", unit: "UN" })],
    products: [product({ id: "prod-c", sku: "311.10", type: "COMPONENT" })],
  });
  assert.equal(preview.rows[0]?.classification, "READY_CREATE_ITEM_AND_INITIAL_BALANCE");
  assert.equal(preview.rows[0]?.warehouseCode, "COMPONENTES");
  assert.equal(preview.rows[0]?.inventoryItemType, "COMPONENT");
  assert.notEqual(preview.rows[0]?.warehouseCode, "MP");
});

test("InventoryItem zerado e sem ledger fica pronto para saldo inicial", () => {
  const preview = classify({ items: [item()] });
  assert.equal(preview.rows[0]?.classification, "READY_INITIAL_BALANCE");
  assert.equal(preview.rows[0]?.inventoryItemId, "item-1");
  assert.equal(preview.rows[0]?.movementCount, 0);
  assert.equal(preview.rows[0]?.physicalQuantity, 0);
});

test("InventoryItem com saldo físico vai para revisão e mostra a diferença", () => {
  const preview = classify({
    items: [item()],
    balances: [{ itemId: "item-1", warehouseId: "wh-pa", physicalQuantity: 4, availableQuantity: 3 }],
  });
  const row = preview.rows[0];
  assert.equal(row?.classification, "EXISTING_STOCK_REVIEW");
  assert.equal(row?.nomusQuantity, 10);
  assert.equal(row?.physicalQuantity, 4);
  assert.equal(row?.difference, 6);
});

test("InventoryItem zerado com movimento não recebe saldo inicial automático", () => {
  const preview = classify({
    items: [item()],
    balances: [{ itemId: "item-1", warehouseId: "wh-pa", physicalQuantity: 0, availableQuantity: 0 }],
    movements: [
      {
        id: "mov-1",
        itemId: "item-1",
        movementType: "ADJUSTMENT",
        sourceWarehouseId: null,
        destinationWarehouseId: "wh-pa",
        reversedMovementId: null,
      },
    ],
  });
  assert.equal(preview.rows[0]?.classification, "EXISTING_LEDGER_REVIEW");
  assert.equal(preview.rows[0]?.movementCount, 1);
});

test("saldo Nomus zero não gera ação", () => {
  const preview = classify({ sourceRows: [source({ oursInOurPower: 0, total: 15 })] });
  assert.equal(preview.rows[0]?.classification, "ZERO_BALANCE_NO_ACTION");
  assert.equal(preview.rows[0]?.nomusQuantity, 0);
  assert.equal(preview.summary.totalReady, 0);
});

test("saldo Nomus negativo não gera proposta", () => {
  const preview = classify({ sourceRows: [source({ oursInOurPower: -2 })] });
  assert.equal(preview.rows[0]?.classification, "NEGATIVE_STOCK_REVIEW");
  assert.equal(preview.summary.totalReady, 0);
});

test("SKU sem Product fica bloqueado", () => {
  const preview = classify({ products: [] });
  assert.equal(preview.rows[0]?.classification, "PRODUCT_NOT_FOUND");
});

test("SKU repetido com a mesma identidade agrega a quantidade", () => {
  const preview = classify({
    sourceRows: [
      source({ sourceRow: 2, oursInOurPower: 2 }),
      source({ sourceRow: 5, sku: "622.03aa", description: " peça ", unit: "pc", oursInOurPower: 3 }),
    ],
  });
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0]?.classification, "READY_CREATE_ITEM_AND_INITIAL_BALANCE");
  assert.equal(preview.rows[0]?.nomusQuantity, 5);
  assert.equal(preview.rows[0]?.sku, "622.03AA");
  assert.deepEqual(preview.rows[0]?.sourceRows, [2, 5]);
});

test("SKU repetido com descrição diferente não é agregado", () => {
  const preview = classify({
    sourceRows: [
      source({ sourceRow: 2, description: "Corpo A", oursInOurPower: 2 }),
      source({ sourceRow: 3, description: "Corpo B", oursInOurPower: 8 }),
    ],
  });
  assert.equal(preview.rows.length, 2);
  assert.equal(preview.rows[0]?.classification, "AMBIGUOUS_REPORT_IDENTITY");
  assert.equal(preview.rows[1]?.classification, "AMBIGUOUS_REPORT_IDENTITY");
  assert.match(preview.rows[0]?.reason ?? "", /linha 2/);
  assert.match(preview.rows[0]?.reason ?? "", /linha 3/);
  assert.match(preview.rows[0]?.reason ?? "", /Corpo A/);
  assert.match(preview.rows[0]?.reason ?? "", /Corpo B/);
  assert.equal(preview.summary.totalReady, 0);
});

test("unidade divergente bloqueia sem conversão", () => {
  const preview = classify({ items: [item({ unit: "KG" })] });
  assert.equal(preview.rows[0]?.classification, "UNIT_MISMATCH");
  assert.match(preview.rows[0]?.reason ?? "", /KG/);
  assert.match(preview.rows[0]?.reason ?? "", /PC/);
});

test("InventoryItem de matéria-prima com o mesmo código não é reaproveitado", () => {
  const preview = classify({
    items: [item({ productId: null, materialId: "mat-1", itemType: "RAW_MATERIAL", unit: "KG" })],
  });
  assert.equal(preview.rows[0]?.classification, "INVENTORY_ITEM_IDENTITY_CONFLICT");
  assert.equal(preview.rows[0]?.inventoryItemId, "");
});

test("Product PRODUCT usa o almoxarifado PA", () => {
  const preview = classify();
  assert.equal(preview.rows[0]?.warehouseCode, NOMUS_STOCK_WAREHOUSE_BY_PRODUCT_TYPE.PRODUCT);
  assert.equal(NOMUS_STOCK_WAREHOUSE_BY_PRODUCT_TYPE.PRODUCT, "PA");
});

test("Product COMPONENT usa o almoxarifado COMPONENTES", () => {
  const preview = classify({
    products: [product({ type: "COMPONENT" })],
  });
  assert.equal(preview.rows[0]?.warehouseCode, "COMPONENTES");
  assert.equal(preview.rows[0]?.inventoryItemType, "COMPONENT");
});

test("matéria-prima não entra nesta carga", () => {
  const preview = classify({
    products: [product({ type: "RAW_MATERIAL" })],
    items: [item({ itemType: "RAW_MATERIAL", materialId: "mat-1", productId: "prod-1" })],
  });
  assert.equal(preview.rows[0]?.classification, "OUT_OF_SCOPE_PRODUCT_TYPE");
  assert.equal(preview.rows[0]?.warehouseCode, "");
  assert.equal((Object.values(NOMUS_STOCK_WAREHOUSE_BY_PRODUCT_TYPE) as readonly string[]).includes("MP"), false);
});

test("preserva o SKU com ponto, letra e zero à esquerda", () => {
  const preview = classify({
    sourceRows: [source({ sku: "00622.03AA" })],
    products: [product({ sku: "00622.03AA" })],
  });
  assert.equal(preview.rows[0]?.sku, "00622.03AA");
  assert.equal(preview.rows[0]?.classification, "READY_CREATE_ITEM_AND_INITIAL_BALANCE");
});

test("coluna física ausente interrompe sem usar Total", () => {
  assert.throws(
    () =>
      locateNomusStockHeaders(
        [
          ["Relatorio"],
          ["Código do Produto", "Descrição", "U.M.", "Total"],
          ["622.03AA", "Peca", "PC", 15],
        ],
        "Posicao"
      ),
    /Materiais nossos em nosso poder/
  );
});

test("reconhece o cabeçalho real e ignora Total como quantidade", () => {
  const matrix = [
    ["Relatorio Posicao de Estoque"],
    [
      "Código do Produto",
      "Descrição",
      "U.M.",
      "Materiais nossos em nosso poder",
      "Materiais nossos em poder de terceiros",
      "Materiais de terceiros em nosso poder",
      "Total",
    ],
    ["622.03AA", "Peca", "PC", "1.234,50", 2, 3, "9.999,00"],
  ];
  const header = locateNomusStockHeaders(matrix, "Posicao");
  assert.equal(header.physicalQuantityHeader, "Materiais nossos em nosso poder");
  assert.equal(header.headerRowNumber, 2);
  const rows = readNomusStockRows(matrix, header);
  assert.equal(rows[0]?.sku, "622.03AA");
  assert.equal(rows[0]?.oursInOurPower, 1234.5);
  assert.equal(rows[0]?.total, 9999);
  const preview = classifyNomusStockPreview({
    sourceRows: rows,
    products: [product()],
    items: [],
    warehouses,
    balances: [],
    movements: [],
  });
  assert.equal(preview.rows[0]?.nomusQuantity, 1234.5);
});

test("fórmula, erro do Excel e texto numérico não são adivinhados", () => {
  assert.equal(parseNomusStockQuantity("=A1+10"), null);
  assert.equal(parseNomusStockQuantity("#DIV/0!"), null);
  assert.equal(parseNomusStockQuantity(""), null);
  assert.equal(parseNomusStockQuantity("1.234,50"), 1234.5);
  assert.equal(parseNomusStockQuantity("10"), 10);
  assert.equal(parseUnambiguousCalendarDate(new Date("2026-09-24T00:00:00.000Z")), "2026-09-24");
});

test("apply é abortado", () => {
  assert.throws(() => assertNomusStockPreviewCommand(["apply", "--file=estoque.xls"]), /APPLY/);
  assert.throws(() => assertNomusStockPreviewCommand(["preview", "--apply"]), /APPLY/);
  assert.doesNotThrow(() => assertNomusStockPreviewCommand(["preview", "--file=estoque.xls"]));
});

test("o script não escreve saldo, Product nem Material e usa o motor canônico", () => {
  const sourceText = readFileSync(path.join(process.cwd(), "scripts", "nomusStockInitialLoad.ts"), "utf8");
  const applyText = readFileSync(path.join(process.cwd(), "src", "lib", "inventory", "nomusStockInitialLoadApply.ts"), "utf8");
  assert.match(sourceText, /assertNomusStockPreviewCommand/);
  assert.match(sourceText, /findMany/);
  assert.match(sourceText, /createInitialInventoryBalance/);
  assert.doesNotMatch(sourceText, /inventoryBalance\.(create|update|upsert|delete|updateMany|deleteMany)\s*\(/);
  assert.doesNotMatch(sourceText, /product\.(create|update|delete|upsert|updateMany|deleteMany)\s*\(/);
  assert.doesNotMatch(sourceText, /material\.(create|update|delete|upsert|updateMany|deleteMany)\s*\(/);
  assert.doesNotMatch(applyText, /inventoryBalance/);
  assert.doesNotMatch(applyText, /\$executeRaw|\$queryRawUnsafe/);
});
