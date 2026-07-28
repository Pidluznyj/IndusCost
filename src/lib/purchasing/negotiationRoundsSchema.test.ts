import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const SCHEMA = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const MIGRATION = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260810120000_purchase_negotiation_rounds_savings/migration.sql"
  ),
  "utf8"
);
const SERVICE = readFileSync(
  join(process.cwd(), "src/lib/purchasing/negotiationRoundService.server.ts"),
  "utf8"
);
const ROUTES = readFileSync(
  join(process.cwd(), "src/lib/purchasing/purchaseQuotationRoutes.ts"),
  "utf8"
);

describe("negotiation rounds schema/routes (OP-16)", () => {
  it("1. schema preserva previous* e novos valores comerciais", () => {
    assert.match(SCHEMA, /previousUnitPrice/);
    assert.match(SCHEMA, /previousFreightValue/);
    assert.match(SCHEMA, /nonRecoverableTaxes/);
    assert.match(SCHEMA, /freightIncoterm/);
    assert.match(SCHEMA, /buyerReport/);
    assert.match(SCHEMA, /responsibleUserName/);
    assert.match(SCHEMA, /minOrderQty/);
    const roundLine = SCHEMA.match(/model PurchaseNegotiationRoundLine \{[\s\S]*?\n\}/m)?.[0] ?? "";
    assert.doesNotMatch(roundLine, /updatedAt/);
  });

  it("2. migration aditiva", () => {
    assert.doesNotMatch(MIGRATION, /\bDROP\s+TABLE\b/i);
    assert.doesNotMatch(MIGRATION, /\bDROP\s+COLUMN\b/i);
    assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS "previousUnitPrice"/);
    assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS "buyerReport"/);
  });

  it("3. serviço append-only; mark-winner exige evidência (OP-17)", () => {
    assert.match(SERVICE, /appendNegotiationRoundLines/);
    assert.match(SERVICE, /assertRoundHistoryAppendOnly/);
    assert.match(SERVICE, /computeOfferRoundSavings/);
    assert.match(SERVICE, /markOfferAsWinner/);
    assert.match(SERVICE, /assertCanConcludeNegotiation/);
    assert.doesNotMatch(SERVICE, /purchaseOrder\.create/i);
  });

  it("4. rotas de rodada e savings registradas", () => {
    assert.match(ROUTES, /\/rounds/);
    assert.match(ROUTES, /\/savings/);
    assert.match(ROUTES, /openNegotiationRound|appendNegotiationRoundLines|closeNegotiationRound/);
  });
});
