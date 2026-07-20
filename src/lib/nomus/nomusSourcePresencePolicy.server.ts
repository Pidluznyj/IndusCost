/**
 * SYNC-07 — Fragmentos SQL Prisma da policy de presença (server-only).
 * Merges/predicados puros: `nomusSourcePresencePolicy.ts`.
 */

import { Prisma } from "@prisma/client";
import {
  isNomusOpsExcludeMissingApEnabled,
  isNomusOpsExcludeMissingArEnabled,
  isNomusOpsExcludeMissingSalesOrdersEnabled,
} from "./nomusSourcePresencePolicy.js";

export {
  buildNomusSourceOperationallyPresentPrismaWhere,
  mergeAccountsPayableOperationalPresenceWhere,
  mergeAccountsReceivableOperationalPresenceWhere,
  mergePrismaWhereWithOperationalPresence,
  mergeSalesOrderOperationalPresenceWhere,
} from "./nomusSourcePresencePolicy.js";

/** Fragmento SQL para SalesOrder (alias padrão `so`). */
export function salesOrderOperationalPresenceSql(
  alias = "so",
  env: Record<string, string | undefined> = process.env
): Prisma.Sql {
  if (!isNomusOpsExcludeMissingSalesOrdersEnabled(env)) {
    return Prisma.sql`TRUE`;
  }
  return Prisma.sql`${Prisma.raw(`${alias}."sourcePresenceStatus"`)}::text <> 'MISSING_CONFIRMED'`;
}

/** Fragmento SQL para NomusAccountsReceivable. */
export function accountsReceivableOperationalPresenceSql(
  alias: string,
  env: Record<string, string | undefined> = process.env
): Prisma.Sql {
  if (!isNomusOpsExcludeMissingArEnabled(env)) {
    return Prisma.sql`TRUE`;
  }
  return Prisma.sql`${Prisma.raw(`${alias}."sourcePresenceStatus"`)}::text <> 'MISSING_CONFIRMED'`;
}

/** Fragmento SQL para NomusAccountsPayable. */
export function accountsPayableOperationalPresenceSql(
  alias: string,
  env: Record<string, string | undefined> = process.env
): Prisma.Sql {
  if (!isNomusOpsExcludeMissingApEnabled(env)) {
    return Prisma.sql`TRUE`;
  }
  return Prisma.sql`${Prisma.raw(`${alias}."sourcePresenceStatus"`)}::text <> 'MISSING_CONFIRMED'`;
}
