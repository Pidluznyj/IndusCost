/**
 * PURCH-MIRROR-01 — Janela temporal do backfill de 12 meses.
 *
 * Regra (item 8 da missão): usa a DATA DE EMISSÃO oficial (issueDate); o
 * período é por data CIVIL America/Sao_Paulo; "12 meses" = 12 meses-
 * calendário retroativos da data de referência — NUNCA "365 dias" corridos
 * silenciosamente (bissexto e meses de tamanhos diferentes fariam isso
 * divergir). Função pura, determinística, testada.
 *
 * América/Sao_Paulo não observa horário de verão desde 2019 — offset fixo
 * UTC-03:00 o ano inteiro. Ainda assim isolamos aqui (em vez de espalhar
 * "-03:00" pelo código) para que uma mudança de política fique em um único
 * lugar.
 */

const SAO_PAULO_OFFSET_MINUTES = -180;

export type NomusPurchaseOrdersBackfillWindow = {
  /** Início do período (00:00:00 America/Sao_Paulo do 1º dia), em UTC. */
  from: Date;
  /** Fim do período (23:59:59.999 America/Sao_Paulo do último dia), em UTC. */
  to: Date;
  /** Representação legível (YYYY-MM-DD) em horário civil de SP. */
  fromDateSp: string;
  toDateSp: string;
  months: number;
};

function toSaoPauloCivilParts(date: Date): {
  year: number;
  month: number;
  day: number;
} {
  const spMs = date.getTime() + SAO_PAULO_OFFSET_MINUTES * 60_000;
  const sp = new Date(spMs);
  return {
    year: sp.getUTCFullYear(),
    month: sp.getUTCMonth(),
    day: sp.getUTCDate(),
  };
}

function saoPauloCivilStartToUtc(year: number, month: number, day: number): Date {
  // 00:00:00 America/Sao_Paulo == 03:00:00 UTC (offset fixo -03:00).
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0) - SAO_PAULO_OFFSET_MINUTES * 60_000);
}

function saoPauloCivilEndToUtc(year: number, month: number, day: number): Date {
  return new Date(
    Date.UTC(year, month, day, 23, 59, 59, 999) - SAO_PAULO_OFFSET_MINUTES * 60_000
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Calcula a janela de N meses-calendário retroativos, terminando no dia
 * civil de SP de `referenceDate` (inclusive). Ex.: referência 15/09/2026,
 * months=12 → de 15/09/2025 00:00 SP até 15/09/2026 23:59:59.999 SP.
 */
export function resolveNomusPurchaseOrdersBackfillWindow(
  referenceDate: Date,
  months: number
): NomusPurchaseOrdersBackfillWindow {
  if (!Number.isFinite(months) || months <= 0) {
    throw new Error(`months deve ser um inteiro positivo, recebido: ${months}`);
  }
  const ref = toSaoPauloCivilParts(referenceDate);

  const toUtc = saoPauloCivilEndToUtc(ref.year, ref.month, ref.day);
  // Volta N meses-calendário a partir do mesmo dia civil. new Date com mês
  // negativo/rolando é seguro no motor de datas do JS (normaliza ano/mês).
  const fromYear = ref.year;
  const fromMonthIndex = ref.month - months;
  const fromProbe = new Date(Date.UTC(fromYear, fromMonthIndex, ref.day));
  const fromParts = {
    year: fromProbe.getUTCFullYear(),
    month: fromProbe.getUTCMonth(),
    day: fromProbe.getUTCDate(),
  };
  const fromUtc = saoPauloCivilStartToUtc(fromParts.year, fromParts.month, fromParts.day);

  return {
    from: fromUtc,
    to: toUtc,
    fromDateSp: `${fromParts.year}-${pad2(fromParts.month + 1)}-${pad2(fromParts.day)}`,
    toDateSp: `${ref.year}-${pad2(ref.month + 1)}-${pad2(ref.day)}`,
    months,
  };
}

/** true se `issueDate` (qualquer instante) cai dentro de [from, to] inclusive. */
export function isDateWithinNomusPurchaseOrdersWindow(
  issueDate: Date | null | undefined,
  window: { from: Date; to: Date }
): boolean {
  if (!issueDate) return false;
  const t = issueDate.getTime();
  return t >= window.from.getTime() && t <= window.to.getTime();
}
