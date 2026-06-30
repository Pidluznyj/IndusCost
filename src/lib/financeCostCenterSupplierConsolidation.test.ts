import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  buildCostCenterConsolidatedSuppliers,
  COST_CENTER_UNIDENTIFIED_SUPPLIER_LABEL,
  resolveCostCenterSupplierConsolidationKey,
  resolveCostCenterSupplierDisplay,
} from "./financeCostCenterSupplierConsolidation.js";
import type { FinanceApDashboardRow } from "./financeAccountsPayableDashboard.js";
import type { SupplierWithAliases } from "./financeSupplierCostCenterRules.js";

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

describe("financeCostCenterSupplierConsolidation", () => {
  it("inclui fornecedor sem alocação com valor integral do título", () => {
    const rows = [apRow({ externalId: 1, balancePayable: 500, amountPayable: 500 })];
    const map = buildCostCenterConsolidatedSuppliers(
      rows,
      new Map(),
      [supplierActive()],
      { status: "all" },
      "all_in_filter"
    );
    assert.equal(map.size, 1);
    const row = [...map.values()][0]!;
    assert.equal(row.supplierId, "sup-1");
    assert.equal(row.amount, 500);
    assert.equal(row.titleIds.size, 1);
  });

  it("inclui fornecedor com alocação parcial somando valor integral", () => {
    const rows = [apRow({ externalId: 2, balancePayable: 1000 })];
    const allocations = new Map([
      [
        2,
        [
          {
            id: "a1",
            accountsPayableId: 2,
            supplierId: "sup-1",
            costCenterId: "cc-1",
            amount: new Prisma.Decimal(600),
            percentage: new Prisma.Decimal(60),
          },
        ],
      ],
    ]);
    const map = buildCostCenterConsolidatedSuppliers(
      rows,
      allocations,
      [supplierActive()],
      { status: "all" },
      "all_in_filter"
    );
    assert.equal(map.size, 1);
    assert.equal([...map.values()][0]!.amount, 1000);
  });

  it("inclui fornecedor sem documento e sem cadastro financeiro", () => {
    const rows = [
      apRow({
        externalId: 3,
        personName: "Prestador Avulso",
        personCnpj: null,
        balancePayable: 250,
        amountPayable: 250,
      }),
    ];
    const map = buildCostCenterConsolidatedSuppliers(
      rows,
      new Map(),
      [],
      { status: "all" },
      "all_in_filter"
    );
    assert.equal(map.size, 1);
    const row = [...map.values()][0]!;
    assert.equal(row.supplierId, null);
    assert.equal(row.name, "Prestador Avulso");
    assert.equal(row.document, null);
    assert.equal(row.amount, 250);
  });

  it("usa label de fornecedor não identificado quando nome está vazio", () => {
    const rows = [apRow({ externalId: 4, personName: null, personCnpj: null, balancePayable: 100 })];
    const display = resolveCostCenterSupplierDisplay(rows[0]!, null);
    assert.equal(display.name, COST_CENTER_UNIDENTIFIED_SUPPLIER_LABEL);
    const key = resolveCostCenterSupplierConsolidationKey(rows[0]!, null);
    assert.match(key, /^ap-fallback:4$/);
  });

  it("filtro Sem regra não exclui fornecedor sem cadastro financeiro", () => {
    const rows = [
      apRow({ externalId: 5, personName: "Sem Regra Ltda", balancePayable: 300 }),
    ];
    const map = buildCostCenterConsolidatedSuppliers(
      rows,
      new Map(),
      [],
      { status: "all", classification: "all" },
      "all_in_filter"
    );
    assert.equal(map.size, 1);
  });
});
