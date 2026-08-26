/**
 * Superfície pública da Satisfação — guard de host, fail-closed.
 *
 * O gateway externo (Cloudflare → túnel → nginx) é a PRIMEIRA barreira e só
 * deve encaminhar os paths públicos. Este módulo é a SEGUNDA barreira, dentro
 * do Node: se a requisição chega pelo hostname público, apenas os paths da
 * allowlist existem — todo o resto responde 404, inclusive `/api/auth/me`,
 * `/api/customers`, `/api/finance` e a SPA administrativa.
 *
 * Remover links do frontend não é defesa. Este arquivo é.
 *
 * Funções puras de propósito: os testes provam a allowlist sem subir servidor.
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";
import { buildSatisfactionPublicCsp } from "./satisfactionPublicCsp.js";

/** Cookies de sessão administrativa — nunca válidos na superfície pública. */
export const SATISFACTION_STRIPPED_COOKIE_NAMES = [
  "induscost_session",
  "induscost_bootstrap_admin",
  "induscost_admin_elevation",
] as const;

/** Prefixos liberados em QUALQUER ambiente. */
const ALWAYS_ALLOWED_PREFIXES = ["/api/public/satisfaction/", "/assets/"] as const;

/** Paths exatos liberados em qualquer ambiente. */
const ALWAYS_ALLOWED_EXACT = new Set<string>([
  "/r",
  "/api/public/satisfaction",
  "/favicon.ico",
  "/robots.txt",
]);

/**
 * Prefixos que só existem com o Vite em modo dev (HMR, módulos-fonte).
 * Em produção o bundle já está em /assets — liberar isto lá exporia o código.
 */
const DEV_ONLY_PREFIXES = [
  "/@vite/",
  "/@react-refresh",
  "/@fs/",
  "/@id/",
  "/src/",
  "/node_modules/",
] as const;

const DEV_ONLY_EXACT = new Set<string>(["/satisfacao.html", "/@vite/client", "/@react-refresh"]);

export type SatisfactionPublicSurfaceConfig = {
  /** Hostnames que representam a superfície pública (sem porta, minúsculos). */
  publicHosts: readonly string[];
  /**
   * Header opcional que o gateway define para marcar a superfície pública.
   * Só é considerado quando configurado — nunca um header genérico como XFF.
   */
  surfaceHeaderName: string | null;
  /** Em produção, os paths de dev do Vite deixam de existir. */
  allowDevAssets: boolean;
};

function splitList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function resolveSatisfactionPublicSurfaceConfig(
  env: NodeJS.ProcessEnv = process.env
): SatisfactionPublicSurfaceConfig {
  const headerName = (env.SATISFACTION_PUBLIC_SURFACE_HEADER ?? "").trim().toLowerCase();
  return {
    publicHosts: splitList(env.SATISFACTION_PUBLIC_HOSTS),
    surfaceHeaderName: headerName || null,
    allowDevAssets: env.NODE_ENV !== "production",
  };
}

/** Extrai só o hostname: tira porta e colchetes de IPv6, normaliza caixa. */
export function normalizeHostname(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end > 0 ? trimmed.slice(0, end + 1) : trimmed;
  }
  const withoutPort = trimmed.split(":")[0] ?? trimmed;
  return withoutPort || null;
}

/**
 * A requisição chega pela superfície pública?
 *
 * Decidido pelo `Host` (o que o gateway repassa) ou pelo header dedicado que o
 * gateway define. NÃO usamos X-Forwarded-Host genérico: um cliente poderia
 * forjá-lo para se declarar "não público" e escapar do guard.
 */
export function isSatisfactionPublicRequest(
  input: { hostHeader?: string | null; headers?: Record<string, unknown> },
  config: SatisfactionPublicSurfaceConfig
): boolean {
  if (config.surfaceHeaderName) {
    const raw = input.headers?.[config.surfaceHeaderName];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === "string" && value.trim() === "1") return true;
  }
  if (config.publicHosts.length === 0) return false;
  const host = normalizeHostname(input.hostHeader);
  if (!host) return false;
  return config.publicHosts.includes(host);
}

/** Normaliza o path: sem query/hash, sem barra final redundante, sem `..`. */
export function normalizeRequestPath(raw: string): string {
  const withoutQuery = raw.split("?")[0]?.split("#")[0] ?? "";
  if (!withoutQuery) return "/";
  let path = withoutQuery;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Percent-encoding inválido: mantém o original (será negado adiante).
  }
  path = path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (path.length > 1 && path.endsWith("/")) path = path.replace(/\/+$/, "");
  return path || "/";
}

/**
 * Allowlist da superfície pública. Fail-closed: o que não está aqui não existe.
 *
 * Qualquer travessia (`..`) é negada antes de qualquer comparação, para que
 * `/assets/../api/customers` não vire um bypass.
 */
export function isSatisfactionPublicPathAllowed(
  rawPath: string,
  config: Pick<SatisfactionPublicSurfaceConfig, "allowDevAssets">
): boolean {
  const path = normalizeRequestPath(rawPath);

  if (path.includes("..")) return false;
  if (!path.startsWith("/")) return false;

  if (ALWAYS_ALLOWED_EXACT.has(path)) return true;
  if (ALWAYS_ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;

  if (config.allowDevAssets) {
    if (DEV_ONLY_EXACT.has(path)) return true;
    if (DEV_ONLY_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  }

  return false;
}

/**
 * Remove cookies de sessão administrativa do cabeçalho.
 *
 * Garante que um token público jamais se transforme em sessão interna, mesmo
 * que algum path escape da allowlist no futuro: sem cookie, não há auth.
 */
export function stripAdminCookies(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return cookieHeader;
  const kept = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => {
      if (!part) return false;
      const name = part.split("=")[0]?.trim();
      return !SATISFACTION_STRIPPED_COOKIE_NAMES.includes(
        name as (typeof SATISFACTION_STRIPPED_COOKIE_NAMES)[number]
      );
    });
  return kept.length > 0 ? kept.join("; ") : undefined;
}

/** Marca posta na request para o restante da stack saber a superfície. */
export const SATISFACTION_PUBLIC_SURFACE_FLAG = "satisfactionPublicSurface" as const;

export function isRequestFlaggedPublic(req: Request): boolean {
  return (req as unknown as Record<string, unknown>)[SATISFACTION_PUBLIC_SURFACE_FLAG] === true;
}

/**
 * Middleware do guard. Registrar logo após o parse de body, ANTES de qualquer
 * rota — inclusive das rotas públicas da Satisfação.
 */
export function createSatisfactionPublicHostGuard(
  config: SatisfactionPublicSurfaceConfig = resolveSatisfactionPublicSurfaceConfig()
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const isPublic = isSatisfactionPublicRequest(
      { hostHeader: req.headers.host, headers: req.headers as Record<string, unknown> },
      config
    );
    if (!isPublic) return next();

    (req as unknown as Record<string, unknown>)[SATISFACTION_PUBLIC_SURFACE_FLAG] = true;
    req.headers.cookie = stripAdminCookies(req.headers.cookie);

    const path = req.path ?? req.url ?? "/";
    if (!isSatisfactionPublicPathAllowed(path, config)) {
      // 404 (e não 403) para não confirmar a existência da aplicação interna.
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    // Nada da superfície pública deve ser cacheado ou indexado.
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // CSP só no host público de produção. Em dev o HMR do Vite usa eval.
    if (!config.allowDevAssets) {
      res.setHeader("Content-Security-Policy", buildSatisfactionPublicCsp());
    }
    return next();
  };
}
