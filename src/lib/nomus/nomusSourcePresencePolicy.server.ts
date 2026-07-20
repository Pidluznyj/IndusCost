/**
 * SYNC-07 — Filtros Prisma/SQL da policy de presença (server-only).
 */

import { Prisma } from "@prisma/client";
import {
  buildNomusSourceOperationallyPresentPrismaWhere,
  isNomusOpsExcludeMissingApEnabled,
  isNomusOpsExcludeMissingArEnabled,
  isNomusOpsExcludeMissingSalesOrdersEnabled,
  mergePrismaWhereWithOperationalPresence,
} from "./nomusSourcePresencePolicy.js";

export {
  buildNomusSourceOperationallyPresentPrismaWhere,
  mergePrismaWhereWithOperationalPresence,
} from "./nomusSourcePresencePolicy.js";

export function mergeSalesOrderOperationalPresenceWhere(
  where: Prisma.SalesOrderWhereInput,
  options?: {
    includeConfirmedMissing?: boolean;
    env?: Record<string, string | undefined>;
  }
): Prisma.SalesOrderWhereInput {
  if (options?.includeConfirmedMissing) return where;
  if (!isNomusOpsExcludeMissingSalesOrdersEnabled(options?.env)) return where;
  return mergePrismaWhereWithOperationalPresence(
    where,
    true
  ) as Prisma.SalesOrderWhereInput;
}

export function mergeAccountsReceivableOperationalPresenceWhere(
  where: Prisma.NomusAccountsReceivableWhereInput,
  options?: {
    /** Quando false, não aplica (ex.: visão settled/histórico). Default: true. */
    openOperationalUniverse?: boolean;
    includeConfirmedMissing?: boolean;
    env?: Record<string, string | undefined>;
  }
): Prisma.NomusAccountsReceivableWhereInput {
  if (options?.includeConfirmedMissing) return where;
  if (options?.openOperationalUniverse === false) return where;
  if (!isNomusOpsExcludeMissingArEnabled(options?.env)) return where;
  return mergePrismaWhereWithOperationalPresence(
    where,
    true
  ) as Prisma.NomusAccountsReceivableWhereInput;
}

export function mergeAccountsPayableOperationalPresenceWhere(
  where: Prisma.NomusAccountsPayableWhereInput,
  options?: {
    openOperationalUniverse?: boolean;
    includeConfirmedMissing?: boolean;
    env?: Record<string, string | undefined>;
  }
): Prisma.NomusAccountsPayableWhereInput {
  if (options?.includeConfirmedMissing) return where;
  if (options?.openOperationalUniverse === false) return where;
  if (!isNomusOpsExcludeMissingApEnabled(options?.env)) return where;
  return mergePrismaWhereWithOperationalPresence(
    where,
    true
  ) as Prisma.NomusAccountsPayableWhereInput;
}

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
