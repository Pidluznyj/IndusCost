import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { FinanceApDashboardRow } from "./financeAccountsPayableDashboard.js";
import type { AllocationDashboardRow } from "./financeCostCenterDashboard.js";
import { buildCostCenterConsolidatedSuppliers, filterCostCenterSupplierScopeRows, resolveCostCenterSupplierConsolidationKey } from "./financeCostCenterSupplierConsolidation.js";
import { parseFinanceCostCenterDashboardFilters, resolveFinanceCostCenterDashboardApScope } from "./financeCostCenterDashboard.js";
import {
  buildCostCenterSupplierPaymentTitles,
} from "./financeCostCenterSupplierPaymentDrilldown.js";
import {
  buildCostCenterSupplierTitles,
  resolveSupplierGridDrilldownTotals,
} from "./financeCostCenterSupplierTitlesDrilldown.js";
import { createDefaultSupplierTitleListFilters } from "./financePaidTitlesModalFilters.js";
import type { SupplierWithAliases } from "./financeSupplierCostCenterRules.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function makeApRow(overrides: Partial<FinanceApDashboardRow> & { externalId: number }): FinanceApDashboardRow {
  return {
    externalId: overrides.externalId,
    companyName: overrides.companyName ?? "Empresa",
    personName: overrides.personName ?? "ZEFFEXX",
    personCnpj: overrides.personCnpj ?? "00.000.000/0001-01",
    description: overrides.description ?? "Serviço",
    dueDate: overrides.dueDate ?? new Date(2026, 5, 10),
    scheduleDate: overrides.scheduleDate ?? null,
    type: overrides.type ?? null,
    settlementDate: overrides.settlementDate ?? null,
    paymentDate: overrides.paymentDate ?? null,
    amountPayable: overrides.amountPayable ?? 2472.94,
    amountPaid: overrides.amountPaid ?? 0,
    balancePayable: overrides.balancePayable ?? 2472.94,
    paymentMethodName: overrides.paymentMethodName ?? null,
    bankAccountName: overrides.bankAccountName ?? null,
    sourceInvoiceId: overrides.sourceInvoiceId ?? null,
    documentNumber: overrides.documentNumber ?? `DOC-${overrides.externalId}`,
    suspendPayment: overrides.suspendPayment ?? false,
    nomusStatus: overrides.nomusStatus ?? true,
    syncedAt: overrides.syncedAt ?? new Date("2026-06-25T00:00:00.000Z"),
  };
}

function zeffexxSupplier(): SupplierWithAliases {
  return {
    id: "sup-zeff",
    displayName: "ZEFFEXX",
    status: "ACTIVE",
    normalizedDocument: "00000000000101",
    normalizedName: "zeffexx",
    aliases: [],
  };
}

function makeCtx(input: {
  rows: FinanceApDashboardRow[];
  allocations?: AllocationDashboardRow[];
  suppliers?: SupplierWithAliases[];
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
    suppliers: input.suppliers ?? [zeffexxSupplier()],
    ccMeta: new Map([
      ["cc-1", { id: "cc-1", code: "ADM", name: "Administrativo", status: "ACTIVE" }],
      ["cc-2", { id: "cc-2", code: "OP", name: "Operacional", status: "ACTIVE" }],
    ]),
    filters:
      input.filters ??
      parseFinanceCostCenterDashboardFilters({ year: 2026, month: 6, status: "all" }),
    referenceDate: new Date("2026-06-29T12:00:00.000Z"),
    syncCutoff: null,
  };
}

describe("financeCostCenterSupplierTitlesDrilldown", () => {
  it("grid ZEFFEXX com 10 títulos e drilldown retornam os mesmos totais", () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      makeApRow({
        externalId: index + 1,
        amountPayable: 2472.935,
        balancePayable: index < 3 ? 0 : 2472.935,
        amountPaid: index < 3 ? 2472.935 : 0,
        paymentDate: index < 3 ? new Date(2026, 4, 15) : null,
        dueDate: new Date(2026, 5, 5 + index),
      })
    );
    const ctx = makeCtx({ rows });
    const apScope = resolveFinanceCostCenterDashboardApScope(ctx.filters);
    const scopeRows = filterCostCenterSupplierScopeRows(
      ctx.rows,
      ctx.filters,
      ctx.referenceDate,
      ctx.syncCutoff,
      apScope
    );
    const consolidated = buildCostCenterConsolidatedSuppliers(
      scopeRows,
      ctx.allocationsByPayable,
      ctx.suppliers,
      ctx.filters,
      apScope
    );
    const supplierKey = resolveCostCenterSupplierConsolidationKey(rows[0]!, zeffexxSupplier());
    const gridRow = consolidated.get(supplierKey);
    assert.ok(gridRow);
    assert.equal(gridRow.titleIds.size, 10);
    assert.equal(gridRow.amount, 24729.35);

    const drilldownTotals = resolveSupplierGridDrilldownTotals(ctx, supplierKey);
    assert.equal(drilldownTotals.titlesCount, 10);
    assert.equal(drilldownTotals.totalTitleAmount, 24729.35);

    const titles = buildCostCenterSupplierTitles(
      ctx,
      supplierKey,
      "ZEFFEXX",
      1,
      50,
      createDefaultSupplierTitleListFilters()
    );
    assert.equal(titles.titlesCount, 10);
    assert.equal(titles.totalTitleAmount, 24729.35);
    assert.equal(titles.supplierKey, supplierKey);
    assert.match(titles.dateRuleNote, /vencimento/i);
  });

  it("modal da aba Fornecedores não usa endpoint de títulos pagos", () => {
    const suppliersTab = read("src/components/finance/cost-centers/FinanceSuppliersTab.tsx");
    const supplierModal = read("src/components/finance/cost-centers/FinanceSupplierTitlesModal.tsx");
    assert.match(suppliersTab, /FinanceSupplierTitlesModal/);
    assert.doesNotMatch(suppliersTab, /FinanceSupplierPaidTitlesModal/);
    assert.match(supplierModal, /supplier-titles/);
    assert.doesNotMatch(supplierModal, /supplier-payment-titles/);
    assert.match(supplierModal, /Títulos do fornecedor —/);
    assert.doesNotMatch(supplierModal, /Títulos pagos —/);
  });

  it("drilldown inclui títulos em aberto que o endpoint de pagos exclui", () => {
    const rows = [
      makeApRow({
        externalId: 1,
        amountPayable: 1000,
        amountPaid: 1000,
        balancePayable: 0,
        paymentDate: new Date(2026, 5, 20),
        dueDate: new Date(2026, 5, 10),
      }),
      makeApRow({
        externalId: 2,
        amountPayable: 2000,
        amountPaid: 0,
        balancePayable: 2000,
        paymentDate: null,
        dueDate: new Date(2026, 5, 12),
      }),
    ];
    const ctx = makeCtx({ rows });
    const supplierKey = resolveCostCenterSupplierConsolidationKey(rows[0]!, zeffexxSupplier());

    const supplierTitles = buildCostCenterSupplierTitles(
      ctx,
      supplierKey,
      "ZEFFEXX",
      1,
      50,
      createDefaultSupplierTitleListFilters()
    );
    const paidTitles = buildCostCenterSupplierPaymentTitles(
      ctx,
      supplierKey,
      "ZEFFEXX",
      2026,
      1,
      50,
      createDefaultSupplierTitleListFilters()
    );

    assert.equal(supplierTitles.titlesCount, 2);
    assert.equal(supplierTitles.totalTitleAmount, 3000);
    assert.equal(paidTitles.paidTitlesCount, 1);
    assert.equal(paidTitles.totalPaidAmount, 1000);
  });

  it("filtro interno de centro de custo restringe dentro dos títulos do fornecedor", () => {
    const rows = [
      makeApRow({ externalId: 1, amountPayable: 1000, dueDate: new Date(2026, 5, 5) }),
      makeApRow({ externalId: 2, amountPayable: 2000, dueDate: new Date(2026, 5, 8) }),
    ];
    const ctx = makeCtx({
      rows,
      allocations: [
        {
          id: "a1",
          accountsPayableId: 1,
          supplierId: "sup-zeff",
          costCenterId: "cc-1",
          amount: null,
          percentage: { toNumber: () => 100 } as never,
        },
        {
          id: "a2",
          accountsPayableId: 2,
          supplierId: "sup-zeff",
          costCenterId: "cc-2",
          amount: null,
          percentage: { toNumber: () => 100 } as never,
        },
      ],
    });
    const supplierKey = `fs:${zeffexxSupplier().id}`;

    const allCenters = buildCostCenterSupplierTitles(ctx, supplierKey, "ZEFFEXX", 1, 50, {
      search: "",
      costCenterFilter: "all",
      classificationStatus: "all",
    });
    assert.equal(allCenters.titlesCount, 2);
    assert.equal(allCenters.totalTitleAmount, 3000);

    const cc1Only = buildCostCenterSupplierTitles(ctx, supplierKey, "ZEFFEXX", 1, 50, {
      search: "",
      costCenterFilter: "cc-1",
      classificationStatus: "all",
    });
    assert.equal(cc1Only.titlesCount, 1);
    assert.equal(cc1Only.totalTitleAmount, 1000);

    const cleared = buildCostCenterSupplierTitles(
      ctx,
      supplierKey,
      "ZEFFEXX",
      1,
      50,
      createDefaultSupplierTitleListFilters()
    );
    assert.equal(cleared.titlesCount, 2);
  });

  it("rota supplier-titles existe e supplier-payment-titles permanece para pagamentos", () => {
    const routes = read("src/lib/financeCostCentersRoutes.ts");
    assert.match(routes, /\/api\/finance\/cost-centers\/supplier-titles/);
    assert.match(routes, /buildCostCenterSupplierTitles/);
    assert.match(routes, /\/api\/finance\/cost-centers\/supplier-payment-titles/);
    assert.match(routes, /buildCostCenterSupplierPaymentTitles/);
  });

  it("filtros padrão do modal iniciam com centro de custo Todos", () => {
    const defaults = createDefaultSupplierTitleListFilters();
    assert.equal(defaults.costCenterFilter, "all");
    assert.equal(defaults.classificationStatus, "all");
  });
});

describe("FinanceSupplierTitlesModal", () => {
  it("modal usa supplier-titles e título correto", () => {
    const modal = read("src/components/finance/cost-centers/FinanceSupplierTitlesModal.tsx");
    assert.match(modal, /finance-supplier-titles-modal/);
    assert.match(modal, /Títulos do fornecedor —/);
    assert.match(modal, /supplier-titles/);
    assert.match(modal, /supplierKey/);
    assert.match(modal, /createDefaultSupplierTitleListFilters/);
    assert.match(modal, /COST_CENTER_SUPPLIER_TITLES_DATE_RULE_NOTE/);
    assert.match(modal, /finance-supplier-titles-cost-center-filter/);
    assert.match(modal, /<option value="all">Todos<\/option>/);
  });
});
