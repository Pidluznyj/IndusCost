import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  accountsPayableMatchesFinancialSupplier,
  createSupplierCostCenterRulesBatch,
  deactivateSupplierCostCenterRule,
  FinanceSupplierCostCenterRuleError,
  isManualLockedAllocation,
  previewSupplierCostCenterRuleImpact,
  validateSupplierRulePercentageTotal,
  type AllocationPreviewRow,
  type ApRulePreviewRow,
  type FinanceSupplierCostCenterRulesDeps,
  type SupplierCostCenterRuleRecord,
  type SupplierWithAliases,
} from "./financeSupplierCostCenterRules.js";
import { FINANCE_SUPPLIER_RULE_AUDIT_ACTION } from "./financeSupplierRuleAuditShared.js";

type MockState = {
  rules: SupplierCostCenterRuleRecord[];
  suppliers: SupplierWithAliases[];
  costCenters: Array<{ id: string; code: string; name: string; status: string }>;
  apRows: ApRulePreviewRow[];
  allocations: AllocationPreviewRow[];
  auditLogs: Array<Record<string, unknown>>;
  nextRuleId: number;
};

function supplierActive(id = "sup-1"): SupplierWithAliases {
  return {
    id,
    displayName: "Fornecedor Teste",
    status: "ACTIVE",
    normalizedDocument: "12345678000190",
    normalizedName: "fornecedor teste",
    aliases: [{ externalSupplierId: 10, normalizedDocument: "12345678000190", normalizedName: null }],
  };
}

function costCenterActive(id: string, code: string): { id: string; code: string; name: string; status: string } {
  return { id, code, name: `Centro ${code}`, status: "ACTIVE" };
}

function createMockDeps(state: MockState): FinanceSupplierCostCenterRulesDeps {
  return {
    listRules: async () => [...state.rules],
    findRuleById: async (id) => state.rules.find((rule) => rule.id === id) ?? null,
    listActiveRulesForScope: async (supplierId, company, priority) =>
      state.rules.filter(
        (rule) =>
          rule.supplierId === supplierId &&
          rule.isActive &&
          (rule.company ?? null) === company &&
          (priority == null || rule.priority === priority)
      ),
    findSupplier: async (id) => state.suppliers.find((s) => s.id === id) ?? null,
    findCostCenter: async (id) => state.costCenters.find((cc) => cc.id === id) ?? null,
    createRules: async (rows) => {
      const created = rows.map((row) => {
        const rule: SupplierCostCenterRuleRecord = {
          id: `rule-${state.nextRuleId++}`,
          supplierId: row.supplierId,
          costCenterId: row.costCenterId,
          percentage: new Prisma.Decimal(row.percentage),
          priority: row.priority,
          autoApply: row.autoApply,
          isActive: true,
          company: row.company,
          notes: row.notes,
          createdByUserId: row.createdByUserId,
          createdByName: row.createdByName,
          createdAt: new Date("2026-06-17T12:00:00.000Z"),
          updatedAt: new Date("2026-06-17T12:00:00.000Z"),
        };
        state.rules.push(rule);
        return rule;
      });
      return created;
    },
    updateRule: async (id, data) => {
      const idx = state.rules.findIndex((rule) => rule.id === id);
      assert.ok(idx >= 0);
      const current = state.rules[idx]!;
      const updated: SupplierCostCenterRuleRecord = {
        ...current,
        percentage:
          data.percentage != null ? new Prisma.Decimal(data.percentage) : current.percentage,
        priority: data.priority ?? current.priority,
        autoApply: data.autoApply ?? current.autoApply,
        company: data.company !== undefined ? data.company : current.company,
        notes: data.notes !== undefined ? data.notes : current.notes,
        isActive: data.isActive ?? current.isActive,
        updatedAt: new Date("2026-06-17T13:00:00.000Z"),
      };
      state.rules[idx] = updated;
      return updated;
    },
    deactivateRules: async (ids) => {
      for (const id of ids) {
        const rule = state.rules.find((r) => r.id === id);
        if (rule) rule.isActive = false;
      }
    },
    loadApRows: async () => state.apRows.map((row) => ({ ...row })),
    loadAllocationsForPayableIds: async (ids) =>
      state.allocations.filter((allocation) => ids.includes(allocation.accountsPayableId)),
    createAuditLog: async (data) => {
      state.auditLogs.push({ ...data });
    },
  };
}

describe("financeSupplierCostCenterRules", () => {
  it("1. cria regra 100%", async () => {
    const state: MockState = {
      rules: [],
      suppliers: [supplierActive()],
      costCenters: [costCenterActive("cc-1", "ADM")],
      apRows: [],
      allocations: [],
      auditLogs: [],
      nextRuleId: 1,
    };
    const deps = createMockDeps(state);
    const result = await createSupplierCostCenterRulesBatch(
      deps,
      {
        supplierId: "sup-1",
        rules: [{ costCenterId: "cc-1", percentage: 100 }],
      },
      { userId: "u1", userName: "User" }
    );
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]!.percentage, 100);
    assert.ok(state.auditLogs.some((log) => log.action === FINANCE_SUPPLIER_RULE_AUDIT_ACTION.CREATE));
  });

  it("2. cria rateio 70/20/10", async () => {
    const state: MockState = {
      rules: [],
      suppliers: [supplierActive()],
      costCenters: [
        costCenterActive("cc-a", "A"),
        costCenterActive("cc-b", "B"),
        costCenterActive("cc-c", "C"),
      ],
      apRows: [],
      allocations: [],
      auditLogs: [],
      nextRuleId: 1,
    };
    const deps = createMockDeps(state);
    const result = await createSupplierCostCenterRulesBatch(
      deps,
      {
        supplierId: "sup-1",
        rules: [
          { costCenterId: "cc-a", percentage: 70 },
          { costCenterId: "cc-b", percentage: 20 },
          { costCenterId: "cc-c", percentage: 10 },
        ],
      },
      { userId: "u1", userName: "User" }
    );
    assert.equal(result.items.length, 3);
    const total = result.items.reduce((sum, item) => sum + item.percentage, 0);
    assert.equal(total, 100);
  });

  it("3. bloqueia rateio diferente de 100%", () => {
    assert.throws(
      () => validateSupplierRulePercentageTotal([{ percentage: 70 }, { percentage: 20 }]),
      (error: unknown) =>
        error instanceof FinanceSupplierCostCenterRuleError &&
        error.code === "INVALID_PERCENTAGE_TOTAL"
    );
  });

  it("4. bloqueia centro de custo inativo", async () => {
    const state: MockState = {
      rules: [],
      suppliers: [supplierActive()],
      costCenters: [{ id: "cc-off", code: "OFF", name: "Off", status: "INACTIVE" }],
      apRows: [],
      allocations: [],
      auditLogs: [],
      nextRuleId: 1,
    };
    const deps = createMockDeps(state);
    await assert.rejects(
      () =>
        createSupplierCostCenterRulesBatch(
          deps,
          { supplierId: "sup-1", rules: [{ costCenterId: "cc-off", percentage: 100 }] },
          { userId: "u1", userName: "User" }
        ),
      (error: unknown) =>
        error instanceof FinanceSupplierCostCenterRuleError &&
        error.code === "INACTIVE_COST_CENTER"
    );
  });

  it("5. bloqueia fornecedor inativo", async () => {
    const state: MockState = {
      rules: [],
      suppliers: [{ ...supplierActive(), status: "INACTIVE" }],
      costCenters: [costCenterActive("cc-1", "ADM")],
      apRows: [],
      allocations: [],
      auditLogs: [],
      nextRuleId: 1,
    };
    const deps = createMockDeps(state);
    await assert.rejects(
      () =>
        createSupplierCostCenterRulesBatch(
          deps,
          { supplierId: "sup-1", rules: [{ costCenterId: "cc-1", percentage: 100 }] },
          { userId: "u1", userName: "User" }
        ),
      (error: unknown) =>
        error instanceof FinanceSupplierCostCenterRuleError && error.code === "INACTIVE_SUPPLIER"
    );
  });

  it("6. preview calcula impacto sem gravar", async () => {
    const state: MockState = {
      rules: [],
      suppliers: [supplierActive()],
      costCenters: [costCenterActive("cc-1", "ADM")],
      apRows: [
        {
          externalId: 100,
          personId: 10,
          personCnpj: "12.345.678/0001-90",
          personName: "Fornecedor Teste",
          companyName: "Empresa A",
          balancePayable: 500,
          amountPayable: 500,
          suspendPayment: false,
        },
        {
          externalId: 101,
          personId: 10,
          personCnpj: "12.345.678/0001-90",
          personName: "Fornecedor Teste",
          companyName: "Empresa A",
          balancePayable: 0,
          amountPayable: 200,
          suspendPayment: false,
        },
      ],
      allocations: [],
      auditLogs: [],
      nextRuleId: 1,
    };
    const deps = createMockDeps(state);
    const rulesBefore = state.rules.length;
    const preview = await previewSupplierCostCenterRuleImpact(deps, {
      supplierId: "sup-1",
      rules: [{ costCenterId: "cc-1", percentage: 100 }],
    });
    assert.equal(state.rules.length, rulesBefore);
    assert.equal(preview.openTitlesCount, 1);
    assert.equal(preview.openAmount, 500);
    assert.equal(preview.historicalTitlesCount, 1);
    assert.equal(preview.wouldApplyCount, 2);
    assert.equal(preview.costCenters[0]!.percentage, 100);
  });

  it("7. não sobrescreve manual no preview", async () => {
    const state: MockState = {
      rules: [],
      suppliers: [supplierActive()],
      costCenters: [costCenterActive("cc-1", "ADM")],
      apRows: [
        {
          externalId: 200,
          personId: 10,
          personCnpj: "12.345.678/0001-90",
          personName: "Fornecedor Teste",
          balancePayable: 100,
          suspendPayment: false,
        },
        {
          externalId: 201,
          personId: 10,
          personCnpj: "12.345.678/0001-90",
          personName: "Fornecedor Teste",
          balancePayable: 50,
          suspendPayment: false,
        },
      ],
      allocations: [
        { accountsPayableId: 200, lockedManual: true, source: "MANUAL" },
        { accountsPayableId: 201, lockedManual: false, source: "AUTO_RULE" },
      ],
      auditLogs: [],
      nextRuleId: 1,
    };
    const deps = createMockDeps(state);
    const preview = await previewSupplierCostCenterRuleImpact(deps, {
      supplierId: "sup-1",
      rules: [{ costCenterId: "cc-1", percentage: 100 }],
    });
    assert.equal(preview.manualLockedTitlesCount, 1);
    assert.equal(preview.wouldOverwriteCount, 1);
    assert.equal(preview.wouldApplyCount, 0);
    assert.ok(isManualLockedAllocation({ accountsPayableId: 1, lockedManual: true, source: "MANUAL" }));
  });

  it("8. desativação gera auditoria", async () => {
    const state: MockState = {
      rules: [
        {
          id: "rule-1",
          supplierId: "sup-1",
          costCenterId: "cc-1",
          percentage: new Prisma.Decimal(100),
          priority: 100,
          autoApply: true,
          isActive: true,
          company: null,
          notes: null,
          createdByUserId: null,
          createdByName: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      suppliers: [supplierActive()],
      costCenters: [costCenterActive("cc-1", "ADM")],
      apRows: [],
      allocations: [],
      auditLogs: [],
      nextRuleId: 2,
    };
    const deps = createMockDeps(state);
    const result = await deactivateSupplierCostCenterRule(deps, "rule-1", {
      userId: "u1",
      userName: "User",
    });
    assert.equal(result.isActive, false);
    assert.ok(
      state.auditLogs.some((log) => log.action === FINANCE_SUPPLIER_RULE_AUDIT_ACTION.DEACTIVATE)
    );
  });

  it("9. permissões aplicadas", () => {
    const routes = readFileSync(
      join(process.cwd(), "src/lib/financeSupplierCostCenterRulesRoutes.ts"),
      "utf8"
    );
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    assert.match(routes, /finance\.cost_center_rules\.view/);
    assert.match(routes, /finance\.cost_center_rules\.manage/);
    assert.match(routes, /\/api\/finance\/supplier-cost-center-rules\/preview/);
    assert.match(server, /registerFinanceSupplierCostCenterRulesRoutes/);
  });

  it("10. não altera AP", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/financeSupplierCostCenterRules.ts"),
      "utf8"
    );
    assert.doesNotMatch(src, /nomusAccountsPayable\.update/);
    assert.doesNotMatch(src, /nomusAccountsPayable\.delete/);
    assert.doesNotMatch(src, /nomusAccountsPayable\.create/);
    assert.match(src, /nomusAccountsPayable\.findMany/);
    assert.doesNotMatch(src, /AccountsPayableCostCenterAllocation\.create/);
  });

  it("matching de fornecedor usa documento/id do AP", () => {
    const supplier = supplierActive();
    const ap: ApRulePreviewRow = {
      externalId: 1,
      personId: 10,
      personCnpj: "12.345.678/0001-90",
      personName: "Fornecedor Teste",
    };
    assert.equal(accountsPayableMatchesFinancialSupplier(ap, supplier), true);
  });
});
