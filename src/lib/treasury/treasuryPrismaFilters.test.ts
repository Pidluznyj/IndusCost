import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  bindTreasuryOptionalUuidAccountFilter,
  treasuryCompanyCodePresentWhere,
} from "./treasuryPrismaFilters.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("treasuryPrismaFilters", () => {
  it("bind de contas vazias não filtra (evita ANY em null)", () => {
    assert.deepEqual(bindTreasuryOptionalUuidAccountFilter(null), {
      filterByAccounts: false,
      accountIdList: [],
    });
    assert.deepEqual(bindTreasuryOptionalUuidAccountFilter([]), {
      filterByAccounts: false,
      accountIdList: [],
    });
  });

  it("bind preserva UUIDs para cast ::uuid[]", () => {
    const ids = ["11111111-1111-4111-8111-111111111111"];
    assert.deepEqual(bindTreasuryOptionalUuidAccountFilter(ids), {
      filterByAccounts: true,
      accountIdList: ids,
    });
  });

  it("companyCode presente usa NOT { companyCode: null } (não not: null)", () => {
    assert.deepEqual(treasuryCompanyCodePresentWhere(), {
      NOT: { companyCode: null },
    });
  });

  it("repos do dashboard/relatório não comparam uuid com text[]", () => {
    for (const file of [
      "repositories/treasuryDashboardDayFlowRepository.server.ts",
      "repositories/treasuryReportRepository.server.ts",
    ]) {
      const src = readFileSync(join(here, file), "utf8");
      assert.doesNotMatch(
        src,
        /plannedAccountId" = ANY\(\$\{[^}]+\}::text\[\]\)/
      );
      assert.match(src, /plannedAccountId" = ANY\(\$\{[^}]+\}::uuid\[\]\)/);
      assert.match(src, /bindTreasuryOptionalUuidAccountFilter/);
    }
  });

  it("serviços guiados não usam companyCode: { not: null }", () => {
    for (const file of [
      "services/treasuryGuidedTodayService.server.ts",
      "services/treasuryGuidedDailyClosingService.server.ts",
    ]) {
      const src = readFileSync(join(here, file), "utf8");
      assert.doesNotMatch(src, /companyCode:\s*\{\s*not:\s*null\s*\}/);
      assert.match(src, /treasuryCompanyCodePresentWhere/);
    }
  });
});
