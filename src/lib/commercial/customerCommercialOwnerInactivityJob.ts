import {
  BRENT_COLLECTION_TIMEZONE,
  PORTFOLIO_INACTIVITY_REGISTERED_JOB,
  getSaoPauloDateTimeParts,
  type SaoPauloDateTimeParts,
} from "@/src/lib/brentCommodityJob.js";

export const PORTFOLIO_INACTIVITY_JOB_ID = PORTFOLIO_INACTIVITY_REGISTERED_JOB.id;
export { PORTFOLIO_INACTIVITY_REGISTERED_JOB };
export const PORTFOLIO_INACTIVITY_LOG_PREFIX = "[crm-owner-inactivity]" as const;
export const PORTFOLIO_INACTIVITY_SCHEDULE_HOUR = 4;
export const PORTFOLIO_INACTIVITY_SCHEDULE_MINUTE = 10;
export const PORTFOLIO_INACTIVITY_SCHEDULE_DAY = 1;

export function isPortfolioInactivityScheduledMinute(parts: SaoPauloDateTimeParts): boolean {
  return (
    parts.day === PORTFOLIO_INACTIVITY_SCHEDULE_DAY &&
    parts.hour === PORTFOLIO_INACTIVITY_SCHEDULE_HOUR &&
    parts.minute === PORTFOLIO_INACTIVITY_SCHEDULE_MINUTE
  );
}

const SCHEDULER_TICK_MS = 60_000;
let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerStarted = false;
const triggeredKeys = new Set<string>();

function isSchedulerEnabled(): boolean {
  const raw = process.env.CRM_OWNER_INACTIVITY_SCHEDULER_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "on" || raw === "yes";
}

export async function runPortfolioInactivityScheduledJob(now: Date = new Date()): Promise<boolean> {
  const parts = getSaoPauloDateTimeParts(now);
  if (!isPortfolioInactivityScheduledMinute(parts)) return false;
  const triggerKey = `${parts.dateIso}:MONTHLY`;
  if (triggeredKeys.has(triggerKey)) return false;
  triggeredKeys.add(triggerKey);
  try {
    const { applyCommercialOwnerInactivity } = await import(
      "./customerCommercialOwnerInactivity.server.js"
    );
    const result = await applyCommercialOwnerInactivity(now);
    console.info(
      `${PORTFOLIO_INACTIVITY_LOG_PREFIX} runId=${result.runId} removed=${result.removed} preserved=${result.preserved} unchanged=${result.unchanged}`
    );
    return true;
  } catch (error) {
    console.error(`${PORTFOLIO_INACTIVITY_LOG_PREFIX} scheduled job crashed:`, error);
    return false;
  }
}

export function startPortfolioInactivityScheduledJob(): void {
  if (schedulerStarted) return;
  if (!isSchedulerEnabled()) {
    console.info(
      `${PORTFOLIO_INACTIVITY_LOG_PREFIX} scheduler disabled via CRM_OWNER_INACTIVITY_SCHEDULER_ENABLED`
    );
    return;
  }
  schedulerStarted = true;
  console.info(
    `${PORTFOLIO_INACTIVITY_LOG_PREFIX} registered job=${PORTFOLIO_INACTIVITY_JOB_ID} schedule=${PORTFOLIO_INACTIVITY_REGISTERED_JOB.schedule} tz=${BRENT_COLLECTION_TIMEZONE}`
  );
  void runPortfolioInactivityScheduledJob();
  schedulerTimer = setInterval(() => {
    void runPortfolioInactivityScheduledJob();
  }, SCHEDULER_TICK_MS);
  schedulerTimer.unref?.();
}

export function resetPortfolioInactivitySchedulerForTests(): void {
  schedulerStarted = false;
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  triggeredKeys.clear();
}
