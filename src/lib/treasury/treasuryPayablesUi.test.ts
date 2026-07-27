import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TreasuryFinancialAccountDto } from "@/src/lib/treasury/contracts/index.js";
import {
  buildTreasuryPayablesListQuery,
  createEmptyTreasuryPayablesFilters,
  describeTreasuryPayableProgrammingRisk,
  previewTreasuryPayableProgrammingImpact,
  resolveTreasuryPayablesViewKind,
} from "./treasuryPayablesUi.js";

function account(
  partial: Partial<TreasuryFinancialAccountDto> &
    Pick<TreasuryFinancialAccountDto, "id" | "code" | "name">
): TreasuryFinancialAccountDto {
  return {
    companyCode: "LAZARIOS",
    companyName: null,
    institutionName: "Banco",
    institutionCode: null,
    accountType: "CHECKING",
    currency: "BRL",
    agencyMasked: "****",
    accountNumberMasked: "****",
    includeInConsolidated: true,
    minimumBalance: "0.00",
    allowNegativeBalance: true,
    liquidity: "HIGH",
    defaultBalanceOrigin: "MANUAL",
    sortOrder: 1,
    nomusBankAccountId: null,
    isActive: true,
    createdByUserId: "u1",
    createdAt: "2026-07-01T00:00:00.000+00:00",
    updatedAt: "2026-07-01T00:00:00.000+00:00",
    deactivatedAt: null,
    deactivatedByUserId: null,
    deactivationReason: null,
    ...partial,
  };
}

describe("treasuryPayablesUi", () => {
  it("resolve viewKind e monta query de filtros", () => {
    assert.equal(
      resolveTreasuryPayablesViewKind({
        canView: false,
        loading: false,
        error: null,
        rowCount: 0,
        hasFilters: false,
      }),
      "denied"
    );
    const filters = createEmptyTreasuryPayablesFilters();
    filters.supplierName = "Alpha";
    filters.scheduledFrom = "2026-08-01";
    const q = buildTreasuryPayablesListQuery({
      filters,
      page: 2,
      pageSize: 25,
    });
    assert.equal(q.supplierName, "Alpha");
    assert.equal(q.scheduledFrom, "2026-08-01");
    assert.equal(q.hasFilters, true);
    assert.equal(q.page, 2);
  });

  it("calcula preview de impacto e descreve risco", () => {
    const impact = previewTreasuryPayableProgrammingImpact({
      accountId: "acc-1",
      scheduledAmount: "80.00",
      accounts: [
        account({ id: "acc-1", code: "CX1", name: "Caixa" }),
        account({ id: "acc-2", code: "CX2", name: "Outra" }),
      ],
      balancesByAccountId: {
        "acc-1": "50.00",
        "acc-2": "40.00",
      },
    });
    assert.equal(impact.accountBalanceAfter, "-30.00");
    assert.equal(impact.consolidatedBalanceAfter, "10.00");
    assert.equal(impact.createsNegativeAccountBalance, true);
    assert.match(
      describeTreasuryPayableProgrammingRisk(impact),
      /conta pagadora/i
    );
  });
});
