/**
 * Metas (OKR) — helpers puros das curvas do Detalhe da Meta.
 *
 * Só calendário e corte: quais meses a janela cobre, em que dia cada mês
 * pousa no eixo X e até onde a curva do realizado pode ir. A agregação em si
 * é do motor de regras (`goalRuleEngine.server`), que fala com o banco.
 */

/** Meses civis "YYYY-MM" cobertos pela janela (inclusivo nas duas pontas). */
export function listGoalSeriesMonths(
  startCivilDate: string,
  endCivilDate: string
): string[] {
  if (!startCivilDate || !endCivilDate || endCivilDate < startCivilDate) return [];
  const months: string[] = [];
  let year = Number(startCivilDate.slice(0, 4));
  let month = Number(startCivilDate.slice(5, 7));
  const endKey = endCivilDate.slice(0, 7);
  // Guarda de sanidade: janelas absurdas (dado corrompido) não podem virar
  // laço infinito nem série de milhares de pontos.
  for (let i = 0; i < 600; i += 1) {
    const key = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
    months.push(key);
    if (key >= endKey) break;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/**
 * Dia em que o ponto do mês pousa no eixo: o último dia do mês, cortado pelo
 * fim da janela (o último mês costuma ser parcial).
 */
export function goalSeriesMonthCivilDate(
  month: string,
  windowEndCivilDate: string
): string {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const monthEnd = `${month}-${String(lastDay).padStart(2, "0")}`;
  return monthEnd > windowEndCivilDate ? windowEndCivilDate : monthEnd;
}

/**
 * Corta a curva do realizado no mês corrente: mês futuro não tem realizado, e
 * desenhar zero ali derrubaria a linha até o chão em vez de simplesmente
 * parar onde a medição parou.
 */
export function limitGoalSeriesToMonth<T extends { month: string }>(
  points: readonly T[],
  currentMonth: string
): T[] {
  return points.filter((p) => p.month <= currentMonth);
}
