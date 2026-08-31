/**
 * Rate limit das operações de credencial humana (login e ciclo de senha).
 *
 * Chave é IDENTIDADE, nunca rede. O IndusCost não habilita `trust proxy` e
 * não possui cadeia de confiança para `X-Forwarded-For` / `X-Real-IP` /
 * `CF-Connecting-IP` no auth humano. Passar a confiar nesses headers só para
 * viabilizar rate limit enfraqueceria superfícies que hoje têm modelo de
 * confiança próprio (Collector via Tailscale, Satisfação via gateway). Então
 * limitamos por e-mail normalizado / userId, que o servidor conhece de fato.
 *
 * NÃO existe lockout persistente: nada é gravado no banco, a janela é
 * deslizante e expira sozinha. Isso impede que um terceiro trave a conta de
 * alguém de forma duradoura (DoS).
 *
 * Implementação in-memory por processo com relógio injetável — mesmo padrão já
 * usado na superfície pública da Satisfação, cujo limiter NÃO é tocado aqui.
 */

export type AuthRateLimitBucket = "login" | "change-password" | "admin-reset";

export type AuthRateLimitRule = {
  /** Janela deslizante, em milissegundos. */
  windowMs: number;
  /** Máximo de tentativas contabilizadas por chave dentro da janela. */
  max: number;
};

/**
 *  - login:           tentativas malsucedidas por identidade; sucesso zera.
 *  - change-password: troca voluntária/obrigatória por usuário autenticado.
 *  - admin-reset:     resets emitidos por um mesmo SUPER_ADMIN (abuso operacional).
 */
export const AUTH_RATE_LIMIT_RULES: Readonly<Record<AuthRateLimitBucket, AuthRateLimitRule>> =
  Object.freeze({
    login: { windowMs: 15 * 60_000, max: 5 },
    "change-password": { windowMs: 15 * 60_000, max: 10 },
    "admin-reset": { windowMs: 10 * 60_000, max: 10 },
  });

export type AuthRateLimitDecision = {
  allowed: boolean;
  remaining: number;
  /** Segundos até liberar — vira `Retry-After` quando bloqueado. */
  retryAfterSeconds: number;
};

type Entry = { hits: number[] };

export class AuthRateLimiter {
  private readonly buckets = new Map<string, Entry>();
  private readonly rules: Record<AuthRateLimitBucket, AuthRateLimitRule>;
  private lastSweepAt = 0;

  constructor(
    rules: Record<AuthRateLimitBucket, AuthRateLimitRule> = AUTH_RATE_LIMIT_RULES as Record<
      AuthRateLimitBucket,
      AuthRateLimitRule
    >
  ) {
    this.rules = rules;
  }

  /** Consulta sem consumir — para negar antes de fazer trabalho caro (scrypt). */
  peek(bucket: AuthRateLimitBucket, key: string, now: number = Date.now()): AuthRateLimitDecision {
    const rule = this.rules[bucket];
    const hits = this.liveHits(bucket, key, now);
    if (hits.length >= rule.max) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: this.retryAfter(hits, rule, now),
      };
    }
    return { allowed: true, remaining: rule.max - hits.length, retryAfterSeconds: 0 };
  }

  /** Contabiliza uma tentativa (tipicamente uma FALHA) e devolve a decisão. */
  consume(
    bucket: AuthRateLimitBucket,
    key: string,
    now: number = Date.now()
  ): AuthRateLimitDecision {
    const rule = this.rules[bucket];
    const mapKey = this.mapKey(bucket, key);
    this.sweep(now);
    const hits = this.liveHits(bucket, key, now);

    if (hits.length >= rule.max) {
      this.buckets.set(mapKey, { hits });
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: this.retryAfter(hits, rule, now),
      };
    }

    hits.push(now);
    this.buckets.set(mapKey, { hits });
    return { allowed: true, remaining: rule.max - hits.length, retryAfterSeconds: 0 };
  }

  /** Sucesso limpa o histórico da identidade (não pune quem só errou de dedo). */
  clear(bucket: AuthRateLimitBucket, key: string): void {
    this.buckets.delete(this.mapKey(bucket, key));
  }

  private mapKey(bucket: AuthRateLimitBucket, key: string): string {
    return `${bucket}:${key}`;
  }

  private liveHits(bucket: AuthRateLimitBucket, key: string, now: number): number[] {
    const windowStart = now - this.rules[bucket].windowMs;
    const entry = this.buckets.get(this.mapKey(bucket, key));
    return (entry?.hits ?? []).filter((at) => at > windowStart);
  }

  private retryAfter(hits: number[], rule: AuthRateLimitRule, now: number): number {
    const oldest = hits[0] ?? now;
    return Math.max(1, Math.ceil(Math.max(0, oldest + rule.windowMs - now) / 1000));
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

/** Instância compartilhada do processo (auth humano apenas). */
export const authRateLimiter = new AuthRateLimiter();

/** Corpo padrão do 429 — código estável, o cliente não faz parsing de texto. */
export function authRateLimitedBody(decision: AuthRateLimitDecision): {
  error: string;
  code: string;
  message: string;
  retryAfterSeconds: number;
} {
  return {
    error: "RATE_LIMITED",
    code: "RATE_LIMITED",
    message: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
    retryAfterSeconds: decision.retryAfterSeconds,
  };
}
