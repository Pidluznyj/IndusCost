/**
 * Intervalo mínimo compartilhado entre todas as chamadas HTTP DJEN do processo.
 * Páginas, termos e empresas usam o mesmo timestamp.
 */

import {
  clampDjenMinRequestIntervalMs,
  djenRateLimitWaitMs,
} from "./djenContracts.js";

export type DjenThrottle = {
  waitBeforeRequest(): Promise<void>;
  waitAfterRateLimit(retryAfterSeconds: number | null | undefined): Promise<void>;
  noteRequest(): void;
};

export type DjenThrottleClock = {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export function createDjenThrottle(input: {
  intervalMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): DjenThrottle {
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
      const wait = djenRateLimitWaitMs(retryAfterSeconds, input.intervalMs);
      if (wait > 0) await sleep(wait);
    },
    noteRequest() {
      lastAt = now();
    },
  };
}

let shared: DjenThrottle | null = null;

export function resetSharedDjenThrottleForTests(): void {
  shared = null;
}

export function setSharedDjenThrottleForTests(throttle: DjenThrottle): void {
  shared = throttle;
}

export function getSharedDjenThrottle(intervalMs: number, clock?: DjenThrottleClock): DjenThrottle {
  if (!shared) {
    shared = createDjenThrottle({
      intervalMs: clampDjenMinRequestIntervalMs(intervalMs),
      now: clock?.now,
      sleep: clock?.sleep,
    });
  }
  return shared;
}
