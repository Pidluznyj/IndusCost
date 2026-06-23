import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  buildFinanceCostCenterDashboard,
  parseFinanceCostCenterDashboardFilters,
  type AllocationDashboardRow,
  type CostCenterMetaRow,
  type FinanceCostCenterDashboardDeps,
  type FinanceCostCenterDashboardPayload,
} from "./financeCostCenterDashboard.js";
import type { FinanceApDashboardRow } from "./financeAccountsPayableDashboard.js";
import type { SupplierWithAliases } from "./financeSupplierCostCenterRules.js";

const REF = new Date(2026, 5, 17);

type MockState = {
  apRows: FinanceApDashboardRow[];
  allocations: AllocationDashboardRow[];
  costCenters: CostCenterMetaRow[];
  suppliers: SupplierWithAliases[];
  supplierIdsWithRules: string[];
};

function apRow(overrides: Partial<FinanceApDashboardRow> & { externalId: number }): FinanceApDashboardRow {
  return {
    companyName: "Empresa A",
    personName: "Fornecedor Teste",
    personCnpj: "12.345.678/0001-90",
    description: null,
    dueDate: new Date(2026, 5, 10),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    amountPayable: 1000,
    amountPaid: 0,
    balancePayable: 1000,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    documentNumber: null,
    suspendPayment: false,
    nomusStatus: true,
    syncedAt: new Date("2026-06-17T10:00:00.000Z"),
    ...overrides,
  };
}

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

function createMockDeps(state: MockState): FinanceCostCenterDashboardDeps {
  return {
    loadApRows: async () => [...state.apRows],
    loadAllocations: async (externalIds) => {
      const ids = new Set(externalIds);
      return state.allocations.filter((row) => ids.has(row.accountsPayableId));
    },
    loadCostCenters: async () => [...state.costCenters],
    loadSuppliers: async () => [...state.suppliers],
    loadSupplierIdsWithActiveRules: async () =>
      state.supplierIdsWithRules.map((supplierId) => ({ supplierId })),
    resolveSyncCutoff: async () => null,
  };
}

function buildDashboard(state: MockState, filters = parseFinanceCostCenterDashboardFilters({ status: "all" })) {
  return buildFinanceCostCenterDashboard(
    state.apRows,
    state.allocations,
    state.costCenters,
    state.suppliers,
    new Set(state.supplierIdsWithRules),
    filters,
    REF
  );
}

function assertPayloadShape(payload: FinanceCostCenterDashboardPayload) {
  assert.ok(payload.summary);
  assert.ok(Array.isArray(payload.byCostCenter));
  assert.ok(Array.isArray(payload.bySupplier));
  assert.ok(payload.unclassified);
  assert.ok(payload.monthlySeries);
  assert.ok(payload.audit);
  assert.equal(typeof payload.summary.totalAmount, "number");
  assert.equal(typeof payload.summary.classifiedPercentage, "number");
  assert.equal(typeof payload.monthlySeries.mode, "string");
}

describe("financeCostCenterDashboard", () => {
  it("1. dashboard sem alocações não quebra", () => {
    const state: MockState = {
      apRows: [apRow({ externalId: 1, balancePayable: 500 })],
      allocations: [],
      costCenters: [{ id: "cc-1", code: "ADM", name: "Administrativo", status: "ACTIVE" }],
      suppliers: [supplierActive()],
      supplierIdsWithRules: ["sup-1"],
    };
    const payload = buildDashboard(state);
    assertPayloadShape(payload);
    assert.equal(payload.summary.totalAmount, 500);
    assert.equal(payload.summary.classifiedAmount, 0);
    assert.equal(payload.summary.unclassifiedAmount, 500);
    assert.equal(payload.unclassified.titlesCount, 1);
    assert.equal(payload.byCostCenter.length, 0);
  });

  it("2. dashboard com alocações soma valores", () => {
    const state: MockState = {
      apRows: [apRow({ externalId: 2, balancePayable: 1000 })],
      allocations: [
        {
          id: "a1",
          accountsPayableId: 2,
          supplierId: "sup-1",
          costCenterId: "cc-1",
          amount: new Prisma.Decimal(700),
          percentage: new Prisma.Decimal(70),
        },
        {
          id: "a2",
          accountsPayableId: 2,
          supplierId: "sup-1",
          costCenterId: "cc-2",
          amount: new Prisma.Decimal(300),
          percentage: new Prisma.Decimal(30),
        },
      ],
      costCenters: [
        { id: "cc-1", code: "ADM", name: "Administrativo", status: "ACTIVE" },
        { id: "cc-2", code: "OP", name: "Operações", status: "ACTIVE" },
      ],
      suppliers: [supplierActive()],
      supplierIdsWithRules: ["sup-1"],
    };
    const payload = buildDashboard(state);
    assert.equal(payload.summary.classifiedAmount, 1000);
    assert.equal(payload.summary.unclassifiedAmount, 0);
    const totalByCc = payload.byCostCenter.reduce((sum, row) => sum + row.amount, 0);
    assert.equal(totalByCc, 1000);
  });

  it("3. sem classificação aparece separado (apenas gap real)", () => {
    const state: MockState = {
      apRows: [
        apRow({ externalId: 3, balancePayable: 400 }),
        apRow({ externalId: 4, balancePayable: 600, personName: "Outro" }),
      ],
      allocations: [
        {
          id: "a3",
          accountsPayableId: 3,
          supplierId: "sup-1",
          costCenterId: "cc-1",
          amount: new Prisma.Decimal(400),
          percentage: new Prisma.Decimal(100),
        },
      ],
      costCenters: [{ id: "cc-1", code: "ADM", name: "Administrativo", status: "ACTIVE" }],
      suppliers: [supplierActive()],
      supplierIdsWithRules: ["sup-1"],
    };
    const payload = buildDashboard(state);
    assert.equal(payload.summary.classifiedAmount, 400);
    assert.equal(payload.summary.unclassifiedAmount, 600);
    assert.equal(payload.unclassified.titlesCount, 1);
    assert.equal(payload.unclassified.amount, 600);
  });

  it("3b. alocação parcial soma só o gap em sem classificação", () => {
    const state: MockState = {
      apRows: [apRow({ externalId: 30, balancePayable: 1000 })],
      allocations: [
        {
          id: "a30",
          accountsPayableId: 30,
          supplierId: "sup-1",
          costCenterId: "cc-1",
          amount: new Prisma.Decimal(600),
          percentage: new Prisma.Decimal(60),
        },
      ],
      costCenters: [{ id: "cc-1", code: "ADM", name: "Administrativo", status: "ACTIVE" }],
      suppliers: [supplierActive()],
      supplierIdsWithRules: [],
    };
    const payload = buildDashboard(state);
    assert.equal(payload.summary.classifiedAmount, 600);
    assert.equal(payload.summary.unclassifiedAmount, 400);
    assert.equal(payload.summary.totalAmount, 1000);
  });

  it("3c. título alocado 100% não entra em sem classificação sem regra de fornecedor", () => {
    const state: MockState = {
      apRows: [apRow({ externalId: 31, balancePayable: 2000, personName: "CONTA ADMINISTRATIVA" })],
      allocations: [
        {
          id: "a31",
          accountsPayableId: 31,
          supplierId: null,
          costCenterId: "cc-folha",
          amount: new Prisma.Decimal(2000),
          percentage: new Prisma.Decimal(100),
        },
      ],
      costCenters: [
        { id: "cc-folha", code: "ADM-FOLHA", name: "Folha", status: "ACTIVE" },
      ],
      suppliers: [],
      supplierIdsWithRules: [],
    };
    const payload = buildDashboard(state);
    assert.equal(payload.summary.unclassifiedAmount, 0);
    assert.equal(payload.unclassified.titlesCount, 0);
    assert.equal(payload.unclassified.topUnclassifiedSuppliers.length, 0);
  });

  it("3d. escopo open_only exclui títulos liquidados do total", () => {
    const state: MockState = {
      apRows: [
        apRow({ externalId: 32, balancePayable: 300 }),
        apRow({ externalId: 33, balancePayable: 0, amountPayable: 5000, amountPaid: 5000 }),
      ],
      allocations: [],
      costCenters: [],
      suppliers: [],
      supplierIdsWithRules: [],
    };
    const payload = buildDashboard(state);
    assert.equal(payload.summary.totalAmount, 300);
    assert.equal(payload.audit.diagnostics.titlesOpen, 1);
    assert.equal(payload.audit.diagnostics.scopeUsed, "open_only");
  });

  it("4. filtro por centro de custo", () => {
    const state: MockState = {
      apRows: [apRow({ externalId: 5, balancePayable: 1000 })],
      allocations: [
        {
          id: "a5",
          accountsPayableId: 5,
          supplierId: "sup-1",
          costCenterId: "cc-1",
          amount: new Prisma.Decimal(600),
          percentage: new Prisma.Decimal(60),
        },
        {
          id: "a6",
          accountsPayableId: 5,
          supplierId: "sup-1",
          costCenterId: "cc-2",
          amount: new Prisma.Decimal(400),
          percentage: new Prisma.Decimal(40),
        },
      ],
      costCenters: [
        { id: "cc-1", code: "ADM", name: "Administrativo", status: "ACTIVE" },
        { id: "cc-2", code: "OP", name: "Operações", status: "ACTIVE" },
      ],
      suppliers: [supplierActive()],
      supplierIdsWithRules: ["sup-1"],
    };
    const payload = buildDashboard(
      state,
      parseFinanceCostCenterDashboardFilters({ status: "all", costCenterId: "cc-1" })
    );
    assert.equal(payload.byCostCenter.length, 1);
    assert.equal(payload.byCostCenter[0]!.costCenterId, "cc-1");
    assert.equal(payload.byCostCenter[0]!.amount, 600);
  });

  it("5. filtro por fornecedor", () => {
    const state: MockState = {
      apRows: [
        apRow({ externalId: 6, balancePayable: 300 }),
        apRow({
          externalId: 7,
          balancePayable: 700,
          personName: "Outro Fornecedor",
          personCnpj: "98.765.432/0001-10",
        }),
      ],
      allocations: [
        {
          id: "a7",
          accountsPayableId: 6,
          supplierId: "sup-1",
          costCenterId: "cc-1",
          amount: new Prisma.Decimal(300),
          percentage: new Prisma.Decimal(100),
        },
        {
          id: "a8",
          accountsPayableId: 7,
          supplierId: "sup-2",
          costCenterId: "cc-1",
          amount: new Prisma.Decimal(700),
          percentage: new Prisma.Decimal(100),
        },
      ],
      costCenters: [{ id: "cc-1", code: "ADM", name: "Administrativo", status: "ACTIVE" }],
      suppliers: [supplierActive()],
      supplierIdsWithRules: ["sup-1"],
    };
    const payload = buildDashboard(
      state,
      parseFinanceCostCenterDashboardFilters({ status: "all", supplierId: "sup-1" })
    );
    assert.equal(payload.summary.classifiedAmount, 300);
    assert.equal(payload.bySupplier.length, 1);
    assert.equal(payload.bySupplier[0]!.supplierId, "sup-1");
  });

  it("6. filtro por status", () => {
    const state: MockState = {
      apRows: [
        apRow({ externalId: 8, balancePayable: 100, dueDate: new Date(2026, 5, 1) }),
        apRow({ externalId: 9, balancePayable: 0, amountPaid: 200, dueDate: new Date(2026, 4, 1) }),
      ],
      allocations: [],
      costCenters: [],
      suppliers: [],
      supplierIdsWithRules: [],
    };
    const overdueOnly = buildDashboard(
      state,
      parseFinanceCostCenterDashboardFilters({ status: "overdue", year: 2026 })
    );
    assert.equal(overdueOnly.audit.titlesConsidered, 1);
    assert.equal(overdueOnly.summary.totalAmount, 100);
  });

  it("7. filtro por mês/ano", () => {
    const state: MockState = {
      apRows: [
        apRow({ externalId: 10, dueDate: new Date(2026, 4, 15), balancePayable: 100 }),
        apRow({ externalId: 11, dueDate: new Date(2026, 5, 15), balancePayable: 200 }),
      ],
      allocations: [],
      costCenters: [],
      suppliers: [],
      supplierIdsWithRules: [],
    };
    const juneOnly = buildDashboard(
      state,
      parseFinanceCostCenterDashboardFilters({ status: "all", year: 2026, month: 6 })
    );
    assert.equal(juneOnly.audit.titlesConsidered, 1);
    assert.equal(juneOnly.summary.totalAmount, 200);
  });

  it("8. percentuais sem NaN", () => {
    const payload = buildDashboard({
      apRows: [],
      allocations: [],
      costCenters: [],
      suppliers: [],
      supplierIdsWithRules: [],
    });
    assert.equal(payload.summary.classifiedPercentage, 0);
    assert.ok(Number.isFinite(payload.summary.classifiedPercentage));
    for (const row of payload.byCostCenter) {
      assert.ok(Number.isFinite(row.sharePercentage));
    }
  });

  it("9. payload mínimo compatível com UI", () => {
    const payload = buildDashboard({
      apRows: [apRow({ externalId: 12, balancePayable: 50 })],
      allocations: [],
      costCenters: [],
      suppliers: [],
      supplierIdsWithRules: [],
    });
    assertPayloadShape(payload);
    assert.ok("topUnclassifiedSuppliers" in payload.unclassified);
    assert.ok("totals" in payload.monthlySeries);
    assert.ok("byCostCenter" in payload.monthlySeries);
    assert.ok("dataSources" in payload.audit);
    assert.ok("filtersApplied" in payload.audit);
    assert.ok("titlesConsidered" in payload.audit);
    assert.ok("allocationsConsidered" in payload.audit);
    assert.ok("lastApSyncAt" in payload.audit);
    assert.ok("diagnostics" in payload.audit);
    assert.equal(payload.audit.diagnostics.scopeUsed, "open_only");
  });

  it("10. endpoint exige permissão finance.cost_centers.view", () => {
    const routes = readFileSync(join(process.cwd(), "src/lib/financeCostCentersRoutes.ts"), "utf8");
    assert.match(routes, /\/api\/finance\/cost-centers\/dashboard/);
    assert.match(routes, /FINANCE_COST_CENTERS_VIEW_PERMISSIONS/);
    assert.match(routes, /finance\.cost_centers\.view/);
    assert.match(routes, /buildFinanceCostCenterDashboardDefault/);
  });
});
