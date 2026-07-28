import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const SCHEMA = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const MIGRATION = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260807120000_purchasing_additive_domain/migration.sql"
  ),
  "utf8"
);

describe("purchasing Prisma schema (OP-13)", () => {
  it("1. schema contém modelos principais do domínio", () => {
    for (const model of [
      "model PurchaseQuotation",
      "model PurchaseQuotationItem",
      "model PurchaseQuotationSupplier",
      "model PurchaseQuotationOffer",
      "model PurchaseQuotationOfferItem",
      "model PurchaseNegotiationRound",
      "model PurchaseNegotiationRoundLine",
      "model PurchaseApproval",
      "model PurchaseOrder",
      "model PurchaseOrderItem",
      "model PurchaseReceipt",
      "model PurchaseReceiptItem",
      "model PurchaseEvidence",
    ]) {
      assert.match(SCHEMA, new RegExp(model));
    }
  });

  it("2. reutiliza PurchaseRequest e IDs oficiais (Material / FinancialSupplier)", () => {
    assert.match(SCHEMA, /model PurchaseRequest \{[\s\S]*quotations\s+PurchaseQuotation\[\]/m);
    assert.match(SCHEMA, /PurchaseQuotationItem[\s\S]*material\s+Material\?/);
    assert.match(SCHEMA, /PurchaseQuotationSupplier[\s\S]*supplier\s+FinancialSupplier/);
    assert.match(SCHEMA, /PurchaseOrder[\s\S]*supplier\s+FinancialSupplier/);
    assert.match(SCHEMA, /model Material \{[\s\S]*PurchaseQuotationItem/m);
    assert.match(SCHEMA, /model FinancialSupplier \{[\s\S]*purchaseOrders\s+PurchaseOrder\[\]/m);
  });

  it("3. preço inicial e adjudicado são campos separados (não um único overwrite)", () => {
    const offerItem = SCHEMA.match(/model PurchaseQuotationOfferItem \{[\s\S]*?\n\}/m)?.[0] ?? "";
    assert.match(offerItem, /initialUnitPrice/);
    assert.match(offerItem, /awardedUnitPrice/);
    assert.match(offerItem, /awardedRoundLineId/);
    const offer = SCHEMA.match(/model PurchaseQuotationOffer \{[\s\S]*?\n\}/m)?.[0] ?? "";
    assert.match(offer, /initialPaymentTerms/);
    assert.match(offer, /awardedPaymentTerms/);
  });

  it("4. rodadas de negociação são append-only (sem updatedAt na linha)", () => {
    const roundLine = SCHEMA.match(/model PurchaseNegotiationRoundLine \{[\s\S]*?\n\}/m)?.[0] ?? "";
    assert.ok(roundLine);
    assert.doesNotMatch(roundLine, /updatedAt/);
    assert.match(roundLine, /unitPrice/);
    assert.match(roundLine, /proposedBy/);
    assert.match(SCHEMA, /@@unique\(\[quotationId, roundNumber\]\)/);
    assert.match(SCHEMA, /@@unique\(\[roundId, offerItemId\]\)/);
  });

  it("5. enums principais existem", () => {
    for (const en of [
      "enum PurchaseQuotationStatus",
      "enum PurchaseQuotationSupplierStatus",
      "enum PurchaseQuotationOfferStatus",
      "enum PurchaseNegotiationRoundStatus",
      "enum PurchaseApprovalStatus",
      "enum PurchaseOrderStatus",
      "enum PurchaseReceiptStatus",
      "enum PurchaseEvidenceEntityType",
      "ADJUDICADA",
      "PARCIALMENTE_RECEBIDO",
      "EM_CONFERENCIA",
      "ESTORNADO",
    ]) {
      assert.match(SCHEMA, new RegExp(en));
    }
  });

  it("6. snapshots históricos de MP e fornecedor", () => {
    assert.match(SCHEMA, /materialCodeSnapshot/);
    assert.match(SCHEMA, /materialDescriptionSnapshot/);
    assert.match(SCHEMA, /supplierDisplayNameSnapshot/);
    assert.match(SCHEMA, /unitPriceSnapshot/);
  });

  it("7. recebimento parcial + soft link futuro a InventoryMovement", () => {
    const receipt = SCHEMA.match(/model PurchaseReceipt \{[\s\S]*?\n\}/m)?.[0] ?? "";
    assert.match(receipt, /inventoryMovementId/);
    assert.match(receipt, /reversalMovementId/);
    assert.match(receipt, /warehouseId/);
    assert.match(SCHEMA, /model PurchaseReceiptItem \{[\s\S]*quantityAccepted/m);
    assert.match(SCHEMA, /model PurchaseReceiptItem \{[\s\S]*inventoryMovementId/m);
  });

  it("8. evidências e aprovação modeladas", () => {
    assert.match(SCHEMA, /model PurchaseEvidence/);
    assert.match(SCHEMA, /storageKey/);
    assert.match(SCHEMA, /model PurchaseApproval/);
    assert.match(SCHEMA, /PurchaseApprovalTargetType/);
  });

  it("9. migration é aditiva (sem DROP/RENAME destrutivo)", () => {
    assert.doesNotMatch(MIGRATION, /\bDROP\s+TABLE\b/i);
    assert.doesNotMatch(MIGRATION, /\bDROP\s+COLUMN\b/i);
    assert.doesNotMatch(MIGRATION, /\bRENAME\s+TO\b/i);
    assert.match(MIGRATION, /CREATE TABLE "PurchaseQuotation"/);
    assert.match(MIGRATION, /CREATE TABLE "PurchaseOrder"/);
    assert.match(MIGRATION, /CREATE TABLE "PurchaseReceipt"/);
    assert.match(MIGRATION, /CREATE TABLE "PurchaseNegotiationRoundLine"/);
    assert.match(MIGRATION, /CREATE TABLE "PurchaseEvidence"/);
    assert.match(MIGRATION, /CREATE TYPE "PurchaseQuotationStatus"/);
  });

  it("10. migration cria FKs oficiais Restrict para Material e FinancialSupplier", () => {
    assert.match(MIGRATION, /REFERENCES "Material"\("id"\)/);
    assert.match(MIGRATION, /REFERENCES "FinancialSupplier"\("id"\)/);
    assert.match(MIGRATION, /ON DELETE RESTRICT/);
  });

  it("11. não altera tabelas Nomus / SalesOrder / AP oficiais", () => {
    for (const modelName of [
      "NomusAccountsPayable",
      "NomusNfe",
      "SalesOrder",
      "SalesOrderItem",
      "MaterialMarketQuote",
    ]) {
      const match = SCHEMA.match(new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`, "m"));
      if (!match) continue;
      assert.doesNotMatch(
        match[0],
        /PurchaseQuotation|PurchaseOrder|PurchaseReceipt/,
        `${modelName} não deve referenciar modelos Purchase SC`
      );
    }
  });

  it("12. InventoryMovement mantém soft purchaseOrderId (sem FK rígida nesta fase)", () => {
    const movement = SCHEMA.match(/model InventoryMovement \{[\s\S]*?\n\}/m)?.[0] ?? "";
    assert.match(movement, /purchaseOrderId\s+String\?/);
    assert.doesNotMatch(movement, /purchaseOrder\s+PurchaseOrder/);
  });
});
