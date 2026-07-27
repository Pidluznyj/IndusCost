import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TREASURY_REPORT_KEYS } from "./contracts/treasuryEnums.js";
import { assertTreasuryReportTotalsConsistent } from "./domain/treasuryReportRules.js";
import {
  createMemoryTreasuryReportRepository,
  type TreasuryReportFacts,
} from "./repositories/treasuryReportRepository.server.js";
import { createTreasuryReportService } from "./services/treasuryReportService.server.js";
import type { TreasuryAccountRepository } from "./repositories/treasuryAccountRepository.server.js";

function memoryAccounts(): TreasuryAccountRepository {
  const rows = [
    {
      id: "acc-1",
      companyCode: "LAZARIOS",
      companyName: "Lazarios",
      code: "CX01",
      name: "Caixa",
      institutionName: "Banco",
      institutionCode: null,
      accountType: "CHECKING" as const,
      currency: "BRL" as const,
      agencyMasked: "***",
      accountNumberMasked: "***",
      includeInConsolidated: true,
      minimumBalance: "0.00",
      allowNegativeBalance: false,
      liquidity: "IMMEDIATE" as const,
      defaultBalanceOrigin: "MANUAL" as const,
      nomusBankAccountId: null,
      sortOrder: 1,
      isActive: true,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      deactivatedAt: null,
      createdByUserId: "u1",
      updatedByUserId: null,
    },
  ];
  return {
    async list() {
      return { rows, totalRows: rows.length };
    },
    async findById(id: string) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async findAccess() {
      return null;
    },
  } as unknown as TreasuryAccountRepository;
}

function partitionedFacts(): TreasuryReportFacts {
  return {
    buckets: [
      { key: "A", label: "A", amount: "50.00", count: 2 },
      { key: "B", label: "B", amount: "30.00", count: 1 },
    ],
    rows: [
      { id: "1", label: "row", amount: "50.00", count: 1 },
    ],
    totalRows: 1,
    totalsAmountOverride: null,
    totalsCountOverride: null,
    extras: { note: "memory" },
    paginate: true,
  };
}

describe("treasuryReportService — contas autorizadas + consistência", () => {
  it("monta DTO consistente para todas as chaves com facts em memória", async () => {
    const factsByKey = Object.fromEntries(
      TREASURY_REPORT_KEYS.map((k) => [k, partitionedFacts()])
    ) as Record<(typeof TREASURY_REPORT_KEYS)[number], TreasuryReportFacts>;

    // camada com override
    factsByKey["daily-position"] = {
      ...partitionedFacts(),
      totalsAmountOverride: "80.00",
      totalsCountOverride: 3,
    };
    factsByKey["cash-bridge"] = {
      ...partitionedFacts(),
      totalsAmountOverride: "80.00",
    };
    factsByKey["planned-vs-actual"] = {
      ...partitionedFacts(),
      totalsAmountOverride: "20.00",
    };
    factsByKey["predictability"] = {
      ...partitionedFacts(),
      totalsAmountOverride: "80.00",
    };

    const service = createTreasuryReportService({
      accountRepository: memoryAccounts(),
      reportRepository: createMemoryTreasuryReportRepository(factsByKey),
    });

    const actor = {
      userId: "u1",
      userName: "Admin",
      role: "SUPER_ADMIN",
      sessionId: "s1",
      requestId: "r1",
      isSuperAdmin: true,
      canViewAccounts: true,
      canManageAccounts: true,
      canManageBalances: true,
      canViewReports: true,
    };

    for (const reportKey of TREASURY_REPORT_KEYS) {
      const dto = await service.getReport(actor, {
        reportKey,
        from: "2026-07-01",
        to: "2026-07-27",
        accountIds: null,
        scenario: "PROBABLE",
        companyCode: "LAZARIOS",
        page: 1,
        pageSize: 50,
        status: null,
        severity: null,
        search: null,
      });
      assert.equal(dto.ok, true);
      assert.equal(dto.reportKey, reportKey);
      assert.deepEqual(dto.authorizedAccountIds, ["acc-1"]);
      assertTreasuryReportTotalsConsistent(dto);
      assert.equal(dto.totals.extras.bucketAmountSum, "80.00");
      assert.equal(dto.totals.extras.bucketCountSum, 3);
    }
  });

  it("nega acesso sem viewReports", async () => {
    const service = createTreasuryReportService({
      accountRepository: memoryAccounts(),
      reportRepository: createMemoryTreasuryReportRepository({
        exceptions: partitionedFacts(),
      }),
    });
    await assert.rejects(
      () =>
        service.getReport(
          {
            userId: "u2",
            role: "USER",
            isSuperAdmin: false,
            canViewAccounts: true,
            canManageAccounts: false,
            canViewReports: false,
          },
          {
            reportKey: "exceptions",
            from: "2026-07-01",
            to: "2026-07-27",
            accountIds: null,
            scenario: "PROBABLE",
            companyCode: null,
            page: 1,
            pageSize: 50,
            status: null,
            severity: null,
            search: null,
          }
        ),
      /Sem permissão/
    );
  });
});
