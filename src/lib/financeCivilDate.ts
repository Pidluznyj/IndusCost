/**
 * Datas financeiras sem hora (vencimento, agendamento, competência) como dias civis.
 * Valores vindos do Prisma/PostgreSQL DATE chegam como meia-noite UTC — usar componentes UTC.
 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const CIVIL_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Extrai yyyy-mm-dd preservando o dia civil (sem deslocar por fuso). */
export function toCivilDateKey(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const head = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
    if (head) return `${head[1]}-${head[2]}-${head[3]}`;
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) return null;
    return toCivilDateKey(d);
  }
  const y = value.getUTCFullYear();
  const m = pad2(value.getUTCMonth() + 1);
  const d = pad2(value.getUTCDate());
  return `${y}-${m}-${d}`;
}

/** Converte chave civil em Date local à meia-noite do dia civil. */
export function civilDateToLocalDate(key: string): Date {
  const match = CIVIL_KEY_RE.exec(key.trim());
  if (!match) return new Date(Number.NaN);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
}

/** Início do dia civil para agrupamento/comparação. */
export function startOfCivilDate(value: Date | string): Date {
  const key = toCivilDateKey(value);
  if (!key) return new Date(Number.NaN);
  return civilDateToLocalDate(key);
}

/** Formata dd/mm/yyyy sem deslocar o dia civil. */
export function formatCivilDate(value: Date | string | null | undefined): string {
  const key = toCivilDateKey(value);
  if (!key) return "—";
  const d = civilDateToLocalDate(key);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

export function compareCivilDates(a: Date | string, b: Date | string): number {
  const ka = toCivilDateKey(a);
  const kb = toCivilDateKey(b);
  if (!ka || !kb) return 0;
  return ka.localeCompare(kb);
}

export function diffCivilDays(from: Date | string, to: Date | string): number {
  const fromKey = toCivilDateKey(from);
  const toKey = toCivilDateKey(to);
  if (!fromKey || !toKey) return 0;
  const a = civilDateToLocalDate(fromKey);
  const b = civilDateToLocalDate(toKey);
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}
