import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const SCHEMA = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const MIGRATION = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260813120000_purchase_quotation_award_approval/migration.sql"
  ),
  "utf8"
);
const ROUTES = readFileSync(
  join(process.cwd(), "src/lib/purchasing/purchaseQuotationRoutes.ts"),
  "utf8"
);
const SERVICE = readFileSync(
  join(process.cwd(), "src/lib/purchasing/quotationAwardService.server.ts"),
  "utf8"
);
const UI = readFileSync(
  join(process.cwd(), "src/components/PurchaseQuotationAwardPanel.tsx"),
  "utf8"
);
const ACCESS = readFileSync(join(process.cwd(), "src/lib/operationsAccess.ts"), "utf8");

describe("quotation award approval (OP-19)", () => {
  it("1. schema/migration aditivos de award + auditoria", () => {
    assert.match(SCHEMA, /model PurchaseQuotationAward/);
    assert.match(SCHEMA, /model PurchaseQuotationAwardAllocation/);
    assert.match(SCHEMA, /model PurchaseQuotationAwardRejection/);
    assert.match(SCHEMA, /model PurchaseQuotationAwardHistoryEvent/);
    assert.match(SCHEMA, /enum PurchaseQuotationAwardMode/);
    assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS "PurchaseQuotationAward"/);
    assert.doesNotMatch(MIGRATION, /\bDROP\s+TABLE\b/i);
    assert.doesNotMatch(MIGRATION, /\bDROP\s+COLUMN\b/i);
  });

  it("2. serviço aprova sem PO/recebimento e impede conflito", () => {
    assert.match(SERVICE, /submitQuotationAward/);
    assert.match(SERVICE, /approveQuotationAward/);
    assert.match(SERVICE, /rejectQuotationAward/);
    assert.match(SERVICE, /status:\s*"ADJUDICADA"/);
    assert.match(SERVICE, /CONFLICTING_AWARD|CONFLICTING_WINNERS/);
    assert.doesNotMatch(SERVICE, /purchaseOrder\.create/i);
    assert.doesNotMatch(SERVICE, /purchaseReceipt\.create/i);
    assert.doesNotMatch(SERVICE, /accountsPayable\.create/i);
  });

  it("3. rotas, permissão approve e UI de alocação/split", () => {
    assert.match(ROUTES, /\/api\/purchase-quotations\/:id\/awards/);
    assert.match(ROUTES, /awards\/:awardId\/approve/);
    assert.match(ROUTES, /awards\/:awardId\/reject/);
    assert.match(ACCESS, /awards\/:awardId\/approve/);
    assert.match(ACCESS, /action:\s*"approve"/);
    assert.match(UI, /quotation-award-panel/);
    assert.match(UI, /SPLIT/);
    assert.match(UI, /Submeter para aprovação/);
    assert.match(UI, /Aprovar adjudicação/);
  });
});
