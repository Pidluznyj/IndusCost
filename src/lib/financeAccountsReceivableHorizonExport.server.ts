/**
 * Export do horizonte AR — loader Prisma (server-only).
 */
import type { PrismaClient } from "@prisma/client";
import { loadFinanceArOpenHorizonRowsFromPrisma } from "./financeAccountsReceivableManagement.server.js";
import {
  buildFinanceArHorizonExportPayloadFromRows,
  parseFinanceArHorizonExportQuery,
  type FinanceArHorizonExportPayload,
} from "./financeAccountsReceivableHorizonExport.js";

export async function buildFinanceArHorizonExportPayloadDefault(
  db: Pick<PrismaClient, "nomusAccountsReceivable" | "salesOrder" | "salesOrderNfeLink">,
  query: ReturnType<typeof parseFinanceArHorizonExportQuery>,
  userContext: { userName: string | null },
  referenceDate: Date = new Date()
): Promise<FinanceArHorizonExportPayload> {
  const { rows, syncCutoff } = await loadFinanceArOpenHorizonRowsFromPrisma(db, referenceDate);
  return buildFinanceArHorizonExportPayloadFromRows(
    rows,
    syncCutoff,
    query,
    userContext,
    referenceDate
  );
}
