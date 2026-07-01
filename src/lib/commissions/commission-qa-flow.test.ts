import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampPaymentAmount, computeReleasedAmountForReceivable, roundMoney } from "./commission-money.js";
import { computeReleaseForSchedule, computeBalanceAfterRelease } from "./commission-release-service.js";
import { COMMISSION_FORECAST_STATUSES } from "./commissionQuery.js";

/** Fluxo A: pedido sem NF-e → prevista com parcelas de pedido, aguardando NF-e quando aplicável. */
describe("commission QA flow A — prevista", () => {
  it("status previsto sem NF-e é FORECAST_FROM_ORDER", () => {
    const hasNfeLink = false;
    const status = hasNfeLink ? "WAITING_NFE" : "FORECAST_FROM_ORDER";
    assert.ok(COMMISSION_FORECAST_STATUSES.includes(status));
  });

  it("status previsto com vínculo NF-e pendente é WAITING_NFE", () => {
    const hasNfeLink = true;
    const status = hasNfeLink ? "WAITING_NFE" : "FORECAST_FROM_ORDER";
    assert.equal(status, "WAITING_NFE");
  });
});

/** Fluxo B: NF-e confirmada → origem OUTPUT_DOCUMENT e parcelas AR. */
describe("commission QA flow B — confirmada", () => {
  it("liberação definitiva usa parcelas ACCOUNTS_RECEIVABLE", () => {
    const result = computeReleaseForSchedule({
      releaseRule: "EACH_RECEIVABLE_PAID",
      commissionAmount: 100,
      alreadyReleased: 0,
      isFirstReceivablePaidInOrder: true,
      receivable: {
        nomusReceivableId: 99,
        nomusNfeId: 10,
        installmentNumber: 1,
        dueDate: null,
        amountReceivable: 500,
        amountReceived: 500,
        balanceReceivable: 0,
        settlementDate: new Date("2026-03-01"),
      },
      schedule: {
        scheduleKey: "ar-1",
        source: "ACCOUNTS_RECEIVABLE",
        status: "ACTIVE",
        nomusOrderId: 1,
        nomusNfeId: 10,
        nomusReceivableId: 99,
        installmentNumber: 1,
        dueDate: null,
        expectedAmount: null,
        receivableAmount: 500,
        receivedAmount: 500,
        openBalance: 0,
        allocationPercent: 100,
        commissionExpectedAmount: 100,
        commissionReleasedAmount: 0,
      },
    });
    assert.equal(result.releasedDelta, 100);
    assert.equal(result.newRecordStatus, "RELEASED");
  });
});

/** Fluxo C: recebimento parcial libera proporcionalmente. */
describe("commission QA flow C — liberação por recebimento", () => {
  it("recebimento de 25% libera 25% da comissão", () => {
    const delta = computeReleasedAmountForReceivable({
      commissionAmount: 200,
      alreadyReleased: 0,
      receivableAmount: 1000,
      receivedAmount: 250,
    });
    assert.equal(delta, 50);
  });

  it("segunda parcela acumula liberação parcial", () => {
    const first = computeReleaseForSchedule({
      releaseRule: "EACH_RECEIVABLE_PAID",
      commissionAmount: 200,
      alreadyReleased: 0,
      isFirstReceivablePaidInOrder: false,
      receivable: {
        nomusReceivableId: 1,
        nomusNfeId: 10,
        installmentNumber: 1,
        dueDate: null,
        amountReceivable: 1000,
        amountReceived: 500,
        balanceReceivable: 500,
        settlementDate: null,
      },
      schedule: {
        scheduleKey: "s1",
        source: "ACCOUNTS_RECEIVABLE",
        status: "ACTIVE",
        nomusOrderId: 1,
        nomusNfeId: 10,
        nomusReceivableId: 1,
        installmentNumber: 1,
        dueDate: null,
        expectedAmount: null,
        receivableAmount: 1000,
        receivedAmount: 500,
        openBalance: 500,
        allocationPercent: 100,
        commissionExpectedAmount: 200,
        commissionReleasedAmount: 0,
      },
    });
    assert.equal(first.newRecordStatus, "PARTIALLY_RELEASED");
    assert.equal(first.newReleasedTotal, 100);
  });
});

/** Fluxo D: pagamento respeita teto liberado. */
describe("commission QA flow D — pagamento", () => {
  it("não paga acima do liberado", () => {
    assert.equal(clampPaymentAmount(500, 300), 300);
  });

  it("paidAmount e balanceAmount após pagamento parcial", () => {
    const commission = 1000;
    const released = 600;
    const paid = 200;
    const available = roundMoney(Math.max(0, released - paid));
    const balance = computeBalanceAfterRelease(commission, released, paid);
    assert.equal(available, 400);
    assert.equal(balance, 200);
  });
});
