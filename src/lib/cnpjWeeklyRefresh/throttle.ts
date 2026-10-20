import type { CnpjWeeklyRefreshConfig } from "./config.js";

export type CnpjRefreshSleep = (ms: number) => Promise<void>;

function retryAfterMs(header: string | null, now: number): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return null;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Uma consulta por vez, com intervalo mínimo, retry e pausa quando as fontes
 * passam a recusar. Não abre conexão extra nem altera o host pedido pelo agregador.
 */
export function createThrottledCnpjFetch(
  config: Pick<
    CnpjWeeklyRefreshConfig,
    | "minIntervalMs"
    | "timeoutMs"
    | "maxRetries"
    | "backoffBaseMs"
    | "backoffCapMs"
    | "circuitFailureThreshold"
    | "circuitPauseMs"
  >,
  deps: {
    fetchImpl: typeof fetch;
    sleep?: CnpjRefreshSleep;
    now?: () => number;
  }
): typeof fetch {
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  let chain: Promise<unknown> = Promise.resolve();
  let lastStart = 0;
  let consecutiveFailures = 0;
  let circuitOpenUntil = 0;

  return (input, init) => {
    const run = async () => {
      const clock = now();
      if (clock < circuitOpenUntil) await sleep(circuitOpenUntil - clock);
      const elapsed = now() - lastStart;
      if (elapsed < config.minIntervalMs) await sleep(config.minIntervalMs - elapsed);

      let attempt = 0;
      let lastResponse: Response | null = null;
      while (attempt <= config.maxRetries) {
        lastStart = now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.timeoutMs);
        const external = init?.signal;
        const onExternalAbort = () => controller.abort();
        external?.addEventListener("abort", onExternalAbort);
        try {
          const response = await deps.fetchImpl(input, { ...init, signal: controller.signal });
          lastResponse = response;
          if (!isRetryableStatus(response.status) || attempt === config.maxRetries) {
            if (isRetryableStatus(response.status)) {
              consecutiveFailures += 1;
              if (consecutiveFailures >= config.circuitFailureThreshold) {
                circuitOpenUntil = now() + config.circuitPauseMs;
                consecutiveFailures = 0;
              }
            } else {
              consecutiveFailures = 0;
            }
            return response;
          }
          const wait = retryAfterMs(response.headers.get("retry-after"), now());
          const backoff = Math.min(config.backoffCapMs, config.backoffBaseMs * 2 ** attempt);
          await sleep(wait ?? backoff);
          attempt += 1;
        } catch (error) {
          if (attempt === config.maxRetries) {
            consecutiveFailures += 1;
            if (consecutiveFailures >= config.circuitFailureThreshold) {
              circuitOpenUntil = now() + config.circuitPauseMs;
              consecutiveFailures = 0;
            }
            throw error;
          }
          const backoff = Math.min(config.backoffCapMs, config.backoffBaseMs * 2 ** attempt);
          await sleep(backoff);
          attempt += 1;
        } finally {
          clearTimeout(timer);
          external?.removeEventListener("abort", onExternalAbort);
        }
      }
      if (lastResponse) return lastResponse;
      throw new Error("Falha na consulta cadastral.");
    };

    const next = chain.then(run, run);
    chain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };
}
