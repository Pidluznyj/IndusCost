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
  listUnclassifiedAccountsPayable,
  previewAccountsPayableAllocation,
  previewBatchAccountsPayableAllocation,
  protectManualLockedAllocations,
  reclassifyAccountsPayableAllocation,
  resolveCostCenterRulesForSupplier,
  resolveSupplierForAccountsPayable,
  resolveTitleAllocationBaseAmount,
  resolveUnclassifiedCause,
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
    assert.match(routes, /classify-batch-preview", \.\.\.batchApplyGuard/);
    assert.match(routes, /classify-batch-apply", \.\.\.batchApplyGuard/);
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

describe("reclassifyAccountsPayableAllocation — override manual por título", () => {
  function baseState(over: Partial<MockState> = {}): MockState {
    return {
      apRows: [apRow(1000), apRow(1001)],
      suppliers: [supplierActive()],
      rules: [rule("r1", "cc-auto", 100)],
      allocations: [
        {
          id: "auto-1000",
          accountsPayableId: 1000,
          supplierId: "sup-1",
          costCenterId: "cc-auto",
          amount: new Prisma.Decimal(1000),
          percentage: new Prisma.Decimal(100),
          source: "AUTO_RULE",
          confidence: null,
          lockedManual: false,
          ruleId: "r1",
          notes: null,
        },
        {
          id: "auto-1001",
          accountsPayableId: 1001,
          supplierId: "sup-1",
          costCenterId: "cc-auto",
          amount: new Prisma.Decimal(1000),
          percentage: new Prisma.Decimal(100),
          source: "AUTO_RULE",
          confidence: null,
          lockedManual: false,
          ruleId: "r1",
          notes: null,
        },
      ],
      auditLogs: [],
      costCenters: [
        { id: "cc-auto", code: "LOG", name: "Logística", status: "ACTIVE" },
        { id: "cc-manual", code: "MAN", name: "Manutenção", status: "ACTIVE" },
      ],
      apWrites: 0,
      nextAllocationId: 10,
      auditShouldFailOnNth: null,
      auditCreateCount: 0,
      transactionActive: false,
      ...over,
    };
  }

  const user = { userId: "user-1", userName: "Paulo" };

  it("título classificado automaticamente pode ser reclassificado manualmente", async () => {
    const state = baseState();
    const result = await reclassifyAccountsPayableAllocation(
      createMockDeps(state),
      1000,
      {
        lines: [{ costCenterId: "cc-manual", percentage: 100 }],
        reason: "Título referente a manutenção, não frete/logística.",
        lockedManual: true,
      },
      user
    );
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]!.costCenterId, "cc-manual");
    assert.equal(result.items[0]!.source, "MANUAL");
    assert.equal(result.items[0]!.lockedManual, true);
    assert.equal(result.items[0]!.notes, "Título referente a manutenção, não frete/logística.");
  });

  it("centro antigo e novo são gravados na auditoria", async () => {
    const state = baseState();
    await reclassifyAccountsPayableAllocation(
      createMockDeps(state),
      1000,
      {
        lines: [{ costCenterId: "cc-manual", percentage: 100 }],
        reason: "Correção pontual.",
        lockedManual: true,
      },
      user
    );
    const reclassLog = state.auditLogs.find(
      (log) => log.action === FINANCE_AP_ALLOCATION_AUDIT_ACTION.MANUAL_RECLASSIFICATION
    );
    assert.ok(reclassLog);
    const before = reclassLog!.beforeJson as { allocations: Array<{ costCenterId: string }> };
    const after = reclassLog!.afterJson as {
      origin: string;
      reason: string;
      allocations: Array<{ costCenterId: string }>;
    };
    assert.equal(before.allocations[0]!.costCenterId, "cc-auto");
    assert.equal(after.allocations[0]!.costCenterId, "cc-manual");
    assert.equal(after.origin, "MANUAL_RECLASSIFICATION");
    assert.equal(after.reason, "Correção pontual.");
    assert.equal(reclassLog!.userId, "user-1");
    assert.equal(reclassLog!.userName, "Paulo");
  });

  it("motivo é obrigatório", async () => {
    const state = baseState();
    await assert.rejects(
      () =>
        reclassifyAccountsPayableAllocation(
          createMockDeps(state),
          1000,
          {
            lines: [{ costCenterId: "cc-manual", percentage: 100 }],
            reason: "   ",
            lockedManual: true,
          },
          user
        ),
      (error: unknown) =>
        error instanceof FinanceApAllocationError && error.code === "MISSING_REASON"
    );
  });

  it("classificação manual prevalece sobre regra automática", async () => {
    const state = baseState();
    await reclassifyAccountsPayableAllocation(
      createMockDeps(state),
      1000,
      {
        lines: [{ costCenterId: "cc-manual", percentage: 100 }],
        reason: "Override manual.",
        lockedManual: true,
      },
      user
    );
    const preview = await previewAccountsPayableAllocation(createMockDeps(state), 1000);
    assert.equal(preview.action, "skip");
    assert.equal(preview.skipReason, "MANUAL_LOCKED");
  });

  it("reprocessamento em lote não sobrescreve override manual", async () => {
    const state = baseState();
    await reclassifyAccountsPayableAllocation(
      createMockDeps(state),
      1000,
      {
        lines: [{ costCenterId: "cc-manual", percentage: 100 }],
        reason: "Override manual.",
        lockedManual: true,
      },
      user
    );
    const batch = await applyBatchAccountsPayableAllocation(
      createMockDeps(state),
      { externalIds: [1000, 1001] },
      FINANCE_AP_ALLOCATION_BATCH_CONFIRMATION_TEXT,
      user
    );
    assert.equal(batch.summary.skippedManualLocked, 1);
    const title1000 = state.allocations.filter((row) => row.accountsPayableId === 1000);
    assert.equal(title1000.length, 1);
    assert.equal(title1000[0]!.costCenterId, "cc-manual");
    assert.equal(title1000[0]!.lockedManual, true);
  });

  it("reclassificar um título não altera outros títulos do mesmo fornecedor", async () => {
    const state = baseState();
    await reclassifyAccountsPayableAllocation(
      createMockDeps(state),
      1000,
      {
        lines: [{ costCenterId: "cc-manual", percentage: 100 }],
        reason: "Somente este título.",
        lockedManual: true,
      },
      user
    );
    const other = state.allocations.filter((row) => row.accountsPayableId === 1001);
    assert.equal(other.length, 1);
    assert.equal(other[0]!.costCenterId, "cc-auto");
    assert.equal(other[0]!.lockedManual, false);
  });
});

describe("listUnclassifiedAccountsPayable — separação de causas", () => {
  function baseState(over: Partial<MockState> = {}): MockState {
    return {
      apRows: [],
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
      ...over,
    };
  }

  function lockedAlloc(externalId: number, percentage = 50): AllocationRecord {
    return {
      id: `lock-${externalId}`,
      accountsPayableId: externalId,
      supplierId: "sup-1",
      costCenterId: "cc-1",
      amount: new Prisma.Decimal(percentage * 10),
      percentage: new Prisma.Decimal(percentage),
      source: "MANUAL",
      confidence: null,
      lockedManual: true,
      ruleId: null,
      notes: null,
    };
  }

  function partialAlloc(externalId: number, percentage = 60): AllocationRecord {
    return {
      id: `part-${externalId}`,
      accountsPayableId: externalId,
      supplierId: "sup-1",
      costCenterId: "cc-1",
      amount: new Prisma.Decimal(percentage * 10),
      percentage: new Prisma.Decimal(percentage),
      source: "AUTO_RULE",
      confidence: null,
      lockedManual: false,
      ruleId: "r1",
      notes: null,
    };
  }

  it("resolveUnclassifiedCause prioriza manual e parcial", () => {
    assert.equal(
      resolveUnclassifiedCause({
        hasManualLocked: true,
        allocationPercentageTotal: 50,
        hasSupplier: true,
        hasActiveAutoApplyRule: true,
        hasActiveRule: true,
      }),
      "MANUAL_LOCKED"
    );
    assert.equal(
      resolveUnclassifiedCause({
        hasManualLocked: false,
        allocationPercentageTotal: 60,
        hasSupplier: true,
        hasActiveAutoApplyRule: true,
        hasActiveRule: true,
      }),
      "PARTIAL_ALLOCATION"
    );
    assert.equal(
      resolveUnclassifiedCause({
        hasManualLocked: false,
        allocationPercentageTotal: 0,
        hasSupplier: false,
        hasActiveAutoApplyRule: false,
        hasActiveRule: false,
      }),
      "NO_SUPPLIER"
    );
    assert.equal(
      resolveUnclassifiedCause({
        hasManualLocked: false,
        allocationPercentageTotal: 0,
        hasSupplier: true,
        hasActiveAutoApplyRule: false,
        hasActiveRule: false,
      }),
      "SUPPLIER_NO_RULE"
    );
    assert.equal(
      resolveUnclassifiedCause({
        hasManualLocked: false,
        allocationPercentageTotal: 0,
        hasSupplier: true,
        hasActiveAutoApplyRule: true,
        hasActiveRule: true,
      }),
      "RULE_NOT_APPLIED"
    );
  });

  it("título sem fornecedor casado → NO_SUPPLIER", async () => {
    const noMatch: ApAllocationTitleRow = {
      externalId: 900,
      personId: 999,
      personName: "Pessoa Sem Cadastro",
      personCnpj: null,
      companyName: "Empresa A",
      balancePayable: 1000,
      amountPayable: 1000,
    };
    const state = baseState({ apRows: [noMatch] });
    const out = await listUnclassifiedAccountsPayable(createMockDeps(state), {});
    assert.equal(out.items.length, 1);
    assert.equal(out.items[0]!.cause, "NO_SUPPLIER");
    assert.equal(out.causeSummary.NO_SUPPLIER, 1);
  });

  it("fornecedor casado sem regra → SUPPLIER_NO_RULE", async () => {
    const state = baseState({ apRows: [apRow(901)], rules: [] });
    const out = await listUnclassifiedAccountsPayable(createMockDeps(state), {});
    assert.equal(out.items[0]!.cause, "SUPPLIER_NO_RULE");
    assert.equal(out.items[0]!.supplierId, "sup-1");
    assert.equal(out.causeSummary.SUPPLIER_NO_RULE, 1);
  });

  it("fornecedor com regra ativa autoApply mas sem alocação → RULE_NOT_APPLIED", async () => {
    const state = baseState({ apRows: [apRow(902)], rules: [rule("r1", "cc-1", 100)] });
    const out = await listUnclassifiedAccountsPayable(createMockDeps(state), {});
    assert.equal(out.items[0]!.cause, "RULE_NOT_APPLIED");
    assert.equal(out.causeSummary.RULE_NOT_APPLIED, 1);
  });

  it("regra existente sem autoApply não conta como aplicável → SUPPLIER_NO_RULE", async () => {
    const state = baseState({
      apRows: [apRow(903)],
      rules: [rule("r1", "cc-1", 100, { autoApply: false })],
    });
    const out = await listUnclassifiedAccountsPayable(createMockDeps(state), {});
    assert.equal(out.items[0]!.cause, "SUPPLIER_NO_RULE");
  });

  it("alocação parcial (<100%) → PARTIAL_ALLOCATION e gap financeiro", async () => {
    const state = baseState({
      apRows: [apRow(904)],
      rules: [rule("r1", "cc-1", 100)],
      allocations: [partialAlloc(904, 60)],
    });
    const out = await listUnclassifiedAccountsPayable(createMockDeps(state), {});
    assert.equal(out.items[0]!.cause, "PARTIAL_ALLOCATION");
    assert.equal(out.causeSummary.PARTIAL_ALLOCATION, 1);
    assert.equal(out.items[0]!.titleAmount, 400);
  });

  it("alocação manual bloqueada parcial → MANUAL_LOCKED (protege manual)", async () => {
    const state = baseState({
      apRows: [apRow(905)],
      rules: [rule("r1", "cc-1", 100)],
      allocations: [lockedAlloc(905, 50)],
    });
    const out = await listUnclassifiedAccountsPayable(createMockDeps(state), {});
    assert.equal(out.items[0]!.cause, "MANUAL_LOCKED");
    assert.equal(out.causeSummary.MANUAL_LOCKED, 1);
  });

  it("título 100% classificado não aparece na lista", async () => {
    const state = baseState({
      apRows: [apRow(906)],
      allocations: [partialAlloc(906, 100)],
    });
    const out = await listUnclassifiedAccountsPayable(createMockDeps(state), {});
    assert.equal(out.items.length, 0);
  });
});

describe("importação de classificações AP — integração segura", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  it("a lib de importação reutiliza o apply em lote (respeita manual locked) e não altera Nomus", () => {
    const lib = read("src/lib/financeUnclassifiedImport.ts");
    // Reutiliza o apply em lote por fornecedor, que pula MANUAL_LOCKED.
    assert.match(lib, /applyBatchAccountsPayableAllocationDefault/);
    assert.match(lib, /unclassifiedOnly: true, supplierId/);
    assert.match(lib, /skippedManualLocked/);
    // Não escreve em NomusAccountsPayable (apenas leitura para personId/documento).
    assert.doesNotMatch(lib, /nomusAccountsPayable\.(update|create|delete|upsert)/);
  });

  it("endpoints de export/import estão registrados com permissões", () => {
    const routes = read("src/lib/financeUnclassifiedImportRoutes.ts");
    const server = read("server.ts");
    assert.match(routes, /\/api\/finance\/cost-centers\/unclassified\/export/);
    assert.match(routes, /\/api\/finance\/cost-centers\/unclassified\/import\/preview/);
    assert.match(routes, /\/api\/finance\/cost-centers\/unclassified\/import\/apply/);
    assert.match(routes, /FINANCE_AP_ALLOCATION_BATCH_APPLY_PERMISSIONS/);
    assert.match(routes, /upload\.single\("file"\)/);
    assert.match(server, /registerFinanceUnclassifiedImportRoutes/);
  });
});
