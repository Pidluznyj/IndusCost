import {
  BRENT_COLLECTION_TIMEZONE,
  getSaoPauloDateTimeParts,
  PTAX_SNAPSHOT_LEGACY_REGISTERED_JOB,
  type SaoPauloDateTimeParts,
} from "./brentCommodityJob.js";
import { PTAX_SNAPSHOT_LOG_PREFIX } from "./ptaxSnapshotCollection.js";

export const PTAX_SNAPSHOT_JOB_ID = "ptax-snapshot-collection" as const;

/**
 * Agenda oficial do PTAX (BCB) — **preservada** ao migrar o Brent para 4x
 * ao dia em 2026-07. O PTAX continua rodando 2x ao dia (09:00 e 15:30 SP)
 * porque a fonte BCB só publica esses horários.
 *
 * Slots usam os valores herdados (`MORNING`, `AFTERNOON`) para manter
 * compatibilidade com o histórico do PTAX no banco. Não usamos os novos
 * slots do Brent aqui.
 */
export const PTAX_COLLECTION_SCHEDULE = [
  { slot: "MORNING" as const, hour: 9, minute: 0, label: "09:00" },
  { slot: "AFTERNOON" as const, hour: 15, minute: 30, label: "15:30" },
];

export const PTAX_SNAPSHOT_REGISTERED_JOB = PTAX_SNAPSHOT_LEGACY_REGISTERED_JOB;

/**
 * Resolvedor de minuto próprio do PTAX. Antes o PTAX reaproveitava o
 * `resolveScheduledSlotForMinute` do Brent — depois da mudança 2026-07
 * o resolvedor do Brent só reconhece os novos horários (07/11/14/16), então
 * PTAX precisa do seu próprio.
 */
export function resolvePtaxScheduledSlotForMinute(
  parts: SaoPauloDateTimeParts
): "MORNING" | "AFTERNOON" | null {
  const match = PTAX_COLLECTION_SCHEDULE.find(
    (entry) => entry.hour === parts.hour && entry.minute === parts.minute
  );
  return match?.slot ?? null;
}

const SCHEDULER_TICK_MS = 60_000;
let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerStarted = false;
const triggeredSlotKeys = new Set<string>();

export async function runPtaxSnapshotScheduledCollection(now: Date = new Date()): Promise<void> {
  const parts = getSaoPauloDateTimeParts(now);
  const slot = resolvePtaxScheduledSlotForMinute(parts);
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
  console.info(
    `${PTAX_SNAPSHOT_LOG_PREFIX} registered job=${PTAX_SNAPSHOT_JOB_ID} schedule=${PTAX_SNAPSHOT_REGISTERED_JOB.schedule} tz=${BRENT_COLLECTION_TIMEZONE}`
  );
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
