import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canManageTreasuryExceptions,
  canViewTreasuryExceptions,
} from "./treasuryExceptionsPermissions.js";
import {
  createEmptyTreasuryExceptionsFilters,
  formatTreasuryExceptionAgeLabel,
  isTreasuryExceptionOpenStatus,
  resolveTreasuryExceptionsViewKind,
  TREASURY_EXCEPTION_STATUS_LABELS,
  TREASURY_EXCEPTIONS_PAGE_TITLE,
} from "./treasuryExceptionsUi.js";
import {
  buildTreasuryExceptionEntityHref,
  recommendTreasuryExceptionAction,
} from "./domain/treasuryExceptionPresentation.js";

describe("treasuryExceptionsUi", () => {
  it("labels canônicos dos 6 status", () => {
    assert.equal(TREASURY_EXCEPTIONS_PAGE_TITLE, "Central de Exceções");
    assert.equal(TREASURY_EXCEPTION_STATUS_LABELS.OPEN, "Aberta");
    assert.equal(TREASURY_EXCEPTION_STATUS_LABELS.IN_ANALYSIS, "Em análise");
    assert.equal(
      TREASURY_EXCEPTION_STATUS_LABELS.WAITING_THIRD_PARTY,
      "Aguardando terceiro"
    );
    assert.equal(TREASURY_EXCEPTION_STATUS_LABELS.RESOLVED, "Resolvida");
    assert.equal(TREASURY_EXCEPTION_STATUS_LABELS.IGNORED, "Ignorada");
    assert.equal(TREASURY_EXCEPTION_STATUS_LABELS.CANCELLED, "Cancelada");
  });

  it("view kind e idade", () => {
    assert.equal(
      resolveTreasuryExceptionsViewKind({
        canView: false,
        loading: false,
        error: null,
        itemCount: 0,
      }),
      "denied"
    );
    assert.equal(
      resolveTreasuryExceptionsViewKind({
        canView: true,
        loading: false,
        error: null,
        itemCount: 0,
      }),
      "empty"
    );
    assert.equal(formatTreasuryExceptionAgeLabel(0), "hoje");
    assert.equal(formatTreasuryExceptionAgeLabel(3), "3 dias");
    assert.ok(isTreasuryExceptionOpenStatus("WAITING_THIRD_PARTY"));
    assert.ok(createEmptyTreasuryExceptionsFilters().sortBy);
  });

  it("deep-link e ação recomendada", () => {
    assert.equal(
      buildTreasuryExceptionEntityHref({
        entityKind: "RECEIVABLE",
        entityId: "t1",
        accountId: null,
        nomusExternalId: "99",
      }),
      "/finance/treasury/receivables?officialTitleId=t1&nomusExternalId=99"
    );
    assert.equal(
      recommendTreasuryExceptionAction({
        type: "STALE_BALANCE",
        status: "OPEN",
        severity: "WARNING",
        responsibleUserId: null,
      }),
      "Atribuir responsável."
    );
    assert.match(
      recommendTreasuryExceptionAction({
        type: "STALE_BALANCE",
        status: "IN_ANALYSIS",
        severity: "WARNING",
        responsibleUserId: "u1",
      }),
      /saldo/i
    );
  });
});

describe("treasuryExceptionsPermissions", () => {
  it("view/manage por capability e legado", () => {
    assert.equal(
      canViewTreasuryExceptions({
        canPerformAction: (r, a) =>
          r === "finance.treasury.exceptions" && a === "view",
      }),
      true
    );
    assert.equal(
      canManageTreasuryExceptions({
        canPerformAction: (r, a) =>
          r === "finance.treasury.exceptions" && a === "manage",
      }),
      true
    );
    assert.equal(
      canManageTreasuryExceptions({
        hasPermission: (k) => k === "finance.treasury.exceptions.view",
      }),
      false
    );
    assert.equal(
      canViewTreasuryExceptions({
        hasPermission: (k) => k === "finance.treasury.exceptions.view",
      }),
      true
    );
  });
});
