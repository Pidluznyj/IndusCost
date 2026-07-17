/**
 * PERM-39 — tentativa de acesso não autorizado (rota/aba).
 * Modal obrigatório antes do redirect; fallback = primeira rota do catálogo de navegação.
 */

import {
  canAccessPath,
  getSafeFirstAllowedPath,
  type NavigationAccessContext,
} from "@/src/lib/resourceNavigationAccess.js";

export const UNAUTHORIZED_ACCESS_MESSAGE =
  "Você não tem acesso a este conteúdo.";

export const NO_ACCESS_PAGE_TITLE = "Nenhum acesso liberado";

export const NO_ACCESS_PAGE_DESCRIPTION =
  "Seu usuário não possui acessos liberados. Procure o administrador do sistema.";

export type UnauthorizedAccessOutcome =
  | { kind: "pending" }
  | { kind: "allowed" }
  | { kind: "show_modal"; fallbackPath: string }
  | { kind: "no_access" };

export type ResolveUnauthorizedAccessInput = {
  ctx: NavigationAccessContext;
  pathname: string;
  /**
   * Aba/seção negada mesmo quando o path do módulo ainda tem `view`
   * (ex.: `/finance/cash-flow` sem grant da seção).
   */
  forceDenied?: boolean;
};

/**
 * Decide se o conteúdo pode renderizar, se o modal deve abrir, ou se
 * a página neutra (sem redirects) é necessária.
 */
export function resolveUnauthorizedAccessOutcome(
  input: ResolveUnauthorizedAccessInput
): UnauthorizedAccessOutcome {
  const { ctx, pathname, forceDenied = false } = input;

  if (ctx.authLoading) {
    return { kind: "pending" };
  }

  if (!forceDenied && canAccessPath(pathname, ctx)) {
    return { kind: "allowed" };
  }

  const fallback = getSafeFirstAllowedPath(ctx);
  if (!fallback) {
    return { kind: "no_access" };
  }

  // Evita loop: fallback inválido ou igual ao path negado sem grant.
  if (fallback === pathname || !canAccessPath(fallback, ctx)) {
    return { kind: "no_access" };
  }

  return { kind: "show_modal", fallbackPath: fallback };
}

/**
 * Aba pedida negada ou página sem abas → mesmo fluxo de acesso negado.
 */
export function resolveDeniedTabAccessOutcome(
  ctx: NavigationAccessContext,
  args: { requestedDenied: boolean; isEmpty: boolean; pathname: string }
): UnauthorizedAccessOutcome {
  if (!args.requestedDenied && !args.isEmpty) {
    return { kind: "allowed" };
  }
  return resolveUnauthorizedAccessOutcome({
    ctx,
    pathname: args.pathname,
    forceDenied: true,
  });
}
