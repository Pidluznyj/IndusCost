import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTreasuryAccountsListQuery,
  createEmptyTreasuryAccountForm,
  formFromTreasuryAccount,
  resolveTreasuryAccountsViewKind,
  toCreateAccountInput,
  validateTreasuryAccountForm,
} from "./treasuryAccountsUi.js";
import type { TreasuryFinancialAccountDto } from "./contracts/index.js";
import {
  canManageTreasuryAccounts,
  canViewTreasuryAccounts,
} from "./treasuryAccountsPermissions.js";

function sampleAccount(
  overrides: Partial<TreasuryFinancialAccountDto> = {}
): TreasuryFinancialAccountDto {
  return {
    id: "acc-1",
    companyCode: "LZ",
    companyName: "Lazarios",
    code: "CC-01",
    name: "Conta principal",
    institutionName: "Banco X",
    institutionCode: "001",
    accountType: "CHECKING",
    currency: "BRL",
    agencyMasked: "****-1",
    accountNumberMasked: "******89",
    includeInConsolidated: true,
    minimumBalance: "1000.00",
    allowNegativeBalance: false,
    liquidity: "IMMEDIATE",
    defaultBalanceOrigin: "MANUAL",
    sortOrder: 1,
    nomusBankAccountId: null,
    isActive: true,
    createdByUserId: "u1",
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-20T10:00:00.000Z",
    deactivatedAt: null,
    deactivatedByUserId: null,
    deactivationReason: null,
    ...overrides,
  };
}

describe("treasuryAccountsUi", () => {
  it("resolveTreasuryAccountsViewKind cobre estados principais", () => {
    assert.equal(
      resolveTreasuryAccountsViewKind({
        canView: false,
        loading: true,
        error: null,
        rowCount: 0,
        hasFilters: false,
      }),
      "denied"
    );
    assert.equal(
      resolveTreasuryAccountsViewKind({
        canView: true,
        loading: true,
        error: null,
        rowCount: 0,
        hasFilters: false,
      }),
      "loading"
    );
    assert.equal(
      resolveTreasuryAccountsViewKind({
        canView: true,
        loading: false,
        error: "falha",
        rowCount: 0,
        hasFilters: false,
      }),
      "error"
    );
    assert.equal(
      resolveTreasuryAccountsViewKind({
        canView: true,
        loading: false,
        error: null,
        rowCount: 0,
        hasFilters: false,
      }),
      "empty"
    );
    assert.equal(
      resolveTreasuryAccountsViewKind({
        canView: true,
        loading: false,
        error: null,
        rowCount: 0,
        hasFilters: true,
      }),
      "empty-filtered"
    );
    assert.equal(
      resolveTreasuryAccountsViewKind({
        canView: true,
        loading: false,
        error: null,
        rowCount: 2,
        hasFilters: false,
      }),
      "ready"
    );
  });

  it("validateTreasuryAccountForm exige campos e mascara", () => {
    const empty = createEmptyTreasuryAccountForm();
    assert.match(validateTreasuryAccountForm(empty, "create") ?? "", /empresa/i);
    empty.companyCode = "LZ";
    assert.match(validateTreasuryAccountForm(empty, "create") ?? "", /código/i);
    empty.code = "CC-01";
    empty.name = "Principal";
    empty.institutionName = "Banco";
    empty.agencyMasked = "****-1";
    empty.accountNumberMasked = "******89";
    empty.minimumBalance = "abc";
    assert.match(validateTreasuryAccountForm(empty, "create") ?? "", /mínimo/i);
    empty.minimumBalance = "10.50";
    assert.equal(validateTreasuryAccountForm(empty, "create"), null);
  });

  it("toCreateAccountInput e formFromTreasuryAccount são estáveis", () => {
    const row = sampleAccount();
    const form = formFromTreasuryAccount(row);
    form.companyCode = row.companyCode;
    form.code = row.code;
    const input = toCreateAccountInput(form);
    assert.equal(input.code, "CC-01");
    assert.equal(input.agencyMasked, "****-1");
    assert.equal(input.includeInConsolidated, true);
    assert.equal(input.minimumBalance, "1000.00");
  });

  it("buildTreasuryAccountsListQuery mapeia status e filtros", () => {
    const q = buildTreasuryAccountsListQuery({
      search: "  banco  ",
      status: "inactive",
      page: 2,
      pageSize: 25,
    });
    assert.equal(q.search, "banco");
    assert.equal(q.isActive, false);
    assert.equal(q.hasFilters, true);
    assert.equal(q.page, 2);
  });
});

describe("treasuryAccountsPermissions", () => {
  it("nega view/manage sem grant e aceita DTO", () => {
    assert.equal(
      canViewTreasuryAccounts({
        canPerformAction: () => false,
        hasPermission: () => false,
      }),
      false
    );
    assert.equal(
      canManageTreasuryAccounts({
        canPerformAction: () => false,
        hasPermission: () => false,
      }),
      false
    );
    assert.equal(
      canViewTreasuryAccounts({
        canPerformAction: (resource, action) =>
          resource === "finance.treasury.accounts" && action === "view",
      }),
      true
    );
    assert.equal(
      canManageTreasuryAccounts({
        canPerformAction: (resource, action) =>
          resource === "finance.treasury.accounts" && action === "manage",
      }),
      true
    );
  });
});
