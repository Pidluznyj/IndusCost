import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMINISTRATIVE_STOCK_ITEM_TYPE,
  ADMINISTRATIVE_STOCK_WAREHOUSE_CODE,
  type AdministrativeStockCsvRow,
  type AdministrativeStockItemSnapshot,
  type AdministrativeStockWarehouseSnapshot,
} from "./administrativeStockInitialLoadPreview.ts";
import { verifyAdministrativeStockInitialLoad } from "./administrativeStockInitialLoadVerify.ts";

const warehouse: AdministrativeStockWarehouseSnapshot = {
  id: "wh-adm",
  code: ADMINISTRATIVE_STOCK_WAREHOUSE_CODE,
  name: "Estoque Administrativo",
  status: "ACTIVE",
  allowsMovements: true,
};

function source(code: string): AdministrativeStockCsvRow {
  return {
    sourceRow: 2,
    code,
    description: code,
    family: "Cat",
    group: "Sub",
    unit: "UN",
    minimumStock: null,
    maximumStock: null,
    reorderPoint: null,
    preferredSupplierName: null,
    lastKnownCost: null,
    notes: null,
    status: "ACTIVE",
    raw: {},
  };
}

function item(code: string, overrides: Partial<AdministrativeStockItemSnapshot> = {}): AdministrativeStockItemSnapshot {
  return {
    id: `id-${code}`,
    code,
    description: code,
    itemType: ADMINISTRATIVE_STOCK_ITEM_TYPE,
    unit: "UN",
    status: "ACTIVE",
    controlsStock: true,
    defaultWarehouseId: warehouse.id,
    defaultLocationId: null,
    ...overrides,
  };
}

test("VERIFY ok quando cadastro bate e não há saldo/movimento", () => {
  const result = verifyAdministrativeStockInitialLoad({
    sourceRows: [source("ADM-1"), source("ADM-2")],
    warehouse,
    items: [item("ADM-1"), item("ADM-2")],
    balanceCountByItemId: new Map(),
    movementCountByItemId: new Map(),
  });
  assert.equal(result.status, "OK");
  assert.equal(result.foundCodes, 2);
});

test("VERIFY bloqueia saldo, movimento, tipo e warehouse errados", () => {
  const result = verifyAdministrativeStockInitialLoad({
    sourceRows: [source("ADM-1"), source("ADM-2"), source("ADM-3")],
    warehouse,
    items: [
      item("ADM-1", { itemType: "RAW_MATERIAL" }),
      item("ADM-2", { defaultWarehouseId: "other" }),
      item("ADM-3", { defaultLocationId: "loc-1" }),
    ],
    balanceCountByItemId: new Map([["id-ADM-1", 1]]),
    movementCountByItemId: new Map([["id-ADM-2", 2]]),
  });
  assert.equal(result.status, "BLOQUEANTE");
  assert.ok(result.findings.some((finding) => finding.code === "ITEM_TYPE"));
  assert.ok(result.findings.some((finding) => finding.code === "ITEM_DEFAULT_WAREHOUSE"));
  assert.ok(result.findings.some((finding) => finding.code === "ITEM_DEFAULT_LOCATION"));
  assert.ok(result.findings.some((finding) => finding.code === "UNEXPECTED_BALANCE"));
  assert.ok(result.findings.some((finding) => finding.code === "UNEXPECTED_MOVEMENT"));
});

test("VERIFY bloqueia warehouse ausente e código faltando", () => {
  const result = verifyAdministrativeStockInitialLoad({
    sourceRows: [source("ADM-MISSING")],
    warehouse: null,
    items: [],
    balanceCountByItemId: new Map(),
    movementCountByItemId: new Map(),
  });
  assert.equal(result.status, "BLOQUEANTE");
  assert.ok(result.findings.some((finding) => finding.code === "WAREHOUSE_MISSING"));
  assert.ok(result.findings.some((finding) => finding.code === "ITEM_MISSING"));
});
