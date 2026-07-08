import type { CommodityCollectionSlot } from "@prisma/client";

export const BRENT_COMMODITY_LOG_PREFIX = "[brent-commodity-collection]" as const;
export const BRENT_COLLECTION_TIMEZONE = "America/Sao_Paulo" as const;
export const BRENT_COMMODITY_JOB_ID = "brent-commodity-collection" as const;

export const BRENT_COLLECTION_SCHEDULE = [
  { slot: "MORNING" as const, hour: 9, minute: 0, label: "09:00" },
  { slot: "AFTERNOON" as const, hour: 15, minute: 30, label: "15:30" },
];

export type SaoPauloDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dateIso: string;
};

export function getSaoPauloDateTimeParts(at: Date = new Date()): SaoPauloDateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRENT_COLLECTION_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const year = read("year");
  const month = read("month");
  const day = read("day");
  return {
    year,
    month,
    day,
    hour: read("hour"),
    minute: read("minute"),
    dateIso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

export function resolveBrentCollectionSlot(
  parts: Pick<SaoPauloDateTimeParts, "hour" | "minute">
): CommodityCollectionSlot {
  if (parts.hour < 15 || (parts.hour === 15 && parts.minute < 30)) return "MORNING";
  return "AFTERNOON";
}

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
  slots: BRENT_COLLECTION_SCHEDULE.map((s) => ({ slot: s.slot, time: s.label })),
  description: "Coleta automática do preço Brent (2x ao dia) para Inteligência de Mercado.",
};

export function listRegisteredScheduledJobs() {
  return [BRENT_COMMODITY_REGISTERED_JOB];
}

export function getRegisteredScheduledJob(jobId: string) {
  return jobId === BRENT_COMMODITY_JOB_ID ? BRENT_COMMODITY_REGISTERED_JOB : null;
}

const SCHEDULER_TICK_MS = 60_000;
let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerStarted = false;
const triggeredSlotKeys = new Set<string>();

export async function runBrentCommodityScheduledCollection(now: Date = new Date()): Promise<void> {
  const parts = getSaoPauloDateTimeParts(now);
  const slot = resolveScheduledSlotForMinute(parts);
  if (!slot) return;
  const triggerKey = `${parts.dateIso}:${slot}`;
  if (triggeredSlotKeys.has(triggerKey)) return;
  triggeredSlotKeys.add(triggerKey);
  try {
    const { collectBrentCommoditySnapshot } = await import("./brentCommodityCollection.js");
    await collectBrentCommoditySnapshot({ trigger: "SCHEDULED", at: now });
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
  console.info(`${BRENT_COMMODITY_LOG_PREFIX} registered job=${BRENT_COMMODITY_JOB_ID}`);
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
