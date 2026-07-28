import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const SCHEMA = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const MIGRATION = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260811120000_purchase_negotiation_evidence_trail/migration.sql"
  ),
  "utf8"
);
const SERVICE = readFileSync(
  join(process.cwd(), "src/lib/purchasing/purchaseEvidenceService.server.ts"),
  "utf8"
);
const ROUTES = readFileSync(
  join(process.cwd(), "src/lib/purchasing/purchaseEvidenceRoutes.ts"),
  "utf8"
);
const STORAGE = readFileSync(join(process.cwd(), "src/lib/appLocalFileStorage.ts"), "utf8");
const SERVER = readFileSync(join(process.cwd(), "server.ts"), "utf8");

describe("purchase evidence trail (OP-17)", () => {
  it("1. schema estende PurchaseEvidence com hash/histórico/soft-delete", () => {
    assert.match(SCHEMA, /contentHash/);
    assert.match(SCHEMA, /model PurchaseEvidenceHistoryEvent/);
    assert.match(SCHEMA, /CONFIRMATION/);
    assert.match(SCHEMA, /deletedAt/);
    assert.match(SCHEMA, /replacesId/);
    assert.match(SCHEMA, /lockedAt/);
  });

  it("2. migration aditiva e reutiliza storage existente", () => {
    assert.doesNotMatch(MIGRATION, /\bDROP\s+TABLE\b/i);
    assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS "contentHash"/);
    assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS "PurchaseEvidenceHistoryEvent"/);
    assert.match(SERVICE, /saveAppLocalFile/);
    assert.match(SERVICE, /fingerprintAppLocalFile/);
    assert.match(STORAGE, /fingerprintAppLocalFile/);
    assert.doesNotMatch(SERVICE, /createWriteStream|new S3|minio/i);
  });

  it("3. rotas e gate de vencedor sem apagar silenciosamente", () => {
    assert.match(ROUTES, /\/api\/purchase-evidences/);
    assert.match(ROUTES, /soft-delete/);
    assert.match(ROUTES, /mark-winner/);
    assert.match(SERVER, /registerPurchaseEvidenceRoutes/);
    assert.match(SERVICE, /SOFT_DELETED/);
    assert.match(SERVICE, /assertEvidenceCanBeMutated|DELETE_REASON/);
  });
});
