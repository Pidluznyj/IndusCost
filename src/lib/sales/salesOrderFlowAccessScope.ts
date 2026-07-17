/**
 * OP-59 — Escopo comercial do Kanban de Pedidos.
 * Reutiliza a carteira CRM oficial (mesmo padrão de Documentos de Saída).
 */

import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  getCommercialAccessScope,
  loadCommercialCrmScope,
  type CommercialAccessScope,
} from "@/src/lib/commercial/commercialAccessScopeService.js";

export type SalesOrderFlowScopeDecision =
  | { ok: true; mode: "unrestricted"; scope: CommercialAccessScope }
  | {
      ok: true;
      mode: "own_portfolio";
      scope: CommercialAccessScope;
      allowedCustomerIds: string[];
    }
  | {
      ok: false;
      status: 403;
      body: { error: string; code: string };
      scope: CommercialAccessScope;
    };

export async function resolveSalesOrderFlowAccessScope(
  user: AppAuthContext,
  _prisma: Pick<PrismaClient, "salesOrder">
): Promise<SalesOrderFlowScopeDecision> {
  const scope = getCommercialAccessScope(user);

  if (scope.mode === "unrestricted") {
    return { ok: true, mode: "unrestricted", scope };
  }

  if (scope.mode === "none") {
    return {
      ok: false,
      status: 403,
      body: {
        error: scope.blockedMessage ?? "Acesso comercial negado.",
        code: "SALES_ORDER_FLOW_SCOPE_DENIED",
      },
      scope,
    };
  }

  const crm = await loadCommercialCrmScope(user);
  if (crm.denied) {
    return {
      ok: false,
      status: 403,
      body: {
        error: crm.reason ?? "Acesso comercial negado.",
        code: "SALES_ORDER_FLOW_SCOPE_DENIED",
      },
      scope,
    };
  }

  return {
    ok: true,
    mode: "own_portfolio",
    scope,
    allowedCustomerIds: [...crm.allowedCustomerIds],
  };
}
