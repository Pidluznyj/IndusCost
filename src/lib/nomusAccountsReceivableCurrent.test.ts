import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterFinanceArManagementReportRows,
  filterFinanceArRows,
} from "./financeAccountsReceivableManagement.js";
import type { FinanceArDashboardRow } from "./financeAccountsReceivableDashboard.js";
import { filterCashFlowArPortfolioRows } from "./financeCashFlowRowFilters.js";
import type { FinanceCashFlowArRow } from "./financeCashFlowDashboard.js";
import {
  auditNomusAccountsReceivableCurrentState,
  consolidateFinanceArReceivableRows,
  excludeObsoleteOrderParcelArRows,
  isArTitleProtectedFromObsolescence,
  parseOrderParcelFromArDescription,
  resolveOrderParcelReceivableGroups,
} from "./nomusAccountsReceivableCurrent.js";

function arRow(overrides: Partial<FinanceArDashboardRow> = {}): FinanceArDashboardRow {
  return {
    externalId: 1,
    companyId: 1,
    companyName: "KOPPETEL",
    personId: 100,
    personName: "Britania Eletrodomesticos SA",
    personCnpj: null,
    description: "Pedido PD 02719 - Parcela 1 de 1",
    comments: null,
    dueDate: new Date(2026, 8, 10),
    competenceDate: null,
    settlementDate: null,
    amountReceivable: 349_590,
    amountReceived: 0,
    balanceReceivable: 349_590,
    paymentMethodName: "Depósito",
    bankAccountName: null,
    sourceInvoiceId: null,
    sourceInvoiceNumber: null,
    suspendCollection: false,
    nomusStatus: true,
    createdAtNomus: new Date(2026, 6, 8, 17, 27, 40),
    modifiedAtNomus: new Date(2026, 6, 8, 17, 27, 40),
    syncedAt: new Date(2026, 6, 8, 18, 0, 0),
    ...overrides,
  };
}

function pd02719Fixture(): FinanceArDashboardRow[] {
  return [
    arRow({
      externalId: 17_509,
      amountReceivable: 164_940,
      balanceReceivable: 164_940,
      dueDate: new Date(2026, 8, 30),
      createdAtNomus: new Date(2026, 5, 30, 19, 52, 8),
      modifiedAtNomus: new Date(2026, 5, 30, 19, 57, 22),
      syncedAt: new Date(2026, 5, 30, 20, 0, 0),
    }),
    arRow({
      externalId: 17_749,
      amountReceivable: 513_390,
      balanceReceivable: 513_390,
      dueDate: new Date(2026, 8, 10),
      createdAtNomus: new Date(2026, 6, 8, 16, 39, 9),
      modifiedAtNomus: new Date(2026, 6, 8, 16, 40, 35),
      syncedAt: new Date(2026, 6, 8, 17, 0, 0),
    }),
    arRow({
      externalId: 17_761,
      amountReceivable: 349_590,
      balanceReceivable: 349_590,
      dueDate: new Date(2026, 8, 10),
      createdAtNomus: new Date(2026, 6, 8, 17, 27, 40),
      modifiedAtNomus: new Date(2026, 6, 8, 17, 27, 40),
      syncedAt: new Date(2026, 6, 8, 18, 0, 0),
    }),
  ];
}

describe("nomusAccountsReceivableCurrent", () => {
  it("parseOrderParcelFromArDescription lê parcela N de M", () => {
    const parsed = parseOrderParcelFromArDescription("Pedido PD 02719 - Parcela 1 de 1");
    assert.equal(parsed?.orderCode, "PD 02719");
    assert.equal(parsed?.installmentNumber, 1);
    assert.equal(parsed?.totalInstallments, 1);
  });

  it("pedido com apenas um título entra normalmente", () => {
    const rows = [arRow({ externalId: 99 })];
    const result = excludeObsoleteOrderParcelArRows(rows);
    assert.equal(result.rows.length, 1);
    assert.equal(result.obsoleteCount, 0);
  });

  it("PD 02719 simulado: vigente 349590, obsoletos 17509 e 17749", () => {
    const rows = pd02719Fixture();
    const result = excludeObsoleteOrderParcelArRows(rows);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0]!.externalId, 17_761);
    assert.equal(result.rows[0]!.amountReceivable, 349_590);
    assert.equal(result.obsoleteCount, 2);
    assert.equal(result.obsoleteAmount, 164_940 + 513_390);

    const audit = auditNomusAccountsReceivableCurrentState(rows);
    assert.equal(audit.grossAmount, 164_940 + 513_390 + 349_590);
    assert.equal(audit.currentAmount, 349_590);
    assert.equal(audit.impactDelta, 164_940 + 513_390);
    assert.equal(audit.groups[0]!.currentExternalId, 17_761);
    assert.deepEqual(audit.groups[0]!.obsoleteExternalIds.sort(), [17_509, 17_749]);
  });

  it("título antigo com amountReceived > 0 não é descartado e gera conflito", () => {
    const rows = [
      arRow({
        externalId: 1,
        amountReceivable: 100_000,
        balanceReceivable: 50_000,
        amountReceived: 50_000,
        createdAtNomus: new Date(2026, 0, 1),
        modifiedAtNomus: new Date(2026, 0, 1),
      }),
      arRow({
        externalId: 2,
        amountReceivable: 80_000,
        balanceReceivable: 80_000,
        createdAtNomus: new Date(2026, 1, 1),
        modifiedAtNomus: new Date(2026, 1, 1),
      }),
    ];
    const result = excludeObsoleteOrderParcelArRows(rows);
    assert.equal(result.rows.length, 2);
    assert.equal(result.conflicts.length, 1);
    assert.ok(isArTitleProtectedFromObsolescence(rows[0]!));
  });

  it("título com settlementDate não é descartado automaticamente", () => {
    const rows = [
      arRow({
        externalId: 1,
        settlementDate: new Date(2026, 5, 1),
        createdAtNomus: new Date(2026, 0, 1),
        modifiedAtNomus: new Date(2026, 0, 1),
      }),
      arRow({
        externalId: 2,
        createdAtNomus: new Date(2026, 1, 1),
        modifiedAtNomus: new Date(2026, 1, 1),
      }),
    ];
    const result = excludeObsoleteOrderParcelArRows(rows);
    assert.equal(result.rows.length, 2);
    assert.equal(result.conflicts[0]!.protectionReasons.includes("settlementDate"), true);
  });

  it("título com sourceInvoiceId não entra na regra de obsolescência de pedido", () => {
    const rows = [
      arRow({ externalId: 1, sourceInvoiceId: 999, sourceInvoiceNumber: "NF-1" }),
      arRow({ externalId: 2 }),
    ];
    const resolution = resolveOrderParcelReceivableGroups(rows);
    assert.equal(resolution.obsoleteExternalIds.size, 0);
    assert.equal(resolution.keptExternalIds.size, 2);
  });

  it("parcelas diferentes não são colapsadas", () => {
    const rows = [
      arRow({
        externalId: 1,
        description: "Pedido PD 02719 - Parcela 1 de 2",
        amountReceivable: 100_000,
        balanceReceivable: 100_000,
      }),
      arRow({
        externalId: 2,
        description: "Pedido PD 02719 - Parcela 2 de 2",
        amountReceivable: 200_000,
        balanceReceivable: 200_000,
      }),
    ];
    const result = excludeObsoleteOrderParcelArRows(rows);
    assert.equal(result.rows.length, 2);
    assert.equal(result.obsoleteCount, 0);
  });

  it("Fluxo de Caixa usa apenas AR vigente", () => {
    const rows = pd02719Fixture() as FinanceCashFlowArRow[];
    const filtered = filterCashFlowArPortfolioRows(
      rows,
      { viewMode: "projected", year: 2026, month: 9, dateBase: "dueDate" },
      { status: "all" },
      new Date(2026, 6, 8)
    );
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.externalId, 17_761);
  });

  it("Contas a Receber grid e cards usam apenas AR vigente", () => {
    const rows = pd02719Fixture();
    const filtered = filterFinanceArRows(rows, { status: "all" }, new Date(2026, 6, 8));
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.externalId, 17_761);

    const managed = filterFinanceArManagementReportRows(
      rows,
      { status: "all" },
      new Date(2026, 6, 8)
    );
    assert.equal(managed.length, 1);
  });

  it("consolidateFinanceArReceivableRows combina dedup pré-NF e obsoletos", () => {
    const withoutNf = arRow({
      externalId: 10,
      sourceInvoiceId: null,
      balanceReceivable: 5_000,
      description: "NF pendente",
      dueDate: new Date(2026, 3, 10),
    });
    const withNf = arRow({
      externalId: 11,
      sourceInvoiceId: 99,
      sourceInvoiceNumber: "NF-99",
      balanceReceivable: 5_000,
      description: "NF emitida",
      dueDate: new Date(2026, 3, 10),
    });
    const consolidated = consolidateFinanceArReceivableRows([withoutNf, withNf]);
    assert.equal(consolidated.rows.length, 1);
    assert.equal(consolidated.supersededPreInvoiceCount, 1);
  });
});
