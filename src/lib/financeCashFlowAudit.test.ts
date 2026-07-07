import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isFinanceArOverdueRow } from "./financeAccountsReceivableOverdue.js";
import {
  buildFinanceCashFlowAuditPayload,
  buildFinanceCashFlowDataset,
  isFinanceCashFlowApOverdueRow,
  isFinanceCashFlowArOverdueRow,
} from "./financeCashFlowDataset.js";
import {
  buildFinanceCashFlowDashboard,
  type FinanceCashFlowApRow,
  type FinanceCashFlowArRow,
} from "./financeCashFlowDashboard.js";
import { buildNomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";
import { buildNomusApReportSyncCutoff } from "./financeNomusApReportFreshness.js";

const LATEST_SYNC = new Date("2026-06-17T10:00:00.000Z");
const STALE_SYNC = new Date("2026-06-12T10:00:00.000Z");
const REF = new Date(2026, 5, 17);

function arCutoff() {
  return buildNomusArReportSyncCutoff(LATEST_SYNC)!;
}

function apCutoff() {
  return buildNomusApReportSyncCutoff(LATEST_SYNC)!;
}

function arRow(overrides: Partial<FinanceCashFlowArRow> = {}): FinanceCashFlowArRow {
  return {
    externalId: 1,
    companyName: "KOPPETEL",
    personName: "Cliente Alpha",
    personCnpj: "11.111.111/0001-11",
    description: "Pedido",
    dueDate: new Date(2026, 5, 10),
    settlementDate: null,
    competenceDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "Boleto",
    bankAccountName: null,
    sourceInvoiceId: 500,
    sourceInvoiceNumber: "NF-500",
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: LATEST_SYNC,
    ...overrides,
  };
}

function apRow(overrides: Partial<FinanceCashFlowApRow> = {}): FinanceCashFlowApRow {
  return {
    externalId: 1,
    companyName: "KOPPETEL",
    personName: "Fornecedor Externo",
    personCnpj: "22.222.222/0001-22",
    description: "NF serviço",
    dueDate: new Date(2026, 5, 12),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    competenceDate: null,
    amountPayable: 500,
    amountPaid: 0,
    balancePayable: 500,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    documentNumber: "DOC-1",
    suspendPayment: false,
    nomusStatus: true,
    syncedAt: LATEST_SYNC,
    ...overrides,
  };
}

function mexichemReceived(): FinanceCashFlowArRow {
  return arRow({
    externalId: 98001,
    personName: "Mexichem Brasil Indústria de Transformação Plástica Ltda",
    personCnpj: "33.081.704/0001-00",
    dueDate: new Date(2026, 2, 15),
    amountReceivable: 98000,
    amountReceived: 98000,
    balanceReceivable: 0,
    settlementDate: new Date(2026, 5, 10),
    syncedAt: LATEST_SYNC,
  });
}

function mexichemOpen(): FinanceCashFlowArRow {
  return arRow({
    externalId: 98002,
    personName: "Mexichem Brasil Indústria de Transformação Plástica Ltda",
    personCnpj: "33.081.704/0001-00",
    dueDate: new Date(2026, 2, 15),
    amountReceivable: 98000,
    amountReceived: 0,
    balanceReceivable: 98000,
    settlementDate: null,
    syncedAt: LATEST_SYNC,
  });
}

const BASE_FILTERS = {
  viewMode: "projected" as const,
  dateBase: "due" as const,
  status: "all" as const,
  year: 2026,
};

function buildDataset(rows: { ar?: FinanceCashFlowArRow[]; ap?: FinanceCashFlowApRow[] }) {
  return buildFinanceCashFlowDataset(
    rows.ar ?? [],
    rows.ap ?? [],
    BASE_FILTERS,
    { status: "all", year: 2026 },
    { status: "all", year: 2026, managementScope: "company" },
    REF,
    arCutoff(),
    apCutoff()
  );
}

function assertMexichemAbsent(payload: ReturnType<typeof buildFinanceCashFlowDashboard>) {
  const names = [
    ...payload.overdueReceivables.map((r) => r.personName ?? ""),
    ...payload.largestProjectedInflows.map((r) => r.personName ?? ""),
    ...payload.topCustomers.map((r) => r.personName ?? ""),
  ]
    .join("|")
    .toUpperCase();
  assert.ok(!names.includes("MEXICHEM"));
  assert.ok(!payload.overdueReceivables.some((r) => r.amount === 98000));
  assert.ok(!payload.largestProjectedInflows.some((r) => r.amount === 98000));
}

describe("financeCashFlowAudit", () => {
  it("Vencidos a receber usa a mesma regra do AR overdue", () => {
    const row = arRow({ externalId: 42, dueDate: new Date(2026, 5, 1), balanceReceivable: 750 });
    const dataset = buildDataset({ ar: [row] });
    assert.equal(isFinanceCashFlowArOverdueRow(row, REF), isFinanceArOverdueRow(row, REF));
    assert.equal(dataset.blocks.overdueReceivables.length, 1);
    assert.equal(dataset.blocks.overdueReceivables[0]!.externalId, 42);
  });

  it("título recebido com balanceReceivable = 0 não aparece em Vencidos a receber", () => {
    const row = arRow({
      balanceReceivable: 0,
      amountReceived: 1000,
      settlementDate: new Date(2026, 5, 12),
      dueDate: new Date(2026, 4, 1),
    });
    const dataset = buildDataset({ ar: [row] });
    assert.equal(dataset.blocks.overdueReceivables.length, 0);
    assert.equal(dataset.blocks.largestExpectedInflows.length, 0);
  });

  it("título recebido não aparece em Maiores entradas previstas", () => {
    const payload = buildFinanceCashFlowDashboard(
      [
        arRow({
          balanceReceivable: 0,
          amountReceived: 5000,
          settlementDate: new Date(2026, 5, 1),
          dueDate: new Date(2026, 5, 20),
        }),
      ],
      [],
      BASE_FILTERS,
      REF,
      arCutoff(),
      apCutoff()
    );
    assert.equal(payload.largestProjectedInflows.length, 0);
  });

  it("título recebido não entra em Top clientes por entrada", () => {
    const payload = buildFinanceCashFlowDashboard(
      [mexichemReceived(), arRow({ externalId: 2, personName: "Outro", balanceReceivable: 100 })],
      [],
      BASE_FILTERS,
      REF,
      arCutoff(),
      apCutoff()
    );
    assertMexichemAbsent(payload);
    assert.ok(payload.topCustomers.every((c) => !c.personName?.toUpperCase().includes("MEXICHEM")));
  });

  it("fixture Mexichem R$ 98k recebido não aparece em nenhum bloco do Fluxo de Caixa", () => {
    const payload = buildFinanceCashFlowDashboard(
      [mexichemReceived()],
      [],
      BASE_FILTERS,
      REF,
      arCutoff(),
      apCutoff()
    );
    assertMexichemAbsent(payload);
    const audit = buildFinanceCashFlowAuditPayload(
      buildDataset({ ar: [mexichemReceived()] }),
      1,
      0,
      [mexichemReceived()],
      []
    );
    assert.equal(audit.traces.overdueReceivables.length, 0);
    assert.equal(audit.traces.largestExpectedInflows.length, 0);
    assert.equal(audit.traces.topReceivableCustomers.length, 0);
  });

  it("vencido aberto sem NF não entra em Vencidos a receber do Fluxo", () => {
    const rows = [
      arRow({
        externalId: 77001,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        balanceReceivable: 18270,
        dueDate: new Date(2026, 2, 10),
      }),
      arRow({
        externalId: 77002,
        sourceInvoiceId: 900,
        sourceInvoiceNumber: "NF-900",
        balanceReceivable: 500,
        dueDate: new Date(2026, 2, 10),
      }),
    ];
    const payload = buildFinanceCashFlowDashboard(rows, [apRow()], BASE_FILTERS, REF, arCutoff());
    assert.equal(payload.overdueReceivables.length, 1);
    assert.equal(payload.overdueReceivables[0]!.externalId, 77002);
    const dataset = buildDataset({ ar: rows });
    assert.equal(dataset.blocks.overdueReceivables.length, 1);
    assert.equal(dataset.blocks.overdueReceivables[0]!.externalId, 77002);
  });

  it("fixture Mexichem R$ 98k aberto aparece nos blocos aplicáveis", () => {
    const payload = buildFinanceCashFlowDashboard(
      [mexichemOpen()],
      [],
      BASE_FILTERS,
      REF,
      arCutoff(),
      apCutoff()
    );
    assert.equal(payload.overdueReceivables.length, 1);
    assert.equal(payload.overdueReceivables[0]!.amount, 98000);
    assert.equal(payload.largestProjectedInflows[0]!.amount, 98000);
    assert.equal(payload.topCustomers[0]!.amount, 98000);
  });

  it("Pagamentos vencidos respeitam vencimento AP", () => {
    const row = apRow({
      externalId: 100,
      dueDate: new Date(2026, 4, 10),
      scheduleDate: new Date(2026, 6, 20),
      balancePayable: 900,
    });
    const dataset = buildDataset({ ap: [row] });
    assert.equal(isFinanceCashFlowApOverdueRow(row, REF), true);
    assert.equal(dataset.blocks.overduePayables.length, 1);
  });

  it("AP stale não aparece em nenhum bloco", () => {
    const row = apRow({
      externalId: 200,
      balancePayable: 5000,
      syncedAt: STALE_SYNC,
      dueDate: new Date(2026, 4, 1),
    });
    const dataset = buildDataset({ ap: [row] });
    assert.equal(dataset.blocks.overduePayables.length, 0);
    assert.equal(dataset.blocks.largestExpectedOutflows.length, 0);
    assert.equal(dataset.blocks.topPayableSuppliers.length, 0);
  });

  it("AR stale não aparece em nenhum bloco do Fluxo de Caixa", () => {
    const stale = arRow({
      externalId: 18001,
      personName: "ENERGY INDUSTRIAL LTDA",
      balanceReceivable: 18000,
      dueDate: new Date(2026, 2, 10),
      syncedAt: STALE_SYNC,
    });
    const fresh = arRow({
      externalId: 18002,
      personName: "Cliente Fresh",
      balanceReceivable: 500,
      dueDate: new Date(2026, 5, 1),
      syncedAt: LATEST_SYNC,
    });
    const payload = buildFinanceCashFlowDashboard(
      [stale, fresh],
      [],
      BASE_FILTERS,
      REF,
      arCutoff(),
      apCutoff()
    );
    assert.equal(payload.overdueReceivables.length, 1);
    assert.equal(payload.overdueReceivables[0]!.externalId, 18002);
    assert.ok(!payload.largestProjectedInflows.some((r) => r.externalId === 18001));
    assert.ok(!payload.topCustomers.some((r) => (r.personName ?? "").toUpperCase().includes("ENERGY")));
    const dataset = buildDataset({ ar: [stale, fresh] });
    assert.equal(dataset.blocks.overdueReceivables.length, 1);
    assert.equal(dataset.blocks.overdueReceivables[0]!.externalId, 18002);
  });

  it("totais dos blocos batem com a soma das linhas exibidas", () => {
    const rows = [
      arRow({ externalId: 1, balanceReceivable: 1200, dueDate: new Date(2026, 5, 1) }),
      arRow({ externalId: 2, balanceReceivable: 800, dueDate: new Date(2026, 4, 20) }),
    ];
    const dataset = buildDataset({ ar: rows });
    const overdueSum = dataset.blocks.overdueReceivables.reduce((s, r) => s + r.amount, 0);
    assert.equal(dataset.blocks.overdueReceivableAmount, overdueSum);
    const inflowSum = dataset.blocks.largestExpectedInflows.reduce((s, r) => s + r.amount, 0);
    assert.ok(inflowSum >= overdueSum);
  });

  it("audit endpoint payload expõe traces por bloco e exclusões", () => {
    const stale = arRow({
      externalId: 99,
      balanceReceivable: 5000,
      syncedAt: STALE_SYNC,
      dueDate: new Date(2026, 2, 10),
    });
    const overdueNoNf = arRow({
      externalId: 88,
      sourceInvoiceId: null,
      sourceInvoiceNumber: null,
      balanceReceivable: 18270,
      dueDate: new Date(2026, 2, 10),
    });
    const rawAr = [
      arRow({ externalId: 55, balanceReceivable: 300, dueDate: new Date(2026, 5, 1) }),
      stale,
      overdueNoNf,
    ];
    const dataset = buildDataset({ ar: rawAr });
    const audit = buildFinanceCashFlowAuditPayload(dataset, rawAr.length, 0, rawAr, []);
    assert.equal(audit.traces.overdueReceivables.length, 1);
    assert.equal(audit.traces.overdueReceivables[0]!.externalId, 55);
    assert.ok(audit.traces.overdueReceivables[0]!.usedInBlocks.includes("overdueReceivables"));
    assert.ok(audit.counts.arPortfolio >= 1);
    assert.ok(audit.exclusions.arStale >= 1);
    assert.ok(audit.exclusions.arOverdueWithoutFiscalDocument >= 1);
  });

  it("ranking por cliente bate com a mesma base das entradas previstas", () => {
    const rows = [
      arRow({ externalId: 1, personName: "Cliente A", balanceReceivable: 500, dueDate: new Date(2026, 5, 5) }),
      arRow({ externalId: 2, personName: "Cliente A", balanceReceivable: 300, dueDate: new Date(2026, 5, 3) }),
    ];
    const dataset = buildDataset({ ar: rows });
    const topTotal = dataset.blocks.topReceivableCustomers.reduce((s, r) => s + r.amount, 0);
    const inflowTotal = dataset.blocks.largestExpectedInflows.reduce((s, r) => s + r.amount, 0);
    assert.equal(topTotal, 800);
    assert.equal(inflowTotal, 800);
  });
});
