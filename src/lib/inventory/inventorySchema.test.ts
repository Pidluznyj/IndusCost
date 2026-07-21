import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const SCHEMA = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const MIGRATION = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260804120000_inventory_additive_warehouse_ledger/migration.sql"
  ),
  "utf8"
);

describe("inventory Prisma schema", () => {
  it("1. schema contém modelos principais", () => {
    for (const model of [
      "model InventoryItem",
      "model InventoryWarehouse",
      "model InventoryLocation",
      "model InventoryMovement",
      "model InventoryBalance",
      "model InventoryReservation",
      "model InventoryBlock",
      "model InventoryStockSnapshot",
      "model InventoryStockSnapshotLine",
      "model InventoryCountSession",
      "model InventoryCountLine",
      "model InventoryAuditLog",
    ]) {
      assert.match(SCHEMA, new RegExp(model));
    }
  });

  it("2. relações principais existem", () => {
    assert.match(SCHEMA, /InventoryItem[\s\S]*balances\s+InventoryBalance\[\]/);
    assert.match(SCHEMA, /InventoryItem[\s\S]*materialId/);
    assert.match(SCHEMA, /InventoryItem[\s\S]*Material\s+Material\?/);
    assert.match(SCHEMA, /InventoryMovement[\s\S]*item\s+InventoryItem/);
    assert.match(SCHEMA, /InventoryBalance[\s\S]*warehouse\s+InventoryWarehouse/);
    assert.match(SCHEMA, /InventoryCountLine[\s\S]*generatedMovement\s+InventoryMovement/);
    assert.match(SCHEMA, /InventoryBlock[\s\S]*movements\s+InventoryMovement\[\]/);
    assert.match(SCHEMA, /InventoryStockSnapshot[\s\S]*lines\s+InventoryStockSnapshotLine\[\]/);
  });

  it("3. unique de saldo item+balanceKey existe", () => {
    assert.match(SCHEMA, /@@unique\(\[itemId, balanceKey\]\)/);
  });

  it("4. InventoryMovement tem snapshots de saldo e auditoria", () => {
    for (const field of [
      "previousPhysicalBalance",
      "nextPhysicalBalance",
      "previousAvailableBalance",
      "nextAvailableBalance",
      "previousBlockedBalance",
      "nextBlockedBalance",
      "previousReservedBalance",
      "nextReservedBalance",
      "responsibleUserId",
      "createdByUserId",
      "reason",
      "lotNumber",
      "serialNumber",
      "expirationDate",
      "materialCodeSnapshot",
      "reversedMovementId",
      "blockId",
    ]) {
      assert.match(SCHEMA, new RegExp(field));
    }
  });

  it("5. InventoryMovement é imutável (sem updatedAt de negócio)", () => {
    const match = SCHEMA.match(/model InventoryMovement \{[\s\S]*?\n\}/m);
    assert.ok(match);
    assert.doesNotMatch(match[0], /updatedAt/);
  });

  it("6. InventoryBalance não possui endpoint de edição direta (grep server)", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    assert.doesNotMatch(server, /inventoryBalance\.update/);
    assert.doesNotMatch(server, /InventoryBalance.*PATCH/);
  });

  it("7. enums foram criados corretamente", () => {
    for (const en of [
      "enum InventoryItemType",
      "enum InventoryMovementType",
      "enum InventoryReservationType",
      "enum InventoryBlockStatus",
      "enum InventoryBlockReasonType",
      "enum InventoryStockSnapshotSource",
      "enum InventoryCountSessionStatus",
      "FINISHED_PRODUCT",
      "MANUAL_ENTRY",
      "TRANSFER",
      "BLOCK",
      "REVERSAL",
      "WAITING_APPROVAL",
      "RECALCULATION",
    ]) {
      assert.match(SCHEMA, new RegExp(en));
    }
  });

  it("8. estorno é único por movimento original", () => {
    assert.match(SCHEMA, /@@unique\(\[reversedMovementId\]\)/);
    assert.match(MIGRATION, /InventoryMovement_reversedMovementId_key/);
  });

  it("9. migration é aditiva (sem DROP/RENAME destrutivo)", () => {
    assert.doesNotMatch(MIGRATION, /\bDROP\s+TABLE\b/i);
    assert.doesNotMatch(MIGRATION, /\bDROP\s+COLUMN\b/i);
    assert.doesNotMatch(MIGRATION, /\bRENAME\s+TO\b/i);
    assert.match(MIGRATION, /ADD COLUMN "materialId"/);
    assert.match(MIGRATION, /CREATE TABLE "InventoryBlock"/);
    assert.match(MIGRATION, /CREATE TABLE "InventoryStockSnapshot"/);
  });

  it("não altera tabelas Nomus oficiais", () => {
    for (const modelName of [
      "NomusAccountsReceivable",
      "NomusAccountsPayable",
      "NomusNfe",
      "SalesOrder",
      "SalesOrderItem",
    ]) {
      const match = SCHEMA.match(new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`, "m"));
      if (!match) continue;
      assert.doesNotMatch(
        match[0],
        /Inventory/,
        `${modelName} não deve referenciar modelos Inventory`
      );
    }
  });

  it("Material só recebe back-relation InventoryItem (sem mutação de campos oficiais)", () => {
    const match = SCHEMA.match(/model Material \{[\s\S]*?\n\}/m);
    assert.ok(match);
    assert.match(match[0], /InventoryItem\s+InventoryItem\[\]/);
    assert.doesNotMatch(match[0], /warehouseId|physicalQuantity|InventoryBalance/);
  });

  it("decisão InventoryLocation documentada no schema", () => {
    assert.match(SCHEMA, /balanceKey/);
    assert.match(SCHEMA, /model InventoryLocation/);
  });

  it("tipos básicos frontend existem sem Prisma", () => {
    const types = readFileSync(join(process.cwd(), "src/types/inventory.ts"), "utf8");
    assert.match(types, /export type InventoryItemType/);
    assert.match(types, /export type InventoryMovementType/);
    assert.match(types, /export type InventoryBlockStatus/);
    assert.match(types, /export type InventoryStockSnapshotSource/);
    assert.doesNotMatch(types, /from ["']@prisma\/client["']/);
  });
});
