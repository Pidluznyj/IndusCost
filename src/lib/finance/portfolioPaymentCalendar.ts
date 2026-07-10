/**
 * Calendário de pagamento por cliente — Conciliação de Carteira (camada paralela).
 *
 * Não altera cadastro oficial de Customer, Fluxo de Caixa, AR, Faturamento nem Comissões.
 * CR real (forecastSource=RECEIVABLE) permanece soberano: não recalcula vencimento.
 */

import type {
  PortfolioForecastSource,
  PortfolioReconciliationFactDraft,
} from "./portfolioReconciliationAllocationEngine.js";

export type PortfolioPaymentRule = {
  customerExternalId: number;
  customerNameSnapshot?: string | null;
  allowedDays: number[];
  defaultTermDays: number;
  moveToNextAllowedDay: boolean;
  isActive: boolean;
  notes?: string | null;
};

/** Fallback em código para Britânia (customerExternalId=200) — sem seed obrigatório. */
export const BRITANIA_CUSTOMER_EXTERNAL_ID = 200;

export const BRITANIA_PAYMENT_RULE_FALLBACK: PortfolioPaymentRule = {
  customerExternalId: BRITANIA_CUSTOMER_EXTERNAL_ID,
  customerNameSnapshot: "Britânia",
  allowedDays: [10, 20, 30],
  defaultTermDays: 0,
  moveToNextAllowedDay: true,
  isActive: true,
  notes: "Fallback IndusCost: paga nos dias 10, 20 e 30; nunca antecipa.",
};

const BUILTIN_FALLBACKS: ReadonlyMap<number, PortfolioPaymentRule> = new Map([
  [BRITANIA_CUSTOMER_EXTERNAL_ID, BRITANIA_PAYMENT_RULE_FALLBACK],
]);

export function parseAllowedDaysJson(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const days = value
    .map((item) => (typeof item === "number" ? item : Number.parseInt(String(item), 10)))
    .filter((day) => Number.isFinite(day) && day >= 1 && day <= 31);
  return [...new Set(days)].sort((a, b) => a - b);
}

export function paymentRuleFromDbRow(row: {
  customerExternalId: number;
  customerNameSnapshot?: string | null;
  allowedDaysJson: unknown;
  defaultTermDays?: number | null;
  moveToNextAllowedDay?: boolean | null;
  isActive?: boolean | null;
  notes?: string | null;
}): PortfolioPaymentRule {
  return {
    customerExternalId: row.customerExternalId,
    customerNameSnapshot: row.customerNameSnapshot ?? null,
    allowedDays: parseAllowedDaysJson(row.allowedDaysJson),
    defaultTermDays: row.defaultTermDays ?? 0,
    moveToNextAllowedDay: row.moveToNextAllowedDay !== false,
    isActive: row.isActive !== false,
    notes: row.notes ?? null,
  };
}

/**
 * Resolve regra ativa: primeiro lista fornecida (ex. DB), depois fallback embutido (Britânia).
 */
export function resolveCustomerPaymentRule(
  customerExternalId: number | null | undefined,
  rules: readonly PortfolioPaymentRule[] = []
): PortfolioPaymentRule | null {
  if (customerExternalId == null) return null;
  const fromList = rules.find(
    (rule) => rule.isActive && rule.customerExternalId === customerExternalId
  );
  if (fromList && fromList.allowedDays.length > 0) return fromList;
  const fallback = BUILTIN_FALLBACKS.get(customerExternalId);
  if (fallback?.isActive && fallback.allowedDays.length > 0) return fallback;
  return null;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function addDays(date: Date, days: number): Date {
  const next = startOfLocalDay(date);
  next.setDate(next.getDate() + days);
  return next;
}

function withDayOfMonth(year: number, monthIndex: number, day: number): Date {
  const dim = daysInMonth(year, monthIndex);
  if (day <= dim) {
    return new Date(year, monthIndex, day, 0, 0, 0, 0);
  }
  // Dia permitido inexistente no mês (ex. 30/fev) → primeiro dia permitido do mês seguinte.
  return withDayOfMonth(year, monthIndex + 1, day);
}

/**
 * Ajusta data para o próximo dia permitido do calendário do cliente.
 * Nunca antecipa. Se já for dia permitido, mantém.
 */
export function adjustToCustomerPaymentCalendar(
  date: Date,
  rule: PortfolioPaymentRule | null | undefined
): Date {
  const base = startOfLocalDay(date);
  if (!rule || !rule.isActive || !rule.moveToNextAllowedDay || rule.allowedDays.length === 0) {
    return base;
  }

  const allowed = [...rule.allowedDays].sort((a, b) => a - b);
  const day = base.getDate();
  if (allowed.includes(day)) return base;

  const year = base.getFullYear();
  const month = base.getMonth();

  for (const allowedDay of allowed) {
    if (allowedDay >= day) {
      const candidate = withDayOfMonth(year, month, allowedDay);
      // withDayOfMonth pode empurrar para o mês seguinte se o dia não existir;
      // ainda assim nunca fica antes de `base`.
      if (candidate.getTime() >= base.getTime()) return candidate;
    }
  }

  // Passou do último dia permitido do mês → primeiro permitido do mês seguinte.
  const first = allowed[0]!;
  return withDayOfMonth(year, month + 1, first);
}

/**
 * baseDate + termDays, depois calendário do cliente (se houver).
 * Sem regra: retorna baseDate + termDays sem ajuste.
 */
export function calculateProjectedReceiptDate(
  baseDate: Date,
  termDays: number,
  rule: PortfolioPaymentRule | null | undefined
): Date {
  const safeTerm = Number.isFinite(termDays) ? Math.trunc(termDays) : 0;
  const projected = addDays(baseDate, Math.max(0, safeTerm));
  return adjustToCustomerPaymentCalendar(projected, rule);
}

function pickNfeBaseDate(fact: PortfolioReconciliationFactDraft): Date | null {
  return fact.nfeProcessedAt ?? fact.stockDocumentDate ?? fact.forecastDate ?? null;
}

function pickOrderBaseDate(fact: PortfolioReconciliationFactDraft): Date | null {
  return fact.expectedDeliveryDate ?? fact.orderIssueDate ?? fact.forecastDate ?? null;
}

export type ApplyPortfolioPaymentCalendarInput = {
  facts: PortfolioReconciliationFactDraft[];
  /** Regras carregadas do DB (opcional). Britânia continua via fallback embutido. */
  rules?: readonly PortfolioPaymentRule[];
};

/**
 * Ajusta forecastDate das linhas NFE/ORDER pelo calendário do cliente.
 * RECEIVABLE: mantém vencimento real do CR (não recalcula).
 * UNRESOLVED: não projeta.
 */
export function applyPortfolioPaymentCalendarToFacts(
  input: ApplyPortfolioPaymentCalendarInput
): PortfolioReconciliationFactDraft[] {
  const rules = input.rules ?? [];

  return input.facts.map((fact) => {
    const source: PortfolioForecastSource = fact.forecastSource;
    if (source === "RECEIVABLE" || source === "UNRESOLVED") {
      return {
        ...fact,
        traceJson: {
          ...fact.traceJson,
          paymentCalendarApplied: false,
          paymentCalendarReason:
            source === "RECEIVABLE" ? "CR_DUE_DATE_SOVEREIGN" : "UNRESOLVED_NO_PROJECTION",
        },
      };
    }

    const rule = resolveCustomerPaymentRule(fact.customerExternalId, rules);
    if (!rule) {
      return {
        ...fact,
        traceJson: {
          ...fact.traceJson,
          paymentCalendarApplied: false,
          paymentCalendarReason: "NO_CUSTOMER_RULE",
        },
      };
    }

    const baseDate =
      source === "NFE" ? pickNfeBaseDate(fact) : pickOrderBaseDate(fact);
    if (!baseDate) {
      return {
        ...fact,
        traceJson: {
          ...fact.traceJson,
          paymentCalendarApplied: false,
          paymentCalendarReason: "MISSING_BASE_DATE",
        },
      };
    }

    const termDays = rule.defaultTermDays ?? 0;
    const adjusted = calculateProjectedReceiptDate(baseDate, termDays, rule);

    return {
      ...fact,
      forecastDate: adjusted,
      traceJson: {
        ...fact.traceJson,
        paymentCalendarApplied: true,
        paymentCalendarCustomerExternalId: rule.customerExternalId,
        paymentCalendarAllowedDays: rule.allowedDays,
        paymentCalendarBaseDate: baseDate.toISOString(),
        paymentCalendarTermDays: termDays,
        paymentCalendarAdjustedDate: adjusted.toISOString(),
      },
    };
  });
}
