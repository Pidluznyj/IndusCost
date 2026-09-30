/**
 * Intervalo mínimo compartilhado entre todas as chamadas HTTP DataJud do processo.
 * Processos e empresas usam o mesmo timestamp; o throttle não reinicia por CNJ.
 */

import {
  clampDatajudMinRequestIntervalMs,
  datajudRateLimitWaitMs,
} from "./datajudContracts.js";

export type DatajudThrottle = {
  waitBeforeRequest(): Promise<void>;
  waitAfterRateLimit(retryAfterSeconds: number | null | undefined): Promise<void>;
  noteRequest(): void;
};

export type DatajudThrottleClock = {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export function createDatajudThrottle(input: {
  intervalMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): DatajudThrottle {
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
      const wait = datajudRateLimitWaitMs(retryAfterSeconds, input.intervalMs);
      if (wait > 0) await sleep(wait);
    },
    noteRequest() {
      lastAt = now();
    },
  };
}

let shared: DatajudThrottle | null = null;

export function resetSharedDatajudThrottleForTests(): void {
  shared = null;
}

export function setSharedDatajudThrottleForTests(throttle: DatajudThrottle): void {
  shared = throttle;
}

export function getSharedDatajudThrottle(intervalMs: number, clock?: DatajudThrottleClock): DatajudThrottle {
  if (!shared) {
    shared = createDatajudThrottle({
      intervalMs: clampDatajudMinRequestIntervalMs(intervalMs),
      now: clock?.now,
      sleep: clock?.sleep,
    });
  }
  return shared;
}
