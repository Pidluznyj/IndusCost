/**
 * Cálculo gerencial/contratual — Encerramento de Prestação de Serviço.
 * Não é rescisão CLT. Lógica pura (sem Prisma / HTTP).
 */

export const DEFAULT_REST_DAYS_PER_YEAR = 20;
/** Dias médios trabalhados/mês (padrão contratual para valor-dia). */
export const DEFAULT_AVERAGE_WORKED_DAYS_PER_MONTH = 30;
export const DEFAULT_HOURS_PER_DAY = 8;
export const DAYS_PER_YEAR_FOR_PRO_RATA = 365;

/** @deprecated use DEFAULT_AVERAGE_WORKED_DAYS_PER_MONTH */
export const DAYS_PER_MONTH_FOR_DAILY_RATE = DEFAULT_AVERAGE_WORKED_DAYS_PER_MONTH;

export type ServiceTerminationCalculationMode = "WORKED_MONTHS" | "WORKED_DAYS";

export type ServiceTerminationCalcInput = {
  monthlyServiceAmount: number;
  /**
   * Horas/mês. Se omitido ou 0, deriva de
   * averageWorkedDaysPerMonth × hoursPerDay.
   */
  monthlyHours?: number | null;
  /** Dias médios trabalhados por mês (base do valor-dia). */
  averageWorkedDaysPerMonth?: number | null;
  /** Horas por dia (base do valor-hora quando faltam horas/mês). */
  hoursPerDay?: number | null;
  restDaysPerYear?: number;
  calculationMode: ServiceTerminationCalculationMode;
  /** Informado ou derivado das datas. */
  workedMonths?: number | null;
  workedDays?: number | null;
  contractStartDate?: string | Date | null;
  contractEndDate?: string | Date | null;
  /** Dias no mês parcial do encerramento (ex.: 7). */
  extraWorkedDays?: number | null;
  /** Multa por encerramento sem aviso de 30 dias. */
  noticePenaltyAmount?: number | null;
  commissionReportTotal?: number | null;
  otherCredits?: number | null;
  otherDiscounts?: number | null;
};

export type ServiceTerminationCalcResult = {
  restDaysPerYear: number;
  averageWorkedDaysPerMonth: number;
  hoursPerDay: number;
  monthlyHours: number;
  calculationMode: ServiceTerminationCalculationMode;
  workedMonths: number;
  workedDays: number;
  proportionalRestDays: number;
  dailyServiceAmount: number;
  hourlyServiceAmount: number;
  proportionalRestAmount: number;
  extraWorkedDays: number;
  extraWorkedAmount: number;
  noticePenaltyAmount: number;
  commissionReportTotal: number;
  otherCredits: number;
  otherDiscounts: number;
  otherAdjustments: number;
  totalTerminationAmount: number;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

function asFinite(n: unknown, fallback = 0): number {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function parseDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  // YYYY-MM-DD como data civil local (evita deslocamento UTC → mês errado).
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Horas/mês = dias médios × horas/dia. */
export function deriveMonthlyHoursFromDayFactors(
  averageWorkedDaysPerMonth: number,
  hoursPerDay: number
): number {
  const days = Math.max(0, asFinite(averageWorkedDaysPerMonth));
  const hours = Math.max(0, asFinite(hoursPerDay));
  return round4(days * hours);
}

/** Meses civis completos entre início e fim (inclusive do mês final se >= 1 dia). */
export function countWorkedMonthsBetween(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined
): number {
  const a = parseDate(start);
  const b = parseDate(end);
  if (!a || !b || b.getTime() < a.getTime()) return 0;
  const months =
    (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
  return Math.max(0, months);
}

/** Dias corridos inclusivos. */
export function countWorkedDaysBetween(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined
): number {
  const a = parseDate(start);
  const b = parseDate(end);
  if (!a || !b || b.getTime() < a.getTime()) return 0;
  const ms = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
    Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  return Math.floor(ms / 86400000) + 1;
}

export function calculateServiceTermination(
  input: ServiceTerminationCalcInput
): ServiceTerminationCalcResult {
  const monthlyServiceAmount = Math.max(0, asFinite(input.monthlyServiceAmount));
  const averageWorkedDaysPerMonth = Math.max(
    0,
    asFinite(input.averageWorkedDaysPerMonth, DEFAULT_AVERAGE_WORKED_DAYS_PER_MONTH)
  );
  const hoursPerDay = Math.max(0, asFinite(input.hoursPerDay, DEFAULT_HOURS_PER_DAY));

  const derivedMonthlyHours = deriveMonthlyHoursFromDayFactors(
    averageWorkedDaysPerMonth,
    hoursPerDay
  );
  const monthlyHoursInput = asFinite(input.monthlyHours, NaN);
  const monthlyHours =
    Number.isFinite(monthlyHoursInput) && monthlyHoursInput > 0
      ? monthlyHoursInput
      : derivedMonthlyHours;

  const restDaysPerYear = Math.max(
    0,
    asFinite(input.restDaysPerYear, DEFAULT_REST_DAYS_PER_YEAR)
  );
  const mode = input.calculationMode === "WORKED_DAYS" ? "WORKED_DAYS" : "WORKED_MONTHS";

  let workedMonths = Math.max(0, asFinite(input.workedMonths));
  let workedDays = Math.max(0, asFinite(input.workedDays));

  if (
    (input.workedMonths == null || !Number.isFinite(Number(input.workedMonths))) &&
    input.contractStartDate &&
    input.contractEndDate
  ) {
    workedMonths = countWorkedMonthsBetween(input.contractStartDate, input.contractEndDate);
  }
  if (
    (input.workedDays == null || !Number.isFinite(Number(input.workedDays))) &&
    input.contractStartDate &&
    input.contractEndDate
  ) {
    workedDays = countWorkedDaysBetween(input.contractStartDate, input.contractEndDate);
  }

  const rawProportionalRestDays =
    mode === "WORKED_DAYS"
      ? restDaysPerYear * (workedDays / DAYS_PER_YEAR_FOR_PRO_RATA)
      : (restDaysPerYear / 12) * workedMonths;
  const proportionalRestDays = round4(rawProportionalRestDays);

  const dailyServiceAmount =
    averageWorkedDaysPerMonth > 0
      ? round2(monthlyServiceAmount / averageWorkedDaysPerMonth)
      : 0;
  const hourlyServiceAmount =
    monthlyHours > 0
      ? round2(monthlyServiceAmount / monthlyHours)
      : hoursPerDay > 0 && dailyServiceAmount > 0
        ? round2(dailyServiceAmount / hoursPerDay)
        : 0;
  // Usa dias crus para bater 6,666… → R$ 1.333,33 (não 6,6667 arredondado * 200).
  const proportionalRestAmount = round2(dailyServiceAmount * rawProportionalRestDays);

  const extraWorkedDays = Math.max(0, Math.round(asFinite(input.extraWorkedDays)));
  const extraWorkedAmount = round2(dailyServiceAmount * extraWorkedDays);
  const noticePenaltyAmount = Math.max(0, asFinite(input.noticePenaltyAmount));

  const commissionReportTotal = Math.max(0, asFinite(input.commissionReportTotal));
  const otherCredits = Math.max(0, asFinite(input.otherCredits));
  const otherDiscounts = Math.max(0, asFinite(input.otherDiscounts));
  const otherAdjustments = round2(otherCredits - otherDiscounts);
  const totalTerminationAmount = round2(
    proportionalRestAmount +
      extraWorkedAmount +
      noticePenaltyAmount +
      commissionReportTotal +
      otherAdjustments
  );

  return {
    restDaysPerYear,
    averageWorkedDaysPerMonth: round4(averageWorkedDaysPerMonth),
    hoursPerDay: round4(hoursPerDay),
    monthlyHours: round4(monthlyHours),
    calculationMode: mode,
    workedMonths: round4(workedMonths),
    workedDays: Math.round(workedDays),
    proportionalRestDays,
    dailyServiceAmount,
    hourlyServiceAmount,
    proportionalRestAmount,
    extraWorkedDays,
    extraWorkedAmount,
    noticePenaltyAmount: round2(noticePenaltyAmount),
    commissionReportTotal: round2(commissionReportTotal),
    otherCredits: round2(otherCredits),
    otherDiscounts: round2(otherDiscounts),
    otherAdjustments,
    totalTerminationAmount,
  };
}

export function formatProportionalRestDaysLabel(days: number): string {
  return days.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
