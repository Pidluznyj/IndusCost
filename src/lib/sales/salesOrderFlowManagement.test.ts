import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applySalesOrderFlowManagementPatch,
  defaultSalesOrderFlowManagementSnapshot,
  listChangedManagementFields,
  parseSalesOrderFlowManagementPatch,
  sanitizeManagementAuditSnapshot,
  SalesOrderFlowManagementError,
} from "./salesOrderFlowManagement.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";

describe("salesOrderFlowManagement (OP-62)", () => {
  it("parse: aceita ações válidas e rejeita currentStage", () => {
    const patch = parseSalesOrderFlowManagementPatch({
      expectedUpdatedAt: null,
      priority: "urgent",
      responsibleArea: "COMERCIAL",
    });
    assert.equal(patch.priority, "URGENT");
    assert.equal(patch.responsibleArea, "COMERCIAL");

    assert.throws(
      () =>
        parseSalesOrderFlowManagementPatch({
          expectedUpdatedAt: null,
          currentStage: "IN_PRODUCTION",
        }),
      (err: unknown) =>
        err instanceof SalesOrderFlowManagementError &&
        err.field === "currentStage"
    );
  });

  it("parse: valida tamanho e conteúdo", () => {
    assert.throws(
      () =>
        parseSalesOrderFlowManagementPatch({
          expectedUpdatedAt: null,
          internalNote: "x".repeat(501),
        }),
      /excede 500/
    );
    assert.throws(
      () =>
        parseSalesOrderFlowManagementPatch({
          expectedUpdatedAt: null,
          blockReason: "bad\u0000char",
          isBlocked: true,
        }),
      /controle/
    );
    assert.throws(
      () =>
        parseSalesOrderFlowManagementPatch({
          expectedUpdatedAt: null,
          responsibleUserId: "not-a-uuid",
        }),
      /UUID/
    );
  });

  it("apply: bloqueio exige motivo; remoção limpa campos vivos", () => {
    const base = defaultSalesOrderFlowManagementSnapshot();
    assert.throws(
      () =>
        applySalesOrderFlowManagementPatch(base, {
          expectedUpdatedAt: null,
          isBlocked: true,
        }),
      /blockReason/
    );

    const blocked = applySalesOrderFlowManagementPatch(base, {
      expectedUpdatedAt: null,
      isBlocked: true,
      blockReason: "Crédito",
      expectedResolutionAt: new Date("2026-07-20T00:00:00Z"),
    });
    assert.equal(blocked.isBlocked, true);
    assert.equal(blocked.blockReason, "Crédito");

    const unblocked = applySalesOrderFlowManagementPatch(blocked, {
      expectedUpdatedAt: new Date(),
      isBlocked: false,
    });
    assert.equal(unblocked.isBlocked, false);
    assert.equal(unblocked.blockReason, null);
    assert.equal(unblocked.expectedResolutionAt, null);
  });

  it("apply: responsável deriva nome; área é independente", () => {
    const next = applySalesOrderFlowManagementPatch(
      defaultSalesOrderFlowManagementSnapshot(),
      {
        expectedUpdatedAt: null,
        responsibleUserId: USER_ID,
        responsibleArea: "PCP",
      },
      "Ana Silva"
    );
    assert.equal(next.responsibleUserId, USER_ID);
    assert.equal(next.responsibleName, "Ana Silva");
    assert.equal(next.responsibleArea, "PCP");

    const cleared = applySalesOrderFlowManagementPatch(
      next,
      { expectedUpdatedAt: new Date(), responsibleUserId: null },
      null
    );
    assert.equal(cleared.responsibleUserId, null);
    assert.equal(cleared.responsibleName, null);
    assert.equal(cleared.responsibleArea, "PCP");
  });

  it("auditoria sanitizada omite conteúdo da nota interna", () => {
    const snap = {
      ...defaultSalesOrderFlowManagementSnapshot(),
      internalNote: "segredo",
      isBlocked: true,
      blockReason: "motivo",
    };
    const sanitized = sanitizeManagementAuditSnapshot(snap);
    assert.equal(sanitized.internalNotePresent, true);
    assert.equal("internalNote" in sanitized, false);

    const changed = listChangedManagementFields(
      defaultSalesOrderFlowManagementSnapshot(),
      snap
    );
    assert.ok(changed.includes("internalNote"));
    assert.ok(changed.includes("isBlocked"));
  });
});
