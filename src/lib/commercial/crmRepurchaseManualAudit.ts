/**
 * Conferência MANUAL da recompra — implementação independente do motor.
 *
 * Refaz a conta de `LAST_6_DISTINCT_PURCHASE_DAYS_MEAN_V1` sem importar o
 * motor nem os helpers de data dele: agrupa pedidos por dia civil, pega as
 * últimas 6 ocasiões, mede intervalos com aritmética inteira de calendário
 * (days-from-civil, sem milissegundos nem fuso), tira a média, soma à última
 * compra e classifica. Serve para a homologação comparar "conta à mão" ×
 * endpoint cliente a cliente — se o motor mudar sem querer, esta conta
 * diverge.
 *
 * Única definição compartilhada com o sistema: o EIXO (dia civil local de
 * `SalesOrder.issueDate`, o mesmo do filtro "Emissão" de Pedidos de Venda).
 */

export type ManualAuditOrder = { orderCode: string; issueDate: Date; totalNetValue: number };

export type ManualAuditOccasion = { day: string; orderCodes: string[]; totalNetValue: number };

export type ManualAuditStatus =
  | "NO_HISTORY"
  | "INSUFFICIENT_HISTORY"
  | "ON_TIME"
  | "DUE_SOON"
  | "OVERDUE"
  | "SEVERELY_OVERDUE";

export type ManualAuditConfidence = "NONE" | "LOW" | "MEDIUM" | "HIGH";

export type ManualRepurchaseAudit = {
  /** Dias distintos de compra no histórico inteiro (até hoje). */
  totalOccasions: number;
  /** As últimas ocasiões usadas (no máximo 6), da mais antiga para a mais nova. */
  occasionsUsed: ManualAuditOccasion[];
  intervals: number[];
  mean: number | null;
  meanRounded: number | null;
  lastPurchase: string | null;
  expected: string | null;
  delta: number | null;
  status: ManualAuditStatus;
  confidence: ManualAuditConfidence;
};

const MAX_OCCASIONS = 6;
const DUE_SOON_DAYS = 15;
const SEVERE_DAYS = 30;

/** Dia civil local (`YYYY-MM-DD`) — o eixo de compra. */
export function manualCivilDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Dias desde 1970-01-01 para uma data civil — aritmética inteira (algoritmo de H. Hinnant). */
function daysFromCivil(key: string): number {
  let [y, m, d] = key.split("-").map(Number) as [number, number, number];
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(days: number): string {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/** Conta manual completa para um cliente, a partir dos pedidos canônicos dele. */
export function auditRepurchaseManually(orders: readonly ManualAuditOrder[], today: string): ManualRepurchaseAudit {
  const byDay = new Map<string, ManualAuditOccasion>();
  for (const order of orders) {
    const day = manualCivilDay(order.issueDate);
    if (day > today) continue; // emissão futura: fora da cadência
    const occasion = byDay.get(day) ?? { day, orderCodes: [], totalNetValue: 0 };
    occasion.orderCodes.push(order.orderCode);
    occasion.totalNetValue = Math.round((occasion.totalNetValue + order.totalNetValue) * 1e6) / 1e6;
    byDay.set(day, occasion);
  }
  const all = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const used = all.slice(-MAX_OCCASIONS);
  const base = { totalOccasions: all.length, occasionsUsed: used };

  if (used.length === 0) {
    return { ...base, intervals: [], mean: null, meanRounded: null, lastPurchase: null, expected: null, delta: null, status: "NO_HISTORY", confidence: "NONE" };
  }
  const lastPurchase = used[used.length - 1]!.day;
  if (used.length === 1) {
    return { ...base, intervals: [], mean: null, meanRounded: null, lastPurchase, expected: null, delta: null, status: "INSUFFICIENT_HISTORY", confidence: "NONE" };
  }

  const intervals: number[] = [];
  for (let i = 1; i < used.length; i += 1) intervals.push(daysFromCivil(used[i]!.day) - daysFromCivil(used[i - 1]!.day));
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const meanRounded = Math.floor(mean + 0.5); // meio para cima (média é sempre positiva)
  const expected = civilFromDays(daysFromCivil(lastPurchase) + meanRounded);
  const delta = daysFromCivil(today) - daysFromCivil(expected);
  const status: ManualAuditStatus =
    delta < -DUE_SOON_DAYS ? "ON_TIME" : delta <= 0 ? "DUE_SOON" : delta <= SEVERE_DAYS ? "OVERDUE" : "SEVERELY_OVERDUE";
  const confidence: ManualAuditConfidence = used.length >= 5 ? "HIGH" : used.length >= 3 ? "MEDIUM" : "LOW";
  return { ...base, intervals, mean, meanRounded, lastPurchase, expected, delta, status, confidence };
}

export type ManualAuditComparable = {
  totalOccasions: number;
  occasionsUsed: number;
  averageRepurchaseDays: number | null;
  lastPurchaseDate: string | null;
  expectedRepurchaseDate: string | null;
  deltaDays: number | null;
  repurchaseStatus: string;
  cadenceConfidence: string;
};

/** Campo a campo: conta manual × endpoint (média comparada com 2 casas, como no contrato). */
export function compareManualAudit(
  manual: ManualRepurchaseAudit,
  endpoint: ManualAuditComparable
): Array<{ field: string; manual: string; endpoint: string }> {
  const round2 = (v: number | null) => (v == null ? null : Math.round((v + Number.EPSILON) * 100) / 100);
  const pairs: Array<[string, unknown, unknown]> = [
    ["totalOccasions", manual.totalOccasions, endpoint.totalOccasions],
    ["occasionsUsed", manual.occasionsUsed.length, endpoint.occasionsUsed],
    ["averageRepurchaseDays", round2(manual.mean), round2(endpoint.averageRepurchaseDays)],
    ["lastPurchaseDate", manual.lastPurchase, endpoint.lastPurchaseDate],
    ["expectedRepurchaseDate", manual.expected, endpoint.expectedRepurchaseDate],
    ["deltaDays", manual.delta, endpoint.deltaDays],
    ["repurchaseStatus", manual.status, endpoint.repurchaseStatus],
    ["cadenceConfidence", manual.confidence, endpoint.cadenceConfidence],
  ];
  return pairs
    .filter(([, a, b]) => a !== b)
    .map(([field, a, b]) => ({ field, manual: String(a), endpoint: String(b) }));
}
