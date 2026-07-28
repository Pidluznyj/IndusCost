import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const SCHEMA = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const MIGRATION = readFileSync(
  join(process.cwd(), "prisma/migrations/20260814120000_purchase_order_formal/migration.sql"),
  "utf8"
);
const SERVICE = readFileSync(
  join(process.cwd(), "src/lib/purchasing/purchaseOrderService.server.ts"),
  "utf8"
);
const ROUTES = readFileSync(
  join(process.cwd(), "src/lib/purchasing/purchaseOrderRoutes.ts"),
  "utf8"
);
const PDF = readFileSync(join(process.cwd(), "src/lib/purchasing/purchaseOrderPdf.ts"), "utf8");
const UI = readFileSync(join(process.cwd(), "src/components/PurchaseOrderModule.tsx"), "utf8");
const APP = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
const SERVER = readFileSync(join(process.cwd(), "server.ts"), "utf8");

describe("purchase order formal (OP-20)", () => {
  it("1. schema/migration aditivos com APROVADO/ENVIADO e histórico", () => {
    assert.match(SCHEMA, /APROVADO/);
    assert.match(SCHEMA, /ENVIADO/);
    assert.match(SCHEMA, /model PurchaseOrderHistoryEvent/);
    assert.match(SCHEMA, /initialUnitPriceSnapshot/);
    assert.match(SCHEMA, /operationalCommitmentAt/);
    assert.match(SCHEMA, /futureEntryPending/);
    assert.match(MIGRATION, /ADD VALUE IF NOT EXISTS 'APROVADO'/);
    assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS "PurchaseOrderHistoryEvent"/);
    assert.doesNotMatch(MIGRATION, /\bDROP\s+TABLE\b/i);
  });

  it("2. serviço gera PO da award sem AP/estoque", () => {
    assert.match(SERVICE, /createPurchaseOrdersFromAward/);
    assert.match(SERVICE, /operationalCommitmentAt/);
    assert.match(SERVICE, /futureEntryPending/);
    assert.doesNotMatch(SERVICE, /accountsPayable\.create/i);
    assert.doesNotMatch(SERVICE, /inventoryMovement\.create/i);
    assert.match(SERVICE, /noAccountsPayable|createsAccountsPayable:\s*false/);
  });

  it("3. rotas, PDF e UI integrados", () => {
    assert.match(ROUTES, /\/api\/purchase-orders/);
    assert.match(ROUTES, /from-award/);
    assert.match(ROUTES, /\/pdf/);
    assert.match(SERVER, /registerPurchaseOrderRoutes/);
    assert.match(PDF, /buildFormattedPortraitPdf/);
    assert.match(APP, /purchases\/orders/);
    assert.match(UI, /purchase-order-detail|purchase-orders-list/);
    assert.match(UI, /Compromisso operacional/);
  });
});
