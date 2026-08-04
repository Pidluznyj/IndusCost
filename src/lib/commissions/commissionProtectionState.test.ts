/**
 * Estado de proteção financeira — o defeito central do reprocessamento.
 *
 * Antes, `inClosedLedger || paidRecord` virava um único estado "paid", e a
 * carga do ledger olhava só `closingId != null`. Todo pedido com fechamento
 * era chamado de "já paga/fechada" e ficava intocável (PD 02747: fechamento
 * zerado, nada liberado, nada pago).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyCommissionProtectionState,
  COMMISSION_PROTECTION_STATES,
  LEGACY_PAID_OR_CLOSED_MESSAGE,
  type CommissionProtectionSignals,
} from "./commissionProtectionState.js";

function signals(
  over: Partial<CommissionProtectionSignals> = {}
): CommissionProtectionSignals {
  return {
    hasClosedLedgerLine: false,
    closedCommissionAmount: 0,
    releasedCommissionAmount: 0,
    hasOpenPaymentBatchItem: false,
    paidAmount: 0,
    hasPaidCommissionRecord: false,
    ...over,
  };
}

describe("proteção — closingId isolado NÃO é pagamento", () => {
  it("closingId sozinho não resulta em PAID", () => {
    const r = classifyCommissionProtectionState(
      signals({ hasClosedLedgerLine: true })
    );
    assert.notEqual(r.state, "PAID");
  });

  it("fechamento zerado sem liberação → CLOSED_ZERO_UNRELEASED", () => {
    const r = classifyCommissionProtectionState(
      signals({ hasClosedLedgerLine: true, closedCommissionAmount: 0 })
    );
    assert.equal(r.state, "CLOSED_ZERO_UNRELEASED");
  });

  it("e esse estado admite rematerialização segura", () => {
    const r = classifyCommissionProtectionState(
      signals({ hasClosedLedgerLine: true })
    );
    assert.equal(r.allowsSafeRematerialization, true);
  });

  it("a mensagem antiga 'já paga/fechada' não é mais emitida aí", () => {
    const r = classifyCommissionProtectionState(
      signals({ hasClosedLedgerLine: true })
    );
    assert.notEqual(r.reason, LEGACY_PAID_OR_CLOSED_MESSAGE);
    assert.equal(/pag[ao]/i.test(r.reason), true, "deve dizer que NADA foi pago");
    assert.match(r.reason, /nada pago/i);
  });
});

describe("proteção — demais estados", () => {
  it("fechamento positivo não pago → CLOSED_WITH_VALUE", () => {
    const r = classifyCommissionProtectionState(
      signals({ hasClosedLedgerLine: true, closedCommissionAmount: 137.79 })
    );
    assert.equal(r.state, "CLOSED_WITH_VALUE");
    assert.equal(r.allowsSafeRematerialization, false);
  });

  it("liberada não paga → RELEASED_UNPAID", () => {
    const r = classifyCommissionProtectionState(
      signals({
        hasClosedLedgerLine: true,
        closedCommissionAmount: 100,
        releasedCommissionAmount: 100,
      })
    );
    assert.equal(r.state, "RELEASED_UNPAID");
  });

  it("lote aberto → IN_PAYMENT_BATCH, mesmo com liberado", () => {
    const r = classifyCommissionProtectionState(
      signals({
        hasClosedLedgerLine: true,
        closedCommissionAmount: 100,
        releasedCommissionAmount: 100,
        hasOpenPaymentBatchItem: true,
      })
    );
    assert.equal(r.state, "IN_PAYMENT_BATCH");
  });

  it("pagamento confirmado por registro → PAID", () => {
    const r = classifyCommissionProtectionState(
      signals({ hasClosedLedgerLine: true, hasPaidCommissionRecord: true })
    );
    assert.equal(r.state, "PAID");
    assert.equal(r.allowsSafeRematerialization, false);
  });

  it("pagamento confirmado por valor pago → PAID", () => {
    const r = classifyCommissionProtectionState(signals({ paidAmount: 50 }));
    assert.equal(r.state, "PAID");
  });

  it("PAID vence lote e liberação (o mais forte prevalece)", () => {
    const r = classifyCommissionProtectionState(
      signals({
        hasPaidCommissionRecord: true,
        hasOpenPaymentBatchItem: true,
        releasedCommissionAmount: 100,
      })
    );
    assert.equal(r.state, "PAID");
  });

  it("nada de nada → UNPROTECTED", () => {
    const r = classifyCommissionProtectionState(signals());
    assert.equal(r.state, "UNPROTECTED");
    assert.equal(r.allowsSafeRematerialization, true);
  });
});

describe("proteção — bordas monetárias e contrato", () => {
  it("centavo residual não promove fechamento zerado a CLOSED_WITH_VALUE", () => {
    const r = classifyCommissionProtectionState(
      signals({ hasClosedLedgerLine: true, closedCommissionAmount: 0.001 })
    );
    assert.equal(r.state, "CLOSED_ZERO_UNRELEASED");
  });

  it("um centavo real promove", () => {
    const r = classifyCommissionProtectionState(
      signals({ hasClosedLedgerLine: true, closedCommissionAmount: 0.01 })
    );
    assert.equal(r.state, "CLOSED_WITH_VALUE");
  });

  it("valor não finito não inventa proteção", () => {
    const r = classifyCommissionProtectionState(
      signals({ hasClosedLedgerLine: true, closedCommissionAmount: Number.NaN })
    );
    assert.equal(r.state, "CLOSED_ZERO_UNRELEASED");
  });

  it("preserva as evidências que geraram a decisão", () => {
    const s = signals({ hasClosedLedgerLine: true, closedCommissionAmount: 10 });
    const r = classifyCommissionProtectionState(s);
    assert.deepEqual(r.evidence, s);
  });

  it("todo estado do contrato é alcançável", () => {
    const alcancados = new Set([
      classifyCommissionProtectionState(signals()).state,
      classifyCommissionProtectionState(signals({ hasClosedLedgerLine: true })).state,
      classifyCommissionProtectionState(
        signals({ hasClosedLedgerLine: true, closedCommissionAmount: 1 })
      ).state,
      classifyCommissionProtectionState(signals({ releasedCommissionAmount: 1 })).state,
      classifyCommissionProtectionState(signals({ hasOpenPaymentBatchItem: true })).state,
      classifyCommissionProtectionState(signals({ paidAmount: 1 })).state,
    ]);
    for (const estado of COMMISSION_PROTECTION_STATES) {
      assert.ok(alcancados.has(estado), `estado inalcançável: ${estado}`);
    }
  });

  it("classificação é pura e determinística", () => {
    const s = signals({ hasClosedLedgerLine: true });
    assert.deepEqual(
      classifyCommissionProtectionState(s),
      classifyCommissionProtectionState(s)
    );
  });
});

describe("PD 02747 — por que não pode ser chamado de pago", () => {
  it("fechamento em julho, zero, nada liberado, nada pago", () => {
    const r = classifyCommissionProtectionState(
      signals({
        hasClosedLedgerLine: true, // closingId 94d58085-...
        closedCommissionAmount: 0, // ledger ZERO_AMOUNT
        releasedCommissionAmount: 0,
        hasOpenPaymentBatchItem: false,
        paidAmount: 0,
        hasPaidCommissionRecord: false,
      })
    );
    assert.equal(r.state, "CLOSED_ZERO_UNRELEASED");
    assert.notEqual(r.state, "PAID");
    assert.equal(
      r.allowsSafeRematerialization,
      true,
      "o pedido pode ser recalculado sem tocar no ledger"
    );
  });
});
