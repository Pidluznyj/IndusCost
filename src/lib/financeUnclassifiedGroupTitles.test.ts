import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  parseUnclassifiedGroupTitlesQuery,
} from "./financeUnclassifiedGroupTitles.js";
import { FinanceApAllocationError } from "./financeAccountsPayableCostCenterAllocation.js";
import { resolveUnclassifiedPayableGroupKey } from "./financeUnclassifiedPayablesGrouping.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("financeUnclassifiedGroupTitles", () => {
  it("parseUnclassifiedGroupTitlesQuery exige groupKey", () => {
    assert.throws(
      () => parseUnclassifiedGroupTitlesQuery({}),
      (error: unknown) =>
        error instanceof FinanceApAllocationError && error.code === "INVALID_GROUP_KEY"
    );
  });

  it("parseUnclassifiedGroupTitlesQuery repassa filtros e paginação", () => {
    const query = parseUnclassifiedGroupTitlesQuery({
      groupKey: "fs:supplier-1",
      cause: "NO_SUPPLIER",
      companyName: "Indústria",
      year: "2026",
      month: "3",
      status: "open",
      classification: "unclassified",
      openOnly: "true",
      search: "NF 123",
      page: "2",
      pageSize: "25",
    });
    assert.equal(query.groupKey, "fs:supplier-1");
    assert.equal(query.cause, "NO_SUPPLIER");
    assert.equal(query.companyName, "Indústria");
    assert.equal(query.year, 2026);
    assert.equal(query.month, 3);
    assert.equal(query.status, "open");
    assert.equal(query.classification, "unclassified");
    assert.equal(query.openOnly, true);
    assert.equal(query.search, "NF 123");
    assert.equal(query.page, 2);
    assert.equal(query.pageSize, 25);
  });

  it("groupKey fs: usa supplierId consolidado", () => {
    const key = resolveUnclassifiedPayableGroupKey({
      externalId: 1,
      titleAmount: 10,
      companyName: null,
      personName: "CONTA ADMINISTRATIVA",
      supplierId: "uuid-admin",
      identityKey: "name:conta administrativa",
      cause: "NO_SUPPLIER",
    });
    assert.equal(key, "fs:uuid-admin");
  });

  it("endpoint registrado nas rotas de alocação AP", () => {
    const routes = read("src/lib/financeAccountsPayableCostCenterAllocationRoutes.ts");
    assert.match(routes, /unclassified-groups\/:groupKey\/titles/);
    assert.match(routes, /listUnclassifiedGroupTitlesDefault/);
    assert.match(routes, /parseUnclassifiedGroupTitlesQuery/);
  });
});
