/**
 * Estado de PROTEÇÃO FINANCEIRA de um pedido — classificador oficial, puro.
 *
 * REGRA (docs/commissions/commission-rules.md, seção 4)
 * Os estados financeiros NÃO são sinônimos. A existência isolada de um
 * `closingId` NUNCA prova pagamento.
 *
 * DEFEITO QUE ISTO SUBSTITUI
 * `classifyCommissionReprocessLifecycle` colapsava `inClosedLedger ||
 * paidRecord` num único estado `"paid"`, e a carga do ledger filtrava apenas
 * `closingId != null` — sem ler valor liberado, status ou vínculo com lote.
 * Resultado: qualquer pedido com fechamento virava "já paga/fechada",
 * afirmação falsa para fechamento zerado e nunca liberado, e o pedido ficava
 * intocável pelo reprocessamento (PD 02747).
 *
 * Nada aqui decide o que o apply materializa — isso é a fase seguinte. Este
 * módulo só nomeia corretamente o estado, para preview e observabilidade.
 */

/** Estados de proteção, do mais permissivo ao mais rígido. */
export const COMMISSION_PROTECTION_STATES = [
  "UNPROTECTED",
  "CLOSED_ZERO_UNRELEASED",
  "CLOSED_WITH_VALUE",
  "RELEASED_UNPAID",
  "IN_PAYMENT_BATCH",
  "PAID",
] as const;

export type CommissionProtectionState =
  (typeof COMMISSION_PROTECTION_STATES)[number];

/**
 * Sinais colhidos das fontes OFICIAIS do domínio. Cada campo tem uma origem
 * declarada — nenhum é inferido de mensagem, nome de variável ou presença
 * genérica de relacionamento.
 */
export type CommissionProtectionSignals = {
  /** Existe linha de ledger com `closingId` != null. Sozinho não prova nada. */
  hasClosedLedgerLine: boolean;
  /** Soma de `expectedCommissionAmount` das linhas fechadas. */
  closedCommissionAmount: number;
  /** Soma de `releasedCommissionAmount` das linhas fechadas. */
  releasedCommissionAmount: number;
  /**
   * Existe `CommissionPaymentBatchItem` em lote NÃO concluído
   * (batch/item em DRAFT ou APPROVED). Cancelado não protege.
   */
  hasOpenPaymentBatchItem: boolean;
  /** Soma efetivamente paga (`amountPaid` de itens de lote PAID). */
  paidAmount: number;
  /** `CommissionRecord.status` ∈ {PAID_PARTIAL, PAID_TOTAL}. */
  hasPaidCommissionRecord: boolean;
};

export type CommissionProtectionClassification = {
  state: CommissionProtectionState;
  /** Frase curta e VERDADEIRA para a interface. */
  reason: string;
  /**
   * O estado admite recalcular e rematerializar snapshot/schedules sem tocar
   * no ledger? Ver seção 6 do doc canônico.
   */
  allowsSafeRematerialization: boolean;
  /** Sinais que determinaram o estado — para auditoria da decisão. */
  evidence: CommissionProtectionSignals;
};

/** Tolerância monetária: abaixo disto é zero para efeito de proteção. */
const MONEY_EPSILON = 0.005;

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > MONEY_EPSILON;
}

/**
 * Classifica o estado de proteção.
 *
 * Ordem de avaliação = ordem de rigidez. O primeiro que casar vence, porque um
 * pedido pago também tem fechamento, e chamá-lo de "fechado" seria perder a
 * informação mais forte.
 */
export function classifyCommissionProtectionState(
  signals: CommissionProtectionSignals
): CommissionProtectionClassification {
  const evidence = signals;

  // 1. PAGO — o único estado que realmente prova pagamento.
  if (signals.hasPaidCommissionRecord || isPositive(signals.paidAmount)) {
    return {
      state: "PAID",
      reason: "Comissão paga — histórico imutável.",
      allowsSafeRematerialization: false,
      evidence,
    };
  }

  // 2. EM LOTE — dinheiro comprometido, ainda não pago.
  if (signals.hasOpenPaymentBatchItem) {
    return {
      state: "IN_PAYMENT_BATCH",
      reason: "Comissão em lote de pagamento aberto — não alterar automaticamente.",
      allowsSafeRematerialization: false,
      evidence,
    };
  }

  // 3. LIBERADA — valor já liberado, pagamento pendente.
  if (isPositive(signals.releasedCommissionAmount)) {
    return {
      state: "RELEASED_UNPAID",
      reason:
        "Comissão liberada e ainda não paga — diferença exige reconciliação explícita.",
      allowsSafeRematerialization: false,
      evidence,
    };
  }

  // 4/5. FECHAMENTO — só aqui o valor fechado separa os dois casos.
  if (signals.hasClosedLedgerLine) {
    if (isPositive(signals.closedCommissionAmount)) {
      return {
        state: "CLOSED_WITH_VALUE",
        reason:
          "Fechamento histórico com valor — recalcular apenas para diagnóstico; ledger preservado.",
        allowsSafeRematerialization: false,
        evidence,
      };
    }
    return {
      state: "CLOSED_ZERO_UNRELEASED",
      reason:
        "Fechamento histórico zerado, nada liberado e nada pago — pode ser recalculado com o ledger intacto.",
      // ESTE é o ponto do defeito: antes virava "já paga/fechada" e travava.
      allowsSafeRematerialization: true,
      evidence,
    };
  }

  return {
    state: "UNPROTECTED",
    reason: "Sem fechamento, liberação, lote ou pagamento.",
    allowsSafeRematerialization: true,
    evidence,
  };
}

/**
 * Mensagem antiga que este módulo aposenta. Mantida como constante para os
 * testes provarem que ela não é mais emitida para fechamento zerado.
 */
export const LEGACY_PAID_OR_CLOSED_MESSAGE =
  "Bloqueada por já paga/fechada no ledger oficial.";
