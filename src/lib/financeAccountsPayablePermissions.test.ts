import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canExportFinanceAccountsPayable,
  canManageFinanceApAllocations,
  canRunFinanceAccountsPayableSync,
  canViewFinanceAccountsPayable,
} from "./financeAccountsPayablePermissions.js";

function auth(keys: string[]) {
  return { hasPermission: (key: string) => keys.includes(key) };
}

describe("financeAccountsPayablePermissions", () => {
  it("view exige accountsPayable.view ou finance.view — não reports/settings", () => {
    assert.equal(canViewFinanceAccountsPayable(auth([])), false);
    assert.equal(canViewFinanceAccountsPayable(auth(["finance.accountsPayable.view"])), true);
    assert.equal(canViewFinanceAccountsPayable(auth(["finance.view"])), true);
    assert.equal(canViewFinanceAccountsPayable(auth(["reports.view"])), false);
    assert.equal(canViewFinanceAccountsPayable(auth(["settings.view"])), false);
  });

  it("export exige chave dedicada — view não autoriza", () => {
    assert.equal(canExportFinanceAccountsPayable(auth(["finance.accountsPayable.export"])), true);
    assert.equal(canExportFinanceAccountsPayable(auth(["finance.view"])), false);
    assert.equal(canExportFinanceAccountsPayable(auth(["finance.accountsPayable.view"])), false);
    assert.equal(canExportFinanceAccountsPayable(auth([])), false);
  });

  it("sync manual só com settings.nomus.sync", () => {
    assert.equal(canRunFinanceAccountsPayableSync(auth(["settings.view"])), false);
    assert.equal(canRunFinanceAccountsPayableSync(auth(["settings.nomus.sync"])), true);
  });

  it("manage alocação com manage ou apply_batch", () => {
    assert.equal(canManageFinanceApAllocations(auth(["finance.ap_allocations.manage"])), true);
    assert.equal(canManageFinanceApAllocations(auth(["finance.ap_allocations.apply_batch"])), true);
    assert.equal(canManageFinanceApAllocations(auth(["finance.accountsPayable.view"])), false);
  });
});
