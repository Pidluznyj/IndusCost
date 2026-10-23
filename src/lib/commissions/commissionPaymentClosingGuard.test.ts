/**
 * Guarda do pagamento contra o fechamento oficial: o lote paga `CommissionRecord`
 * (cálculo por item), mas nunca além do que o ledger CLOSED liberou por (vendedor, pedido).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluatePaymentAgainstOfficialClosing,
  paymentGuardOrderKey,
  type PaymentGuardLedgerLine,
} from "./commissionPaymentClosingGuard.js";
import { competenceBoundsOfPeriod, evaluateCommissionPaymentBatchAgainstClosing } from "./commissionPaymentClosingGuard.server.js";
import { resolveCreateBatchPeriod } from "../../components/commissions/payments/commissionsPaymentsFilters.js";

const SELLER_A = "person-a";
const SELLER_B = "person-b";
const ledger = (seller: string, nomusOrderId: number | null, orderCode: string | null, released: number, status = "COMMISSIONABLE"): PaymentGuardLedgerLine => ({
  canonicalSellerId: seller,
  nomusOrderId,
  orderCode,
  status,
  releasedCommissionAmount: released,
});
const request = (id: string, nomusOrderId: number | null, orderCode: string | null, amount: number) => ({
  commissionRecordId: id,
  nomusOrderId,
  orderCode,
  amount,
});

// NF-e 7862 (2 pedidos, mesmo vendedor) + NF-e com 2 pedidos de vendedores diferentes +
// pedido faturado em 3 NF-e (R1) com 320 + 480 liberados até agora.
const LEDGER = [
  ledger(SELLER_A, 2934, "02933", 30.11),
  ledger(SELLER_A, 2998, "02997", 106.78),
  ledger(SELLER_A, 4101, "04101", 90),
  ledger(SELLER_B, 4102, "04102", 30),
  ledger(SELLER_A, 5001, "05001", 320),
  ledger(SELLER_A, 5001, "05001", 480),
  ledger(SELLER_A, 6001, "06001", 99, "ERROR"),
];

describe("guarda de pagamento × fechamento oficial", () => {
  it("paga exatamente o liberado por pedido do vendedor (N pedidos na mesma NF-e)", () => {
    const result = evaluatePaymentAgainstOfficialClosing({
      commissionPersonId: SELLER_A,
      ledgerLines: LEDGER,
      committed: [],
      requested: [request("r1", 2934, "02933", 30.11), request("r2", 2998, "02997", 106.78), request("r3", 4101, "04101", 90)],
      openCompetences: [],
    });
    assert.equal(result.ok, true, result.violations.join("; "));
    assert.deepEqual(
      result.orders.map((row) => [row.orderLabel, row.releasedByClosing, row.requested, row.available]),
      [
        ["02933", 30.11, 30.11, 30.11],
        ["02997", 106.78, 106.78, 106.78],
        ["04101", 90, 90, 90],
      ]
    );
  });

  it("R1: registros integrais do pedido em 3 NF-e (3 × R$ 1.200) não passam do liberado (R$ 800)", () => {
    const blocked = evaluatePaymentAgainstOfficialClosing({
      commissionPersonId: SELLER_A,
      ledgerLines: LEDGER,
      committed: [],
      requested: [request("n1", 5001, "05001", 1200), request("n2", 5001, "05001", 1200), request("n3", 5001, "05001", 1200)],
      openCompetences: [],
    });
    assert.equal(blocked.ok, false);
    assert.match(blocked.violations[0]!, /PD 05001: solicitado R\$ 3600\.00 acima do liberado no fechamento oficial \(R\$ 800\.00/);
    const allowed = evaluatePaymentAgainstOfficialClosing({
      commissionPersonId: SELLER_A,
      ledgerLines: LEDGER,
      committed: [],
      requested: [request("n1", 5001, "05001", 800)],
      openCompetences: [],
    });
    assert.equal(allowed.ok, true);
  });

  it("atribuição: vendedor B não recebe pedido do vendedor A, nem linha retida (não comissionável)", () => {
    const wrongSeller = evaluatePaymentAgainstOfficialClosing({
      commissionPersonId: SELLER_B,
      ledgerLines: LEDGER,
      committed: [],
      requested: [request("x", 4101, "04101", 90)],
      openCompetences: [],
    });
    assert.equal(wrongSeller.ok, false);
    assert.equal(wrongSeller.orders[0]!.releasedByClosing, 0);
    const own = evaluatePaymentAgainstOfficialClosing({
      commissionPersonId: SELLER_B,
      ledgerLines: LEDGER,
      committed: [],
      requested: [request("y", 4102, "04102", 30)],
      openCompetences: [],
    });
    assert.equal(own.ok, true);
    const held = evaluatePaymentAgainstOfficialClosing({
      commissionPersonId: SELLER_A,
      ledgerLines: LEDGER,
      committed: [],
      requested: [request("z", 6001, "06001", 99)],
      openCompetences: [],
    });
    assert.equal(held.ok, false, "linha ERROR (retida) não é liberada para pagamento");
  });

  it("duplicidade entre lotes: o já comprometido em outro lote consome o liberado", () => {
    const result = evaluatePaymentAgainstOfficialClosing({
      commissionPersonId: SELLER_A,
      ledgerLines: LEDGER,
      committed: [{ nomusOrderId: 2934, orderCode: "02933", amount: 30.11 }],
      requested: [request("r1-again", 2934, "02933", 30.11)],
      openCompetences: [],
    });
    assert.equal(result.ok, false);
    assert.equal(result.orders[0]!.available, 0);
    // Comprometido de outro pedido não interfere.
    const other = evaluatePaymentAgainstOfficialClosing({
      commissionPersonId: SELLER_A,
      ledgerLines: LEDGER,
      committed: [{ nomusOrderId: 2934, orderCode: "02933", amount: 30.11 }],
      requested: [request("r2", 2998, "02997", 106.78)],
      openCompetences: [],
    });
    assert.equal(other.ok, true);
  });

  it("competência sem fechamento CLOSED e registro sem pedido são recusados", () => {
    const result = evaluatePaymentAgainstOfficialClosing({
      commissionPersonId: SELLER_A,
      ledgerLines: LEDGER,
      committed: [],
      requested: [request("sem-pedido", null, null, 10)],
      openCompetences: ["11/2026"],
    });
    assert.equal(result.ok, false);
    assert.equal(result.violations.length, 2);
    assert.match(result.violations[0]!, /11\/2026 sem fechamento oficial encerrado/);
    assert.match(result.violations[1]!, /sem pedido/);
  });

  it("chave do pedido: id Nomus quando existe; código normalizado quando o ledger não tem o id", () => {
    assert.equal(paymentGuardOrderKey({ nomusOrderId: 2934, orderCode: "02933" }), "n:2934");
    assert.equal(paymentGuardOrderKey({ nomusOrderId: null, orderCode: "PD 02933" }), "c:2933");
    const byCode = evaluatePaymentAgainstOfficialClosing({
      commissionPersonId: SELLER_A,
      ledgerLines: [ledger(SELLER_A, null, "02933", 30.11)],
      committed: [],
      requested: [request("r1", 2934, "2933", 30.11)],
      openCompetences: [],
    });
    assert.equal(byCode.ok, true, byCode.violations.join("; "));
  });
});

describe("período do lote: mês em UTC ou datas no fuso do navegador apontam a mesma competência", () => {
  // Banco simulado: só fevereiro/2027 fechado; R$ 100 liberados do pedido 1 ao vendedor.
  const db = {
    commissionMonthlyClosing: {
      findMany: async ({ where }: { where: { OR: Array<{ year: number; month: number }> } }) =>
        where.OR.filter((month) => month.year === 2027 && month.month === 2),
    },
    commissionReceiptLedgerLine: {
      findMany: async () => [{ canonicalSellerId: "v", nomusOrderId: 1, orderCode: "1", status: "COMMISSIONABLE", releasedCommissionAmount: 100 }],
    },
    commissionPaymentBatchItem: { findMany: async () => [] },
  } as unknown as Parameters<typeof evaluateCommissionPaymentBatchAgainstClosing>[0];
  const evaluate = (period: { periodStart: string; periodEnd: string }) =>
    evaluateCommissionPaymentBatchAgainstClosing(db, {
      commissionPersonId: "v",
      periodStart: new Date(period.periodStart),
      periodEnd: new Date(period.periodEnd),
      requested: [{ commissionRecordId: "r", nomusOrderId: 1, orderCode: "1", amount: 100 }],
    });

  it("filtro por mês (UTC) e por datas (23:59:59 −03:00 = 02:59Z do dia 1º) liberam fevereiro sem exigir março", async () => {
    const byMonth = await evaluate(resolveCreateBatchPeriod({ from: "", to: "", year: "2027", month: "2" })!);
    assert.equal(byMonth.ok, true, byMonth.violations.join("; "));
    const byDates = await evaluate({ periodStart: "2027-02-01T03:00:00.000Z", periodEnd: "2027-03-01T02:59:59.000Z" });
    assert.equal(byDates.ok, true, byDates.violations.join("; "));
    // Um dia só, em hora local: continua na competência do dia.
    const oneDay = await evaluate({ periodStart: "2027-02-10T03:00:00.000Z", periodEnd: "2027-02-11T02:59:59.000Z" });
    assert.equal(oneDay.ok, true, oneDay.violations.join("; "));
    // Período que entra de fato em março continua exigindo março fechado.
    const intoMarch = await evaluate({ periodStart: "2027-02-01T03:00:00.000Z", periodEnd: "2027-03-02T02:59:59.000Z" });
    assert.equal(intoMarch.ok, false);
    assert.match(intoMarch.violations[0]!, /03\/2027 sem fechamento/);
  });

  it("bordas com 12 h de folga; período de um dia usa o meio", () => {
    const bounds = competenceBoundsOfPeriod(new Date("2027-02-01T03:00:00.000Z"), new Date("2027-03-01T02:59:59.000Z"));
    assert.deepEqual([bounds.start.toISOString(), bounds.end.toISOString()], ["2027-02-01T15:00:00.000Z", "2027-02-28T14:59:59.000Z"]);
    const day = competenceBoundsOfPeriod(new Date("2027-02-10T03:00:00.000Z"), new Date("2027-02-11T02:59:59.000Z"));
    assert.equal(day.start.toISOString().slice(0, 10), "2027-02-10");
    assert.equal(day.end.toISOString().slice(0, 10), "2027-02-10");
  });
});
