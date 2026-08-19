import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const SCHEMA = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const MIGRATION = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260808120000_purchase_request_workflow/migration.sql"
  ),
  "utf8"
);
const ROUTES = readFileSync(
  join(process.cwd(), "src/lib/purchasing/purchaseRequestRoutes.ts"),
  "utf8"
);
const SERVICE = readFileSync(
  join(process.cwd(), "src/lib/purchasing/purchaseRequestService.server.ts"),
  "utf8"
);
const SERVER = readFileSync(join(process.cwd(), "server.ts"), "utf8");

describe("purchase request workflow schema/routes (OP-14)", () => {
  it("1. status e histórico aditivos no schema", () => {
    assert.match(SCHEMA, /AGUARDANDO_APROVACAO/);
    assert.match(SCHEMA, /REJEITADA/);
    assert.match(SCHEMA, /EM_COTACAO/);
    assert.match(SCHEMA, /model PurchaseRequestHistoryEvent/);
    assert.match(SCHEMA, /model PurchaseRequest \{[\s\S]*projectId/m);
    assert.match(SCHEMA, /enum PurchaseApprovalTargetType[\s\S]*REQUEST/m);
  });

  it("2. migration é aditiva (sem DROP/RENAME destrutivo)", () => {
    assert.doesNotMatch(MIGRATION, /\bDROP\s+TABLE\b/i);
    assert.doesNotMatch(MIGRATION, /\bDROP\s+COLUMN\b/i);
    assert.doesNotMatch(MIGRATION, /\bRENAME\s+TO\b/i);
    assert.match(MIGRATION, /ADD VALUE IF NOT EXISTS 'AGUARDANDO_APROVACAO'/);
    assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS "PurchaseRequestHistoryEvent"/);
    assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS "projectId"/);
  });

  it("3. rotas de workflow registradas sem criar PO/AP", () => {
    assert.match(ROUTES, /\/submit/);
    assert.match(ROUTES, /\/approve/);
    assert.match(ROUTES, /\/reject/);
    assert.match(ROUTES, /\/cancel/);
    assert.match(ROUTES, /\/forward-to-quotation/);
    assert.match(ROUTES, /official-refs\/materials/);
    assert.match(ROUTES, /official-refs\/projects/);
    assert.match(SERVER, /registerPurchaseRequestWorkflowRoutes/);
    assert.doesNotMatch(SERVICE, /accountsPayable\.create|AccountsPayable\.create/i);
    // Fluxo simplificado: a aprovacao do gestor EMITE o pedido (uma unica
    // criacao, dentro do approve). Contas a Pagar continua proibido aqui.
    const poCreates = SERVICE.match(/purchaseOrder\.create/gi) ?? [];
    assert.equal(poCreates.length, 1, "PO deve nascer somente na aprovacao");
    assert.doesNotMatch(SERVICE, /accountsPayable/i);
    assert.match(SERVICE, /purchaseQuotation\.create/);
  });

  it("4. encaminhamento cria cotação RASCUNHO apenas", () => {
    assert.match(SERVICE, /status:\s*"RASCUNHO"/);
    assert.match(SERVICE, /FORWARD_TO_QUOTATION/);
    assert.match(SERVICE, /createOfficialDataProviders/);
  });
});
