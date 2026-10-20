/**
 * Agenda semanal de CNPJ: domingo, 08:00, America/Sao_Paulo.
 * O fuso é lido pelo IANA. O instante das 08:00 usa o offset atual dessa data,
 * então o horário civil permanece 08:00 mesmo que a regra de verão mude.
 */

export const CNPJ_WEEKLY_REFRESH_TIMEZONE = "America/Sao_Paulo" as const;
export const CNPJ_WEEKLY_REFRESH_JOB_ID = "cnpj-weekly-refresh" as const;
export const CNPJ_WEEKLY_REFRESH_WEEKDAY = 0;
export const CNPJ_WEEKLY_REFRESH_HOUR = 8;
export const CNPJ_WEEKLY_REFRESH_MINUTE = 0;
export const CNPJ_WEEKLY_REFRESH_CRON = "0 8 * * 0";

export const CNPJ_WEEKLY_REFRESH_REGISTERED_JOB = {
  id: CNPJ_WEEKLY_REFRESH_JOB_ID,
  name: "Atualização semanal de CNPJ",
  timezone: CNPJ_WEEKLY_REFRESH_TIMEZONE,
  schedule: "domingo 08:00",
  cronExpression: CNPJ_WEEKLY_REFRESH_CRON,
  runsOnWeekdaysOnly: false,
  slots: [{ slot: "WEEKLY", time: "08:00" }],
  description:
    "Consulta cadastral semanal dos CNPJs válidos de clientes e fornecedores. Não altera o cadastro operacional do Nomus e não libera crédito.",
} as const;

export type SaoPauloDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
  dateIso: string;
};

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getCnpjRefreshSaoPauloParts(at: Date = new Date()): SaoPauloDateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: CNPJ_WEEKLY_REFRESH_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = formatter.formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const weekdayName = parts.find((part) => part.type === "weekday")?.value ?? "";
  const year = read("year");
  const month = read("month");
  const day = read("day");
  let hour = read("hour");
  if (hour === 24) hour = 0;
  return {
    year,
    month,
    day,
    hour,
    minute: read("minute"),
    weekday: WEEKDAY_MAP[weekdayName] ?? 0,
    dateIso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

export function isCnpjWeeklyRefreshInstant(parts: Pick<SaoPauloDateTimeParts, "weekday" | "hour" | "minute">): boolean {
  return (
    parts.weekday === CNPJ_WEEKLY_REFRESH_WEEKDAY &&
    parts.hour === CNPJ_WEEKLY_REFRESH_HOUR &&
    parts.minute === CNPJ_WEEKLY_REFRESH_MINUTE
  );
}

function shiftIsoDate(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const utc = new Date(Date.UTC(year!, month! - 1, day!));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/** Instante UTC correspondente a domingo 08:00 no horário civil de São Paulo. */
export function cnpjWeeklyRefreshInstant(slot: string): Date {
  const [year, month, day] = slot.split("-").map(Number);
  const guess = new Date(Date.UTC(year!, month! - 1, day!, CNPJ_WEEKLY_REFRESH_HOUR, CNPJ_WEEKLY_REFRESH_MINUTE));
  const shown = getCnpjRefreshSaoPauloParts(guess);
  const shownAsUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute);
  const wantedAsUtc = Date.UTC(year!, month! - 1, day!, CNPJ_WEEKLY_REFRESH_HOUR, CNPJ_WEEKLY_REFRESH_MINUTE);
  return new Date(guess.getTime() + (wantedAsUtc - shownAsUtc));
}

export function sundayOnOrBefore(dateIso: string, weekday: number): string {
  return shiftIsoDate(dateIso, -weekday);
}

export function dueCnpjWeeklyRefreshSlot(at: Date = new Date()): string {
  const parts = getCnpjRefreshSaoPauloParts(at);
  const thisSunday = sundayOnOrBefore(parts.dateIso, parts.weekday);
  const instant = cnpjWeeklyRefreshInstant(thisSunday);
  if (at.getTime() >= instant.getTime()) return thisSunday;
  return shiftIsoDate(thisSunday, -7);
}

export function nextCnpjWeeklyRefresh(at: Date = new Date()): { slot: string; at: Date } {
  const parts = getCnpjRefreshSaoPauloParts(at);
  const thisSunday = sundayOnOrBefore(parts.dateIso, parts.weekday);
  const instant = cnpjWeeklyRefreshInstant(thisSunday);
  if (at.getTime() < instant.getTime()) return { slot: thisSunday, at: instant };
  const next = shiftIsoDate(thisSunday, 7);
  return { slot: next, at: cnpjWeeklyRefreshInstant(next) };
}
