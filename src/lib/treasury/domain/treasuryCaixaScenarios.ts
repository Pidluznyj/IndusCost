/**
 * Motor puro dos três cenários da Caixa — Otimista / Realista / Pessimista.
 *
 * REGRA CENTRAL:
 *   - Passado (dia < asOfCivilDate) usa realizado do motor único-de-dia
 *     (canonicalDays da Fase 1) e é IGUAL nos três cenários.
 *   - Futuro (dia ≥ asOfCivilDate) projeta cada CR/CP em aberto pela regra
 *     do cenário, reutilizando `treasuryMovementDateRules` (o mesmo motor
 *     canônico de datas que a agenda usa hoje).
 *   - Cada cenário compartilha a MESMA população base (CR/CP), sem 3 loads
 *     independentes. Só a data projetada muda.
 *   - Saldo encadeia dia a dia por cenário:
 *       openingCenario(N) = closingCenario(N-1)
 *       closingCenario(N) = opening + realizedInflows − realizedOutflows
 *                                    + projectedInInScenario
 *                                    − projectedOutInScenario
 *
 * Não reescreve dueDate, não dá baixa, não move dinheiro. Só recoloca o
 * saldo em aberto do título numa data operacional dentro do cenário.
 */

import { compareCivilDates } from "@/src/lib/financeCivilDate.js";
import type { TreasuryCivilDate } from "../contracts/treasuryCivilDate.js";
import type { TreasuryScenarioPolicyDto } from "../contracts/treasuryScenarioPolicyContracts.js";
import type {
  TreasuryCaixaCanonicalDay,
  TreasuryCaixaCanonicalDayPayableTitle,
  TreasuryCaixaCanonicalDayReceivableTitle,
} from "./treasuryCaixaCanonicalDay.js";
import {
  resolvePayableMovementDate,
  resolveReceivableMovementDate,
  type TreasuryMovementDateResolution,
  type TreasuryPayableMovementDateInput,
  type TreasuryReceivableMovementDateInput,
} from "./treasuryMovementDateRules.js";

export const TREASURY_SCENARIO_LABELS = [
  "OPTIMISTIC",
  "REALISTIC",
  "PESSIMISTIC",
] as const;
export type TreasuryScenarioLabel = (typeof TREASURY_SCENARIO_LABELS)[number];

/** Origem operacional da data projetada — explica o "porquê" no drill-down. */
export type TreasuryScenarioReasonCode =
  | "REALIZED" // já baixado — fato realizado, não é projeção
  | "ACTIVE_PROMISE"
  | "EXPECTED_DATE"
  | "SCHEDULED_DATE"
  | "AUTHORIZED_SCHEDULE"
  | "PROGRAMMED_SCHEDULE"
  | "CONFIRMED_DATE"
  | "DUE_DATE"
  | "POLICY_PESSIMISTIC_DELAY"
  | "POLICY_OVERDUE_DELAY"
  | "UNRELIABLE";

export type TreasuryScenarioTitleProjection = {
  externalId: number;
  amount: number;
  projectedDate: string; // YYYY-MM-DD
  reasonCode: TreasuryScenarioReasonCode;
  reasonDetail: string;
  officialDueDate: string | null;
  personName: string | null;
  documentNumber?: string | null;
};

export type TreasuryScenarioDayFacts = {
  receivableInflows: number;
  payableOutflows: number;
  receivableCount: number;
  payableCount: number;
  receivableProjections: TreasuryScenarioTitleProjection[];
  payableProjections: TreasuryScenarioTitleProjection[];
  closingBalance: number | null;
};

export type TreasuryScenarioDay = {
  civilDate: string;
  openingBalance: number | null;
  /** Fatos passados COMUNS aos três cenários (baixas já realizadas). */
  realizedInflows: number;
  realizedOutflows: number;
  otherInflows: number;
  otherOutflows: number;
  optimistic: TreasuryScenarioDayFacts;
  realistic: TreasuryScenarioDayFacts;
  pessimistic: TreasuryScenarioDayFacts;
  warnings: string[];
};

export type TreasuryScenarioSummary = {
  scenario: TreasuryScenarioLabel;
  finalBalance: number | null;
  minBalance: number | null;
  minBalanceDate: string | null;
  firstNegativeDate: string | null;
  negativeDaysCount: number;
  /**
   * Necessidade máxima de caixa — quanto de caixa adicional seria preciso
   * para que o menor saldo do período não caia abaixo de zero. Zero quando
   * o menor saldo já é ≥ 0.
   */
  maxCashNeed: number;
  totalReceivableProjected: number;
  totalPayableProjected: number;
};

export type TreasuryScenarioConfidence = "HIGH" | "MEDIUM" | "LOW";

export type TreasuryScenarioComputationResult = {
  asOfCivilDate: string;
  days: TreasuryScenarioDay[];
  summaries: {
    optimistic: TreasuryScenarioSummary;
    realistic: TreasuryScenarioSummary;
    pessimistic: TreasuryScenarioSummary;
  };
  confidence: TreasuryScenarioConfidence;
  confidenceReasons: string[];
  /** Alertas de horizonte (globais), fora dos avisos por dia. */
  alerts: string[];
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clampFuture(
  candidate: string | null,
  asOfCivilDate: string
): string | null {
  if (!candidate) return null;
  // Nunca projetar em data passada. Se a regra escolheu uma data ≤ ontem,
  // sobe para hoje — mantém o dinheiro no futuro sem inventar antecipação.
  return compareCivilDates(candidate, asOfCivilDate) < 0 ? asOfCivilDate : candidate;
}

function addDaysCivil(civilDate: string, days: number): string {
  const [y, m, d] = civilDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function isCivilOverdue(dueDate: string | null, asOfCivilDate: string): boolean {
  if (!dueDate) return false;
  return compareCivilDates(dueDate, asOfCivilDate) < 0;
}

/**
 * Título CR/CP em aberto (ou parcial) do universo carregado. Nomes aderem
 * ao motor único-de-dia (canonicalDays) para reuso direto.
 */
export type TreasuryScenarioOpenReceivable =
  TreasuryCaixaCanonicalDayReceivableTitle & {
    activePromiseDate?: string | null;
    activePromiseStatus?: string | null;
    expectedDate?: string | null;
    confirmedDate?: string | null;
    hasBrokenPromise?: boolean;
  };

export type TreasuryScenarioOpenPayable =
  TreasuryCaixaCanonicalDayPayableTitle & {
    scheduledDate?: string | null;
    expectedDate?: string | null;
    confirmedDate?: string | null;
    programmingStatus?: string | null;
  };

export type TreasuryScenarioComputationInput = {
  /** Data-base (América/São Paulo). Passado (< asOf) só realizado. */
  asOfCivilDate: TreasuryCivilDate;
  /** Janela de dias civis a projetar (inclui asOf até o horizonte). */
  civilDatesInWindow: readonly string[];
  /** Motor único-de-dia — passado + hoje + realizado agregado. */
  canonicalDays: readonly TreasuryCaixaCanonicalDay[];
  /**
   * Universo de CR ainda em aberto (com complementos operacionais quando
   * existirem). O motor projeta cada um pela regra do cenário.
   */
  openReceivables: readonly TreasuryScenarioOpenReceivable[];
  openPayables: readonly TreasuryScenarioOpenPayable[];
  policy: TreasuryScenarioPolicyDto;
  /** Saldo de abertura da janela (do último realized day conhecido). */
  openingBalanceOfFirstDay: number | null;
};

function receivableMovementInput(
  title: TreasuryScenarioOpenReceivable
): TreasuryReceivableMovementDateInput {
  return {
    dueDate: title.dueDate,
    expectedDate: title.expectedDate ?? null,
    confirmedDate: title.confirmedDate ?? null,
    activePromiseDate: title.activePromiseDate ?? null,
    activePromiseStatus: title.activePromiseStatus ?? null,
  };
}

function payableMovementInput(
  title: TreasuryScenarioOpenPayable
): TreasuryPayableMovementDateInput {
  return {
    dueDate: title.dueDate,
    expectedDate: title.expectedDate ?? null,
    confirmedDate: title.confirmedDate ?? null,
    scheduledDate: title.scheduledDate ?? null,
    programmingStatus: title.programmingStatus ?? null,
  };
}

function toReason(
  resolution: TreasuryMovementDateResolution
): { code: TreasuryScenarioReasonCode; detail: string } {
  return { code: resolution.source as TreasuryScenarioReasonCode, detail: resolution.detail };
}

/**
 * REALISTA (AR) = PROBABLE (promessa ativa → expectedDate → dueDate
 *                  não vencido; vencido sem previsão fica UNRELIABLE).
 */
function projectReceivableRealistic(
  title: TreasuryScenarioOpenReceivable,
  asOfCivilDate: TreasuryCivilDate
): { projectedDate: string | null; reason: ReturnType<typeof toReason> } {
  const res = resolveReceivableMovementDate({
    scenario: "PROBABLE",
    asOfCivilDate,
    movement: receivableMovementInput(title),
  });
  return {
    projectedDate: clampFuture(res.resolvedDate, asOfCivilDate),
    reason: toReason(res),
  };
}

/**
 * OTIMISTA (AR) = a data favorável mais cedo entre as evidências operacionais
 * (promessa, expectedDate, confirmedDate ou realizedDate) e o dueDate se
 * anterior. Sem evidência: não antecipa (usa dueDate). Nunca antes do asOf.
 */
function projectReceivableOptimistic(
  title: TreasuryScenarioOpenReceivable,
  asOfCivilDate: TreasuryCivilDate
): { projectedDate: string | null; reason: ReturnType<typeof toReason> } {
  const candidates: Array<{
    date: string | null | undefined;
    code: TreasuryScenarioReasonCode;
    detail: string;
  }> = [
    {
      date: title.activePromiseDate,
      code: "ACTIVE_PROMISE",
      detail: "Otimista: promessa ativa é evidência favorável.",
    },
    {
      date: title.expectedDate,
      code: "EXPECTED_DATE",
      detail: "Otimista: data esperada operacional favorável.",
    },
    {
      date: title.confirmedDate,
      code: "CONFIRMED_DATE",
      detail: "Otimista: confirmação operacional favorável.",
    },
    {
      date: title.dueDate,
      code: "DUE_DATE",
      detail: "Otimista: vencimento oficial (sem evidência de antecipação).",
    },
  ];
  const withDate = candidates
    .filter((c) => typeof c.date === "string" && c.date !== "")
    .map((c) => ({ ...c, date: c.date as string }));
  if (withDate.length === 0) {
    return {
      projectedDate: null,
      reason: {
        code: "UNRELIABLE",
        detail: "Otimista: sem data operacional confiável.",
      },
    };
  }
  const earliest = withDate.reduce((best, cur) =>
    compareCivilDates(cur.date, best.date) < 0 ? cur : best
  );
  return {
    projectedDate: clampFuture(earliest.date, asOfCivilDate),
    reason: { code: earliest.code, detail: earliest.detail },
  };
}

/**
 * PESSIMISTA (AR) = REALISTA + atraso da política em títulos SEM evidência
 * operacional firme. Título com promessa ativa mantém a promessa; título
 * vencido sem nova expectativa usa `pessimisticOverdueReceivableDelayDays`
 * (ou o global quando null); promessa quebrada obedece a flag.
 */
function projectReceivablePessimistic(
  title: TreasuryScenarioOpenReceivable,
  asOfCivilDate: TreasuryCivilDate,
  policy: TreasuryScenarioPolicyDto
): { projectedDate: string | null; reason: ReturnType<typeof toReason> } {
  if (!policy.pessimisticEnabled) {
    // Se a política pessimista está desligada, o pessimista se comporta como
    // contratual (dueDate rígido, sem delay).
    const res = resolveReceivableMovementDate({
      scenario: "CONTRACTUAL",
      asOfCivilDate,
      movement: receivableMovementInput(title),
    });
    return {
      projectedDate: clampFuture(res.resolvedDate, asOfCivilDate),
      reason: toReason(res),
    };
  }

  // Base: promessa ativa se existir (não é substituída), senão realista
  // com regra especial de vencidos.
  const hasActivePromise =
    !!title.activePromiseDate &&
    (title.activePromiseStatus == null ||
      title.activePromiseStatus === "ACTIVE" ||
      title.activePromiseStatus === "PARTIALLY_FULFILLED");
  const overdue = isCivilOverdue(title.dueDate, asOfCivilDate);
  const brokenPromise =
    title.hasBrokenPromise === true ||
    title.activePromiseStatus === "BROKEN" ||
    title.activePromiseStatus === "EXPIRED";

  // Promessa ativa firme sem sinal de quebra: mantém.
  if (hasActivePromise && !brokenPromise) {
    return {
      projectedDate: clampFuture(title.activePromiseDate ?? null, asOfCivilDate),
      reason: {
        code: "ACTIVE_PROMISE",
        detail:
          "Pessimista: promessa ativa firme mantida (sem sinal de quebra).",
      },
    };
  }

  // Promessa quebrada + política de aplicar delay → soma delay ao dueDate.
  if (
    brokenPromise &&
    policy.pessimisticTreatBrokenPromiseAsDelayed &&
    title.dueDate
  ) {
    const base = title.dueDate.slice(0, 10);
    const shifted = addDaysCivil(base, policy.pessimisticReceivableDelayDays);
    return {
      projectedDate: clampFuture(shifted, asOfCivilDate),
      reason: {
        code: "POLICY_PESSIMISTIC_DELAY",
        detail: `Pessimista: promessa quebrada → dueDate +${policy.pessimisticReceivableDelayDays} dias (política).`,
      },
    };
  }

  // Vencido sem nova expectativa: usa delay específico (ou global).
  if (overdue && !title.expectedDate && !hasActivePromise) {
    const delay =
      policy.pessimisticOverdueReceivableDelayDays ??
      policy.pessimisticReceivableDelayDays;
    const shifted = addDaysCivil(title.dueDate!.slice(0, 10), delay);
    return {
      projectedDate: clampFuture(shifted, asOfCivilDate),
      reason: {
        code: "POLICY_OVERDUE_DELAY",
        detail: `Pessimista: vencido sem nova expectativa → dueDate +${delay} dias (política).`,
      },
    };
  }

  // Sem evidência operacional (nem promessa nem expected/confirmed) e dueDate
  // no futuro: aplica delay em cima do dueDate.
  const hasEvidence =
    !!title.expectedDate || !!title.confirmedDate || hasActivePromise;
  if (!hasEvidence && title.dueDate) {
    const base = title.dueDate.slice(0, 10);
    const shifted = addDaysCivil(base, policy.pessimisticReceivableDelayDays);
    return {
      projectedDate: clampFuture(shifted, asOfCivilDate),
      reason: {
        code: "POLICY_PESSIMISTIC_DELAY",
        detail: `Pessimista: sem evidência operacional → dueDate +${policy.pessimisticReceivableDelayDays} dias (política).`,
      },
    };
  }

  // Com expected/confirmed (mas sem promessa firme): mantém o realista.
  return projectReceivableRealistic(title, asOfCivilDate);
}

/**
 * REALISTA (AP) = PROBABLE (scheduledDate → expectedDate → dueDate).
 */
function projectPayableRealistic(
  title: TreasuryScenarioOpenPayable,
  asOfCivilDate: TreasuryCivilDate
): { projectedDate: string | null; reason: ReturnType<typeof toReason> } {
  const res = resolvePayableMovementDate({
    scenario: "PROBABLE",
    asOfCivilDate,
    movement: payableMovementInput(title),
  });
  return {
    projectedDate: clampFuture(res.resolvedDate, asOfCivilDate),
    reason: toReason(res),
  };
}

/**
 * OTIMISTA (AP) = maior data plausível entre programação/expected/due; sem
 * evidência posterior, usa o dueDate. Nunca posterga além do evidenciado.
 */
function projectPayableOptimistic(
  title: TreasuryScenarioOpenPayable,
  asOfCivilDate: TreasuryCivilDate
): { projectedDate: string | null; reason: ReturnType<typeof toReason> } {
  const candidates: Array<{
    date: string | null | undefined;
    code: TreasuryScenarioReasonCode;
    detail: string;
  }> = [
    {
      date: title.scheduledDate,
      code: "SCHEDULED_DATE",
      detail: "Otimista: programação registrada define a data mais tardia.",
    },
    {
      date: title.expectedDate,
      code: "EXPECTED_DATE",
      detail: "Otimista: data esperada registrada.",
    },
    {
      date: title.confirmedDate,
      code: "CONFIRMED_DATE",
      detail: "Otimista: confirmação operacional.",
    },
    {
      date: title.dueDate,
      code: "DUE_DATE",
      detail: "Otimista: vencimento oficial (sem evidência de postergação).",
    },
  ];
  const withDate = candidates
    .filter((c) => typeof c.date === "string" && c.date !== "")
    .map((c) => ({ ...c, date: c.date as string }));
  if (withDate.length === 0) {
    return {
      projectedDate: null,
      reason: { code: "UNRELIABLE", detail: "Otimista: sem data confiável." },
    };
  }
  const latest = withDate.reduce((best, cur) =>
    compareCivilDates(cur.date, best.date) > 0 ? cur : best
  );
  return {
    projectedDate: clampFuture(latest.date, asOfCivilDate),
    reason: { code: latest.code, detail: latest.detail },
  };
}

/**
 * PESSIMISTA (AP) = data mais EXIGENTE (mais cedo) sem duplicar. Programação
 * confirmada antes do due é usada; expected anterior válida é usada; senão
 * dueDate. Nunca inventa antecipação.
 */
function projectPayablePessimistic(
  title: TreasuryScenarioOpenPayable,
  asOfCivilDate: TreasuryCivilDate
): { projectedDate: string | null; reason: ReturnType<typeof toReason> } {
  const candidates: Array<{
    date: string | null | undefined;
    code: TreasuryScenarioReasonCode;
    detail: string;
  }> = [
    {
      date: title.scheduledDate,
      code: "SCHEDULED_DATE",
      detail: "Pessimista: programação confirmada.",
    },
    {
      date: title.expectedDate,
      code: "EXPECTED_DATE",
      detail: "Pessimista: expected anterior válido.",
    },
    {
      date: title.dueDate,
      code: "DUE_DATE",
      detail: "Pessimista: vencimento oficial.",
    },
  ];
  const withDate = candidates
    .filter((c) => typeof c.date === "string" && c.date !== "")
    .map((c) => ({ ...c, date: c.date as string }));
  if (withDate.length === 0) {
    return {
      projectedDate: null,
      reason: {
        code: "UNRELIABLE",
        detail: "Pessimista: sem data confiável.",
      },
    };
  }
  const earliest = withDate.reduce((best, cur) =>
    compareCivilDates(cur.date, best.date) < 0 ? cur : best
  );
  return {
    projectedDate: clampFuture(earliest.date, asOfCivilDate),
    reason: { code: earliest.code, detail: earliest.detail },
  };
}

function amountOf(title: { balanceReceivable?: number; balancePayable?: number }): number {
  if ("balanceReceivable" in title && typeof title.balanceReceivable === "number") {
    return title.balanceReceivable;
  }
  if ("balancePayable" in title && typeof title.balancePayable === "number") {
    return title.balancePayable;
  }
  return 0;
}

function personName(t: { personName: string | null }): string | null {
  return t.personName;
}

/**
 * Constrói o resultado dos três cenários, dia a dia, para a janela pedida.
 * Reuso máximo: canonicalDays já traz opening + realized do passado; só o
 * FUTURO ganha três projeções (uma por cenário).
 */
export function computeTreasuryCaixaScenarios(
  input: TreasuryScenarioComputationInput
): TreasuryScenarioComputationResult {
  const asOf = input.asOfCivilDate;

  // Índice rápido dos dias canônicos, para reuso do realizado por dia.
  const canonicalByDay = new Map<string, TreasuryCaixaCanonicalDay>();
  for (const d of input.canonicalDays) canonicalByDay.set(d.civilDate, d);

  // Projeção de cada AR/AP nos três cenários — feito uma única vez.
  type ArProjBucket = Map<string, TreasuryScenarioTitleProjection[]>;
  type ApProjBucket = ArProjBucket;
  function emptyByCivilDate(): ArProjBucket {
    return new Map();
  }

  const arOpt = emptyByCivilDate();
  const arReal = emptyByCivilDate();
  const arPes = emptyByCivilDate();
  const apOpt = emptyByCivilDate();
  const apReal = emptyByCivilDate();
  const apPes = emptyByCivilDate();

  function bucket(map: ArProjBucket, date: string): TreasuryScenarioTitleProjection[] {
    let existing = map.get(date);
    if (existing) return existing;
    existing = [];
    map.set(date, existing);
    return existing;
  }

  function push(
    map: ArProjBucket,
    date: string | null,
    proj: TreasuryScenarioTitleProjection
  ) {
    if (!date) return;
    bucket(map, date).push(proj);
  }

  // ── AR ────────────────────────────────────────────────────────────────
  for (const r of input.openReceivables) {
    // Só projeta se sobra saldo.
    const amount = amountOf(r);
    if (!(amount > 0)) continue;

    const optimistic = projectReceivableOptimistic(r, asOf);
    const realistic = projectReceivableRealistic(r, asOf);
    const pessimistic = projectReceivablePessimistic(r, asOf, input.policy);

    const base = {
      externalId: r.externalId,
      amount: roundMoney(amount),
      officialDueDate: r.dueDate?.slice(0, 10) ?? null,
      personName: personName(r),
      documentNumber: r.documentNumber ?? null,
    };
    push(arOpt, optimistic.projectedDate, {
      ...base,
      projectedDate: optimistic.projectedDate!,
      reasonCode: optimistic.reason.code,
      reasonDetail: optimistic.reason.detail,
    });
    push(arReal, realistic.projectedDate, {
      ...base,
      projectedDate: realistic.projectedDate!,
      reasonCode: realistic.reason.code,
      reasonDetail: realistic.reason.detail,
    });
    push(arPes, pessimistic.projectedDate, {
      ...base,
      projectedDate: pessimistic.projectedDate!,
      reasonCode: pessimistic.reason.code,
      reasonDetail: pessimistic.reason.detail,
    });
  }

  // ── AP ────────────────────────────────────────────────────────────────
  for (const p of input.openPayables) {
    const amount = amountOf(p);
    if (!(amount > 0)) continue;

    const optimistic = projectPayableOptimistic(p, asOf);
    const realistic = projectPayableRealistic(p, asOf);
    const pessimistic = projectPayablePessimistic(p, asOf);

    const base = {
      externalId: p.externalId,
      amount: roundMoney(amount),
      officialDueDate: p.dueDate?.slice(0, 10) ?? null,
      personName: personName(p),
      documentNumber: p.documentNumber ?? null,
    };
    push(apOpt, optimistic.projectedDate, {
      ...base,
      projectedDate: optimistic.projectedDate!,
      reasonCode: optimistic.reason.code,
      reasonDetail: optimistic.reason.detail,
    });
    push(apReal, realistic.projectedDate, {
      ...base,
      projectedDate: realistic.projectedDate!,
      reasonCode: realistic.reason.code,
      reasonDetail: realistic.reason.detail,
    });
    push(apPes, pessimistic.projectedDate, {
      ...base,
      projectedDate: pessimistic.projectedDate!,
      reasonCode: pessimistic.reason.code,
      reasonDetail: pessimistic.reason.detail,
    });
  }

  // ── Encadeia saldo dia a dia por cenário ───────────────────────────────
  const sortedDays = [...input.civilDatesInWindow].sort();
  const days: TreasuryScenarioDay[] = [];

  let openOpt: number | null =
    input.openingBalanceOfFirstDay != null
      ? roundMoney(input.openingBalanceOfFirstDay)
      : null;
  let openReal: number | null = openOpt;
  let openPes: number | null = openOpt;

  let confidenceLoad = { withEvidence: 0, projected: 0 };
  const alerts: string[] = [];
  let overdueAndOpen = 0;
  let usedPessimisticDelayValue = 0;

  for (const civilDate of sortedDays) {
    const canon = canonicalByDay.get(civilDate);
    const realizedInflows = canon?.realizedInflows ?? 0;
    const realizedOutflows = canon?.realizedOutflows ?? 0;
    const otherInflows = canon?.otherInflows ?? 0;
    const otherOutflows = canon?.otherOutflows ?? 0;

    // Passado: apenas realized (sem projeção). Futuro: soma projeções do cenário.
    const isFuture = compareCivilDates(civilDate, asOf) >= 0;

    function facts(
      arBucket: ArProjBucket,
      apBucket: ApProjBucket,
      opening: number | null
    ): TreasuryScenarioDayFacts {
      const arList = isFuture ? arBucket.get(civilDate) ?? [] : [];
      const apList = isFuture ? apBucket.get(civilDate) ?? [] : [];
      const receivableInflows = arList.reduce((s, x) => s + x.amount, 0);
      const payableOutflows = apList.reduce((s, x) => s + x.amount, 0);
      const projected = opening == null
        ? null
        : roundMoney(
            opening +
              realizedInflows +
              receivableInflows -
              realizedOutflows -
              payableOutflows
          );
      return {
        receivableInflows: roundMoney(receivableInflows),
        payableOutflows: roundMoney(payableOutflows),
        receivableCount: arList.length,
        payableCount: apList.length,
        receivableProjections: arList,
        payableProjections: apList,
        closingBalance: projected,
      };
    }

    const warnings: string[] = [];
    if (openOpt == null && days.length === 0) {
      warnings.push(
        "Saldo inicial da janela indisponível — cenários não podem calcular fechamento até que ao menos uma origem informe saldo."
      );
    }
    if (canon && canon.warnings.some((w) => w.code === "OTHER_MOVEMENTS_NOT_LOADED")) {
      warnings.push(
        "Ledger/transferência não carregados neste dia — 'Outros' podem estar subestimados."
      );
    }

    const optimistic = facts(arOpt, apOpt, openOpt);
    const realistic = facts(arReal, apReal, openReal);
    const pessimistic = facts(arPes, apPes, openPes);

    // Confiança global: só considera dias FUTUROS.
    if (isFuture) {
      for (const arr of [
        realistic.receivableProjections,
        realistic.payableProjections,
      ]) {
        for (const proj of arr) {
          confidenceLoad.projected += proj.amount;
          if (
            proj.reasonCode === "ACTIVE_PROMISE" ||
            proj.reasonCode === "EXPECTED_DATE" ||
            proj.reasonCode === "SCHEDULED_DATE" ||
            proj.reasonCode === "AUTHORIZED_SCHEDULE" ||
            proj.reasonCode === "PROGRAMMED_SCHEDULE" ||
            proj.reasonCode === "CONFIRMED_DATE"
          ) {
            confidenceLoad.withEvidence += proj.amount;
          }
          if (proj.reasonCode === "POLICY_PESSIMISTIC_DELAY") {
            // não conta na composição do realista.
          }
        }
      }
      for (const proj of pessimistic.receivableProjections) {
        if (
          proj.reasonCode === "POLICY_PESSIMISTIC_DELAY" ||
          proj.reasonCode === "POLICY_OVERDUE_DELAY"
        ) {
          usedPessimisticDelayValue += proj.amount;
        }
      }
      overdueAndOpen += realistic.receivableProjections.filter(
        (p) => p.reasonCode === "UNRELIABLE"
      ).length;
    }

    days.push({
      civilDate,
      openingBalance: openOpt, // usa opt como referência de "início do dia"
      // (todos os três compartilham o MESMO saldo inicial no primeiro dia;
      // depois divergem — cada facts.closingBalance leva seu próprio open).
      realizedInflows,
      realizedOutflows,
      otherInflows,
      otherOutflows,
      optimistic,
      realistic,
      pessimistic,
      warnings,
    });

    openOpt = optimistic.closingBalance;
    openReal = realistic.closingBalance;
    openPes = pessimistic.closingBalance;
  }

  // ── Sumários por cenário ──────────────────────────────────────────────
  function summarize(
    days: readonly TreasuryScenarioDay[],
    scenario: TreasuryScenarioLabel
  ): TreasuryScenarioSummary {
    let finalBalance: number | null = null;
    let minBalance: number | null = null;
    let minBalanceDate: string | null = null;
    let firstNegativeDate: string | null = null;
    let negativeDaysCount = 0;
    let totalReceivable = 0;
    let totalPayable = 0;

    for (const d of days) {
      const facts = d[scenario === "OPTIMISTIC" ? "optimistic" : scenario === "REALISTIC" ? "realistic" : "pessimistic"];
      totalReceivable += facts.receivableInflows;
      totalPayable += facts.payableOutflows;
      const closing = facts.closingBalance;
      if (closing != null) {
        finalBalance = closing;
        if (minBalance == null || closing < minBalance) {
          minBalance = closing;
          minBalanceDate = d.civilDate;
        }
        if (closing < 0) {
          negativeDaysCount += 1;
          if (firstNegativeDate == null) firstNegativeDate = d.civilDate;
        }
      }
    }

    const maxCashNeed = minBalance != null && minBalance < 0
      ? roundMoney(-minBalance)
      : 0;

    return {
      scenario,
      finalBalance,
      minBalance,
      minBalanceDate,
      firstNegativeDate,
      negativeDaysCount,
      maxCashNeed,
      totalReceivableProjected: roundMoney(totalReceivable),
      totalPayableProjected: roundMoney(totalPayable),
    };
  }

  const summaries = {
    optimistic: summarize(days, "OPTIMISTIC"),
    realistic: summarize(days, "REALISTIC"),
    pessimistic: summarize(days, "PESSIMISTIC"),
  };

  // Confiabilidade operacional: proporção do valor projetado (Realista) que
  // tem evidência (promessa/expected/scheduled/confirmed) sobre o total.
  let confidence: TreasuryScenarioConfidence = "MEDIUM";
  const reasons: string[] = [];
  if (confidenceLoad.projected > 0) {
    const ratio = confidenceLoad.withEvidence / confidenceLoad.projected;
    if (ratio >= 0.7) {
      confidence = "HIGH";
      reasons.push(
        `Realista: ${(ratio * 100).toFixed(0)}% do valor projetado tem evidência operacional (promessa/expected/scheduled/confirmed).`
      );
    } else if (ratio < 0.3) {
      confidence = "LOW";
      reasons.push(
        `Realista: apenas ${(ratio * 100).toFixed(0)}% do valor projetado tem evidência operacional — o resto usa fallback do vencimento.`
      );
    } else {
      confidence = "MEDIUM";
      reasons.push(
        `Realista: ${(ratio * 100).toFixed(0)}% do valor projetado tem evidência operacional.`
      );
    }
  } else {
    reasons.push("Nenhum valor projetado no horizonte pedido.");
  }
  if (openOpt == null && input.openingBalanceOfFirstDay == null) {
    confidence = "LOW";
    reasons.push(
      "Saldo inicial da janela indisponível — projeção fica sem âncora."
    );
  }
  if (overdueAndOpen > 0) {
    reasons.push(
      `${overdueAndOpen} título(s) de CR vencidos sem nova expectativa (não entram na projeção Realista, mas geram risco).`
    );
    alerts.push(
      `Há ${overdueAndOpen} CR vencido(s) sem nova promessa. Não somam na projeção Realista.`
    );
  }
  if (usedPessimisticDelayValue > 0) {
    alerts.push(
      `O cenário Pessimista usou atraso padrão de ${input.policy.pessimisticReceivableDelayDays} dias em R$ ${roundMoney(
        usedPessimisticDelayValue
      ).toFixed(2)} de CR.`
    );
  }

  return {
    asOfCivilDate: asOf,
    days,
    summaries,
    confidence,
    confidenceReasons: reasons,
    alerts,
  };
}
