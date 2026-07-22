/**
 * OP-27 — matriz de personas + hardening de evidência/autorização.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  hasInventoryMovementCreatePermission,
  hasPurchasesApprovePermission,
  PURCHASING_PERSONA_MATRIX,
  resolveEvidenceExceptionPermission,
  mimeMatchesPurchaseEvidenceExtension,
  clampPurchasingPageSize,
} from "./purchasingSecurity.js";
import { supportsPermissionAction } from "@/src/lib/security/permissionContract/index.js";

const EVIDENCE_ROUTES = readFileSync(
  join(process.cwd(), "src/lib/purchasing/purchaseEvidenceRoutes.ts"),
  "utf8"
);
const QUOTATION_ROUTES = readFileSync(
  join(process.cwd(), "src/lib/purchasing/purchaseQuotationRoutes.ts"),
  "utf8"
);
const RECEIPT_ROUTES = readFileSync(
  join(process.cwd(), "src/lib/purchasing/purchaseReceiptRoutes.ts"),
  "utf8"
);
const REQUEST_ROUTES = readFileSync(
  join(process.cwd(), "src/lib/purchasing/purchaseRequestRoutes.ts"),
  "utf8"
);
const EVIDENCE_RULES = readFileSync(
  join(process.cwd(), "src/lib/purchasing/purchaseEvidenceRules.ts"),
  "utf8"
);
const CONTRACT = readFileSync(
  join(process.cwd(), "src/lib/security/permissionContract/resources.ts"),
  "utf8"
);

describe("purchasingSecurity personas (OP-27)", () => {
  it("matriz: mega-key view/edit não concede approve nem exceção de evidência", () => {
    const viewer = PURCHASING_PERSONA_MATRIX.find((p) => p.id === "viewer_compras")!;
    const analista = PURCHASING_PERSONA_MATRIX.find((p) => p.id === "analista_compras")!;
    const aprovador = PURCHASING_PERSONA_MATRIX.find((p) => p.id === "aprovador_compras")!;
    const recebedor = PURCHASING_PERSONA_MATRIX.find((p) => p.id === "recebedor_estoque")!;
    const sem = PURCHASING_PERSONA_MATRIX.find((p) => p.id === "sem_compras")!;

    assert.equal(hasPurchasesApprovePermission(viewer.effectivePermissions), false);
    assert.equal(hasPurchasesApprovePermission(analista.effectivePermissions), false);
    assert.equal(hasPurchasesApprovePermission(aprovador.effectivePermissions), true);
    assert.equal(hasPurchasesApprovePermission(sem.effectivePermissions), false);

    assert.equal(
      resolveEvidenceExceptionPermission({
        effectivePermissions: analista.effectivePermissions,
        clientClaimedUseException: true,
      }),
      false,
      "body.useException não pode auto-autorizar"
    );
    assert.equal(
      resolveEvidenceExceptionPermission({
        effectivePermissions: aprovador.effectivePermissions,
        clientClaimedUseException: false,
      }),
      true
    );

    assert.equal(analista.can.useEvidenceException, false);
    assert.equal(aprovador.can.useEvidenceException, true);
    assert.equal(aprovador.can.confirmReceiptWithInventory, false);
    assert.equal(recebedor.can.confirmReceiptWithInventory, true);
    assert.equal(
      hasInventoryMovementCreatePermission(recebedor.effectivePermissions),
      true
    );
    assert.equal(
      hasInventoryMovementCreatePermission(aprovador.effectivePermissions),
      false
    );
  });

  it("contrato operations.purchases suporta approve", () => {
    assert.equal(supportsPermissionAction("operations.purchases", "approve"), true);
    assert.match(CONTRACT, /A\(\["purchases\.approve"\]\)/);
  });

  it("MIME∩extensão e paginação", () => {
    assert.equal(mimeMatchesPurchaseEvidenceExtension("application/pdf", "x.pdf"), true);
    assert.equal(mimeMatchesPurchaseEvidenceExtension("application/octet-stream", "x.pdf"), false);
    assert.equal(clampPurchasingPageSize(500, 100), 100);
    assert.equal(clampPurchasingPageSize(-1), 20);
  });
});

describe("purchasingSecurity route hardening (OP-27)", () => {
  it("1. useException do body não concede hasExceptionPermission", () => {
    assert.match(EVIDENCE_ROUTES, /resolveEvidenceExceptionPermission/);
    assert.match(QUOTATION_ROUTES, /resolveEvidenceExceptionPermission/);
    assert.doesNotMatch(EVIDENCE_ROUTES, /hasExceptionPermission:\s*Boolean\(req\.body\?\.useException\)/);
    assert.doesNotMatch(QUOTATION_ROUTES, /hasExceptionPermission:\s*Boolean\(req\.body\?\.useException\)/);
  });

  it("2. recebimento não forja inventory permissions", () => {
    assert.match(RECEIPT_ROUTES, /effectivePermissions/);
    assert.doesNotMatch(
      RECEIPT_ROUTES,
      /permissions:\s*\[\s*"inventory\.movement\.create"/
    );
  });

  it("3. approve SoD + evidência PR via serviço validado + MIME sem bypass só por extensão", () => {
    assert.match(REQUEST_ROUTES, /OPERATIONS_ACTIONS\.approve/);
    assert.match(REQUEST_ROUTES, /uploadPurchaseEvidence/);
    assert.match(REQUEST_ROUTES, /downloadPurchaseEvidence/);
    assert.doesNotMatch(EVIDENCE_RULES, /if \(ext && EXT_MAP\[ext\]\) return true/);
  });
});
