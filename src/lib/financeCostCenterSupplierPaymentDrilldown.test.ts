import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinanceApDashboardRow } from "./financeAccountsPayableDashboard.js";
import type { AllocationDashboardRow } from "./financeCostCenterDashboard.js";
import {
  buildCostCenterSupplierPaymentSummary,
  buildCostCenterSupplierPaymentTitles,
  buildCostCenterSupplierPaymentYears,
  isTitlePaidInPeriod,
  resolveSupplierPaidAttributionAmount,
  resolveSupplierPaymentPeriodBounds,
} from "./financeCostCenterSupplierPaymentDrilldown.js";
import { parseFinanceCostCenterDashboardFilters } from "./financeCostCenterDashboard.js";

function makeApRow(overrides: Partial<FinanceApDashboardRow> & { externalId: number }): FinanceApDashboardRow {
  return {
    externalId: overrides.externalId,
    companyName: overrides.companyName ?? "Empresa",
    personName: overrides.personName ?? "Fornecedor Teste LTDA",
    personCnpj: overrides.personCnpj ?? "12.345.678/0001-99",
    description: overrides.description ?? "Serviço",
    dueDate: overrides.dueDate ?? new Date("2026-06-15T00:00:00.000Z"),
    scheduleDate: overrides.scheduleDate ?? null,
    type: overrides.type ?? null,
    settlementDate: overrides.settlementDate ?? null,
    paymentDate: overrides.paymentDate ?? new Date("2026-06-20T00:00:00.000Z"),
    amountPayable: overrides.amountPayable ?? 1000,
    amountPaid: overrides.amountPaid ?? 1000,
    balancePayable: overrides.balancePayable ?? 0,
    paymentMethodName: overrides.paymentMethodName ?? "TED",
    bankAccountName: overrides.bankAccountName ?? null,
    sourceInvoiceId: overrides.sourceInvoiceId ?? 123,
    documentNumber: overrides.documentNumber ?? "DOC-1",
    suspendPayment: overrides.suspendPayment ?? false,
    nomusStatus: overrides.nomusStatus ?? true,
    syncedAt: overrides.syncedAt ?? new Date("2026-06-25T00:00:00.000Z"),
  };
}

function makeCtx(input: {
  rows: FinanceApDashboardRow[];
  allocations?: AllocationDashboardRow[];
  filters?: ReturnType<typeof parseFinanceCostCenterDashboardFilters>;
}) {
  const allocationsByPayable = new Map<number, AllocationDashboardRow[]>();
  for (const allocation of input.allocations ?? []) {
    const list = allocationsByPayable.get(allocation.accountsPayableId) ?? [];
    list.push(allocation);
    allocationsByPayable.set(allocation.accountsPayableId, list);
  }
  return {
    rows: input.rows,
    allocationsByPayable,
    suppliers: [],
    ccMeta: new Map([
      ["cc-1", { id: "cc-1", code: "ADM", name: "Administrativo", status: "ACTIVE" }],
    ]),
    filters:
      input.filters ??
      parseFinanceCostCenterDashboardFilters({ year: 2026, month: 6, status: "all" }),
    referenceDate: new Date("2026-06-29T12:00:00.000Z"),
    syncCutoff: null,
  };
}

describe("financeCostCenterSupplierPaymentDrilldown", () => {
  it("resolveSupplierPaymentPeriodBounds respeita mês/ano", () => {
    const filters = parseFinanceCostCenterDashboardFilters({ year: 2026, month: 6, status: "all" });
    const bounds = resolveSupplierPaymentPeriodBounds(filters);
    assert.match(bounds.periodLabel, /Jun\/2026/);
    assert.equal(bounds.periodStart.getMonth(), 5);
  });

  it("isTitlePaidInPeriod usa data gerencial de liquidação do motor oficial", () => {
    const row = makeApRow({ externalId: 1, dueDate: new Date("2026-06-10T00:00:00.000Z") });
    const start = new Date(2026, 5, 1);
    const end = new Date(2026, 5, 30, 23, 59, 59, 999);
    assert.equal(isTitlePaidInPeriod(row, start, end), true);
    assert.equal(isTitlePaidInPeriod(row, new Date(2026, 4, 1), new Date(2026, 4, 30, 23, 59, 59, 999)), false);
  });

  it("cards por fornecedor somam pagamentos do período e ordenam por valor", () => {
    const ctx = makeCtx({
      rows: [
        makeApRow({
          externalId: 1,
          personName: "Fornecedor A",
          personCnpj: "11.111.111/0001-11",
          dueDate: new Date(2026, 5, 5),
          amountPayable: 500,
          amountPaid: 500,
        }),
        makeApRow({
          externalId: 2,
          personName: "Fornecedor B",
          personCnpj: "22.222.222/0001-22",
          dueDate: new Date(2026, 5, 8),
          amountPayable: 1200,
          amountPaid: 1200,
        }),
      ],
      allocations: [
        {
          id: "a1",
          accountsPayableId: 1,
          supplierId: null,
          costCenterId: "cc-1",
          amount: null,
          percentage: { toNumber: () => 100 } as never,
        },
        {
          id: "a2",
          accountsPayableId: 2,
          supplierId: null,
          costCenterId: "cc-1",
          amount: null,
          percentage: { toNumber: () => 100 } as never,
        },
      ],
    });

    const summary = buildCostCenterSupplierPaymentSummary(ctx);
    assert.equal(summary.supplierPaymentSummary.length, 2);
    assert.equal(summary.supplierPaymentSummary[0]?.totalPaidAmount, 1200);
    assert.equal(summary.totalPaidAmountAllSuppliers, 1700);
    assert.match(summary.supplierPaymentSummary[0]?.supplierDisplayName ?? "", /Fornecedor B/);
    assert.doesNotMatch(summary.supplierPaymentSummary[0]?.supplierDisplayName ?? "", /fs:/);
  });

  it("fornecedor sem documento aparece com nome do AP", () => {
    const ctx = makeCtx({
      rows: [
        makeApRow({
          externalId: 9,
          personName: "Origem AP Sem Cadastro",
          personCnpj: null,
          dueDate: new Date("2026-06-12T00:00:00.000Z"),
        }),
      ],
    });
    const summary = buildCostCenterSupplierPaymentSummary(ctx);
    assert.equal(summary.supplierPaymentSummary[0]?.supplierDisplayName, "Origem AP Sem Cadastro");
  });

  it("drilldown anual soma títulos e grid bate com card do ano", () => {
    const ctx = makeCtx({
      rows: [
        makeApRow({
          externalId: 10,
          personName: "Fornecedor Drill",
          personCnpj: "33.333.333/0001-33",
          dueDate: new Date(2026, 5, 12),
          amountPayable: 300,
          amountPaid: 300,
        }),
        makeApRow({
          externalId: 11,
          personName: "Fornecedor Drill",
          personCnpj: "33.333.333/0001-33",
          dueDate: new Date(2025, 2, 10),
          amountPayable: 200,
          amountPaid: 200,
        }),
      ],
    });
    const summary = buildCostCenterSupplierPaymentSummary(ctx);
    const supplier = summary.supplierPaymentSummary[0]!;
    const years = buildCostCenterSupplierPaymentYears(ctx, supplier.supplierKey, supplier.supplierDisplayName);
    const year2026 = years.years.find((row) => row.year === 2026);
    assert.ok(year2026);
    const titles = buildCostCenterSupplierPaymentTitles(
      ctx,
      supplier.supplierKey,
      supplier.supplierDisplayName,
      2026
    );
    assert.equal(titles.totalPaidAmount, year2026!.totalPaidAmount);
    assert.equal(titles.paidTitlesCount, year2026!.paidTitlesCount);
  });

  it("título sem centro de custo aparece no grid", () => {
    const ctx = makeCtx({
      rows: [
        makeApRow({
          externalId: 20,
          dueDate: new Date("2026-06-18T00:00:00.000Z"),
        }),
      ],
    });
    const summary = buildCostCenterSupplierPaymentSummary(ctx);
    const supplier = summary.supplierPaymentSummary[0]!;
    const titles = buildCostCenterSupplierPaymentTitles(
      ctx,
      supplier.supplierKey,
      supplier.supplierDisplayName,
      2026
    );
    assert.equal(titles.items[0]?.costCenterName, "Sem centro de custo classificado");
  });

  it("resolveSupplierPaidAttributionAmount respeita filtro de centro de custo", () => {
    const row = makeApRow({ externalId: 30, amountPayable: 1000, amountPaid: 1000 });
    const allocations: AllocationDashboardRow[] = [
      {
        id: "a30",
        accountsPayableId: 30,
        supplierId: null,
        costCenterId: "cc-1",
        amount: { toNumber: () => 400 } as never,
        percentage: { toNumber: () => 40 } as never,
      },
    ];
    const filters = parseFinanceCostCenterDashboardFilters({
      year: 2026,
      month: 6,
      status: "all",
      costCenterId: "cc-1",
    });
    const paid = resolveSupplierPaidAttributionAmount(row, allocations, filters);
    assert.equal(paid, 400);
  });
});
