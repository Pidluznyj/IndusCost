import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinanceArDashboardRow } from "../financeAccountsReceivableDashboard.js";
import { buildNomusArReportSyncCutoff } from "../financeNomusArReportFreshness.js";
import {
  CANONICAL_AR_BOLETO_PAYMENT_METHOD_IDS,
  CustomerSalesBlockedError,
  buildCustomerSalesBlockStatus,
  isOfficialArBoletoPaymentMethod,
  resolveCustomerFinancialIdentity,
  toPublicCustomerSalesBlock,
  uniqueNomusPersonIds,
} from "./customerSalesBlock.js";
import {
  CUSTOMER_SALES_BLOCKED_IDENTITY_HINT,
  customerSalesBlockButtonHint,
  customerSalesBlockTooltip,
  formatCustomerCadastralStatus,
} from "./customerSalesBlockView.js";

const TODAY = new Date(2026, 8, 7); // 7 set 2026
const LATEST_SYNC = new Date("2026-09-07T10:00:00.000Z");
const STALE_SYNC = new Date("2026-09-01T10:00:00.000Z");
const PERSON = 100;
const BOLETO_ID = 10;

function title(overrides: Partial<FinanceArDashboardRow> & { paymentMethodId?: number | null } = {}) {
  return {
    externalId: 1,
    companyName: "KOPPETEL",
    personId: PERSON,
    personName: "Platinum Maxxi",
    personCnpj: "11.111.111/0001-11",
    description: "Pedido 1",
    comments: null,
    dueDate: new Date(2026, 8, 6),
    competenceDate: null,
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "Boleto Bancário",
    paymentMethodId: BOLETO_ID,
    bankAccountName: null,
    sourceInvoiceId: 500,
    sourceInvoiceNumber: "NF-500",
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: LATEST_SYNC,
    sourcePresenceStatus: "PRESENT",
    ...overrides,
  };
}

/** Avalia com identidade primária do Customer + IDs dos pedidos como evidência. */
function evaluate(
  titles: ReturnType<typeof title>[],
  identity: { customer: number | null; orders?: Array<number | null | undefined> } = { customer: PERSON }
) {
  return buildCustomerSalesBlockStatus({
    identity: resolveCustomerFinancialIdentity({
      nomusExternalPersonId: identity.customer,
      salesOrderExternalCustomerIds: identity.orders ?? [],
    }),
    titles,
    today: TODAY,
    evaluatedAt: TODAY,
    syncCutoff: buildNomusArReportSyncCutoff(LATEST_SYNC),
  });
}

describe("resolveCustomerFinancialIdentity — Customer.nomusExternalPersonId é a autoridade", () => {
  it("TEST S / CASO B: nomusExternalPersonId=100 e todos os pedidos 100 → RESOLVED 100", () => {
    assert.deepEqual(
      resolveCustomerFinancialIdentity({ nomusExternalPersonId: 100, salesOrderExternalCustomerIds: [100, 100, 100] }),
      { kind: "RESOLVED", personId: 100, salesOrderPersonIds: [100] }
    );
  });

  it("CASO A: cliente SEM pedido resolve pelo ID do Customer (863 casos na homologação)", () => {
    assert.deepEqual(
      resolveCustomerFinancialIdentity({ nomusExternalPersonId: 100, salesOrderExternalCustomerIds: [] }),
      { kind: "RESOLVED", personId: 100, salesOrderPersonIds: [] }
    );
    // pedidos sem externalCustomerId não contam como divergência
    assert.equal(
      resolveCustomerFinancialIdentity({ nomusExternalPersonId: 100, salesOrderExternalCustomerIds: [null, undefined, 0] }).kind,
      "RESOLVED"
    );
  });

  it("TEST T / CASO C (CUNHA): 1389 no Customer e pedidos {1389, 61} → CONFLITO, sem escolher nem somar", () => {
    const resolution = resolveCustomerFinancialIdentity({
      nomusExternalPersonId: 1389,
      salesOrderExternalCustomerIds: [1389, 61, 1389],
    });
    assert.deepEqual(resolution, { kind: "CONFLICT", customerPersonId: 1389, salesOrderPersonIds: [61, 1389] });
    // mais frequente / primeiro / último não decidem
    assert.equal(
      resolveCustomerFinancialIdentity({ nomusExternalPersonId: 100, salesOrderExternalCustomerIds: [200] }).kind,
      "CONFLICT"
    );
  });

  it("CASO D: sem ID no Customer, um único ID de pedido NÃO vira identidade (sem regra oficial)", () => {
    assert.deepEqual(
      resolveCustomerFinancialIdentity({ nomusExternalPersonId: null, salesOrderExternalCustomerIds: [100] }),
      { kind: "MISSING", salesOrderPersonIds: [100] }
    );
  });

  it("TEST U / CASO E: sem ID no Customer e sem pedidos → MISSING", () => {
    assert.deepEqual(
      resolveCustomerFinancialIdentity({ nomusExternalPersonId: null, salesOrderExternalCustomerIds: [] }),
      { kind: "MISSING", salesOrderPersonIds: [] }
    );
    assert.equal(resolveCustomerFinancialIdentity({ nomusExternalPersonId: 0, salesOrderExternalCustomerIds: [] }).kind, "MISSING");
  });

  it("uniqueNomusPersonIds: distintos, positivos, ordenados", () => {
    assert.deepEqual(uniqueNomusPersonIds([200, 100, 100, null, 0, -1, undefined]), [100, 200]);
  });
});

describe("isOfficialArBoletoPaymentMethod — paymentMethodId=10 é a autoridade", () => {
  it("catálogo canônico contém exatamente o ID 10", () => {
    assert.deepEqual([...CANONICAL_AR_BOLETO_PAYMENT_METHOD_IDS], [10]);
  });

  it("TEST V: ID 10 com qualquer rótulo é boleto", () => {
    assert.equal(isOfficialArBoletoPaymentMethod({ paymentMethodId: 10, paymentMethodName: "qualquer label" }), true);
    assert.equal(isOfficialArBoletoPaymentMethod({ paymentMethodId: 10, paymentMethodName: "Pix" }), true);
  });

  it("TEST W: ID 13 com nome 'Boleto Bancário' NÃO é boleto", () => {
    assert.equal(isOfficialArBoletoPaymentMethod({ paymentMethodId: 13, paymentMethodName: "Boleto Bancário" }), false);
  });

  it("TEST X: ID 10 com nome null é boleto", () => {
    assert.equal(isOfficialArBoletoPaymentMethod({ paymentMethodId: 10, paymentMethodName: null }), true);
  });

  it("sem ID: nome sozinho nunca decide (regex/substring não é autoridade)", () => {
    assert.equal(isOfficialArBoletoPaymentMethod({ paymentMethodId: null, paymentMethodName: "Boleto Bancário" }), false);
    assert.equal(isOfficialArBoletoPaymentMethod({ paymentMethodName: "boleto" }), false);
    assert.equal(isOfficialArBoletoPaymentMethod({ paymentMethodId: 1, paymentMethodName: "Dinheiro" }), false);
  });
});

describe("buildCustomerSalesBlockStatus", () => {
  it("TEST A: cliente sem AR → blocked=false", () => {
    const status = evaluate([]);
    assert.equal(status.blocked, false);
    assert.equal(status.resolution, "RESOLVED");
    assert.equal(status.nomusPersonId, PERSON);
  });

  it("TEST B: boleto com vencimento futuro → blocked=false", () => {
    assert.equal(evaluate([title({ dueDate: new Date(2026, 8, 20) })]).blocked, false);
  });

  it("TEST C: boleto vencendo hoje → blocked=false", () => {
    assert.equal(evaluate([title({ dueDate: new Date(2026, 8, 7) })]).blocked, false);
  });

  it("TEST D: boleto venceu ontem com saldo > 0 → blocked=true", () => {
    const status = evaluate([title({ dueDate: new Date(2026, 8, 6), balanceReceivable: 150 })]);
    assert.equal(status.blocked, true);
    assert.equal(status.reason, "OVERDUE_BOLETO");
    assert.equal(status.overdueOpenBalance, 150);
  });

  it("TEST E: boleto vencido com balanceReceivable = 0 → blocked=false", () => {
    const status = evaluate([
      title({ balanceReceivable: 0, amountReceived: 1000, settlementDate: new Date(2026, 8, 6) }),
    ]);
    assert.equal(status.blocked, false);
  });

  it("TEST F: pagamento parcial usa o saldo canônico", () => {
    const status = evaluate([title({ amountReceivable: 10000, amountReceived: 8000, balanceReceivable: 2000 })]);
    assert.equal(status.blocked, true);
    assert.equal(status.overdueOpenBalance, 2000);
  });

  it("TEST G: título vencido que não é boleto (Pix, ID 13) → blocked=false", () => {
    assert.equal(evaluate([title({ paymentMethodId: 13, paymentMethodName: "Pix" })]).blocked, false);
  });

  it("TEST W (aplicado): vencido com ID 13 e rótulo 'Boleto Bancário' não bloqueia", () => {
    assert.equal(evaluate([title({ paymentMethodId: 13, paymentMethodName: "Boleto Bancário" })]).blocked, false);
  });

  it("TEST H: boleto vencido suspenso/inelegível → blocked=false", () => {
    assert.equal(evaluate([title({ suspendCollection: true })]).blocked, false);
  });

  it("TEST I: duplicata/previsão substituída pelo motor oficial não conta duas vezes", () => {
    const withNf = title({ externalId: 10, sourceInvoiceId: 900, sourceInvoiceNumber: "NF-900", description: "Pedido 10" });
    const preNf = title({ externalId: 11, sourceInvoiceId: null, sourceInvoiceNumber: null, description: "Pedido 10" });
    const status = evaluate([withNf, preNf]);
    assert.equal(status.blocked, true);
    assert.equal(status.overdueBoletoCount, 1);
  });

  it("TEST J: dois boletos vencidos somam quantidade e saldo", () => {
    const status = evaluate([
      title({ externalId: 1, balanceReceivable: 1000, amountReceivable: 1000 }),
      title({ externalId: 2, balanceReceivable: 2500, amountReceivable: 2500, dueDate: new Date(2026, 8, 1) }),
    ]);
    assert.equal(status.blocked, true);
    assert.equal(status.overdueBoletoCount, 2);
    assert.equal(status.overdueOpenBalance, 3500);
    assert.equal(status.oldestDueDate, "2026-09-01");
    assert.equal(status.maxDaysOverdue, 6);
  });

  it("TEST K: após quitação o bloqueio some", () => {
    assert.equal(evaluate([title({ balanceReceivable: 2000 })]).blocked, true);
    assert.equal(
      evaluate([title({ balanceReceivable: 0, amountReceived: 2000, settlementDate: new Date(2026, 8, 7) })]).blocked,
      false
    );
  });

  it("TEST N/O: AR de outro personId nunca bloqueia", () => {
    const status = evaluate([title({ personId: 999 })]);
    assert.equal(status.blocked, false);
    assert.equal(status.nomusPersonId, PERSON);
  });

  it("TEST P: título stale segundo o motor oficial não bloqueia", () => {
    assert.equal(evaluate([title({ syncedAt: STALE_SYNC, sourcePresenceStatus: "PRESENT" })]).blocked, false);
  });

  it("vencido sem NF (inelegível gerencial) não bloqueia", () => {
    assert.equal(evaluate([title({ sourceInvoiceId: null, sourceInvoiceNumber: null })]).blocked, false);
  });

  it("vencidos sem forma de pagamento informada: UNRESOLVED_PAYMENT_METHOD, não bloqueia", () => {
    const status = evaluate([title({ paymentMethodId: null, paymentMethodName: null })]);
    assert.equal(status.blocked, false);
    assert.equal(status.resolution, "UNRESOLVED_PAYMENT_METHOD");
  });
});

describe("cliente sem pedido (identidade só pelo Customer)", () => {
  it("TEST Q: nomusExternalPersonId=100, sem SalesOrder, AR sem vencido → AVAILABLE", () => {
    const status = evaluate([title({ dueDate: new Date(2026, 8, 30) })], { customer: 100, orders: [] });
    assert.equal(status.blocked, false);
    assert.equal(status.reason, null);
    assert.equal(status.resolution, "RESOLVED");
    assert.equal(status.nomusPersonId, 100);
  });

  it("TEST R: nomusExternalPersonId=100, sem SalesOrder, boleto ID 10 vencido → BLOCKED_OVERDUE_BOLETO", () => {
    const status = evaluate([title()], { customer: 100, orders: [] });
    assert.equal(status.blocked, true);
    assert.equal(status.reason, "OVERDUE_BOLETO");
    assert.equal(status.resolution, "RESOLVED");
  });
});

describe("identidade não validável → fail closed sem afirmar dívida", () => {
  it("TEST T (CUNHA): Customer 1389, pedidos {1389, 61}, AR só em 1389 → bloqueia por identidade, não por boleto", () => {
    const status = evaluate([title({ personId: 1389 })], { customer: 1389, orders: [1389, 61] });
    assert.equal(status.blocked, true);
    assert.equal(status.reason, "FINANCIAL_IDENTITY_UNRESOLVED");
    assert.equal(status.resolution, "UNRESOLVED_IDENTITY_CONFLICT");
    assert.equal(status.nomusPersonId, null);
    assert.equal(status.overdueBoletoCount, 0);
    assert.equal(status.overdueOpenBalance, 0);
  });

  it("CUNHA sem dívida em 1389 continua bloqueado: não se declara situação regular consultando só um ID", () => {
    const status = evaluate([], { customer: 1389, orders: [1389, 61] });
    assert.equal(status.blocked, true);
    assert.equal(status.reason, "FINANCIAL_IDENTITY_UNRESOLVED");
  });

  it("TEST U: sem nomusExternalPersonId e sem pedidos → FINANCIAL_IDENTITY_UNRESOLVED", () => {
    const status = evaluate([title()], { customer: null, orders: [] });
    assert.equal(status.blocked, true);
    assert.equal(status.reason, "FINANCIAL_IDENTITY_UNRESOLVED");
    assert.equal(status.resolution, "UNRESOLVED_IDENTITY");
    assert.equal(status.nomusPersonId, null);
  });

  it("TEST Z: UNRESOLVED nunca produz mensagem de boleto vencido, com ou sem permissão", () => {
    const status = evaluate([], { customer: null, orders: [] });
    for (const includeFinancial of [false, true]) {
      const publicBlock = toPublicCustomerSalesBlock(status, includeFinancial);
      const tip = customerSalesBlockTooltip(publicBlock, includeFinancial);
      assert.equal(tip, CUSTOMER_SALES_BLOCKED_IDENTITY_HINT);
      assert.doesNotMatch(tip, /boleto/i);
      assert.doesNotMatch(customerSalesBlockButtonHint(publicBlock) ?? "", /boleto/i);
    }
    const error = new CustomerSalesBlockedError("FINANCIAL_IDENTITY_UNRESOLVED");
    assert.equal(error.code, "CUSTOMER_SALES_BLOCKED_FINANCIAL_IDENTITY_UNRESOLVED");
    assert.equal(error.httpStatus, 409);
    assert.doesNotMatch(error.message, /boleto/i);
    assert.match(error.message, /identidade financeira/);
  });
});

describe("casos reais da homologação (fixtures equivalentes)", () => {
  const marretaTitle = (externalId: number, dueDate: Date) =>
    title({
      externalId,
      personId: 1341,
      companyName: "CONSTRUTORA MARRETA LTDA",
      personName: "CONSTRUTORA MARRETA LTDA",
      personCnpj: "64.577.757/0001-25",
      dueDate,
      paymentMethodId: 10,
      paymentMethodName: "Boleto Bancário",
      amountReceivable: 3280,
      amountReceived: 0,
      balanceReceivable: 3280,
      sourceInvoiceId: 15000 + externalId,
      sourceInvoiceNumber: `NF-${externalId}`,
      description: `Título ${externalId}`,
    });

  it("MARRETA (1341): dois boletos vencidos de R$ 3.280 → BLOCKED_OVERDUE_BOLETO com R$ 6.560", () => {
    const status = evaluate(
      [marretaTitle(15206, new Date(2026, 4, 6)), marretaTitle(15207, new Date(2026, 4, 13))],
      { customer: 1341, orders: [1341, 1341] }
    );
    assert.equal(status.blocked, true);
    assert.equal(status.reason, "OVERDUE_BOLETO");
    assert.equal(status.overdueBoletoCount, 2);
    assert.equal(status.overdueOpenBalance, 6560);
    assert.equal(status.oldestDueDate, "2026-05-06");
  });

  it("TEST Y: outro 'CONSTRUTORA MARRETA LTDA' (791) não herda a dívida do 1341 — nome nunca cruza AR", () => {
    const debtOf1341 = [marretaTitle(15206, new Date(2026, 4, 6)), marretaTitle(15207, new Date(2026, 4, 13))];
    const own791 = title({
      externalId: 20001,
      personId: 791,
      companyName: "CONSTRUTORA MARRETA LTDA",
      personName: "CONSTRUTORA MARRETA LTDA",
      personCnpj: "50.798.391/0001-00",
      dueDate: new Date(2026, 9, 15),
    });
    const status = evaluate([...debtOf1341, own791], { customer: 791, orders: [791] });
    assert.equal(status.blocked, false);
    assert.equal(status.resolution, "RESOLVED");
    assert.equal(status.nomusPersonId, 791);
  });
});

describe("toPublicCustomerSalesBlock / tooltip", () => {
  it("omite valores financeiros sem permissão AR", () => {
    const status = evaluate([title({ balanceReceivable: 18450, amountReceivable: 18450 })]);
    const publicBlock = toPublicCustomerSalesBlock(status, false);
    assert.equal(publicBlock.blocked, true);
    assert.equal(publicBlock.reason, "OVERDUE_BOLETO");
    assert.equal(publicBlock.overdueOpenBalance, undefined);
    assert.equal(publicBlock.nomusPersonId, undefined);
    assert.equal(customerSalesBlockTooltip(publicBlock, false), "Venda bloqueada: o cliente possui boleto(s) vencido(s).");
  });

  it("com permissão AR explica quantidade, saldo e data", () => {
    const status = evaluate([title({ balanceReceivable: 18450, amountReceivable: 18450 })]);
    const publicBlock = toPublicCustomerSalesBlock(status, true);
    const tip = customerSalesBlockTooltip(publicBlock, true);
    assert.match(tip, /1 boleto vencido/);
    assert.match(tip, /18\.450,00/);
    assert.match(tip, /06\/09\/2026/);
  });

  it("erro de boleto vencido mantém código e mensagem originais", () => {
    const error = new CustomerSalesBlockedError();
    assert.equal(error.code, "CUSTOMER_SALES_BLOCKED_OVERDUE_BOLETO");
    assert.equal(error.reason, "OVERDUE_BOLETO");
    assert.equal(error.message, "Venda bloqueada. O cliente possui boleto(s) vencido(s) em aberto.");
  });

  it("status cadastral permanece separado da trava financeira", () => {
    assert.equal(formatCustomerCadastralStatus("ACTIVE"), "Ativo");
    assert.equal(formatCustomerCadastralStatus("INACTIVE"), "Inativo");
    assert.equal(formatCustomerCadastralStatus("BLOCKED"), "Bloqueado");
  });
});
