import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertEvidenceCanBeMutated,
  assertNegotiationConclusionRequirements,
  detectPurchaseEvidenceType,
  isAllowedPurchaseEvidenceUpload,
  PurchaseEvidenceError,
  validatePurchaseEvidenceUploadFile,
} from "./purchaseEvidenceRules.js";

describe("purchaseEvidenceRules (OP-17)", () => {
  it("aceita PDF/imagem/planilha/email e rejeita executável", () => {
    assert.equal(isAllowedPurchaseEvidenceUpload("application/pdf", "a.pdf"), true);
    assert.equal(isAllowedPurchaseEvidenceUpload("image/png", "a.png"), true);
    assert.equal(
      isAllowedPurchaseEvidenceUpload(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "a.xlsx"
      ),
      true
    );
    assert.equal(isAllowedPurchaseEvidenceUpload("message/rfc822", "a.eml"), true);
    assert.equal(isAllowedPurchaseEvidenceUpload("application/x-msdownload", "a.exe"), false);
  });

  it("valida tamanho e arquivo vazio", () => {
    assert.throws(
      () =>
        validatePurchaseEvidenceUploadFile({
          originalName: "x.pdf",
          mimeType: "application/pdf",
          size: 0,
        }),
      (e: unknown) => e instanceof PurchaseEvidenceError && e.code === "FILE_EMPTY"
    );
    assert.throws(
      () =>
        validatePurchaseEvidenceUploadFile({
          originalName: "x.pdf",
          mimeType: "application/pdf",
          size: 20 * 1024 * 1024,
        }),
      (e: unknown) => e instanceof PurchaseEvidenceError && e.code === "FILE_TOO_LARGE"
    );
  });

  it("detecta tipo de evidência", () => {
    assert.equal(
      detectPurchaseEvidenceType({ mimeType: "application/pdf", fileName: "p.pdf" }),
      "PDF"
    );
    assert.equal(
      detectPurchaseEvidenceType({
        mimeType: "application/octet-stream",
        fileName: "p.pdf",
        explicitType: "PROPOSAL",
      }),
      "PROPOSAL"
    );
  });

  it("bloqueia exclusão silenciosa quando locked/PO/vencedor", () => {
    assert.throws(
      () =>
        assertEvidenceCanBeMutated({
          lockedAt: new Date(),
          hasPurchaseOrder: false,
          quotationAwarded: false,
          offerIsWinner: false,
          isSoftDelete: true,
          softDeleteReason: "",
        }),
      (e: unknown) => e instanceof PurchaseEvidenceError && e.code === "DELETE_REASON_REQUIRED"
    );
    assert.doesNotThrow(() =>
      assertEvidenceCanBeMutated({
        lockedAt: new Date(),
        hasPurchaseOrder: true,
        quotationAwarded: false,
        offerIsWinner: true,
        isSoftDelete: true,
        softDeleteReason: "substituição auditada",
      })
    );
  });

  it("exige relato + evidência para concluir, salvo exceção justificada", () => {
    assert.throws(
      () =>
        assertNegotiationConclusionRequirements({
          buyerReport: "",
          activeEvidenceCount: 1,
          hasExceptionPermission: false,
        }),
      (e: unknown) => e instanceof PurchaseEvidenceError && e.code === "BUYER_REPORT_REQUIRED"
    );
    assert.throws(
      () =>
        assertNegotiationConclusionRequirements({
          buyerReport: "Relato ok",
          activeEvidenceCount: 0,
          hasExceptionPermission: false,
        }),
      (e: unknown) => e instanceof PurchaseEvidenceError && e.code === "EVIDENCE_REQUIRED"
    );
    const ok = assertNegotiationConclusionRequirements({
      buyerReport: "Relato",
      activeEvidenceCount: 2,
      hasExceptionPermission: false,
    });
    assert.equal(ok.usedException, false);
    const ex = assertNegotiationConclusionRequirements({
      buyerReport: "",
      activeEvidenceCount: 0,
      hasExceptionPermission: true,
      exceptionJustification: "Urgência operacional documentada",
    });
    assert.equal(ex.usedException, true);
  });
});
