import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFinanceAccountsReceivableDashboard,
  filterFinanceArRows,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import {
  buildFinanceAccountsPayableDashboard,
  filterFinanceApRows,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";
import { buildFinanceArExportCsv } from "./financeAccountsReceivableExport.js";
import { buildFinanceApExportCsv } from "./financeAccountsPayableExport.js";
import { buildFinanceCashFlowDashboard } from "./financeCashFlowDashboard.js";
import {
  isEconomicGroupCnpj,
  isFinanceApPurchaseOrderAgenda,
  isFinanceArGhostTitle,
  isFinanceInternalGroupPerson,
  isFinanceApExcludedFromManagement,
  isIntercompanyPayable,
  isInternalGroupCompany,
  normalizeFinanceCnpj,
  normalizeFinancePersonText,
} from "./financeInternalGroupExclusions.js";
import {
  financeManagementSanitizationScopeMessage,
  FINANCE_MANAGEMENT_SANITIZATION_SCOPE,
} from "./financeFilterScope.js";

const REF = new Date(2026, 5, 9);

function arRow(overrides: Partial<FinanceArDashboardRow> = {}): FinanceArDashboardRow {
  return {
    externalId: 1,
    companyName: "KOPPETEL",
    personName: "Cliente Externo Ltda",
    personCnpj: "11.111.111/0001-11",
    description: null,
    dueDate: new Date(2026, 5, 15),
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    sourceInvoiceNumber: null,
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: new Date(),
    ...overrides,
  };
}

function apRow(overrides: Partial<FinanceApDashboardRow> = {}): FinanceApDashboardRow {
  return {
    externalId: 2,
    companyName: "KOPPETEL",
    personName: "Fornecedor Externo Ltda",
    personCnpj: "22.222.222/0001-22",
    description: "Nota fiscal serviço",
    dueDate: new Date(2026, 5, 20),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    amountPayable: 500,
    amountPaid: 0,
    balancePayable: 500,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    documentNumber: null,
    suspendPayment: false,
    nomusStatus: true,
    syncedAt: new Date(),
    ...overrides,
  };
}

describe("financeInternalGroupExclusions", () => {
  it("CNPJ Lazarios com e sem pontuação retorna interno", () => {
    assert.equal(
      isFinanceInternalGroupPerson({
        personCnpj: "72.569.510/0001-95",
        personName: "Outro",
      }),
      true
    );
    assert.equal(
      isFinanceInternalGroupPerson({ personCnpj: "72569510000195", personName: null }),
      true
    );
  });

  it("CNPJ Koppetel com e sem pontuação retorna interno", () => {
    assert.equal(
      isFinanceInternalGroupPerson({ personCnpj: "14.055.501/0001-80", personName: "X" }),
      true
    );
    assert.equal(
      isFinanceInternalGroupPerson({ personCnpj: "14055501000180", personName: null }),
      true
    );
  });

  it("CNPJ SM com e sem pontuação retorna interno", () => {
    assert.equal(
      isFinanceInternalGroupPerson({ personCnpj: "55.717.719/0001-30", personName: "X" }),
      true
    );
    assert.equal(
      isFinanceInternalGroupPerson({ personCnpj: "55717719000130", personName: null }),
      true
    );
  });

  it("nome Lazarios com variações de acento/case retorna interno", () => {
    assert.equal(
      isFinanceInternalGroupPerson({
        personName: "lazários comércio de plásticos ltda",
      }),
      true
    );
    assert.equal(isFinanceInternalGroupPerson({ personName: "LAZARIOS" }), true);
  });

  it("nome Koppetel com variações retorna interno", () => {
    assert.equal(
      isFinanceInternalGroupPerson({ personName: "Koppetel Comercio de Plasticos LTDA" }),
      true
    );
    assert.equal(isFinanceInternalGroupPerson({ personName: "koppetel" }), true);
  });

  it("nome SM completo retorna interno", () => {
    assert.equal(
      isFinanceInternalGroupPerson({
        personName: "Sm Comercio de Plasticos LTDA - SM",
      }),
      true
    );
    assert.equal(isFinanceInternalGroupPerson({ personName: "SM" }), true);
  });

  it("string genérica com letras SM não é excluída indevidamente", () => {
    assert.equal(
      isFinanceInternalGroupPerson({ personName: "OSMAR SUPRIMENTOS INDUSTRIAIS" }),
      false
    );
    assert.equal(isFinanceInternalGroupPerson({ personName: "ASMETAL COMERCIO" }), false);
  });

  it("nomeEmpresa não é usado para exclusão de contraparte", () => {
    assert.equal(
      isFinanceInternalGroupPerson({
        personName: "Cliente Mercado Ltda",
        personCnpj: "99.999.999/0001-99",
      }),
      false
    );
  });

  it("pessoa externa não é excluída", () => {
    assert.equal(
      isFinanceInternalGroupPerson({
        personName: "Distribuidora ABC",
        personCnpj: "12.345.678/0001-90",
      }),
      false
    );
  });

  it("nome vazio não quebra", () => {
    assert.equal(isFinanceInternalGroupPerson({ personName: null, personCnpj: null }), false);
    assert.equal(normalizeFinancePersonText(""), "");
    assert.equal(normalizeFinanceCnpj(""), "");
  });

  it("título fantasma AR é identificado", () => {
    assert.equal(
      isFinanceArGhostTitle({
        amountReceivable: 100,
        amountReceived: 0,
        balanceReceivable: 0,
      }),
      true
    );
    assert.equal(
      isFinanceArGhostTitle({
        amountReceivable: 100,
        amountReceived: 50,
        balanceReceivable: 50,
      }),
      false
    );
  });

  it("agenda AP de pedido de compra no início da descrição ou type 2", () => {
    assert.equal(
      isFinanceApPurchaseOrderAgenda({ description: "PEDIDO DE COMPRA 12345" }),
      true
    );
    assert.equal(
      isFinanceApPurchaseOrderAgenda({ description: "  pedido de compra ref 99" }),
      true
    );
    assert.equal(
      isFinanceApPurchaseOrderAgenda({ description: "Pedido de compra PC 7788" }),
      true
    );
    assert.equal(isFinanceApPurchaseOrderAgenda({ type: 2, description: "Outro" }), true);
    assert.equal(
      isFinanceApPurchaseOrderAgenda({ description: "NF ref pedido de compra" }),
      false
    );
  });

  it("isIntercompanyPayable exige pagador e credor do grupo", () => {
    assert.equal(
      isIntercompanyPayable({
        companyName: "KOPPETEL",
        personName: "Fornecedor Externo Ltda",
        personCnpj: "22.222.222/0001-22",
      }),
      false
    );
    assert.equal(
      isIntercompanyPayable({
        companyName: "KOPPETEL",
        personName: "Lazarios Comercio de Plasticos LTDA",
        personCnpj: "72.569.510/0001-95",
      }),
      true
    );
    assert.equal(
      isIntercompanyPayable({
        companyName: "LAZARIOS",
        personName: "Koppetel Comercio de Plasticos LTDA",
        personCnpj: "14.055.501/0001-80",
      }),
      true
    );
    assert.equal(
      isIntercompanyPayable({
        companyName: "SM",
        personName: "Lazarios Comercio de Plasticos LTDA",
        personCnpj: "72.569.510/0001-95",
      }),
      true
    );
  });

  it("fornecedor do grupo sem empresa pagadora do grupo não é excluído em AP", () => {
    assert.equal(
      isFinanceApExcludedFromManagement({
        companyName: "Empresa Externa XYZ",
        personName: "Koppetel Comercio de Plasticos LTDA",
        personCnpj: "14.055.501/0001-80",
      }),
      false
    );
  });

  it("Koppetel + fornecedor externo não é excluído", () => {
    assert.equal(
      isFinanceApExcludedFromManagement({
        companyName: "KOPPETEL",
        personName: "Distribuidora ABC",
        personCnpj: "12.345.678/0001-90",
      }),
      false
    );
  });

  it("SM pagando fornecedor externo entra", () => {
    assert.equal(
      isFinanceApExcludedFromManagement({
        companyName: "SM",
        personName: "Fornecedor Nacional Ltda",
        personCnpj: "33.333.333/0001-33",
      }),
      false
    );
    assert.equal(
      isIntercompanyPayable({
        companyName: "SM",
        personName: "Fornecedor Nacional Ltda",
        personCnpj: "33.333.333/0001-33",
      }),
      false
    );
  });

  it("Koppetel pagando Koppetel sai como intercompany", () => {
    assert.equal(
      isIntercompanyPayable({
        companyName: "KOPPETEL",
        personName: "Koppetel Comercio de Plasticos LTDA",
        personCnpj: "14.055.501/0001-80",
      }),
      true
    );
    assert.equal(
      isFinanceApExcludedFromManagement({
        companyName: "KOPPETEL",
        personName: "Koppetel Comercio de Plasticos LTDA",
        personCnpj: "14.055.501/0001-80",
      }),
      true
    );
  });

  it("Lazarios pagando Lazarios sai como intercompany", () => {
    assert.equal(
      isIntercompanyPayable({
        companyName: "LAZARIOS",
        personName: "Lazarios Comercio de Plasticos LTDA",
        personCnpj: "72.569.510/0001-95",
      }),
      true
    );
  });

  it("SM pagando SM sai como intercompany", () => {
    assert.equal(
      isIntercompanyPayable({
        companyName: "SM",
        personName: "SM Comercio de Plasticos LTDA - SM",
        personCnpj: "55.717.719/0001-30",
      }),
      true
    );
  });

  it("CNPJ do grupo com e sem pontuação em isEconomicGroupCnpj", () => {
    assert.equal(isEconomicGroupCnpj("72.569.510/0001-95"), true);
    assert.equal(isEconomicGroupCnpj("72569510000195"), true);
    assert.equal(isEconomicGroupCnpj("11.111.111/0001-11"), false);
  });

  it("isInternalGroupCompany reconhece empresas do grupo", () => {
    assert.equal(isInternalGroupCompany("KOPPETEL"), true);
    assert.equal(isInternalGroupCompany("lazários"), true);
    assert.equal(isInternalGroupCompany("SM"), true);
    assert.equal(isInternalGroupCompany("Empresa Terceira"), false);
  });

  it("não gera falso positivo por nome parcial na contraparte", () => {
    assert.equal(
      isFinanceInternalGroupPerson({ personName: "OSMAR SUPRIMENTOS INDUSTRIAIS" }),
      false
    );
    assert.equal(isIntercompanyPayable({
      companyName: "KOPPETEL",
      personName: "OSMAR SUPRIMENTOS INDUSTRIAIS",
    }), false);
  });

  it("mensagem de saneamento descreve intercompany", () => {
    assert.equal(financeManagementSanitizationScopeMessage("company"), FINANCE_MANAGEMENT_SANITIZATION_SCOPE);
    assert.equal(
      financeManagementSanitizationScopeMessage("group_consolidated"),
      FINANCE_MANAGEMENT_SANITIZATION_SCOPE
    );
    assert.ok(FINANCE_MANAGEMENT_SANITIZATION_SCOPE.includes("intercompany"));
  });
});

describe("financeDataSanitization — AR", () => {
  const filters = { status: "all" as const, year: 2026 };

  it("exclui título fantasma, grupo interno e mantém externo", () => {
    const rows = [
      arRow({ externalId: 1 }),
      arRow({
        externalId: 2,
        personName: "Koppetel Comercio de Plasticos LTDA",
        personCnpj: "14.055.501/0001-80",
        balanceReceivable: 2000,
      }),
      arRow({
        externalId: 3,
        amountReceivable: 500,
        amountReceived: 0,
        balanceReceivable: 0,
      }),
    ];
    const filtered = filterFinanceArRows(rows, filters, REF);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.externalId, 1);
  });

  it("cards e export não contam títulos excluídos", () => {
    const rows = [
      arRow({ externalId: 1, balanceReceivable: 1000 }),
      arRow({
        externalId: 2,
        personName: "Lazarios Comercio de Plasticos LTDA",
        balanceReceivable: 9000,
      }),
      arRow({
        externalId: 3,
        amountReceivable: 300,
        amountReceived: 0,
        balanceReceivable: 0,
      }),
    ];
    const dashboard = buildFinanceAccountsReceivableDashboard(rows, filters, REF);
    assert.equal(dashboard.cards.openTitlesCount, 1);
    assert.equal(dashboard.cards.totalOpenAmount, 1000);
    assert.equal(dashboard.dataSanitization.ignoredInternalGroupReceivables, 1);
    assert.equal(dashboard.dataSanitization.ignoredGhostReceivables, 1);

    const csv = buildFinanceArExportCsv(rows, filters, REF);
    const csvLines = csv.split("\n").filter((line) => line.trim().length > 0);
    assert.equal(csvLines.length, 2);
    assert.ok(csv.includes("Cliente Externo"));
    assert.ok(!csv.includes("Lazarios Comercio"));
  });
});

describe("financeDataSanitization — AP", () => {
  const filters = { status: "all" as const, year: 2026 };

  it("exclui pedido de compra e intercompany; mantém fornecedor externo", () => {
    const rows = [
      apRow({ externalId: 1 }),
      apRow({
        externalId: 2,
        description: "PEDIDO DE COMPRA 7788",
        balancePayable: 300,
      }),
      apRow({
        externalId: 3,
        personName: "SM Comercio de Plasticos LTDA - SM",
        personCnpj: "55.717.719/0001-30",
        balancePayable: 400,
      }),
    ];
    const filtered = filterFinanceApRows(rows, filters, REF);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.externalId, 1);
  });

  it("intercompany Koppetel→Lazarios é excluído independente de escopo", () => {
    const rows = [
      apRow({ externalId: 1 }),
      apRow({
        externalId: 4,
        companyName: "KOPPETEL",
        personName: "Lazarios Comercio de Plasticos LTDA",
        personCnpj: "72.569.510/0001-95",
        balancePayable: 900,
      }),
    ];
    const filtered = filterFinanceApRows(rows, filters, REF);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.externalId, 1);
    const consolidated = filterFinanceApRows(
      rows,
      { ...filters, managementScope: "group_consolidated" },
      REF
    );
    assert.equal(consolidated.length, 1);
  });

  it("cards e export não contam registros excluídos", () => {
    const rows = [
      apRow({ externalId: 1, balancePayable: 500 }),
      apRow({
        externalId: 2,
        description: "PEDIDO DE COMPRA",
        balancePayable: 800,
      }),
    ];
    const dashboard = buildFinanceAccountsPayableDashboard(rows, filters, REF);
    assert.equal(dashboard.cards.openTitlesCount, 1);
    assert.equal(dashboard.dataSanitization.ignoredPurchaseOrderAgendaPayables, 1);

    const csvLines = buildFinanceApExportCsv(rows, filters, REF)
      .split("\n")
      .filter((line) => line.trim().length > 0);
    assert.equal(csvLines.length, 2);
  });
});

describe("financeDataSanitization — Cash Flow", () => {
  const filters = {
    viewMode: "projected" as const,
    dateBase: "due" as const,
    status: "all" as const,
    year: 2026,
  };

  it("entradas/saídas saneadas e posição líquida correta", () => {
    const rowsAr = [
      arRow({ externalId: 1, balanceReceivable: 1000 }),
      arRow({
        externalId: 2,
        personName: "Koppetel Comercio de Plasticos LTDA",
        balanceReceivable: 5000,
      }),
      arRow({
        externalId: 3,
        amountReceivable: 200,
        amountReceived: 0,
        balanceReceivable: 0,
      }),
    ];
    const rowsAp = [
      apRow({ externalId: 4, balancePayable: 300 }),
      apRow({
        externalId: 5,
        description: "PEDIDO DE COMPRA 001",
        balancePayable: 700,
      }),
    ];

    const withoutSanitizationNet = 1000 - 300;
    const payload = buildFinanceCashFlowDashboard(rowsAr, rowsAp, filters, REF);
    assert.equal(payload.cards.totalReceivableOpen, 1000);
    assert.equal(payload.cards.totalPayableOpen, 300);
    assert.equal(payload.cards.netCashPosition, withoutSanitizationNet);
    assert.equal(payload.dataSanitization.ignoredInternalGroupReceivables, 1);
    assert.equal(payload.dataSanitization.ignoredGhostReceivables, 1);
    assert.equal(payload.dataSanitization.ignoredPurchaseOrderAgendaPayables, 1);
    assert.equal(payload.executiveYtd.totalReceivableOpen, 1000);
    assert.equal(Number.isFinite(payload.cards.netCashPosition), true);
  });
});
