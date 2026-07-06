export type FleetPublicSlot = {
  start: string;
  end: string;
  label: string;
  key: string;
};

export type FleetPublicSlotConfig = {
  startHour: number;
  endHour: number;
  slotMinutes: number;
};

const DEFAULT_START_HOUR = 6;
const DEFAULT_END_HOUR = 20;
const DEFAULT_SLOT_MINUTES = 60;

export function parseFleetPublicSlotConfig(settings: Record<string, string>): FleetPublicSlotConfig {
  const startHour = clampHour(parseInt(settings.publicReservationStartHour ?? "6", 10), 6);
  const endHour = clampHour(parseInt(settings.publicReservationEndHour ?? "20", 10), 20);
  const slotMinutes = parsePositiveInt(settings.publicReservationSlotMinutes, DEFAULT_SLOT_MINUTES);
  return { startHour, endHour, slotMinutes };
}

function clampHour(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 23) return fallback;
  return value;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function formatHourMinute(hour: number, minute = 0): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function slotKey(start: string, end: string): string {
  return `${start}-${end}`;
}

function buildSlotsFromConfig(config: FleetPublicSlotConfig): FleetPublicSlot[] {
  const durationHours = config.slotMinutes / 60;
  const slots: FleetPublicSlot[] = [];
  const seen = new Set<string>();

  let hour = config.startHour;
  while (hour + durationHours <= config.endHour) {
    const start = formatHourMinute(hour);
    const end = formatHourMinute(hour + durationHours);
    const key = slotKey(start, end);
    if (!seen.has(key)) {
      slots.push({ start, end, label: `${start}–${end}`, key });
      seen.add(key);
    }
    hour += durationHours;
  }

  const lastStart = config.endHour - durationHours;
  if (lastStart >= config.startHour) {
    const start = formatHourMinute(lastStart);
    const end = formatHourMinute(config.endHour);
    const key = slotKey(start, end);
    if (!seen.has(key)) {
      slots.push({ start, end, label: `${start}–${end}`, key });
      seen.add(key);
    }
  }

  return slots.sort((a, b) => a.start.localeCompare(b.start));
}

const DEFAULT_SLOT_CONFIG: FleetPublicSlotConfig = {
  startHour: DEFAULT_START_HOUR,
  endHour: DEFAULT_END_HOUR,
  slotMinutes: DEFAULT_SLOT_MINUTES,
};

/** Slots padrão: 06:00–20:00 em blocos de 1 hora. */
export const FLEET_PUBLIC_DEFAULT_SLOTS: FleetPublicSlot[] = buildSlotsFromConfig(DEFAULT_SLOT_CONFIG);

/**
 * Gera slots dentro da janela diária.
 * Inclui slot final que termina exatamente em endHour (ex.: 19:00–20:00 com duração de 1h).
 * Não gera slot que ultrapasse endHour (ex.: 20:00–21:00).
 */
export function buildFleetPublicReservationSlots(config: FleetPublicSlotConfig): FleetPublicSlot[] {
  const durationHours = config.slotMinutes / 60;
  if (!Number.isFinite(durationHours) || durationHours <= 0) {
    return [...FLEET_PUBLIC_DEFAULT_SLOTS];
  }

  if (
    config.startHour === DEFAULT_START_HOUR &&
    config.endHour === DEFAULT_END_HOUR &&
    config.slotMinutes === DEFAULT_SLOT_MINUTES
  ) {
    return [...FLEET_PUBLIC_DEFAULT_SLOTS];
  }

  return buildSlotsFromConfig(config);
}

/** Monta DateTime de reserva no fuso local do servidor (parede de relógio YYYY-MM-DD + HH:mm). */
export function combineDateAndTimeLocal(dateStr: string, timeStr: string): Date {
  const [y, m, d] = dateStr.split("-").map((p) => parseInt(p, 10));
  const [hh, mm] = timeStr.split(":").map((p) => parseInt(p, 10));
  return new Date(y, m - 1, d, hh, mm ?? 0, 0, 0);
}

/** Alias explícito para DateTime de reserva (data local + hora local). */
export const buildFleetReservationLocalDateTime = combineDateAndTimeLocal;

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseYmdParts(value: string): { y: number; m: number; d: number } | null {
  const m = value.match(DATE_ONLY_RE);
  if (!m) return null;
  const y = parseInt(m[1]!, 10);
  const mo = parseInt(m[2]!, 10);
  const d = parseInt(m[3]!, 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

/**
 * Converte "YYYY-MM-DD" em Date para coluna DATE do Prisma sem deslocar o dia.
 * Usa meio-dia UTC para o valor calendário ficar estável em qualquer fuso do servidor.
 */
export function parseLocalDateOnly(value: string): Date | null {
  const parts = parseYmdParts(value);
  if (!parts) return null;
  const dt = new Date(Date.UTC(parts.y, parts.m - 1, parts.d, 12, 0, 0, 0));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** Extrai YYYY-MM-DD de um Date vindo de coluna DATE (componentes UTC). */
export function dateOnlyToYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** @deprecated Use dateOnlyToYmd — mantido para compatibilidade de imports. */
export const dateToYmdUtc = dateOnlyToYmd;

/** Formata data calendário para exibição pt-BR (DD/MM/YYYY) sem deslocar por UTC. */
export function formatFleetLocalDate(value: Date | string): string {
  if (typeof value === "string") {
    const parts = parseYmdParts(value.slice(0, 10));
    if (parts) {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${pad(parts.d)}/${pad(parts.m)}/${parts.y}`;
    }
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const ymd = dateOnlyToYmd(value);
    return formatFleetLocalDate(ymd);
  }
  return typeof value === "string" ? value : "";
}

export function isSameLocalDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Remove slots cujo horário de término já passou quando a data é hoje. */
export function filterPastSlotsForToday(
  slots: FleetPublicSlot[],
  dateStr: string,
  now: Date = new Date()
): FleetPublicSlot[] {
  const requested = combineDateAndTimeLocal(dateStr, "00:00");
  if (!isSameLocalDate(requested, now)) return slots;

  return slots.filter((slot) => {
    const slotEnd = combineDateAndTimeLocal(dateStr, slot.end);
    return slotEnd.getTime() > now.getTime();
  });
}

/** @deprecated Preferir parseLocalDateOnly para persistência; alias mantido. */
export function parseDateOnly(value: string): Date | null {
  return parseLocalDateOnly(value);
}

const WEEKDAY_PT = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export function formatDateYmd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatWeekdayDateLabel(dateStr: string): string {
  const parts = parseYmdParts(dateStr);
  if (!parts) return dateStr;
  const d = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
  const weekday = WEEKDAY_PT[d.getUTCDay()] ?? "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${weekday}, ${pad(parts.d)}/${pad(parts.m)}`;
}

/** Gera lista de datas YYYY-MM-DD a partir de `from` por `days` (máx. 14). */
export function buildPublicDateRange(from: string, days: number): string[] {
  const parts = parseYmdParts(from);
  if (!parts) return [];
  const count = Math.min(14, Math.max(1, Math.floor(days)));
  const out: string[] = [];
  const cursor = new Date(Date.UTC(parts.y, parts.m - 1, parts.d, 12, 0, 0, 0));
  for (let i = 0; i < count; i++) {
    out.push(dateOnlyToYmd(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
