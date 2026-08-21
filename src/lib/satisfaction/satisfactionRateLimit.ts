/**
 * Rate limit aplicacional da superfície pública.
 *
 * Complementa (não substitui) a proteção de borda do Cloudflare/nginx descrita
 * no runbook. Os limites são generosos para o cliente legítimo — que responde
 * uma pesquisa curta uma vez — e apertados o bastante para barrar spam trivial.
 *
 * Implementação in-memory por processo, com relógio injetável: os testes não
 * dependem de tempo real e não há cache distribuído prematuro.
 */

export type SatisfactionRateLimitBucket = "session" | "draft" | "submit";

export type SatisfactionRateLimitRule = {
  /** Janela deslizante, em milissegundos. */
  windowMs: number;
  /** Máximo de requisições por chave dentro da janela. */
  max: number;
};

/**
 * Limites por operação:
 *  - session: troca token→sessão; tolera recarregar a página várias vezes.
 *  - draft:   autosave com debounce; o formulário salva a cada poucos segundos.
 *  - submit:  envio final; poucos por janela já cobre retentativa legítima.
 */
export const SATISFACTION_RATE_LIMIT_RULES: Readonly<
  Record<SatisfactionRateLimitBucket, SatisfactionRateLimitRule>
> = Object.freeze({
  session: { windowMs: 60_000, max: 20 },
  draft: { windowMs: 60_000, max: 60 },
  submit: { windowMs: 300_000, max: 10 },
});

type Entry = { hits: number[] };

export type SatisfactionRateLimitDecision = {
  allowed: boolean;
  remaining: number;
  /** Segundos até liberar — vira `Retry-After` quando bloqueado. */
  retryAfterSeconds: number;
};

/**
 * Contador de janela deslizante.
 *
 * A chave NUNCA é o token nem dado pessoal: usamos o identificador de rede já
 * derivado pelo chamador, combinado ao nome do bucket.
 */
export class SatisfactionRateLimiter {
  private readonly buckets = new Map<string, Entry>();
  private readonly rules: Record<SatisfactionRateLimitBucket, SatisfactionRateLimitRule>;
  private lastSweepAt = 0;

  constructor(
    rules: Record<
      SatisfactionRateLimitBucket,
      SatisfactionRateLimitRule
    > = SATISFACTION_RATE_LIMIT_RULES as Record<
      SatisfactionRateLimitBucket,
      SatisfactionRateLimitRule
    >
  ) {
    this.rules = rules;
  }

  check(
    bucket: SatisfactionRateLimitBucket,
    key: string,
    now: number = Date.now()
  ): SatisfactionRateLimitDecision {
    const rule = this.rules[bucket];
    const mapKey = `${bucket}:${key}`;
    const windowStart = now - rule.windowMs;

    this.sweep(now);

    const entry = this.buckets.get(mapKey) ?? { hits: [] };
    const hits = entry.hits.filter((at) => at > windowStart);

    if (hits.length >= rule.max) {
      const oldest = hits[0] ?? now;
      const retryAfterMs = Math.max(0, oldest + rule.windowMs - now);
      entry.hits = hits;
      this.buckets.set(mapKey, entry);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      };
    }

    hits.push(now);
    entry.hits = hits;
    this.buckets.set(mapKey, entry);
    return { allowed: true, remaining: rule.max - hits.length, retryAfterSeconds: 0 };
  }

  /** Limpeza preguiçosa — evita o Map crescer sem limite em processo longo. */
  private sweep(now: number): void {
    if (now - this.lastSweepAt < 60_000) return;
    this.lastSweepAt = now;
    const maxWindow = Math.max(...Object.values(this.rules).map((r) => r.windowMs));
    const cutoff = now - maxWindow;
    for (const [key, entry] of this.buckets) {
      const hits = entry.hits.filter((at) => at > cutoff);
      if (hits.length === 0) this.buckets.delete(key);
      else entry.hits = hits;
    }
  }

  /** Só para teste — zera o estado entre casos. */
  reset(): void {
    this.buckets.clear();
    this.lastSweepAt = 0;
  }
}

/**
 * Identificador de rede para o rate limit.
 *
 * Nunca é persistido como dado de negócio: vive apenas em memória, dentro da
 * janela. `X-Forwarded-For` só é considerado quando o proxy local é confiável,
 * senão um cliente forjaria a chave e escaparia do limite.
 */
export function resolveRateLimitKey(
  input: {
    socketAddress?: string | null;
    forwardedFor?: string | string[] | null;
  },
  options: { trustProxy: boolean }
): string {
  if (options.trustProxy) {
    const raw = Array.isArray(input.forwardedFor) ? input.forwardedFor[0] : input.forwardedFor;
    if (typeof raw === "string" && raw.trim()) {
      const first = raw.split(",")[0]?.trim();
      if (first) return first;
    }
  }
  return input.socketAddress?.trim() || "unknown";
}

/** Instância compartilhada do processo. */
export const satisfactionRateLimiter = new SatisfactionRateLimiter();
