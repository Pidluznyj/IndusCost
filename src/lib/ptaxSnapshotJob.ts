import {
  BRENT_COLLECTION_SCHEDULE,
  BRENT_COLLECTION_TIMEZONE,
  getSaoPauloDateTimeParts,
  resolveScheduledSlotForMinute,
} from "./brentCommodityJob.js";
import { PTAX_SNAPSHOT_LOG_PREFIX } from "./ptaxSnapshotCollection.js";

export const PTAX_SNAPSHOT_JOB_ID = "ptax-snapshot-collection" as const;

export const PTAX_SNAPSHOT_REGISTERED_JOB = {
  id: PTAX_SNAPSHOT_JOB_ID,
  name: "Coleta PTAX (BCB)",
  timezone: BRENT_COLLECTION_TIMEZONE,
  schedule: BRENT_COLLECTION_SCHEDULE.map((s) => s.label).join(", "),
  description:
    "Coleta automática da PTAX de fechamento (BCB) para Inteligência de Mercado — mesma agenda do Brent.",
};

const SCHEDULER_TICK_MS = 60_000;
let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerStarted = false;
const triggeredSlotKeys = new Set<string>();

export async function runPtaxSnapshotScheduledCollection(now: Date = new Date()): Promise<void> {
  const parts = getSaoPauloDateTimeParts(now);
  const slot = resolveScheduledSlotForMinute(parts);
  if (!slot) return;
  const triggerKey = `${parts.dateIso}:${slot}`;
  if (triggeredSlotKeys.has(triggerKey)) return;
  triggeredSlotKeys.add(triggerKey);
  try {
    const { collectPtaxSnapshot } = await import("./ptaxSnapshotCollection.js");
    await collectPtaxSnapshot({ trigger: "SCHEDULED", at: now });
  } catch (error) {
    console.error(`${PTAX_SNAPSHOT_LOG_PREFIX} scheduled job crashed:`, error);
  }
}

function isPtaxSchedulerEnabled(): boolean {
  const raw = process.env.PTAX_SNAPSHOT_SCHEDULER_ENABLED?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off" || raw === "no") return false;
  return true;
}

export function startPtaxSnapshotScheduledJob(): void {
  if (schedulerStarted) return;
  if (!isPtaxSchedulerEnabled()) {
    console.info(
      `${PTAX_SNAPSHOT_LOG_PREFIX} scheduler disabled via PTAX_SNAPSHOT_SCHEDULER_ENABLED`
    );
    return;
  }
  schedulerStarted = true;
  console.info(`${PTAX_SNAPSHOT_LOG_PREFIX} registered job=${PTAX_SNAPSHOT_JOB_ID}`);
  void runPtaxSnapshotScheduledCollection();
  schedulerTimer = setInterval(() => void runPtaxSnapshotScheduledCollection(), SCHEDULER_TICK_MS);
  schedulerTimer.unref?.();
}

export function resetPtaxSnapshotSchedulerForTests(): void {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  schedulerStarted = false;
  triggeredSlotKeys.clear();
}

export function __testOnlyRememberPtaxTriggeredSlot(dateIso: string, slot: string): void {
  triggeredSlotKeys.add(`${dateIso}:${slot}`);
}

export function __testOnlyHasPtaxTriggeredSlot(dateIso: string, slot: string): boolean {
  return triggeredSlotKeys.has(`${dateIso}:${slot}`);
}
