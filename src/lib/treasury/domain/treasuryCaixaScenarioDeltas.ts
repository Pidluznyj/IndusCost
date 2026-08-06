/**
 * Matemática de DELTAS diários sobre a série canônica da Caixa (client-safe).
 *
 * HISTÓRICO: este arquivo já abrigou o motor de antecipação/postergação de
 * datas por título (conceito do commit 40bdb2d). Aquele conceito foi
 * SUBSTITUÍDO pelos cenários de sensibilidade ao volume de vendas
 * (`treasuryCaixaSalesVolumeScenarios.ts`) e o motor antigo foi removido —
 * ficou aqui apenas a infraestrutura neutra reutilizada pelo novo modelo:
 *
 *  - utilitários de data civil imunes a fuso (addCivilDays/diffCivilDays);
 *  - o formato de delta diário (TreasuryScenarioDeltaDay/Set), assinado,
 *    com "fora do horizonte" separado (nunca no último dia);
 *  - `applyScenarioDeltasToClosings`, que soma o delta líquido ACUMULADO
 *    sobre os fechamentos canônicos SEM recalcular o Realista.
 */

// ── Utilitários de data civil (YYYY-MM-DD, sem fuso) ─────────────────────

/** Soma dias corridos a uma data civil — UTC puro, imune a fuso/DST. */
export function addCivilDays(civilDate: string, days: number): string {
  const [y, m, d] = civilDate.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Diferença em dias corridos (b − a). */
export function diffCivilDays(a: string, b: string): number {
  const [ay, am, ad] = a.slice(0, 10).split("-").map(Number);
  const [by, bm, bd] = b.slice(0, 10).split("-").map(Number);
  const MS = 24 * 60 * 60 * 1000;
  return Math.round(
    (Date.UTC(by!, bm! - 1, bd!) - Date.UTC(ay!, am! - 1, ad!)) / MS
  );
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ── Contratos de delta diário ────────────────────────────────────────────

export type TreasuryScenarioDeltaDay = {
  civilDate: string;
  /** Diferença de entradas do dia (assinada — negativa reduz entradas). */
  inflowDelta: number;
  /** Diferença de saídas do dia (assinada — negativa reduz saídas). */
  outflowDelta: number;
};

export type TreasuryScenarioDeltaSet = {
  /** Só dias com delta ≠ 0, ordenados; todos no futuro (> asOf). */
  byDay: TreasuryScenarioDeltaDay[];
  /** Valores deslocados para depois do horizonte — nunca no último dia. */
  outOfHorizonInflow: number;
  outOfHorizonOutflow: number;
  changedTitleCount: number;
};

// ── Aplicação do delta sobre a série canônica ────────────────────────────

/**
 * Aplica o delta acumulado sobre os fechamentos da série canônica Realista.
 *
 * Matemática: fechamento = abertura + Σ fluxos; somar deltas aos fluxos de
 * cada dia desloca o fechamento pelo delta LÍQUIDO ACUMULADO até aquele dia.
 * Dias <= asOf nunca têm delta → passado e hoje idênticos nos três cenários.
 * A série Realista de entrada não é modificada — apenas somada.
 */
export function applyScenarioDeltasToClosings(input: {
  /** Dias do gráfico, em ordem cronológica. */
  orderedCivilDates: readonly string[];
  /** Fechamento canônico Realista por dia (null = indisponível). */
  realisticClosingByDay: ReadonlyMap<string, number | null>;
  deltas: TreasuryScenarioDeltaSet;
}): Map<string, number | null> {
  const deltaByDay = new Map(input.deltas.byDay.map((d) => [d.civilDate, d]));
  const out = new Map<string, number | null>();
  let cumulative = 0;
  for (const civilDate of input.orderedCivilDates) {
    const d = deltaByDay.get(civilDate);
    if (d) cumulative = roundMoney(cumulative + d.inflowDelta - d.outflowDelta);
    const base = input.realisticClosingByDay.get(civilDate);
    out.set(
      civilDate,
      base == null ? null : roundMoney(base + cumulative)
    );
  }
  return out;
}
