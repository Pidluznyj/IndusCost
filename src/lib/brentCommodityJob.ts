import type { CommodityCollectionSlot } from "@prisma/client";

export const BRENT_COMMODITY_LOG_PREFIX = "[brent-commodity-collection]" as const;
export const BRENT_COLLECTION_TIMEZONE = "America/Sao_Paulo" as const;
export const BRENT_COMMODITY_JOB_ID = "brent-commodity-collection" as const;

/**
 * Agenda oficial do Brent (America/Sao_Paulo, dias úteis).
 *
 * Alterada em 2026-07 — antes eram 09:00 e 15:30. Agora:
 *   07:00 → MORNING_EARLY
 *   11:00 → MORNING_LATE
 *   14:00 → AFTERNOON_EARLY
 *   16:00 → AFTERNOON_LATE
 *
 * Regra de dias úteis: seg–sex (`BRENT_RUNS_ON_WEEKDAYS_ONLY = true`). Em
 * fins de semana o poller descarta a coleta e o header mantém a última
 * cotação válida (nunca sobrescreve com "sem dado").
 *
 * PTAX **não** compartilha mais este schedule — `ptaxSnapshotJob.ts` mantém
 * a agenda legada 09:00/15:30 e seu próprio resolvedor de minuto.
 */
export const BRENT_COLLECTION_SCHEDULE = [
  { slot: "MORNING_EARLY" as const, hour: 7, minute: 0, label: "07:00" },
  { slot: "MORNING_LATE" as const, hour: 11, minute: 0, label: "11:00" },
  { slot: "AFTERNOON_EARLY" as const, hour: 14, minute: 0, label: "14:00" },
  { slot: "AFTERNOON_LATE" as const, hour: 16, minute: 0, label: "16:00" },
];

export const BRENT_RUNS_ON_WEEKDAYS_ONLY = true as const;

export type SaoPauloDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0=Sunday … 6=Saturday. */
  weekday: number;
  dateIso: string;
};

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getSaoPauloDateTimeParts(at: Date = new Date()): SaoPauloDateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRENT_COLLECTION_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = formatter.formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const weekdayName = parts.find((p) => p.type === "weekday")?.value ?? "";
  const year = read("year");
  const month = read("month");
  const day = read("day");
  const weekday = WEEKDAY_MAP[weekdayName] ?? 0;
  return {
    year,
    month,
    day,
    hour: read("hour"),
    minute: read("minute"),
    weekday,
    dateIso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

/** True se a data em `America/Sao_Paulo` é segunda–sexta. */
export function isSaoPauloWeekday(
  parts: Pick<SaoPauloDateTimeParts, "weekday">
): boolean {
  return parts.weekday >= 1 && parts.weekday <= 5;
}

/**
 * Slot operacional canônico usado por coletas MANUAIS ou eventos avulsos.
 * Mapeia por faixa de hora local (SP):
 *   00:00–08:59  → MORNING_EARLY  (07 é o próximo slot)
 *   09:00–12:59  → MORNING_LATE   (11 já rodou; 14 ainda longe)
 *   13:00–14:59  → AFTERNOON_EARLY
 *   15:00–23:59  → AFTERNOON_LATE
 * Nunca retorna os slots legados MORNING/AFTERNOON.
 */
export function resolveBrentCollectionSlot(
  parts: Pick<SaoPauloDateTimeParts, "hour" | "minute">
): CommodityCollectionSlot {
  if (parts.hour < 9) return "MORNING_EARLY";
  if (parts.hour < 13) return "MORNING_LATE";
  if (parts.hour < 15) return "AFTERNOON_EARLY";
  return "AFTERNOON_LATE";
}

/**
 * Slot agendado para o minuto atual — só retorna quando bate exatamente
 * com um dos horários oficiais (07:00 / 11:00 / 14:00 / 16:00 SP).
 */
export function resolveScheduledSlotForMinute(
  parts: SaoPauloDateTimeParts
): CommodityCollectionSlot | null {
  const match = BRENT_COLLECTION_SCHEDULE.find(
    (entry) => entry.hour === parts.hour && entry.minute === parts.minute
  );
  return match?.slot ?? null;
}

export const BRENT_COMMODITY_REGISTERED_JOB = {
  id: BRENT_COMMODITY_JOB_ID,
  name: "Coleta Brent (commodity)",
  timezone: BRENT_COLLECTION_TIMEZONE,
  schedule: BRENT_COLLECTION_SCHEDULE.map((s) => s.label).join(", "),
  cronExpression: "0 7,11,14,16 * * 1-5",
  runsOnWeekdaysOnly: BRENT_RUNS_ON_WEEKDAYS_ONLY,
  slots: BRENT_COLLECTION_SCHEDULE.map((s) => ({ slot: s.slot, time: s.label })),
  description:
    "Coleta automática do preço Brent (4x ao dia, dias úteis) para Inteligência de Mercado.",
};

// PTAX metadata is *hardcoded here* to preserve the legacy 09:00/15:30 schedule
// while Brent gets a decoupled cadence. The PTAX resolver + runner live in
// `ptaxSnapshotJob.ts` and use their own local schedule.
export const PTAX_SNAPSHOT_LEGACY_REGISTERED_JOB = {
  id: "ptax-snapshot-collection",
  name: "Coleta PTAX (BCB)",
  timezone: BRENT_COLLECTION_TIMEZONE,
  schedule: "09:00, 15:30",
  cronExpression: "0 9,15 * * *",
  runsOnWeekdaysOnly: false,
  slots: [
    { slot: "MORNING", time: "09:00" },
    { slot: "AFTERNOON", time: "15:30" },
  ],
  description:
    "Coleta automática da PTAX de fechamento (BCB) para Inteligência de Mercado. Agenda legada 09:00/15:30 preservada.",
} as const;

export function listRegisteredScheduledJobs() {
  return [BRENT_COMMODITY_REGISTERED_JOB, PTAX_SNAPSHOT_LEGACY_REGISTERED_JOB];
}

export function getRegisteredScheduledJob(jobId: string) {
  if (jobId === BRENT_COMMODITY_JOB_ID) return BRENT_COMMODITY_REGISTERED_JOB;
  if (jobId === PTAX_SNAPSHOT_LEGACY_REGISTERED_JOB.id) {
    return PTAX_SNAPSHOT_LEGACY_REGISTERED_JOB;
  }
  return null;
}

const SCHEDULER_TICK_MS = 60_000;
let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerStarted = false;
const triggeredSlotKeys = new Set<string>();

export async function runBrentCommodityScheduledCollection(now: Date = new Date()): Promise<void> {
  const parts = getSaoPauloDateTimeParts(now);
  const slot = resolveScheduledSlotForMinute(parts);
  if (!slot) return;

  // Regra oficial 2026-07: agenda Brent roda apenas dias úteis (seg–sex SP).
  // Fim de semana → o header mantém a última cotação válida.
  if (BRENT_RUNS_ON_WEEKDAYS_ONLY && !isSaoPauloWeekday(parts)) {
    console.info(
      `${BRENT_COMMODITY_LOG_PREFIX} skipped weekend at=${parts.dateIso}T${String(
        parts.hour
      ).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")} tz=${BRENT_COLLECTION_TIMEZONE} slot=${slot}`
    );
    return;
  }

  const triggerKey = `${parts.dateIso}:${slot}`;
  if (triggeredSlotKeys.has(triggerKey)) return;
  triggeredSlotKeys.add(triggerKey);
  const startedAt = Date.now();
  console.info(
    `${BRENT_COMMODITY_LOG_PREFIX} update started at=${parts.dateIso}T${String(
      parts.hour
    ).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")} tz=${BRENT_COLLECTION_TIMEZONE} slot=${slot}`
  );
  try {
    const { collectBrentCommoditySnapshot } = await import("./brentCommodityCollection.js");
    const outcome = await collectBrentCommoditySnapshot({ trigger: "SCHEDULED", at: now });
    const durationMs = Date.now() - startedAt;
    console.info(
      `${BRENT_COMMODITY_LOG_PREFIX} update finished slot=${slot} action=${outcome.action} durationMs=${durationMs}`
    );
  } catch (error) {
    console.error(`${BRENT_COMMODITY_LOG_PREFIX} scheduled job crashed:`, error);
  }
}

function isBrentSchedulerEnabled(): boolean {
  const raw = process.env.BRENT_COMMODITY_SCHEDULER_ENABLED?.trim().toLowerCase();
  // Default ON in production/server; explicit "false"/"0"/"off" disables safely.
  if (raw === "false" || raw === "0" || raw === "off" || raw === "no") return false;
  return true;
}

export function startBrentCommodityScheduledJob(): void {
  if (schedulerStarted) return;
  if (!isBrentSchedulerEnabled()) {
    console.info(
      `${BRENT_COMMODITY_LOG_PREFIX} scheduler disabled via BRENT_COMMODITY_SCHEDULER_ENABLED`
    );
    return;
  }
  schedulerStarted = true;
  console.info(
    `${BRENT_COMMODITY_LOG_PREFIX} registered job=${BRENT_COMMODITY_JOB_ID} schedule=${BRENT_COMMODITY_REGISTERED_JOB.schedule} tz=${BRENT_COLLECTION_TIMEZONE} weekdaysOnly=${BRENT_RUNS_ON_WEEKDAYS_ONLY}`
  );
  void runBrentCommodityScheduledCollection();
  schedulerTimer = setInterval(() => void runBrentCommodityScheduledCollection(), SCHEDULER_TICK_MS);
  schedulerTimer.unref?.();
}

export function resetBrentCommoditySchedulerForTests(): void {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  schedulerStarted = false;
  triggeredSlotKeys.clear();
}

export function __testOnlyRememberTriggeredSlot(dateIso: string, slot: string): void {
  triggeredSlotKeys.add(`${dateIso}:${slot}`);
}

export function __testOnlyHasTriggeredSlot(dateIso: string, slot: string): boolean {
  return triggeredSlotKeys.has(`${dateIso}:${slot}`);
}
