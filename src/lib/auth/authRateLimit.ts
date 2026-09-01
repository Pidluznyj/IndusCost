/**
 * Rate limit das operações de credencial humana.
 *
 * São DOIS mecanismos, porque os problemas são diferentes:
 *
 *  - `LoginThrottle`  — força bruta de senha. Precisa impedir a VERIFICAÇÃO
 *    (scrypt) em si, não só trocar o código de resposta. Cooldown progressivo
 *    e curto por identidade.
 *  - `AuthRateLimiter` — abuso operacional de quem JÁ está autenticado
 *    (trocar senha, disparar resets). Janela deslizante simples basta.
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

export type AuthRateLimitBucket = "change-password" | "admin-reset";

export type AuthRateLimitRule = {
  /** Janela deslizante, em milissegundos. */
  windowMs: number;
  /** Máximo de tentativas contabilizadas por chave dentro da janela. */
  max: number;
};

/**
 *  - change-password: troca voluntária/obrigatória por usuário autenticado.
 *  - admin-reset:     resets emitidos por um mesmo SUPER_ADMIN (abuso operacional).
 *
 * O login NÃO está aqui: ver `LoginThrottle` no fim do arquivo.
 */
export const AUTH_RATE_LIMIT_RULES: Readonly<Record<AuthRateLimitBucket, AuthRateLimitRule>> =
  Object.freeze({
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
export function authRateLimitedBody(decision: { retryAfterSeconds: number }): {
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

/* ------------------------------------------------------------------ */
/* Força bruta de login                                                */
/* ------------------------------------------------------------------ */

/**
 * Throttle de verificação de senha.
 *
 * O problema que ele resolve: uma janela deslizante que apenas troca 401 por
 * 429 NÃO contém força bruta, porque o `scrypt` continua rodando a cada
 * tentativa e o atacante segue testando candidatos à vontade. Aqui o gate
 * roda ANTES da verificação: durante o cooldown a requisição é recusada sem
 * que `verifyPassword` chegue a ser chamado.
 *
 * O que ele deliberadamente NÃO faz: bloqueio longo. O teto é de 2 minutos,
 * justamente para que conhecer o e-mail de alguém não vire uma forma de
 * derrubar o acesso da pessoa por muito tempo.
 *
 * Chave é IDENTIDADE (e-mail normalizado), nunca rede: não há `trust proxy`
 * nem cadeia de confiança para `X-Forwarded-For` / `CF-Connecting-IP`.
 *
 * Estado é in-memory por processo. Nada vai para o banco — não existe
 * `failedLoginCount` nem `lockedUntil` em `AppUser`.
 */

/** A partir daqui cada nova tentativa passa a exigir cooldown. */
export const LOGIN_FAILURE_THRESHOLD = 5;

/** Backoff progressivo, em ms, a partir da 5ª falha. O último valor é o teto. */
export const LOGIN_BACKOFF_MS: readonly number[] = Object.freeze([
  15_000, // 5ª falha
  30_000, // 6ª
  60_000, // 7ª
  120_000, // 8ª em diante (teto)
]);

/** Sem atividade por esse tempo, a identidade volta ao estado limpo. */
export const LOGIN_STATE_RESET_MS = 15 * 60_000;

export function loginCooldownMsFor(failures: number): number {
  if (failures < LOGIN_FAILURE_THRESHOLD) return 0;
  const index = Math.min(failures - LOGIN_FAILURE_THRESHOLD, LOGIN_BACKOFF_MS.length - 1);
  return LOGIN_BACKOFF_MS[index] ?? 0;
}

export type LoginAttemptAllowed = { allowed: true; failures: number };
export type LoginAttemptDenied = {
  allowed: false;
  failures: number;
  retryAfterSeconds: number;
};
export type LoginAttemptDecision = LoginAttemptAllowed | LoginAttemptDenied;

/**
 * Estreitamento explícito.
 *
 * O tsconfig do projeto não usa `strict`, e sem `strictNullChecks` o
 * estreitamento por discriminante (`if (!gate.allowed)`) não é aplicado. Um
 * type guard nomeado resolve sem `any` e sem `@ts-ignore` — mesmo padrão já
 * usado em `isPasswordLifecycleFailure`.
 */
export function isLoginAttemptDenied(
  decision: LoginAttemptDecision
): decision is LoginAttemptDenied {
  return decision.allowed === false;
}

type LoginEntry = {
  /** Falhas consecutivas contabilizadas para esta identidade. */
  failures: number;
  /** Instante (epoch ms) até o qual nenhuma verificação é permitida. */
  cooldownUntil: number;
  /** Última atividade — usada para o decaimento do estado. */
  lastAttemptAt: number;
};

export class LoginThrottle {
  private readonly entries = new Map<string, LoginEntry>();
  private lastSweepAt = 0;

  /**
   * Concede (ou nega) o direito de verificar a senha desta identidade.
   *
   * É SÍNCRONO de propósito: leitura e escrita acontecem sem `await` no meio,
   * então no laço de eventos do Node duas requisições paralelas não conseguem
   * observar o mesmo estado e passar as duas. Quem entra primeiro já grava o
   * novo cooldown; as demais o enxergam e são recusadas.
   *
   * A tentativa é cobrada como falha JÁ na concessão. Se ela der certo,
   * `recordSuccess` apaga tudo. Cobrar na entrada é o que impede uma rajada
   * simultânea de N requisições de conseguir N verificações antes que a
   * primeira falha fosse registrada.
   */
  acquire(key: string, now: number = Date.now()): LoginAttemptDecision {
    this.sweep(now);

    const stored = this.entries.get(key);
    const entry: LoginEntry =
      stored && now - stored.lastAttemptAt < LOGIN_STATE_RESET_MS
        ? stored
        : { failures: 0, cooldownUntil: 0, lastAttemptAt: now };

    if (now < entry.cooldownUntil) {
      entry.lastAttemptAt = now;
      this.entries.set(key, entry);
      return {
        allowed: false,
        failures: entry.failures,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.cooldownUntil - now) / 1000)),
      };
    }

    entry.failures += 1;
    entry.lastAttemptAt = now;
    entry.cooldownUntil = now + loginCooldownMsFor(entry.failures);
    this.entries.set(key, entry);
    return { allowed: true, failures: entry.failures };
  }

  /** Autenticação bem-sucedida apaga todo o estado da identidade. */
  recordSuccess(key: string): void {
    this.entries.delete(key);
  }

  /** Só para inspeção/teste. */
  failuresFor(key: string, now: number = Date.now()): number {
    const entry = this.entries.get(key);
    if (!entry) return 0;
    if (now - entry.lastAttemptAt >= LOGIN_STATE_RESET_MS) return 0;
    return entry.failures;
  }

  /** Só para inspeção/teste. */
  cooldownRemainingMs(key: string, now: number = Date.now()): number {
    const entry = this.entries.get(key);
    if (!entry) return 0;
    return Math.max(0, entry.cooldownUntil - now);
  }

  private sweep(now: number): void {
    if (now - this.lastSweepAt < 60_000) return;
    this.lastSweepAt = now;
    for (const [key, entry] of this.entries) {
      if (now - entry.lastAttemptAt >= LOGIN_STATE_RESET_MS) this.entries.delete(key);
    }
  }

  /** Só para teste — zera o estado entre casos. */
  reset(): void {
    this.entries.clear();
    this.lastSweepAt = 0;
  }
}

/** Instância compartilhada do processo. */
export const loginThrottle = new LoginThrottle();
