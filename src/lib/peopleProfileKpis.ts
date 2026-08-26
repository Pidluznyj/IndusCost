/**
 * KPIs da ficha funcional — tempo de casa e marcos de carreira/reajuste.
 * Nunca persiste "tempo de casa". Sem valores monetários.
 */

import {
  HR_COMPENSATION_TYPE_LABELS,
  HR_HISTORY_EVENT_LABELS,
  type HrCompensationAdjustmentType,
  type HrEmployeeHistoryEventType,
} from "./peopleProfileTypes.js";

export function parseIsoDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatPtBrDate(value: string | Date | null | undefined): string {
  const parsed = parseIsoDate(value);
  if (!parsed) return "Não informado";
  return parsed.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

export type TenureParts = { years: number; months: number; totalMonths: number };

export function computeTenureParts(
  admissionDate: string | Date | null | undefined,
  now: Date = new Date()
): TenureParts | null {
  const start = parseIsoDate(admissionDate);
  if (!start) return null;
  if (start.getTime() > now.getTime()) return { years: 0, months: 0, totalMonths: 0 };

  let years = now.getUTCFullYear() - start.getUTCFullYear();
  let months = now.getUTCMonth() - start.getUTCMonth();
  if (now.getUTCDate() < start.getUTCDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 0) return { years: 0, months: 0, totalMonths: 0 };
  return { years, months, totalMonths: years * 12 + months };
}

/** Ex.: "7 anos e 2 meses". Sempre calculado. */
export function formatTenureLabel(
  admissionDate: string | Date | null | undefined,
  now: Date = new Date()
): string | null {
  const parts = computeTenureParts(admissionDate, now);
  if (!parts) return null;
  const { years, months } = parts;
  if (years === 0 && months === 0) return "Menos de 1 mês";
  const yearPart =
    years === 0 ? "" : years === 1 ? "1 ano" : `${years} anos`;
  const monthPart =
    months === 0 ? "" : months === 1 ? "1 mês" : `${months} meses`;
  if (yearPart && monthPart) return `${yearPart} e ${monthPart}`;
  return yearPart || monthPart;
}

export function formatElapsedSince(
  from: string | Date | null | undefined,
  now: Date = new Date()
): string | null {
  return formatTenureLabel(from, now);
}

export function computeAdjustmentPercentage(
  previousAmount: number | null | undefined,
  newAmount: number | null | undefined
): number | null {
  const prev = Number(previousAmount);
  const next = Number(newAmount);
  if (!Number.isFinite(prev) || !Number.isFinite(next) || prev === 0) return null;
  const pct = ((next - prev) / prev) * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.round(pct * 100) / 100;
}

export type CareerLikeEvent = {
  eventType: string;
  effectiveDate: string | Date;
  newRoleName?: string | null;
  previousRoleName?: string | null;
};

export type AdjustmentLikeEvent = {
  effectiveDate: string | Date;
  percentage?: number | null;
  type?: string | null;
};

export function pickLastPromotion(events: CareerLikeEvent[]): CareerLikeEvent | null {
  const promotions = events.filter((e) => e.eventType === "PROMOTION");
  if (promotions.length === 0) return null;
  return [...promotions].sort(
    (a, b) => parseIsoDate(b.effectiveDate)!.getTime() - parseIsoDate(a.effectiveDate)!.getTime()
  )[0];
}

export function pickLastAdjustment(events: AdjustmentLikeEvent[]): AdjustmentLikeEvent | null {
  if (events.length === 0) return null;
  return [...events].sort(
    (a, b) => parseIsoDate(b.effectiveDate)!.getTime() - parseIsoDate(a.effectiveDate)!.getTime()
  )[0];
}

export function formatPromotionSummary(event: CareerLikeEvent | null): string | null {
  if (!event) return null;
  const from = (event.previousRoleName ?? "").trim();
  const to = (event.newRoleName ?? "").trim();
  if (from && to) return `${from} → ${to}`;
  return to || from || HR_HISTORY_EVENT_LABELS.PROMOTION;
}

export function compensationTypeLabel(type: string | null | undefined): string | null {
  if (!type) return null;
  return (
    HR_COMPENSATION_TYPE_LABELS[type as HrCompensationAdjustmentType] ?? type
  );
}

export function historyEventLabel(eventType: string): string {
  return (
    HR_HISTORY_EVENT_LABELS[eventType as HrEmployeeHistoryEventType] ?? eventType
  );
}

export function toIsoDateString(value: Date | string | null | undefined): string | null {
  const parsed = parseIsoDate(value);
  return parsed ? parsed.toISOString() : null;
}
