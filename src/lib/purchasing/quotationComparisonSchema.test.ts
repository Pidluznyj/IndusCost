import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const SCHEMA = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const MIGRATION = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260812120000_purchase_quotation_comparison/migration.sql"
  ),
  "utf8"
);
const ROUTES = readFileSync(
  join(process.cwd(), "src/lib/purchasing/purchaseQuotationRoutes.ts"),
  "utf8"
);
const SERVICE = readFileSync(
  join(process.cwd(), "src/lib/purchasing/quotationComparisonService.server.ts"),
  "utf8"
);
const ROUND_SERVICE = readFileSync(
  join(process.cwd(), "src/lib/purchasing/negotiationRoundService.server.ts"),
  "utf8"
);
const UI = readFileSync(
  join(process.cwd(), "src/components/PurchaseQuotationComparisonModule.tsx"),
  "utf8"
);
const APP = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
const ACCESS = readFileSync(join(process.cwd(), "src/lib/operationsAccess.ts"), "utf8");

describe("quotation comparison (OP-18)", () => {
  it("1. schema/migration aditivos com justificativa humana", () => {
    assert.match(SCHEMA, /selectionJustification/);
    assert.match(SCHEMA, /selectedAt/);
    assert.match(SCHEMA, /selectedByUserId/);
    assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS "selectionJustification"/);
    assert.doesNotMatch(MIGRATION, /\bDROP\s+TABLE\b/i);
    assert.doesNotMatch(MIGRATION, /\bDROP\s+COLUMN\b/i);
  });

  it("2. API de comparação e mark-winner exigem escolha humana", () => {
    assert.match(ROUTES, /\/api\/purchase-quotations\/:id\/comparison/);
    assert.match(SERVICE, /buildQuotationComparison/);
    assert.match(SERVICE, /selectionNote/);
    assert.match(ROUND_SERVICE, /assertHumanWinnerSelection/);
    assert.match(ROUND_SERVICE, /selectionJustification/);
    assert.match(ACCESS, /\/api\/purchase-quotations\/:id\/comparison/);
  });

  it("3. UI com cards, timeline e sem auto-vencedor por preço", () => {
    assert.match(APP, /purchases\/quotations\/:quotationId\/compare/);
    assert.match(APP, /PurchaseQuotationComparisonModule/);
    assert.match(UI, /comparison-summary-cards/);
    assert.match(UI, /Valor inicial/);
    assert.match(UI, /Valor negociado/);
    assert.match(UI, /Ganho conquistado/);
    assert.match(UI, /comparison-timeline/);
    assert.match(UI, /selectionJustification/);
    assert.match(UI, /autoPickByLowestPrice:\s*false/);
    assert.doesNotMatch(UI, /autoPickByLowestPrice:\s*true/);
  });
});
