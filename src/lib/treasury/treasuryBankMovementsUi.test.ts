import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createEmptyTreasuryBankMovementsFilters,
  isTreasuryBankMovementFilterBucket,
  resolveTreasuryBankMovementsViewKind,
  resolveTreasuryOfxImportWizardMessage,
  validateTreasuryOfxUploadForm,
} from "./treasuryBankMovementsUi.js";

describe("treasuryBankMovementsUi — fluxo", () => {
  it("resolve view kinds e buckets de filtro", () => {
    assert.equal(
      resolveTreasuryBankMovementsViewKind({
        canView: false,
        loading: false,
        error: null,
        itemCount: 0,
      }),
      "denied"
    );
    assert.equal(
      resolveTreasuryBankMovementsViewKind({
        canView: true,
        loading: true,
        error: null,
        itemCount: 0,
      }),
      "loading"
    );
    assert.equal(
      resolveTreasuryBankMovementsViewKind({
        canView: true,
        loading: false,
        error: "x",
        itemCount: 0,
      }),
      "error"
    );
    assert.equal(
      resolveTreasuryBankMovementsViewKind({
        canView: true,
        loading: false,
        error: null,
        itemCount: 0,
        duplicatesNotPersisted: true,
      }),
      "duplicates_info"
    );
    assert.equal(
      resolveTreasuryBankMovementsViewKind({
        canView: true,
        loading: false,
        error: null,
        itemCount: 0,
      }),
      "empty"
    );
    assert.equal(
      resolveTreasuryBankMovementsViewKind({
        canView: true,
        loading: false,
        error: null,
        itemCount: 2,
      }),
      "ready"
    );
    assert.equal(isTreasuryBankMovementFilterBucket("UNRECONCILED"), true);
    assert.equal(isTreasuryBankMovementFilterBucket("DUPLICATES"), true);
    assert.equal(isTreasuryBankMovementFilterBucket("NOPE"), false);
    assert.deepEqual(createEmptyTreasuryBankMovementsFilters().bucket, "");
  });

  it("valida upload e mensagens do wizard OFX", () => {
    assert.match(
      validateTreasuryOfxUploadForm({ accountId: "", file: null }) ?? "",
      /conta/i
    );
    assert.match(
      validateTreasuryOfxUploadForm({
        accountId: "a1",
        file: null,
      }) ?? "",
      /arquivo/i
    );
    const bad = new File(["x"], "nota.pdf", { type: "application/pdf" });
    assert.match(
      validateTreasuryOfxUploadForm({ accountId: "a1", file: bad }) ?? "",
      /\.ofx/i
    );
    const ok = new File(["OFX"], "extrato.ofx", { type: "application/x-ofx" });
    assert.equal(
      validateTreasuryOfxUploadForm({ accountId: "a1", file: ok }),
      null
    );
    assert.match(resolveTreasuryOfxImportWizardMessage("upload"), /OFX/i);
    assert.match(resolveTreasuryOfxImportWizardMessage("preview"), /duplicados/i);
    assert.match(resolveTreasuryOfxImportWizardMessage("confirming"), /Confirmando/i);
    assert.match(resolveTreasuryOfxImportWizardMessage("done"), /concluída/i);
  });
});
