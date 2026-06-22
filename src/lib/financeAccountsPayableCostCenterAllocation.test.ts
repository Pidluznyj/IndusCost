import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  FINANCE_AP_ALLOCATION_AUDIT_ACTION,
  FINANCE_AP_ALLOCATION_BATCH_CONFIRMATION_TEXT,
} from "./financeApAllocationShared.js";
import {
  applyAccountsPayableAllocation,
  applyBatchAccountsPayableAllocation,
  assertFinanceApAllocationBatchConfirmation,
  FinanceApAllocationError,
  previewAccountsPayableAllocation,
  previewBatchAccountsPayableAllocation,
  protectManualLockedAllocations,
  resolveCostCenterRulesForSupplier,
  resolveSupplierForAccountsPayable,
  resolveTitleAllocationBaseAmount,
  splitAmountByPercentages,
  validateAllocationTotals,
  type AllocationRecord,
  type ApAllocationTitleRow,
  type FinanceApAllocationDeps,
  type SupplierRuleRecord,
} from "./financeAccountsPayableCostCenterAllocation.js";
import type { SupplierWithAliases } from "./financeSupplierCostCenterRules.js";

type MockState = {
  apRows: ApAllocationTitleRow[];
  suppliers: SupplierWithAliases[];
  rules: SupplierRuleRecord[];
  allocations: AllocationRecord[];
  auditLogs: Array<Record<string, unknown>>;
  costCenters: Array<{ id: string; code: string; name: string; status: string }>;
  apWrites: number;
  nextAllocationId: number;
  auditShouldFailOnNth: number | null;
  auditCreateCount: number;
  transactionActive: boolean;
};

function supplierActive(): SupplierWithAliases {
  return {
    id: "sup-1",
    displayName: "Fornecedor Teste",
    status: "ACTIVE",
    normalizedDocument: "12345678000190",
    normalizedName: "fornecedor teste",
    aliases: [
      { externalSupplierId: 10, normalizedDocument: "12345678000190", normalizedName: null },
    ],
  };
}

function apRow(externalId: number, amount = 1000): ApAllocationTitleRow {
  return {
    externalId,
    personId: 10,
    personName: "Fornecedor Teste",
    personCnpj: "12.345.678/0001-90",
    companyName: "Empresa A",
    balancePayable: amount,
    amountPayable: amount,
  };
}

function rule(
  id: string,
  costCenterId: string,
  percentage: number,
  options?: Partial<SupplierRuleRecord>
): SupplierRuleRecord {
  return {
    id,
    supplierId: "sup-1",
    costCenterId,
    percentage: new Prisma.Decimal(percentage),
    priority: 1,
    autoApply: true,
    isActive: true,
    company: null,
    ...options,
  };
}

function createMockDeps(state: MockState): FinanceApAllocationDeps {
  return {
    loadAllSuppliers: async () => [...state.suppliers],
    loadApById: async (externalId) => state.apRows.find((row) => row.externalId === externalId) ?? null,
    loadApRows: async (filters) => {
      let rows = [...state.apRows];
      if (filters.externalIds?.length) {
        const ids = new Set(filters.externalIds);
        rows = rows.filter((row) => ids.has(row.externalId));
      }
      if (filters.companyName) {
        rows = rows.filter((row) => row.companyName === filters.companyName);
      }
      return rows;
    },
    loadAllocationsForPayable: async (externalId) =>
      state.allocations.filter((row) => row.accountsPayableId === externalId),
    loadAllocationsForPayables: async (externalIds) => {
      const ids = new Set(externalIds);
      return state.allocations.filter((row) => ids.has(row.accountsPayableId));
    },
    loadRulesForSupplier: async (supplierId) =>
      state.rules.filter((row) => row.supplierId === supplierId && row.isActive),
    loadCostCenterMeta: async (id) => state.costCenters.find((cc) => cc.id === id) ?? null,
    getClosedThroughDate: async () => null,
    replaceAllocationsForPayable: async (externalId, lines, removableAllocationIds) => {
      state.allocations = state.allocations.filter(
        (row) => !removableAllocationIds.includes(row.id)
      );
      const created: AllocationRecord[] = lines.map((line) => {
        const row: AllocationRecord = {
          id: `alloc-${state.nextAllocationId++}`,
          accountsPayableId: externalId,
          supplierId: line.supplierId,
          costCenterId: line.costCenterId,
          amount: new Prisma.Decimal(line.amount),
          percentage: new Prisma.Decimal(line.percentage),
          source: line.source,
          confidence: null,
          lockedManual: line.lockedManual,
          ruleId: line.ruleId,
          notes: line.notes,
        };
        state.allocations.push(row);
        return row;
      });
      return created;
    },
    createAuditLog: async (data) => {
      state.auditCreateCount += 1;
      if (
        state.auditShouldFailOnNth != null &&
        state.auditCreateCount >= state.auditShouldFailOnNth
      ) {
        throw new Error("AUDIT_WRITE_FAILED");
      }
      state.auditLogs.push({ ...data });
    },
    runInTransaction: async (fn) => {
      if (state.transactionActive) return fn(createMockDeps(state));
      state.transactionActive = true;
      const snapshot = {
        allocations: state.allocations.map((row) => ({ ...row })),
        auditLogs: state.auditLogs.map((row) => ({ ...row })),
        auditCreateCount: state.auditCreateCount,
      };
      try {
        const result = await fn(createMockDeps(state));
        state.transactionActive = false;
        return result;
      } catch (error) {
        state.allocations = snapshot.allocations;
        state.auditLogs = snapshot.auditLogs;
        state.auditCreateCount = snapshot.auditCreateCount;
        state.transactionActive = false;
        throw error;
      }
    },
  };
}

describe("financeAccountsPayableCostCenterAllocation", () => {
  it("1. título com fornecedor e regra 100% gera uma alocação", async () => {
    const state: MockState = {
      apRows: [apRow(100)],
      suppliers: [supplierActive()],
      rules: [rule("r1", "cc-1", 100)],
      allocations: [],
      auditLogs: [],
      costCenters: [{ id: "cc-1", code: "ADM", name: "Admin", status: "ACTIVE" }],
      apWrites: 0,
      nextAllocationId: 1,
      auditShouldFailOnNth: null,
      auditCreateCount: 0,
      transactionActive: false,
    };
    const preview = await previewAccountsPayableAllocation(createMockDeps(state), 100);
    assert.equal(preview.action, "create");
    assert.equal(preview.lines.length, 1);
    assert.equal(preview.lines[0]!.percentage, 100);
    assert.equal(preview.lines[0]!.costCenterId, "cc-1");
  });

  it("2. título com rateio gera múltiplas alocações", async () => {
    const state: MockState = {
      apRows: [apRow(101, 1000)],
      suppliers: [supplierActive()],
      rules: [
        rule("r1", "cc-a", 70),
        rule("r2", "cc-b", 20),
        rule("r3", "cc-c", 10),
      ],
      allocations: [],
      auditLogs: [],
      costCenters: [],
      apWrites: 0,
      nextAllocationId: 1,
      auditShouldFailOnNth: null,
      auditCreateCount: 0,
      transactionActive: false,
    };
    const preview = await previewAccountsPayableAllocation(createMockDeps(state), 101);
    assert.equal(preview.lines.length, 3);
    assert.deepEqual(
      preview.lines.map((line) => line.percentage),
      [70, 20, 10]
    );
  });

  it("3. soma percentual = 100%", () => {
    const lines = [
      { percentage: 70, amount: 700 },
      { percentage: 20, amount: 200 },
      { percentage: 10, amount: 100 },
    ];
    assert.doesNotThrow(() => validateAllocationTotals(lines, 1000));
    assert.throws(
      () => validateAllocationTotals([{ percentage: 60, amount: 600 }], 1000),
      (error: unknown) =>
        error instanceof FinanceApAllocationError && error.code === "INVALID_PERCENTAGE_TOTAL"
    );
  });

  it("4. soma valor = total do título", () => {
    const amounts = splitAmountByPercentages(1000, [33.33, 33.33, 33.34]);
    const total = amounts.reduce((sum, value) => sum + value, 0);
    assert.equal(total, 1000);
    assert.doesNotThrow(() =>
      validateAllocationTotals(
        amounts.map((amount, index) => ({
          amount,
          percentage: [33.33, 33.33, 33.34][index]!,
        })),
        1000
      )
    );
  });

  it("5. manual locked não é sobrescrito", async () => {
    const state: MockState = {
      apRows: [apRow(200)],
      suppliers: [supplierActive()],
      rules: [rule("r1", "cc-1", 100)],
      allocations: [
        {
          id: "locked-1",
          accountsPayableId: 200,
          supplierId: "sup-1",
          costCenterId: "cc-manual",
          amount: new Prisma.Decimal(1000),
          percentage: new Prisma.Decimal(100),
          source: "MANUAL",
          confidence: null,
          lockedManual: true,
          ruleId: null,
          notes: null,
        },
      ],
      auditLogs: [],
      costCenters: [],
      apWrites: 0,
      nextAllocationId: 2,
      auditShouldFailOnNth: null,
      auditCreateCount: 0,
      transactionActive: false,
    };
    const preview = await previewAccountsPayableAllocation(createMockDeps(state), 200);
    assert.equal(preview.action, "skip");
    assert.equal(preview.skipReason, "MANUAL_LOCKED");
    assert.equal(protectManualLockedAllocations(state.allocations).length, 1);
  });

  it("6. sem regra fica sem classificação", async () => {
    const state: MockState = {
      apRows: [apRow(300)],
      suppliers: [supplierActive()],
      rules: [],
      allocations: [],
      auditLogs: [],
      costCenters: [],
      apWrites: 0,
      nextAllocationId: 1,
      auditShouldFailOnNth: null,
      auditCreateCount: 0,
      transactionActive: false,
    };
    const preview = await previewAccountsPayableAllocation(createMockDeps(state), 300);
    assert.equal(preview.action, "skip");
    assert.equal(preview.skipReason, "NO_RULE");
    assert.equal(preview.lines.length, 0);
  });

  it("7. batch preview não grava", async () => {
    const state: MockState = {
      apRows: [apRow(400), apRow(401)],
      suppliers: [supplierActive()],
      rules: [rule("r1", "cc-1", 100)],
      allocations: [],
      auditLogs: [],
      costCenters: [],
      apWrites: 0,
      nextAllocationId: 1,
      auditShouldFailOnNth: null,
      auditCreateCount: 0,
      transactionActive: false,
    };
    const deps = createMockDeps(state);
    const preview = await previewBatchAccountsPayableAllocation(deps, {});
    assert.equal(preview.items.length, 2);
    assert.equal(state.allocations.length, 0);
    assert.equal(state.auditLogs.length, 0);
  });

  it("8. batch apply exige confirmação", async () => {
    const state: MockState = {
      apRows: [apRow(500)],
      suppliers: [supplierActive()],
      rules: [rule("r1", "cc-1", 100)],
      allocations: [],
      auditLogs: [],
      costCenters: [{ id: "cc-1", code: "ADM", name: "Admin", status: "ACTIVE" }],
      apWrites: 0,
      nextAllocationId: 1,
      auditShouldFailOnNth: null,
      auditCreateCount: 0,
      transactionActive: false,
    };
    await assert.rejects(
      () =>
        applyBatchAccountsPayableAllocation(createMockDeps(state), {}, "", {
          userId: "u1",
          userName: "User",
        }),
      (error: unknown) =>
        error instanceof FinanceApAllocationError && error.code === "INVALID_CONFIRMATION"
    );
  });

  it("9. batch apply com confirmação errada falha", () => {
    assert.throws(
      () => assertFinanceApAllocationBatchConfirmation("CONFIRMACAO ERRADA"),
      (error: unknown) =>
        error instanceof FinanceApAllocationError && error.code === "INVALID_CONFIRMATION"
    );
  });

  it("10. apply cria auditoria", async () => {
    const state: MockState = {
      apRows: [apRow(600, 500)],
      suppliers: [supplierActive()],
      rules: [],
      allocations: [],
      auditLogs: [],
      costCenters: [{ id: "cc-1", code: "ADM", name: "Admin", status: "ACTIVE" }],
      apWrites: 0,
      nextAllocationId: 1,
      auditShouldFailOnNth: null,
      auditCreateCount: 0,
      transactionActive: false,
    };
    await applyAccountsPayableAllocation(
      createMockDeps(state),
      600,
      { lines: [{ costCenterId: "cc-1", percentage: 100 }] },
      { userId: "u1", userName: "User" }
    );
    assert.ok(state.auditLogs.some((log) => log.action === FINANCE_AP_ALLOCATION_AUDIT_ACTION.CREATE));
  });

  it("11. AP original não é alterado", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/financeAccountsPayableCostCenterAllocation.ts"),
      "utf8"
    );
    assert.doesNotMatch(src, /nomusAccountsPayable\.update/);
    assert.doesNotMatch(src, /nomusAccountsPayable\.delete/);
    assert.doesNotMatch(src, /nomusAccountsPayable\.create/);
    assert.match(src, /nomusAccountsPayable\.find/);
  });

  it("12. não retorna NaN/Infinity", async () => {
    const state: MockState = {
      apRows: [apRow(700, 333.33)],
      suppliers: [supplierActive()],
      rules: [
        rule("r1", "cc-a", 33.33),
        rule("r2", "cc-b", 33.33),
        rule("r3", "cc-c", 33.34),
      ],
      allocations: [],
      auditLogs: [],
      costCenters: [],
      apWrites: 0,
      nextAllocationId: 1,
      auditShouldFailOnNth: null,
      auditCreateCount: 0,
      transactionActive: false,
    };
    const preview = await previewAccountsPayableAllocation(createMockDeps(state), 700);
    for (const line of preview.lines) {
      assert.ok(Number.isFinite(line.percentage));
      assert.ok(Number.isFinite(line.amount));
      assert.notEqual(line.percentage, Infinity);
      assert.notEqual(line.amount, Infinity);
    }
  });

  it("13. transação evita estado parcial", async () => {
    const state: MockState = {
      apRows: [apRow(800), apRow(801)],
      suppliers: [supplierActive()],
      rules: [rule("r1", "cc-1", 100)],
      allocations: [],
      auditLogs: [],
      costCenters: [{ id: "cc-1", code: "ADM", name: "Admin", status: "ACTIVE" }],
      apWrites: 0,
      nextAllocationId: 1,
      auditShouldFailOnNth: 2,
      auditCreateCount: 0,
      transactionActive: false,
    };
    await assert.rejects(
      () =>
        applyBatchAccountsPayableAllocation(
          createMockDeps(state),
          {},
          FINANCE_AP_ALLOCATION_BATCH_CONFIRMATION_TEXT,
          { userId: "u1", userName: "User" }
        ),
      /AUDIT_WRITE_FAILED/
    );
    assert.equal(state.allocations.length, 0);
    assert.equal(state.auditLogs.length, 0);
  });

  it("14. endpoints aplicam permissões", () => {
    const routes = readFileSync(
      join(process.cwd(), "src/lib/financeAccountsPayableCostCenterAllocationRoutes.ts"),
      "utf8"
    );
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    assert.match(routes, /\/api\/finance\/accounts-payable\/classification-summary/);
    assert.match(routes, /\/api\/finance\/accounts-payable\/unclassified/);
    assert.match(routes, /\/api\/finance\/accounts-payable\/classify-batch-preview/);
    assert.match(routes, /\/api\/finance\/accounts-payable\/classify-batch-apply/);
    assert.match(routes, /\/api\/finance\/accounts-payable\/:id\/cost-center-allocation/);
    assert.match(routes, /FINANCE_AP_ALLOCATION_VIEW_PERMISSIONS/);
    assert.match(routes, /finance\.ap_allocations\.view/);
    assert.match(routes, /FINANCE_AP_ALLOCATION_MANAGE_PERMISSIONS/);
    assert.match(routes, /finance\.ap_allocations\.manage/);
    assert.match(routes, /FINANCE_AP_ALLOCATION_BATCH_APPLY_PERMISSIONS/);
    assert.match(routes, /finance\.ap_allocations\.apply_batch/);
    assert.match(server, /registerFinanceAccountsPayableCostCenterAllocationRoutes/);
  });

  it("resolveSupplierForAccountsPayable encontra fornecedor por alias", () => {
    const ap = apRow(1);
    const supplier = resolveSupplierForAccountsPayable(ap, [supplierActive()]);
    assert.ok(supplier);
    assert.equal(supplier!.id, "sup-1");
  });

  it("resolveCostCenterRulesForSupplier respeita autoApply", () => {
    const ap = apRow(1);
    const rules = resolveCostCenterRulesForSupplier(
      "sup-1",
      ap,
      [rule("r1", "cc-1", 100, { autoApply: false })],
      { requireAutoApply: true }
    );
    assert.equal(rules.length, 0);
  });

  it("resolveTitleAllocationBaseAmount usa balancePayable", () => {
    assert.equal(resolveTitleAllocationBaseAmount({ externalId: 1, balancePayable: 250 }), 250);
  });
});
