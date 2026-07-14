/**
 * Cálculo gerencial/contratual — Encerramento de Prestação de Serviço.
 * Não é rescisão CLT. Lógica pura (sem Prisma / HTTP).
 */

export const DEFAULT_REST_DAYS_PER_YEAR = 20;
export const DAYS_PER_MONTH_FOR_DAILY_RATE = 30;
export const DAYS_PER_YEAR_FOR_PRO_RATA = 365;

export type ServiceTerminationCalculationMode = "WORKED_MONTHS" | "WORKED_DAYS";

export type ServiceTerminationCalcInput = {
  monthlyServiceAmount: number;
  monthlyHours: number;
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
  const monthlyHours = Math.max(0, asFinite(input.monthlyHours));
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

  const dailyServiceAmount = round2(monthlyServiceAmount / DAYS_PER_MONTH_FOR_DAILY_RATE);
  const hourlyServiceAmount =
    monthlyHours > 0 ? round2(monthlyServiceAmount / monthlyHours) : 0;
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
