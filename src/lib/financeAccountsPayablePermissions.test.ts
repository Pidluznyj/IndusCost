import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canExportFinanceAccountsPayable,
  canRunFinanceAccountsPayableSync,
  canViewFinanceAccountsPayable,
} from "./financeAccountsPayablePermissions.js";

function auth(keys: string[]) {
  return { hasPermission: (key: string) => keys.includes(key) };
}

describe("financeAccountsPayablePermissions", () => {
  it("view exige permissão financeira ou fallback", () => {
    assert.equal(canViewFinanceAccountsPayable(auth([])), false);
    assert.equal(canViewFinanceAccountsPayable(auth(["finance.view"])), true);
    assert.equal(canViewFinanceAccountsPayable(auth(["reports.view"])), true);
  });

  it("export permite export dedicado ou view", () => {
    assert.equal(canExportFinanceAccountsPayable(auth(["finance.accountsPayable.export"])), true);
    assert.equal(canExportFinanceAccountsPayable(auth(["finance.view"])), true);
    assert.equal(canExportFinanceAccountsPayable(auth([])), false);
  });

  it("sync manual só com settings.nomus.sync", () => {
    assert.equal(canRunFinanceAccountsPayableSync(auth(["settings.view"])), false);
    assert.equal(canRunFinanceAccountsPayableSync(auth(["settings.nomus.sync"])), true);
  });
});
