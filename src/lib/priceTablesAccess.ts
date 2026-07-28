/**
 * Acesso a tabelas comerciais:
 * - Consumo (listar / usar preço vigente em propostas): proposals|pricing|settings.
 * - Geração/publicação de DRAFT: somente SUPER_ADMIN (gera para os demais usarem).
 */

export const PRICE_TABLE_CONSUMER_PERMISSIONS = [
  "pricing.view",
  "proposals.view",
  "settings.price_tables.view",
] as const;

export type PriceTableAccessChecker = {
  hasPermission: (permission: string) => boolean;
  isSuperAdmin?: () => boolean;
};

/** Quem acessa Propostas (ou precificação/config) pode usar tabelas vigentes. */
export function canConsumePriceTables(check: PriceTableAccessChecker): boolean {
  if (check.isSuperAdmin?.()) return true;
  return PRICE_TABLE_CONSUMER_PERMISSIONS.some((key) => check.hasPermission(key));
}

/** Somente Super Admin gera/publica tabelas comerciais. */
export function canGenerateCommercialPriceTables(check: {
  isSuperAdmin: () => boolean;
}): boolean {
  return check.isSuperAdmin();
}
