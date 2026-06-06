import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canExportFinanceAccountsReceivable,
  canRunFinanceAccountsReceivableSync,
  canViewFinanceAccountsReceivable,
} from "./financeAccountsReceivablePermissions.js";

function auth(keys: string[]) {
  return { hasPermission: (key: string) => keys.includes(key) };
}

describe("financeAccountsReceivablePermissions", () => {
  it("view exige permissão financeira ou fallback", () => {
    assert.equal(canViewFinanceAccountsReceivable(auth([])), false);
    assert.equal(canViewFinanceAccountsReceivable(auth(["finance.view"])), true);
    assert.equal(canViewFinanceAccountsReceivable(auth(["reports.view"])), true);
  });

  it("export permite export dedicado ou view", () => {
    assert.equal(canExportFinanceAccountsReceivable(auth(["finance.accountsReceivable.export"])), true);
    assert.equal(canExportFinanceAccountsReceivable(auth(["finance.view"])), true);
    assert.equal(canExportFinanceAccountsReceivable(auth([])), false);
  });

  it("sync manual só com settings.nomus.sync", () => {
    assert.equal(canRunFinanceAccountsReceivableSync(auth(["settings.view"])), false);
    assert.equal(canRunFinanceAccountsReceivableSync(auth(["settings.nomus.sync"])), true);
  });
});
