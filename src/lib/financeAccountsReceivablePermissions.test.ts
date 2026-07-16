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
  it("view: AR.view | finance.view — sem reports/settings/AP", () => {
    assert.equal(canViewFinanceAccountsReceivable(auth([])), false);
    assert.equal(canViewFinanceAccountsReceivable(auth(["finance.view"])), true);
    assert.equal(
      canViewFinanceAccountsReceivable(auth(["finance.accountsReceivable.view"])),
      true
    );
    assert.equal(canViewFinanceAccountsReceivable(auth(["reports.view"])), false);
    assert.equal(
      canViewFinanceAccountsReceivable(auth(["finance.accountsPayable.view"])),
      false
    );
  });

  it("export exige chave dedicada — view não autoriza", () => {
    assert.equal(
      canExportFinanceAccountsReceivable(auth(["finance.accountsReceivable.export"])),
      true
    );
    assert.equal(canExportFinanceAccountsReceivable(auth(["finance.view"])), false);
    assert.equal(
      canExportFinanceAccountsReceivable(auth(["finance.accountsReceivable.view"])),
      false
    );
    assert.equal(canExportFinanceAccountsReceivable(auth([])), false);
  });

  it("sync manual só com settings.nomus.sync", () => {
    assert.equal(canRunFinanceAccountsReceivableSync(auth(["settings.view"])), false);
    assert.equal(canRunFinanceAccountsReceivableSync(auth(["settings.nomus.sync"])), true);
  });
});
