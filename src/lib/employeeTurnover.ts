/**
 * Turnover acumulado no ano (YTD) — geral, voluntário e involuntário.
 *
 * Taxa = desligamentos no período ÷ headcount médio do período.
 * - Período: 01/01 do ano corrente até hoje (fuso do negócio).
 * - Headcount médio: média dos headcounts no fim de cada mês fechado do ano + hoje.
 *   Headcount numa data = admitido até a data (ou sem admissão) e sem desligamento até ela.
 * - Desligamentos: status INACTIVE com data de demissão no período.
 * - Voluntário/involuntário: automático pelo motivo (`TERMINATION_RULES[...].turnover`).
 *   Motivo "Outro" ou desligamento antigo sem motivo entram só no geral (não classificados).
 * - Desligado sem data de demissão (legado) fica fora: não dá para situá-lo no tempo.
 */
import { terminationTurnoverClass, toIsoDay } from "./employeeLifecycle.js";

export type TurnoverEmployeeRow = {
  status: string | null;
  admissionDate: Date | string | null;
  terminationDate: Date | string | null;
  terminationReason?: string | null;
};

export type TurnoverYtd = {
  year: number;
  from: string;
  to: string;
  /** Datas usadas no headcount médio (fim de cada mês fechado + hoje). */
  snapshotDates: string[];
  averageHeadcount: number;
  terminations: number;
  voluntary: number;
  involuntary: number;
  unclassified: number;
  /** Frações (0.05 = 5%); null quando não há headcount no período. */
  rate: number | null;
  voluntaryRate: number | null;
  involuntaryRate: number | null;
  /** Desligados sem data de demissão, fora do cálculo. */
  excludedWithoutTerminationDate: number;
};

function lastDayOfMonth(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export function turnoverSnapshotDates(todayIso: string): string[] {
  const year = Number(todayIso.slice(0, 4));
  const month = Number(todayIso.slice(5, 7));
  const dates: string[] = [];
  for (let m = 1; m < month; m += 1) dates.push(lastDayOfMonth(year, m));
  dates.push(todayIso);
  return dates;
}

export function computeTurnoverYtd(rows: readonly TurnoverEmployeeRow[], todayIso: string): TurnoverYtd {
  const year = Number(todayIso.slice(0, 4));
  const from = `${year}-01-01`;
  const snapshotDates = turnoverSnapshotDates(todayIso);

  let excludedWithoutTerminationDate = 0;
  const people: { admission: string | null; termination: string | null; reason: string | null }[] = [];
  for (const row of rows) {
    const inactive = (row.status ?? "ACTIVE").toUpperCase() === "INACTIVE";
    const termination = inactive ? toIsoDay(row.terminationDate) : null;
    if (inactive && !termination) {
      excludedWithoutTerminationDate += 1;
      continue;
    }
    people.push({ admission: toIsoDay(row.admissionDate), termination, reason: row.terminationReason ?? null });
  }

  const headcounts = snapshotDates.map(
    (d) => people.filter((p) => (p.admission == null || p.admission <= d) && (p.termination == null || p.termination > d)).length,
  );
  const averageHeadcount = headcounts.reduce((a, b) => a + b, 0) / headcounts.length;

  let terminations = 0;
  let voluntary = 0;
  let involuntary = 0;
  for (const p of people) {
    if (!p.termination || p.termination < from || p.termination > todayIso) continue;
    terminations += 1;
    const cls = terminationTurnoverClass(p.reason);
    if (cls === "VOLUNTARY") voluntary += 1;
    else if (cls === "INVOLUNTARY") involuntary += 1;
  }
  const ratio = (n: number) => (averageHeadcount > 0 ? n / averageHeadcount : null);
  return {
    year,
    from,
    to: todayIso,
    snapshotDates,
    averageHeadcount: Math.round(averageHeadcount * 10) / 10,
    terminations,
    voluntary,
    involuntary,
    unclassified: terminations - voluntary - involuntary,
    rate: ratio(terminations),
    voluntaryRate: ratio(voluntary),
    involuntaryRate: ratio(involuntary),
    excludedWithoutTerminationDate,
  };
}
