import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const SCHEMA = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");

describe("inventory Prisma schema", () => {
  it("1. schema contém modelos principais", () => {
    for (const model of [
      "model InventoryItem",
      "model InventoryWarehouse",
      "model InventoryLocation",
      "model InventoryMovement",
      "model InventoryBalance",
      "model InventoryReservation",
      "model InventoryCountSession",
      "model InventoryCountLine",
      "model InventoryAuditLog",
    ]) {
      assert.match(SCHEMA, new RegExp(model));
    }
  });

  it("2. relações principais existem", () => {
    assert.match(SCHEMA, /InventoryItem[\s\S]*balances\s+InventoryBalance\[\]/);
    assert.match(SCHEMA, /InventoryMovement[\s\S]*item\s+InventoryItem/);
    assert.match(SCHEMA, /InventoryBalance[\s\S]*warehouse\s+InventoryWarehouse/);
    assert.match(SCHEMA, /InventoryCountLine[\s\S]*generatedMovement\s+InventoryMovement/);
  });

  it("3. unique de saldo item+balanceKey existe", () => {
    assert.match(SCHEMA, /@@unique\(\[itemId, balanceKey\]\)/);
  });

  it("4. InventoryMovement tem campos de auditoria de saldo", () => {
    for (const field of [
      "previousPhysicalBalance",
      "nextPhysicalBalance",
      "previousAvailableBalance",
      "nextAvailableBalance",
      "responsibleUserId",
      "reason",
    ]) {
      assert.match(SCHEMA, new RegExp(field));
    }
  });

  it("5. InventoryBalance não possui endpoint de edição direta (grep server)", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    assert.doesNotMatch(server, /inventoryBalance\.update/);
    assert.doesNotMatch(server, /InventoryBalance.*PATCH/);
  });

  it("6. enums foram criados corretamente", () => {
    for (const en of [
      "enum InventoryItemType",
      "enum InventoryMovementType",
      "enum InventoryReservationType",
      "enum InventoryCountSessionStatus",
      "FINISHED_PRODUCT",
      "MANUAL_ENTRY",
      "TRANSFER",
      "WAITING_APPROVAL",
    ]) {
      assert.match(SCHEMA, new RegExp(en));
    }
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

  it("decisão InventoryLocation documentada no schema", () => {
    assert.match(SCHEMA, /balanceKey/);
    assert.match(SCHEMA, /model InventoryLocation/);
  });
});
