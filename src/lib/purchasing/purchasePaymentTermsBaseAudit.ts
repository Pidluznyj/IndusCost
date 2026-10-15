/**
 * Diagnóstico (somente leitura) da data-base contratual das parcelas dos Pedidos de Compra Nomus.
 *
 * O payload não diz a partir de qual evento o Nomus conta os dias da condição. Teste usado:
 * para pedidos com a MESMA condição (`idCondicaoPagamento`), sob a data-base correta os prazos
 * em dias das parcelas são iguais entre os pedidos; sob a base errada eles variam.
 */
import {
  calendarDaysBetween,
  type PaymentTermsBaseKind,
  type PaymentTermsInstallmentInput,
} from "./purchasePaymentTerms.js";

export type BaseAuditOrder = {
  orderNumber: string;
  issuedAt: Date | null;
  expectedAt: Date | null;
  conditionId: number | null;
  conditionText: string | null;
  installments: readonly PaymentTermsInstallmentInput[];
};

export type BaseCandidate = Extract<PaymentTermsBaseKind, "ORDER_ISSUE_DATE" | "EXPECTED_DELIVERY_DATE">;

export type BaseCandidateStats = {
  base: BaseCandidate;
  /** Pedidos com parcelas completas e a data-base disponível. */
  measurableOrders: number;
  /** Condições (idCondicaoPagamento) com ≥ 2 pedidos mensuráveis. */
  conditionsCompared: number;
  /** Dessas, quantas têm os MESMOS prazos (dias) em todos os pedidos. */
  conditionsConsistent: number;
  /** Pedidos cujos prazos coincidem com o padrão mais frequente da sua condição. */
  ordersMatchingConditionMode: number;
  ordersInComparedConditions: number;
  topPatterns: Array<{ pattern: string; orders: number }>;
};

export type BaseAuditReport = {
  totalOrders: number;
  withInstallments: number;
  withCompleteInstallments: number;
  withConditionId: number;
  conditionTexts: Array<{ text: string; orders: number }>;
  candidates: BaseCandidateStats[];
  /** Base com maior aderência — apenas evidência; a decisão é humana. */
  suggestedBase: BaseCandidate | null;
  conditionSamples: Array<{ conditionId: number; text: string | null; byBase: Record<BaseCandidate, string[]> }>;
};

function complete(installments: readonly PaymentTermsInstallmentInput[]): boolean {
  return (
    installments.length > 0 &&
    installments.every((i) => i.dueDate && !Number.isNaN(i.dueDate.getTime()) && i.amount != null && Number.isFinite(i.amount))
  );
}

function pattern(base: Date, installments: readonly PaymentTermsInstallmentInput[]): string {
  return installments
    .map((i) => calendarDaysBetween(base, i.dueDate as Date) as number)
    .sort((a, b) => a - b)
    .join("/");
}

const baseOf = (o: BaseAuditOrder, base: BaseCandidate) => (base === "ORDER_ISSUE_DATE" ? o.issuedAt : o.expectedAt);

export function auditPaymentTermsBase(orders: readonly BaseAuditOrder[]): BaseAuditReport {
  const texts = new Map<string, number>();
  for (const o of orders) {
    const t = (o.conditionText ?? "").trim() || "(vazio)";
    texts.set(t, (texts.get(t) ?? 0) + 1);
  }
  const usable = orders.filter((o) => complete(o.installments));
  const candidates: BaseCandidateStats[] = (["ORDER_ISSUE_DATE", "EXPECTED_DELIVERY_DATE"] as const).map((base) => {
    const measurable = usable.filter((o) => baseOf(o, base));
    const byCondition = new Map<number, string[]>();
    const patternCount = new Map<string, number>();
    for (const o of measurable) {
      const p = pattern(baseOf(o, base) as Date, o.installments);
      patternCount.set(p, (patternCount.get(p) ?? 0) + 1);
      if (o.conditionId == null) continue;
      byCondition.set(o.conditionId, [...(byCondition.get(o.conditionId) ?? []), p]);
    }
    let compared = 0;
    let consistent = 0;
    let matching = 0;
    let inCompared = 0;
    for (const patterns of byCondition.values()) {
      if (patterns.length < 2) continue;
      compared += 1;
      inCompared += patterns.length;
      const freq = new Map<string, number>();
      for (const p of patterns) freq.set(p, (freq.get(p) ?? 0) + 1);
      const mode = Math.max(...freq.values());
      matching += mode;
      if (freq.size === 1) consistent += 1;
    }
    return {
      base,
      measurableOrders: measurable.length,
      conditionsCompared: compared,
      conditionsConsistent: consistent,
      ordersMatchingConditionMode: matching,
      ordersInComparedConditions: inCompared,
      topPatterns: [...patternCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([p, n]) => ({ pattern: p, orders: n })),
    };
  });

  const score = (c: BaseCandidateStats) => (c.ordersInComparedConditions ? c.ordersMatchingConditionMode / c.ordersInComparedConditions : 0);
  const [a, b] = candidates;
  const suggestedBase =
    a.ordersInComparedConditions === 0 && b.ordersInComparedConditions === 0
      ? null
      : Math.abs(score(a) - score(b)) < 0.05
        ? null
        : score(a) > score(b)
          ? a.base
          : b.base;

  const samples = new Map<number, BaseAuditReport["conditionSamples"][number]>();
  for (const o of usable) {
    if (o.conditionId == null) continue;
    const s = samples.get(o.conditionId) ?? {
      conditionId: o.conditionId,
      text: o.conditionText,
      byBase: { ORDER_ISSUE_DATE: [], EXPECTED_DELIVERY_DATE: [] },
    };
    for (const base of ["ORDER_ISSUE_DATE", "EXPECTED_DELIVERY_DATE"] as const) {
      const bd = baseOf(o, base);
      if (bd && s.byBase[base].length < 6) s.byBase[base].push(`${o.orderNumber}: ${pattern(bd, o.installments)}`);
    }
    samples.set(o.conditionId, s);
  }

  return {
    totalOrders: orders.length,
    withInstallments: orders.filter((o) => o.installments.length > 0).length,
    withCompleteInstallments: usable.length,
    withConditionId: orders.filter((o) => o.conditionId != null).length,
    conditionTexts: [...texts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 30).map(([text, n]) => ({ text, orders: n })),
    candidates,
    suggestedBase,
    conditionSamples: [...samples.values()].slice(0, 25),
  };
}
