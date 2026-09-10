/**
 * Acesso à tela Pedidos de Compra — Nomus (`/purchases/nomus-orders`).
 *
 * A listagem HTTP ainda autoriza pela bag legada (`requireAnyPermission`),
 * enquanto o menu Compras usa o DTO `operations.purchases`. Sem este gate
 * extra, o perfil pode manter o item no menu e a rota renderiza o casco
 * com 403 ("Você não tem permissão para acessar este recurso.").
 *
 * A decisão de rota/landing lê a bag real (`effectivePermissions` /
 * `permissions`), não `hasPermission` do AuthContext — esse helper eleva
 * `purchases.view` a partir do DTO e esconderia o problema.
 */

export const NOMUS_PURCHASE_ORDER_VIEW_PERMISSIONS = [
  "purchases.nomusPurchaseOrders.view",
  "purchases.view",
  "settings.nomus.view",
] as const;

export const NOMUS_PURCHASE_ORDERS_PATH = "/purchases/nomus-orders";

/** Solicitação interna — destino do menu Compras quando Pedidos Nomus está negado. */
export const PURCHASES_INTERNAL_FALLBACK_PATH = "/purchases";

export function isNomusPurchaseOrdersPath(pathname: string): boolean {
  const normalized = (pathname.split("?")[0] ?? pathname).replace(/\/+$/, "") || "/";
  return (
    normalized === NOMUS_PURCHASE_ORDERS_PATH ||
    normalized.startsWith(`${NOMUS_PURCHASE_ORDERS_PATH}/`)
  );
}

export function userBagAllowsNomusPurchaseOrders(
  user:
    | {
        role?: string | null;
        permissions?: readonly string[] | null;
        effectivePermissions?: readonly string[] | null;
      }
    | null
    | undefined
): boolean {
  if (!user) return false;
  if (user.role === "SUPER_ADMIN") return true;
  const bag = new Set([
    ...(user.effectivePermissions ?? []),
    ...(user.permissions ?? []),
  ]);
  return NOMUS_PURCHASE_ORDER_VIEW_PERMISSIONS.some((key) => bag.has(key));
}

export function resolvePurchasesMenuPath(
  user:
    | {
        role?: string | null;
        permissions?: readonly string[] | null;
        effectivePermissions?: readonly string[] | null;
      }
    | null
    | undefined
): string {
  return userBagAllowsNomusPurchaseOrders(user)
    ? NOMUS_PURCHASE_ORDERS_PATH
    : PURCHASES_INTERNAL_FALLBACK_PATH;
}
