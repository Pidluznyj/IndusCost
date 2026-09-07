import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinanceArDashboardRow } from "../financeAccountsReceivableDashboard.js";
import { buildNomusArReportSyncCutoff } from "../financeNomusArReportFreshness.js";
import {
  buildCustomerSalesBlockStatus,
  isOfficialArBoletoPaymentMethod,
  resolveUniqueNomusPersonId,
  toPublicCustomerSalesBlock,
} from "./customerSalesBlock.js";
import {
  customerSalesBlockTooltip,
  formatCustomerCadastralStatus,
} from "./customerSalesBlockView.js";

const TODAY = new Date(2026, 8, 7); // 7 set 2026
const LATEST_SYNC = new Date("2026-09-07T10:00:00.000Z");
const STALE_SYNC = new Date("2026-09-01T10:00:00.000Z");
const PERSON = 100;

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
    paymentMethodName: "Boleto",
    paymentMethodId: null,
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

function evaluate(
  titles: ReturnType<typeof title>[],
  ids: Array<number | null | undefined> = [PERSON]
) {
  return buildCustomerSalesBlockStatus({
    personResolution: resolveUniqueNomusPersonId(ids),
    titles,
    today: TODAY,
    evaluatedAt: TODAY,
    syncCutoff: buildNomusArReportSyncCutoff(LATEST_SYNC),
  });
}

describe("resolveUniqueNomusPersonId", () => {
  it("TEST L: vários pedidos com o mesmo externalCustomerId resolvem uma identidade", () => {
    const resolved = resolveUniqueNomusPersonId([100, 100, 100]);
    assert.deepEqual(resolved, { kind: "RESOLVED", personId: 100 });
  });

  it("TEST M: IDs conflitantes não escolhem primeiro/último/mais frequente", () => {
    assert.deepEqual(resolveUniqueNomusPersonId([100, 200]), {
      kind: "CONFLICT",
      personIds: [100, 200],
    });
    assert.deepEqual(resolveUniqueNomusPersonId([200, 100, 100]), {
      kind: "CONFLICT",
      personIds: [100, 200],
    });
  });

  it("sem pedidos: MISSING", () => {
    assert.deepEqual(resolveUniqueNomusPersonId([null, undefined, 0]), { kind: "MISSING" });
  });
});

describe("isOfficialArBoletoPaymentMethod", () => {
  it("reconhece boleto pelo classificador canônico de nome (token, não fuzzy)", () => {
    assert.equal(isOfficialArBoletoPaymentMethod({ paymentMethodName: "Boleto Bancário" }), true);
    assert.equal(isOfficialArBoletoPaymentMethod({ paymentMethodName: "PIX" }), false);
    assert.equal(isOfficialArBoletoPaymentMethod({ paymentMethodName: "Transferência" }), false);
  });
});

describe("buildCustomerSalesBlockStatus", () => {
  it("TEST A: cliente sem AR → blocked=false", () => {
    const status = evaluate([]);
    assert.equal(status.blocked, false);
    assert.equal(status.resolution, "RESOLVED");
  });

  it("TEST B: boleto com vencimento futuro → blocked=false", () => {
    const status = evaluate([title({ dueDate: new Date(2026, 8, 20) })]);
    assert.equal(status.blocked, false);
  });

  it("TEST C: boleto vencendo hoje → blocked=false", () => {
    const status = evaluate([title({ dueDate: new Date(2026, 8, 7) })]);
    assert.equal(status.blocked, false);
  });

  it("TEST D: boleto venceu ontem com saldo > 0 → blocked=true", () => {
    const status = evaluate([title({ dueDate: new Date(2026, 8, 6), balanceReceivable: 150 })]);
    assert.equal(status.blocked, true);
    assert.equal(status.reason, "OVERDUE_BOLETO");
    assert.equal(status.overdueOpenBalance, 150);
  });

  it("TEST E: boleto vencido com balanceReceivable = 0 → blocked=false", () => {
    const status = evaluate([
      title({
        balanceReceivable: 0,
        amountReceived: 1000,
        settlementDate: new Date(2026, 8, 6),
      }),
    ]);
    assert.equal(status.blocked, false);
  });

  it("TEST F: pagamento parcial usa o saldo canônico", () => {
    const status = evaluate([
      title({
        amountReceivable: 10000,
        amountReceived: 8000,
        balanceReceivable: 2000,
      }),
    ]);
    assert.equal(status.blocked, true);
    assert.equal(status.overdueOpenBalance, 2000);
  });

  it("TEST G: título vencido que não é boleto → blocked=false", () => {
    const status = evaluate([title({ paymentMethodName: "PIX" })]);
    assert.equal(status.blocked, false);
  });

  it("TEST H: boleto vencido suspenso/inelegível → blocked=false", () => {
    const status = evaluate([title({ suspendCollection: true })]);
    assert.equal(status.blocked, false);
  });

  it("TEST I: duplicata/previsão substituída pelo motor oficial não conta duas vezes", () => {
    const withNf = title({
      externalId: 10,
      sourceInvoiceId: 900,
      sourceInvoiceNumber: "NF-900",
      description: "Pedido 10",
    });
    const preNf = title({
      externalId: 11,
      sourceInvoiceId: null,
      sourceInvoiceNumber: null,
      description: "Pedido 10",
    });
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
    const before = evaluate([title({ balanceReceivable: 2000 })]);
    assert.equal(before.blocked, true);
    const after = evaluate([
      title({
        balanceReceivable: 0,
        amountReceived: 2000,
        settlementDate: new Date(2026, 8, 7),
      }),
    ]);
    assert.equal(after.blocked, false);
  });

  it("TEST N/O: AR de outro personId nunca bloqueia", () => {
    const status = evaluate([title({ personId: 999, paymentMethodName: "Boleto" })], [PERSON]);
    assert.equal(status.blocked, false);
    assert.equal(status.nomusPersonId, PERSON);
  });

  it("TEST M: identidade conflitante → UNRESOLVED e não bloqueia", () => {
    const status = evaluate([title()], [100, 200]);
    assert.equal(status.blocked, false);
    assert.equal(status.resolution, "UNRESOLVED_IDENTITY");
    assert.equal(status.nomusPersonId, null);
  });

  it("sem SalesOrder → UNRESOLVED_IDENTITY", () => {
    const status = evaluate([title()], []);
    assert.equal(status.resolution, "UNRESOLVED_IDENTITY");
    assert.equal(status.blocked, false);
  });

  it("TEST P: título stale segundo o motor oficial não bloqueia", () => {
    const status = evaluate([
      title({
        syncedAt: STALE_SYNC,
        sourcePresenceStatus: "PRESENT",
      }),
    ]);
    assert.equal(status.blocked, false);
  });

  it("vencido sem NF (inelegível gerencial) não bloqueia", () => {
    const status = evaluate([
      title({ sourceInvoiceId: null, sourceInvoiceNumber: null }),
    ]);
    assert.equal(status.blocked, false);
  });
});

describe("toPublicCustomerSalesBlock / tooltip", () => {
  it("omite valores financeiros sem permissão AR", () => {
    const status = evaluate([title({ balanceReceivable: 18450, amountReceivable: 18450 })]);
    const publicBlock = toPublicCustomerSalesBlock(status, false);
    assert.equal(publicBlock.blocked, true);
    assert.equal(publicBlock.overdueOpenBalance, undefined);
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

  it("status cadastral permanece separado da trava financeira", () => {
    assert.equal(formatCustomerCadastralStatus("ACTIVE"), "Ativo");
    assert.equal(formatCustomerCadastralStatus("INACTIVE"), "Inativo");
    assert.equal(formatCustomerCadastralStatus("BLOCKED"), "Bloqueado");
  });
});
