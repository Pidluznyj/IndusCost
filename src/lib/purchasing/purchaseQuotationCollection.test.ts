import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const SCHEMA = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const MIGRATION = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260809120000_purchase_quotation_collection/migration.sql"
  ),
  "utf8"
);
const SERVICE = readFileSync(
  join(process.cwd(), "src/lib/purchasing/purchaseQuotationService.server.ts"),
  "utf8"
);
const ROUTES = readFileSync(
  join(process.cwd(), "src/lib/purchasing/purchaseQuotationRoutes.ts"),
  "utf8"
);
const SERVER = readFileSync(join(process.cwd(), "server.ts"), "utf8");

describe("purchase quotation collection (OP-15)", () => {
  it("1. schema tem campos comerciais iniciais e proposta recebida", () => {
    assert.match(SCHEMA, /initialNonRecoverableTaxes/);
    assert.match(SCHEMA, /initialExpenses/);
    assert.match(SCHEMA, /initialDiscounts/);
    assert.match(SCHEMA, /initialMinOrderQty/);
    assert.match(SCHEMA, /proposalReceived/);
    assert.match(SCHEMA, /initialUnitPrice/);
    assert.match(SCHEMA, /initialFreightValue/);
    assert.match(SCHEMA, /initialPaymentTerms/);
    assert.match(SCHEMA, /initialValidityDate/);
  });

  it("2. migration aditiva sem DROP/RENAME destrutivo", () => {
    assert.doesNotMatch(MIGRATION, /\bDROP\s+TABLE\b/i);
    assert.doesNotMatch(MIGRATION, /\bDROP\s+COLUMN\b/i);
    assert.doesNotMatch(MIGRATION, /\bRENAME\s+TO\b/i);
    assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS "proposalReceived"/);
    assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS "initialNonRecoverableTaxes"/);
  });

  it("3. rotas de coleta sem PO/AP/adjudicação", () => {
    assert.match(ROUTES, /invite-supplier/);
    assert.match(ROUTES, /mark-received/);
    assert.match(ROUTES, /official-refs\/suppliers/);
    assert.match(SERVER, /registerPurchaseQuotationCollectionRoutes/);
    assert.doesNotMatch(SERVICE, /purchaseOrder\.create/i);
    assert.doesNotMatch(SERVICE, /accountsPayable\.create/i);
    assert.doesNotMatch(SERVICE, /status:\s*"ADJUDICADA"/);
    assert.doesNotMatch(SERVICE, /status:\s*"VENCEDOR"/);
    assert.doesNotMatch(SERVICE, /status:\s*"VENCEDORA"/);
    assert.match(SERVICE, /createOfficialDataProviders/);
    assert.match(SERVICE, /assertCanEditInitialOffer/);
    assert.match(SERVICE, /proposalReceived:\s*true/);
  });

  it("4. snapshots de fornecedor oficial na convite", () => {
    assert.match(SERVICE, /supplierDisplayNameSnapshot/);
    assert.match(SERVICE, /supplierDocumentSnapshot/);
    assert.match(SERVICE, /reads\.suppliers\.findById/);
  });
});
