/**
 * Limite de tentativas do portal público, em memória do processo.
 * Complementa o bloqueio de 5 códigos errados por convite: aqui o alvo é varredura de
 * tokens e excesso de requisições por origem. Atrás de proxy, `req.ip` depende do
 * `trust proxy` do Express (não alterado por este módulo).
 */
import type { RequestHandler } from "express";

export type RateLimitOptions = { windowMs: number; max: number; now?: () => number };

export function createRateLimiter(name: string, options: RateLimitOptions): RequestHandler & { reset: () => void } {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const now = options.now ?? (() => Date.now());
  const handler = ((req, res, next) => {
    const t = now();
    if (hits.size > 5000) {
      for (const [key, bucket] of hits) if (bucket.resetAt <= t) hits.delete(key);
    }
    const key = `${name}:${req.ip ?? "?"}`;
    const bucket = hits.get(key);
    if (!bucket || bucket.resetAt <= t) {
      hits.set(key, { count: 1, resetAt: t + options.windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > options.max) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - t) / 1000)));
      res.status(429).json({ ok: false, message: "Muitas tentativas. Espere um minuto e tente de novo." });
      return;
    }
    next();
  }) as RequestHandler & { reset: () => void };
  handler.reset = () => hits.clear();
  return handler;
}
