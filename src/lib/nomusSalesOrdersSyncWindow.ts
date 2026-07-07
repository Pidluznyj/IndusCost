/**
 * Janela temporal e estratégia do sync Nomus de Pedidos de Venda.
 * Fonte oficial da janela frequente: dataEmissao do pedido Nomus.
 */

export type NomusSalesOrdersSyncStrategy = "recent-window" | "full-reconciliation";

export type NomusSalesOrdersEmissaoWindow = {
  startDate: Date;
  endDate: Date;
  windowMonths: number | null;
  windowDays: number | null;
  label: string;
};

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const normalized = value.replace(/[^\d-]/g, "");
    if (!normalized) return null;
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseNomusSalesOrdersSyncStrategy(value?: unknown): NomusSalesOrdersSyncStrategy {
  const raw = String(
    value ?? process.env.NOMUS_SALES_ORDERS_SYNC_STRATEGY ?? "recent-window"
  )
    .trim()
    .toLowerCase();
  if (
    raw === "full-reconciliation" ||
    raw === "full" ||
    raw === "reconciliation" ||
    raw === "wide"
  ) {
    return "full-reconciliation";
  }
  return "recent-window";
}

/** Subtrai meses calendário preservando o último dia válido do mês destino. */
export function subtractCalendarMonths(referenceDate: Date, months: number): Date {
  const safeMonths = Math.max(0, Math.trunc(months));
  const d = new Date(referenceDate);
  const day = d.getDate();
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() - safeMonths);
  if (d.getDate() !== day) d.setDate(0);
  return d;
}

export function formatNomusPedidoDateBr(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function resolveNomusSalesOrdersEmissaoWindow(
  referenceNow = new Date()
): NomusSalesOrdersEmissaoWindow {
  const endDate = new Date(referenceNow);
  endDate.setHours(23, 59, 59, 999);

  const monthsEnv = toInt(process.env.NOMUS_SALES_ORDERS_RECENT_WINDOW_MONTHS);
  if (monthsEnv != null && monthsEnv > 0) {
    const startDate = subtractCalendarMonths(referenceNow, monthsEnv);
    startDate.setHours(0, 0, 0, 0);
    return {
      startDate,
      endDate,
      windowMonths: monthsEnv,
      windowDays: null,
      label: `${monthsEnv} meses (dataEmissao)`,
    };
  }

  const daysEnv = toInt(process.env.NOMUS_SALES_ORDERS_RECENT_WINDOW_DAYS);
  if (daysEnv != null && daysEnv > 0) {
    const startDate = new Date(referenceNow);
    startDate.setDate(startDate.getDate() - daysEnv);
    startDate.setHours(0, 0, 0, 0);
    return {
      startDate,
      endDate,
      windowMonths: null,
      windowDays: daysEnv,
      label: `${daysEnv} dias (dataEmissao, compat)`,
    };
  }

  const defaultMonths = 7;
  const startDate = subtractCalendarMonths(referenceNow, defaultMonths);
  startDate.setHours(0, 0, 0, 0);
  return {
    startDate,
    endDate,
    windowMonths: defaultMonths,
    windowDays: null,
    label: `${defaultMonths} meses (dataEmissao, padrão)`,
  };
}

/** Interpreta dataEmissao do payload Nomus (DD/MM/YYYY ou ISO). */
export function parseNomusPedidoDataEmissao(input: unknown): Date | null {
  if (input instanceof Date && !Number.isNaN(input.getTime())) return input;
  if (typeof input !== "string") return null;

  const raw = input.trim();
  if (!raw) return null;

  const br = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (br) {
    const dd = Number.parseInt(br[1], 10);
    const mm = Number.parseInt(br[2], 10);
    const yearRaw = Number.parseInt(br[3], 10);
    const yyyy = br[3].length === 2 ? 2000 + yearRaw : yearRaw;
    const hh = Number.parseInt(br[4] ?? "0", 10);
    const mi = Number.parseInt(br[5] ?? "0", 10);
    const ss = Number.parseInt(br[6] ?? "0", 10);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    const parsed = new Date(yyyy, mm - 1, dd, hh, mi, ss);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const iso = new Date(raw);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

export function extractPedidoDataEmissao(pedido: Record<string, unknown>): Date | null {
  return (
    parseNomusPedidoDataEmissao(pedido.dataEmissao) ??
    parseNomusPedidoDataEmissao(pedido.dataCriacao)
  );
}

export function isPedidoWithinEmissaoWindow(
  pedido: Record<string, unknown>,
  windowStart: Date
): boolean {
  const issueDate = extractPedidoDataEmissao(pedido);
  if (!issueDate) return true;
  return issueDate.getTime() >= windowStart.getTime();
}

export function filterPedidosByEmissaoWindow<T extends Record<string, unknown>>(
  pedidos: T[],
  windowStart: Date
): { kept: T[]; excludedOlder: number } {
  const kept: T[] = [];
  let excludedOlder = 0;
  for (const pedido of pedidos) {
    if (isPedidoWithinEmissaoWindow(pedido, windowStart)) {
      kept.push(pedido);
    } else {
      excludedOlder += 1;
    }
  }
  return { kept, excludedOlder };
}

export function describeNomusSalesOrdersSyncMode(strategy: NomusSalesOrdersSyncStrategy): string {
  return strategy === "full-reconciliation"
    ? "full-reconciliation (histórico amplo, cursor rotativo)"
    : "recent-window (dataEmissao, janela recente)";
}
