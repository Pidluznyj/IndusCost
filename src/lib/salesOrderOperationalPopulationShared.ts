/**
 * Helpers compartilháveis (sem Prisma client) para população operacional.
 * Separado para materialDemandFilters / CRM poderem aplicar presença sem
 * importar o facade server-only completo.
 */
import { mergeSalesOrderOperationalPresenceWhere } from "./nomus/nomusSourcePresencePolicy.js";

export type SalesOrderOperationalContext = "OPERATIONAL" | "HISTORICAL_AUDIT";

export { mergeSalesOrderOperationalPresenceWhere };

export function operationalPresenceOptions(input?: {
  context?: SalesOrderOperationalContext;
  env?: Record<string, string | undefined>;
}) {
  return {
    env: input?.env,
    includeConfirmedMissing: input?.context === "HISTORICAL_AUDIT",
  };
}
