/**
 * P11 — Rotas públicas / allowlist autenticada + reexport do mapa path→módulo.
 */

import {
  resolveModuleIdFromPath,
  SIDEBAR_MODULE_ORDER,
  type AppModuleId,
} from "@/src/lib/modulePermissions.js";

/** Paths públicos (fora de RequireAuth). Prefix match. */
export const PUBLIC_ROUTE_PATH_PREFIXES: readonly string[] = [
  "/login",
  "/proposals/",
  "/sales-orders/",
  "/public/",
  "/reservar-carro",
  "/r/",
];

/**
 * Rotas autenticadas sem resourceKey de módulo.
 * Vazio por política P11 — sessão não basta para abrir URL sem módulo mapeado.
 */
export const AUTHENTICATED_ALLOWLIST_PATH_PREFIXES: readonly string[] = [];

function normalizePathname(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed) return "/";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.replace(/\/+$/, "") || "/";
}

export function isPublicRoutePath(pathname: string): boolean {
  const p = normalizePathname(pathname);
  if (p === "/") return true;
  if (p.includes("/print")) {
    if (p.startsWith("/proposals/")) return true;
    if (p.startsWith("/sales-orders/")) return true;
    if (
      p.startsWith("/finance/suppliers/") &&
      p.includes("/service-terminations/")
    ) {
      return true;
    }
  }
  return PUBLIC_ROUTE_PATH_PREFIXES.some(
    (prefix) => p === prefix.replace(/\/+$/, "") || p.startsWith(prefix)
  );
}

export function isAuthenticatedAllowlistPath(pathname: string): boolean {
  const p = normalizePathname(pathname);
  return AUTHENTICATED_ALLOWLIST_PATH_PREFIXES.some(
    (prefix) => p === prefix.replace(/\/+$/, "") || p.startsWith(prefix)
  );
}

/** Alias oficial P11 do resolvedor de módulo. */
export function resolvePrivateRouteModuleId(
  pathname: string
): AppModuleId | null {
  return resolveModuleIdFromPath(pathname);
}

export function listPrivateRouteCoveredModules(): readonly AppModuleId[] {
  return SIDEBAR_MODULE_ORDER;
}
