import { clampEscavadorMinRequestIntervalMs } from "../../legalExposureFeatureFlags.js";

export type EscavadorThrottle = {
  waitBeforeRequest(): Promise<void>;
  waitAfterRateLimit(retryAfterSeconds: number | null | undefined): Promise<void>;
  noteRequest(): void;
};

export function createEscavadorThrottle(input: {
  intervalMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): EscavadorThrottle {
  let lastAt = 0;
  const now = input.now ?? (() => Date.now());
  const sleep =
    input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return {
    async waitBeforeRequest() {
      if (lastAt > 0) {
        const wait = Math.max(0, input.intervalMs - (now() - lastAt));
        if (wait > 0) await sleep(wait);
      }
      lastAt = now();
    },
    async waitAfterRateLimit(retryAfterSeconds) {
      const wait =
        retryAfterSeconds != null && Number.isFinite(retryAfterSeconds)
          ? Math.max(0, Math.round(retryAfterSeconds * 1000))
          : input.intervalMs;
      if (wait > 0) await sleep(wait);
    },
    noteRequest() {
      lastAt = now();
    },
  };
}

let shared: EscavadorThrottle | null = null;

export function resetSharedEscavadorThrottleForTests(): void {
  shared = null;
}

export function getSharedEscavadorThrottle(intervalMs: number): EscavadorThrottle {
  if (!shared) {
    shared = createEscavadorThrottle({
      intervalMs: clampEscavadorMinRequestIntervalMs(String(intervalMs)),
    });
  }
  return shared;
}
