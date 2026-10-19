/**
 * Superfície pública do portal de Desempenho e Cultura — guard de host, fail-closed.
 *
 * Mesma arquitetura da Satisfação (`satisfactionPublicSurface.ts`): o gateway externo é a
 * primeira barreira; este middleware é a segunda, dentro do Node. Pelo hostname público
 * configurado em PERFORMANCE_PUBLIC_HOSTS só existem `/avaliacao`, `/assets/*` e
 * `/api/public/performance/*`. Todo o resto responde 404 e os cookies administrativos
 * são removidos. Sem a variável, nada muda (o portal segue só na rede interna).
 *
 * Nenhuma infraestrutura real é alterada por este arquivo: publicar o portal fora da LAN
 * exige configurar o gateway e as variáveis, com autorização.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { normalizeHostname, normalizeRequestPath, stripAdminCookies } from "../satisfaction/satisfactionPublicSurface.js";

const ALWAYS_ALLOWED_EXACT = new Set<string>(["/avaliacao", "/favicon.ico", "/robots.txt"]);
const ALWAYS_ALLOWED_PREFIXES = ["/api/public/performance/", "/assets/"] as const;
const DEV_ONLY_EXACT = new Set<string>(["/avaliacao.html", "/@vite/client", "/@react-refresh"]);
const DEV_ONLY_PREFIXES = ["/@vite/", "/@react-refresh", "/@fs/", "/@id/", "/src/", "/node_modules/"] as const;

export type PerformancePublicSurfaceConfig = {
  publicHosts: readonly string[];
  surfaceHeaderName: string | null;
  allowDevAssets: boolean;
};

export function resolvePerformancePublicSurfaceConfig(env: NodeJS.ProcessEnv = process.env): PerformancePublicSurfaceConfig {
  const header = (env.PERFORMANCE_PUBLIC_SURFACE_HEADER ?? "").trim().toLowerCase();
  return {
    publicHosts: (env.PERFORMANCE_PUBLIC_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    surfaceHeaderName: header || null,
    allowDevAssets: env.NODE_ENV !== "production",
  };
}

export function isPerformancePublicRequest(input: { hostHeader?: string | null; headers?: Record<string, unknown> }, config: PerformancePublicSurfaceConfig): boolean {
  if (config.surfaceHeaderName) {
    const raw = input.headers?.[config.surfaceHeaderName];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === "string" && value.trim() === "1") return true;
  }
  if (config.publicHosts.length === 0) return false;
  const host = normalizeHostname(input.hostHeader);
  return Boolean(host && config.publicHosts.includes(host));
}

export function isPerformancePublicPathAllowed(rawPath: string, config: Pick<PerformancePublicSurfaceConfig, "allowDevAssets">): boolean {
  const path = normalizeRequestPath(rawPath);
  if (path.includes("..") || !path.startsWith("/")) return false;
  if (ALWAYS_ALLOWED_EXACT.has(path)) return true;
  if (ALWAYS_ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  if (config.allowDevAssets) {
    if (DEV_ONLY_EXACT.has(path)) return true;
    if (DEV_ONLY_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  }
  return false;
}

export const PERFORMANCE_PUBLIC_CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";

export function createPerformancePublicHostGuard(config: PerformancePublicSurfaceConfig = resolvePerformancePublicSurfaceConfig()): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isPerformancePublicRequest({ hostHeader: req.headers.host, headers: req.headers as Record<string, unknown> }, config)) return next();
    req.headers.cookie = stripAdminCookies(req.headers.cookie);
    if (!isPerformancePublicPathAllowed(req.path ?? req.url ?? "/", config)) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    if (!config.allowDevAssets) res.setHeader("Content-Security-Policy", PERFORMANCE_PUBLIC_CSP);
    next();
  };
}
