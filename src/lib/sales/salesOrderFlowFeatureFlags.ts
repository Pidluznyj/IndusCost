/**
 * OP-58 — Ativação controlada da UI do Fluxo de Pedidos.
 *
 * O backend, migrations, rebuild e hooks incrementais não dependem desta flag.
 * Ela controla exclusivamente exposição de rota/menu do Kanban.
 */

import type { RequestHandler } from "express";

/** Nome conceitual/documental da feature. */
export const SALES_ORDER_FLOW_FEATURE_RESOURCE =
  "commercial.salesOrderFlow.enabled";

/** Mecanismo oficial atual do projeto: flag server-side por ambiente. */
export const SALES_ORDER_FLOW_ENABLED_ENV =
  "COMMERCIAL_SALES_ORDER_FLOW_ENABLED";

const ENABLED_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);

/**
 * Fail closed: ausente, vazia ou valor desconhecido = desabilitada.
 */
export function isSalesOrderFlowEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const raw = env[SALES_ORDER_FLOW_ENABLED_ENV]?.trim().toLowerCase();
  return raw != null && ENABLED_VALUES.has(raw);
}

/**
 * Guard para as futuras rotas HTTP do Kanban.
 * Retorna 404 quando desabilitada para não expor uma feature não liberada.
 */
export function requireSalesOrderFlowEnabled(
  env: Record<string, string | undefined> = process.env
): RequestHandler {
  return (_req, res, next) => {
    if (!isSalesOrderFlowEnabled(env)) {
      return res.status(404).json({ error: "API route not found" });
    }
    return next();
  };
}

/**
 * Regra única para visibilidade do futuro link/menu.
 * Feature flag não substitui autorização.
 */
export function canShowSalesOrderFlowNavigation(input: {
  featureEnabled: boolean;
  hasSalesOrdersViewAccess: boolean;
}): boolean {
  return input.featureEnabled && input.hasSalesOrdersViewAccess;
}
