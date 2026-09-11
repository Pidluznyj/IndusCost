/**
 * Motor canônico de recompra do CRM — V1
 * (`LAST_6_DISTINCT_PURCHASE_DAYS_MEAN_V1`).
 *
 * Módulo PURO: sem Prisma, sem Express, sem React. Recebe fatos de compra já
 * selecionados pela população canônica de Pedido de Venda e devolve a
 * cadência. Não decide o que é pedido válido — quem chama já passou pelo
 * `crmCanonicalSalesOrderWhere`.
 *
 * Regras:
 *   - Compra = Pedido de Venda; data = `SalesOrder.issueDate`.
 *   - OCASIÃO de compra = dia de calendário LOCAL distinto. Três pedidos no
 *     mesmo dia são 3 pedidos (quantidade/valor) e 1 ocasião (recompra).
 *   - Usa as ÚLTIMAS 6 ocasiões distintas → no máximo 5 intervalos.
 *   - Média aritmética simples dos intervalos, com precisão interna total.
 *     Arredonda (meio para cima) SÓ para achar a data esperada.
 *   - Data esperada = última ocasião + round(média).
 *   - deltaDays = hoje − data esperada (dias de calendário, nunca ms/24h).
 *   - Sem remoção de outliers nesta V1.
 *
 * Dias de calendário: `nomusDateTimeToCivilKey` (mesmo fuso operacional do
 * filtro canônico de emissão) e aritmética de chave civil de
 * `financeCivilDate` — nada de dividir milissegundos por 86.400.000.
 */

import { addCivilDays, diffCivilDays } from "@/src/lib/financeCivilDate.js";
import { nomusDateTimeToCivilKey } from "@/src/lib/nomusDateTime.js";
import {
  CRM_REPURCHASE_ENGINE_VERSION,
  type CrmCadenceConfidence,
  type CrmRepurchaseEngineVersion,
  type CrmRepurchaseForecastStatus,
  type CrmRepurchaseStatus,
} from "@/src/lib/commercial/crmReportsTypes.js";

/** Quantas ocasiões distintas (as mais recentes) entram na média. */
export const REPURCHASE_MAX_OCCASIONS = 6;
/** Consequência direta: no máximo 5 intervalos. */
export const REPURCHASE_MAX_INTERVALS = REPURCHASE_MAX_OCCASIONS - 1;
/** Janela "vence em breve": −15 ≤ deltaDays ≤ 0. */
export const REPURCHASE_DUE_SOON_DAYS = 15;
/** Acima disso o atraso é grave: deltaDays > 30. */
export const REPURCHASE_SEVERE_OVERDUE_DAYS = 30;

const BUSINESS_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Chave `YYYY-MM-DD` real (rejeita 2026-02-30, mês 13 etc.). */
export function isValidBusinessDate(value: string | null | undefined): value is string {
  if (typeof value !== "string") return false;
  const match = BUSINESS_DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function assertBusinessDate(value: string, label: string): string {
  if (!isValidBusinessDate(value)) {
    throw new RangeError(`${label} precisa ser uma data YYYY-MM-DD válida; recebido "${value}"`);
  }
  return value;
}

/**
 * Dia de compra (calendário local) de um `issueDate`.
 * - `Date` → dia civil no fuso operacional do servidor;
 * - `"YYYY-MM-DD"` → usado como está (já é dia civil);
 * - string ISO com hora → interpretada como instante e convertida.
 */
export function toBusinessDate(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (BUSINESS_DATE_RE.test(trimmed)) return isValidBusinessDate(trimmed) ? trimmed : null;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : nomusDateTimeToCivilKey(parsed);
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return nomusDateTimeToCivilKey(value);
}

/** Dias de calendário de `from` até `to` (positivo quando `to` é depois). */
export function businessDaysBetween(from: string, to: string): number {
  assertBusinessDate(from, "from");
  assertBusinessDate(to, "to");
  return diffCivilDays(from, to);
}

export function addBusinessDays(date: string, days: number): string {
  assertBusinessDate(date, "date");
  if (!Number.isInteger(days)) {
    throw new RangeError(`days precisa ser inteiro; recebido ${days}`);
  }
  const result = addCivilDays(date, days);
  if (!result) throw new RangeError(`não foi possível somar ${days} dia(s) a ${date}`);
  return result;
}

function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/** Soma/subtrai meses de calendário ajustando fim de mês (31/03 − 1 mês → 28 ou 29/02). */
export function addBusinessMonths(date: string, months: number): string {
  assertBusinessDate(date, "date");
  if (!Number.isInteger(months)) {
    throw new RangeError(`months precisa ser inteiro; recebido ${months}`);
  }
  const match = BUSINESS_DATE_RE.exec(date)!;
  const year = Number(match[1]);
  const month0 = Number(match[2]) - 1 + months;
  const targetYear = year + Math.floor(month0 / 12);
  const targetMonth = ((month0 % 12) + 12) % 12 + 1;
  const targetDay = Math.min(Number(match[3]), daysInMonth(targetYear, targetMonth));
  return `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

export type BusinessDateWindow = { from: string; to: string };

/** Janela móvel de N dias que INCLUI hoje: [hoje − (N − 1), hoje]. 60 → hoje + 59 anteriores. */
export function resolveRollingDaysWindow(
  today: string,
  days: number
): BusinessDateWindow & { days: number } {
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError(`days precisa ser inteiro ≥ 1; recebido ${days}`);
  }
  return { from: addBusinessDays(today, -(days - 1)), to: assertBusinessDate(today, "today"), days };
}

/**
 * Janela móvel de N meses que INCLUI hoje: [(hoje − N meses) + 1 dia, hoje].
 * Ex.: hoje 11/09/2026, 12 meses → 12/09/2025 … 11/09/2026.
 */
export function resolveRollingMonthsWindow(
  today: string,
  months: number
): BusinessDateWindow & { months: number } {
  if (!Number.isInteger(months) || months < 1) {
    throw new RangeError(`months precisa ser inteiro ≥ 1; recebido ${months}`);
  }
  return {
    from: addBusinessDays(addBusinessMonths(today, -months), 1),
    to: assertBusinessDate(today, "today"),
    months,
  };
}

export function isBusinessDateWithin(date: string, window: BusinessDateWindow): boolean {
  return date >= window.from && date <= window.to;
}

// ---------------------------------------------------------------------------
// Ocasiões de compra
// ---------------------------------------------------------------------------

export type RepurchaseOrderInput = {
  issueDate: Date | string;
  /** `SalesOrder.totalNetValue` já convertido para número. */
  totalNetValue?: number | null;
};

export type PurchaseOccasion = {
  /** Dia de compra, calendário local (`YYYY-MM-DD`). */
  businessDate: string;
  /** Pedidos emitidos no dia. */
  orderCount: number;
  /** Σ `totalNetValue` dos pedidos do dia. */
  totalNetValue: number;
};

const MONEY_MICROS = 1_000_000;

/**
 * `totalNetValue` é Decimal(20,6): somar em micro-unidades inteiras mantém a
 * soma exata (seguro até ~R$ 9 bilhões por acumulador).
 */
export function moneyToMicros(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value * MONEY_MICROS);
}

export function microsToMoney(micros: number): number {
  return micros / MONEY_MICROS;
}

/**
 * Agrupa pedidos em ocasiões (dias distintos), em ordem cronológica.
 * Pedido sem data válida não vira ocasião.
 */
export function buildDistinctPurchaseOccasions(
  orders: readonly RepurchaseOrderInput[]
): PurchaseOccasion[] {
  const byDay = new Map<string, { orderCount: number; micros: number }>();
  for (const order of orders) {
    const businessDate = toBusinessDate(order.issueDate);
    if (!businessDate) continue;
    const current = byDay.get(businessDate) ?? { orderCount: 0, micros: 0 };
    current.orderCount += 1;
    current.micros += moneyToMicros(order.totalNetValue);
    byDay.set(businessDate, current);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([businessDate, agg]) => ({
      businessDate,
      orderCount: agg.orderCount,
      totalNetValue: microsToMoney(agg.micros),
    }));
}

// ---------------------------------------------------------------------------
// Cadência
// ---------------------------------------------------------------------------

/** 0–1 ocasião: NONE · 2: LOW · 3–4: MEDIUM · 5+: HIGH. */
export function resolveCadenceConfidence(occasions: number): CrmCadenceConfidence {
  if (occasions >= 5) return "HIGH";
  if (occasions >= 3) return "MEDIUM";
  if (occasions === 2) return "LOW";
  return "NONE";
}

/**
 * delta < −15 → ON_TIME · −15…0 → DUE_SOON · 1…30 → OVERDUE · > 30 → SEVERELY_OVERDUE.
 */
export function classifyRepurchaseDelta(deltaDays: number): CrmRepurchaseForecastStatus {
  if (!Number.isFinite(deltaDays)) {
    throw new RangeError(`deltaDays inválido: ${deltaDays}`);
  }
  if (deltaDays < -REPURCHASE_DUE_SOON_DAYS) return "ON_TIME";
  if (deltaDays <= 0) return "DUE_SOON";
  if (deltaDays <= REPURCHASE_SEVERE_OVERDUE_DAYS) return "OVERDUE";
  return "SEVERELY_OVERDUE";
}

export type RepurchaseCadence = {
  version: CrmRepurchaseEngineVersion;
  /** Ocasiões distintas no histórico recebido. */
  totalOccasions: number;
  /** Ocasiões usadas (últimas, até 6). */
  occasionsUsed: number;
  intervalsUsed: number;
  /** Intervalos usados, em dias, na ordem cronológica. */
  intervalDays: number[];
  /** Primeira ocasião considerada na média. */
  firstOccasionUsedDate: string | null;
  lastPurchaseDate: string | null;
  /** Média com precisão interna total. */
  averageRepurchaseDays: number | null;
  averageRepurchaseDaysRounded: number | null;
  expectedRepurchaseDate: string | null;
  deltaDays: number | null;
  cadenceConfidence: CrmCadenceConfidence;
  status: CrmRepurchaseStatus;
};

/**
 * Calcula a cadência a partir das ocasiões e do dia de referência.
 * Aceita ocasiões fora de ordem/duplicadas (normaliza por dia distinto).
 */
export function computeRepurchaseCadence(
  occasions: readonly Pick<PurchaseOccasion, "businessDate">[],
  today: string
): RepurchaseCadence {
  assertBusinessDate(today, "today");
  const days = [
    ...new Set(occasions.map((o) => o.businessDate).filter((d) => isValidBusinessDate(d))),
  ].sort();
  const totalOccasions = days.length;

  if (totalOccasions === 0) {
    return {
      version: CRM_REPURCHASE_ENGINE_VERSION,
      totalOccasions: 0,
      occasionsUsed: 0,
      intervalsUsed: 0,
      intervalDays: [],
      firstOccasionUsedDate: null,
      lastPurchaseDate: null,
      averageRepurchaseDays: null,
      averageRepurchaseDaysRounded: null,
      expectedRepurchaseDate: null,
      deltaDays: null,
      cadenceConfidence: "NONE",
      status: "NO_HISTORY",
    };
  }

  const used = days.slice(-REPURCHASE_MAX_OCCASIONS);
  const lastPurchaseDate = used[used.length - 1]!;

  if (used.length === 1) {
    return {
      version: CRM_REPURCHASE_ENGINE_VERSION,
      totalOccasions,
      occasionsUsed: 1,
      intervalsUsed: 0,
      intervalDays: [],
      firstOccasionUsedDate: lastPurchaseDate,
      lastPurchaseDate,
      averageRepurchaseDays: null,
      averageRepurchaseDaysRounded: null,
      expectedRepurchaseDate: null,
      deltaDays: null,
      cadenceConfidence: "NONE",
      status: "INSUFFICIENT_HISTORY",
    };
  }

  const intervalDays: number[] = [];
  for (let i = 1; i < used.length; i += 1) {
    intervalDays.push(businessDaysBetween(used[i - 1]!, used[i]!));
  }
  const sum = intervalDays.reduce((acc, value) => acc + value, 0);
  const averageRepurchaseDays = sum / intervalDays.length;
  const averageRepurchaseDaysRounded = Math.round(averageRepurchaseDays);
  const expectedRepurchaseDate = addBusinessDays(lastPurchaseDate, averageRepurchaseDaysRounded);
  const deltaDays = businessDaysBetween(expectedRepurchaseDate, today);

  return {
    version: CRM_REPURCHASE_ENGINE_VERSION,
    totalOccasions,
    occasionsUsed: used.length,
    intervalsUsed: intervalDays.length,
    intervalDays,
    firstOccasionUsedDate: used[0]!,
    lastPurchaseDate,
    averageRepurchaseDays,
    averageRepurchaseDaysRounded,
    expectedRepurchaseDate,
    deltaDays,
    cadenceConfidence: resolveCadenceConfidence(used.length),
    status: classifyRepurchaseDelta(deltaDays),
  };
}
