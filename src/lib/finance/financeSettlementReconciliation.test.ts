/**
 * Regressão da regra dos N dias ÚTEIS de conciliação.
 * Cobre AR e AP (mesma função canônica), incluindo os edge cases
 * combinados com o pedido/decisão original do domínio.
 *
 * Calendário usado (agosto/2026): 01=sáb, 04=ter, 05=qua, 07=sex,
 * 08=sáb, 10=seg, 12=qua, 13=qui, 14=sex, 17=seg, 19=qua, 20=qui.
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

describe("resolveFinanceEffectiveSettlementDate — regra dos N dias ÚTEIS", () => {
  const due = d("2026-08-04"); // terça

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

  it("baixa 1 dia útil após (ter→qua) → dentro da tolerância padrão (3) → dueDate", () => {
    const eff = resolveFinanceEffectiveSettlementDate({
      dueDate: due,
      settledOn: d("2026-08-05"),
      isSettled: true,
    });
    assert.equal(eff?.toISOString().slice(0, 10), "2026-08-04");
  });

  it("baixa 3 dias úteis após (ter→sex) → limite da tolerância → dueDate", () => {
    const eff = resolveFinanceEffectiveSettlementDate({
      dueDate: due,
      settledOn: d("2026-08-07"),
      isSettled: true,
    });
    assert.equal(eff?.toISOString().slice(0, 10), "2026-08-04");
  });

  it("baixa no sábado seguinte (ter→sáb = 3 úteis, 4 corridos) → AINDA dentro → dueDate", () => {
    // Antes (dias corridos) este caso virava atraso falso.
    const eff = resolveFinanceEffectiveSettlementDate({
      dueDate: due,
      settledOn: d("2026-08-08"),
      isSettled: true,
    });
    assert.equal(eff?.toISOString().slice(0, 10), "2026-08-04");
  });

  it("baixa 4 dias úteis após (ter→seg seguinte) → fora da tolerância → paymentDate (atraso real)", () => {
    const eff = resolveFinanceEffectiveSettlementDate({
      dueDate: due,
      settledOn: d("2026-08-10"),
      isSettled: true,
    });
    assert.equal(eff?.toISOString().slice(0, 10), "2026-08-10");
  });

  it("CASO DO BUG: vence sexta (14/08), concilia segunda (17/08) = 1 dia útil → dueDate", () => {
    // Em dias corridos eram 3 (borderline); qui→seg eram 4 e virava atraso falso.
    const eff = resolveFinanceEffectiveSettlementDate({
      dueDate: d("2026-08-14"),
      settledOn: d("2026-08-17"),
      isSettled: true,
    });
    assert.equal(eff?.toISOString().slice(0, 10), "2026-08-14");
  });

  it("vence quinta (13/08), concilia segunda (17/08) = 2 dias úteis → dueDate", () => {
    // Em corridos eram 4 → marcava atraso falso por causa do fim de semana.
    const eff = resolveFinanceEffectiveSettlementDate({
      dueDate: d("2026-08-13"),
      settledOn: d("2026-08-17"),
      isSettled: true,
    });
    assert.equal(eff?.toISOString().slice(0, 10), "2026-08-13");
  });

  it("vence sexta (14/08), concilia quarta (19/08) = 3 dias úteis → limite → dueDate", () => {
    const eff = resolveFinanceEffectiveSettlementDate({
      dueDate: d("2026-08-14"),
      settledOn: d("2026-08-19"),
      isSettled: true,
    });
    assert.equal(eff?.toISOString().slice(0, 10), "2026-08-14");
  });

  it("vence sexta (14/08), concilia quinta (20/08) = 4 dias úteis → atraso real", () => {
    const eff = resolveFinanceEffectiveSettlementDate({
      dueDate: d("2026-08-14"),
      settledOn: d("2026-08-20"),
      isSettled: true,
    });
    assert.equal(eff?.toISOString().slice(0, 10), "2026-08-20");
  });

  it("vencimento no sábado (01/08), baixa terça (04/08) = 2 dias úteis → dueDate", () => {
    const eff = resolveFinanceEffectiveSettlementDate({
      dueDate: d("2026-08-01"),
      settledOn: d("2026-08-04"),
      isSettled: true,
    });
    assert.equal(eff?.toISOString().slice(0, 10), "2026-08-01");
  });

  it("vencimento no sábado (01/08), baixa quinta (06/08) = 4 dias úteis → atraso real", () => {
    const eff = resolveFinanceEffectiveSettlementDate({
      dueDate: d("2026-08-01"),
      settledOn: d("2026-08-06"),
      isSettled: true,
    });
    assert.equal(eff?.toISOString().slice(0, 10), "2026-08-06");
  });

  it("tolerância customizada (ex.: 5 dias úteis) muda o corte", () => {
    // ter 04/08 → seg 10/08 = 4 úteis: fora com 3, dentro com 5.
    const eff5 = resolveFinanceEffectiveSettlementDate(
      { dueDate: due, settledOn: d("2026-08-10"), isSettled: true },
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

  it("defaults exportados batem com a decisão do produto (enabled=true, 3 dias úteis)", () => {
    assert.equal(FINANCE_SETTLEMENT_RECONCILIATION_DEFAULTS.enabled, true);
    assert.equal(FINANCE_SETTLEMENT_RECONCILIATION_DEFAULTS.toleranceDays, 3);
  });

  it("tolerância inválida (fracionária) é normalizada (floor) — trava input sujo", () => {
    // 3.9 vira 3 pelo floor; ter 04/08 → seg 10/08 = 4 úteis continua fora.
    const eff = resolveFinanceEffectiveSettlementDate(
      { dueDate: due, settledOn: d("2026-08-10"), isSettled: true },
      { enabled: true, toleranceDays: 3.9 }
    );
    assert.equal(eff?.toISOString().slice(0, 10), "2026-08-10");
  });

  it("tolerância negativa é clampada em 0 (nenhuma tolerância)", () => {
    const eff = resolveFinanceEffectiveSettlementDate(
      { dueDate: due, settledOn: d("2026-08-05"), isSettled: true },
      { enabled: true, toleranceDays: -5 }
    );
    // 1 dia útil após, tolerância 0 → fora, mantém paymentDate.
    assert.equal(eff?.toISOString().slice(0, 10), "2026-08-05");
  });
});
