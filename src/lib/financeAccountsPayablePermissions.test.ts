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
});
