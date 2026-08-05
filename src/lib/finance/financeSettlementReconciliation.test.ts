/**
 * Regressão da regra dos N dias de conciliação.
 * Cobre AR e AP (mesma função canônica), incluindo os edge cases
 * combinados com o pedido/decisão original do domínio.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FINANCE_SETTLEMENT_RECONCILIATION_DEFAULTS,
  FINANCE_SETTLEMENT_RECONCILIATION_LEGACY,
  resolveFinanceEffectiveSettlementDate,
} from "./financeSettlementReconciliation.js";

function d(iso: string): Date {
  // UTC-noon → evita cair de dia por causa de fuso.
  return new Date(`${iso}T12:00:00.000Z`);
}

describe("resolveFinanceEffectiveSettlementDate — regra dos N dias", () => {
  const due = d("2026-08-04");

  it("baixa antes do vencimento respeita paymentDate (dinheiro saiu antes)", () => {
    const eff = resolveFinanceEffectiveSettlementDate({
      dueDate: due,
      settledOn: d("2026-08-01"),
      isSettled: true,
    });
    assert.equal(eff?.toISOString().slice(0, 10), "2026-08-01");
  });

  it("baixa no MESMO dia do vencimento usa a própria baixa (não muda nada)", () => {
    const eff = resolveFinanceEffectiveSettlementDate({
      dueDate: due,
      settledOn: due,
      isSettled: true,
    });
    assert.equal(eff?.toISOString().slice(0, 10), "2026-08-04");
  });

  it("baixa 1 dia após → dentro da tolerância padrão (3) → dueDate", () => {
    const eff = resolveFinanceEffectiveSettlementDate({
      dueDate: due,
      settledOn: d("2026-08-05"),
      isSettled: true,
    });
    assert.equal(eff?.toISOString().slice(0, 10), "2026-08-04");
  });

  it("baixa 3 dias após → limite da tolerância → dueDate", () => {
    const eff = resolveFinanceEffectiveSettlementDate({
      dueDate: due,
      settledOn: d("2026-08-07"),
      isSettled: true,
    });
    assert.equal(eff?.toISOString().slice(0, 10), "2026-08-04");
  });

  it("baixa 4 dias após → fora da tolerância → paymentDate (atraso real)", () => {
    const eff = resolveFinanceEffectiveSettlementDate({
      dueDate: due,
      settledOn: d("2026-08-08"),
      isSettled: true,
    });
    assert.equal(eff?.toISOString().slice(0, 10), "2026-08-08");
  });

  it("fim de semana comum: sexta (01/08) vence, segunda (04/08) baixa → dueDate (3 dias)", () => {
    const eff = resolveFinanceEffectiveSettlementDate({
      dueDate: d("2026-08-01"),
      settledOn: d("2026-08-04"),
      isSettled: true,
    });
    assert.equal(eff?.toISOString().slice(0, 10), "2026-08-01");
  });

  it("feriadão prolongado além de 3 dias vira 'atraso' — sinal para operação afrouxar tolerância se necessário", () => {
    const eff = resolveFinanceEffectiveSettlementDate({
      dueDate: d("2026-08-01"),
      settledOn: d("2026-08-06"),
      isSettled: true,
    });
    assert.equal(eff?.toISOString().slice(0, 10), "2026-08-06");
  });

  it("tolerância customizada (ex.: 5 dias) muda o corte", () => {
    const eff5 = resolveFinanceEffectiveSettlementDate(
      { dueDate: due, settledOn: d("2026-08-08"), isSettled: true },
      { enabled: true, toleranceDays: 5 }
    );
    assert.equal(eff5?.toISOString().slice(0, 10), "2026-08-04");
  });

  it("Nomus sem paymentDate mas título liquidado → dueDate (fallback histórico)", () => {
    const eff = resolveFinanceEffectiveSettlementDate({
      dueDate: due,
      settledOn: null,
      isSettled: true,
    });
    assert.equal(eff?.toISOString().slice(0, 10), "2026-08-04");
  });

  it("título ainda aberto sem baixa → null (não realizado)", () => {
    const eff = resolveFinanceEffectiveSettlementDate({
      dueDate: due,
      settledOn: null,
      isSettled: false,
    });
    assert.equal(eff, null);
  });

  it("política DESLIGADA → comportamento legado (dueDate quando existe, ignora paymentDate)", () => {
    const eff = resolveFinanceEffectiveSettlementDate(
      { dueDate: due, settledOn: d("2026-08-20"), isSettled: true },
      FINANCE_SETTLEMENT_RECONCILIATION_LEGACY
    );
    // Legado: dueDate sempre — apesar do settledOn distante.
    assert.equal(eff?.toISOString().slice(0, 10), "2026-08-04");
  });

  it("política DESLIGADA, sem dueDate → cai no settledOn (não some do fluxo)", () => {
    const eff = resolveFinanceEffectiveSettlementDate(
      { dueDate: null, settledOn: d("2026-08-05"), isSettled: true },
      FINANCE_SETTLEMENT_RECONCILIATION_LEGACY
    );
    assert.equal(eff?.toISOString().slice(0, 10), "2026-08-05");
  });

  it("defaults exportados batem com a decisão do produto (enabled=true, 3 dias)", () => {
    assert.equal(FINANCE_SETTLEMENT_RECONCILIATION_DEFAULTS.enabled, true);
    assert.equal(FINANCE_SETTLEMENT_RECONCILIATION_DEFAULTS.toleranceDays, 3);
  });

  it("tolerância inválida (fracionária) é normalizada (floor) — trava input sujo", () => {
    // 3.9 vira 3 pelo floor; baixa em 04+4=08 continua fora.
    const eff = resolveFinanceEffectiveSettlementDate(
      { dueDate: due, settledOn: d("2026-08-08"), isSettled: true },
      { enabled: true, toleranceDays: 3.9 }
    );
    assert.equal(eff?.toISOString().slice(0, 10), "2026-08-08");
  });

  it("tolerância negativa é clampada em 0 (nenhuma tolerância)", () => {
    const eff = resolveFinanceEffectiveSettlementDate(
      { dueDate: due, settledOn: d("2026-08-05"), isSettled: true },
      { enabled: true, toleranceDays: -5 }
    );
    // 1 dia após, tolerância 0 → fora, mantém paymentDate.
    assert.equal(eff?.toISOString().slice(0, 10), "2026-08-05");
  });
});
