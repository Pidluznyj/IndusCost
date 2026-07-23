/**
 * Pós-sync: Pedidos de Venda (apply OK) → Documentos de Saída por idNfe dos vínculos.
 *
 * - Só idNfe já ligados via SalesOrderNfeLink (nunca janela ampla).
 * - Soft-fail no chamador: falha de DS não invalida pedidos já gravados.
 * - respectGlobalLock=false: roda sob o flock global dos pedidos.
 * - Antes do recompute do Kanban — garante DS local quando a NF já está no pedido.
 */

import type { PrismaClient } from "@prisma/client";
import { NOMUS_STOCK_DOCUMENTS_LOG_PREFIX } from "@/src/lib/nomusStockDocumentsSyncConstants.js";
import {
  syncNomusStockDocumentsByIdNfes,
  type SyncStockDocumentsByIdNfeResult,
} from "@/src/lib/nomusStockDocumentsSyncByIdNfe.server.js";

const LOG_PREFIX = NOMUS_STOCK_DOCUMENTS_LOG_PREFIX;

export const NOMUS_STOCK_DOCUMENTS_AFTER_SALES_SYNC_ENV =
  "NOMUS_STOCK_DOCUMENTS_AFTER_SALES_SYNC";

export type StockDocumentsAfterSalesOrdersResult = {
  skipped: boolean;
  skipReason: string | null;
  idNfes: number[];
  sync: SyncStockDocumentsByIdNfeResult | null;
};

export type RunNomusStockDocumentsAfterSalesOrdersSyncArgs = {
  prisma: PrismaClient;
  salesOrderIds?: string[];
  /** Injetável em testes. */
  syncByIdNfes?: typeof syncNomusStockDocumentsByIdNfes;
  env?: NodeJS.ProcessEnv;
  logger?: (message: string) => void;
};

export function isStockDocumentsAfterSalesSyncEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const raw = (env[NOMUS_STOCK_DOCUMENTS_AFTER_SALES_SYNC_ENV] ?? "true")
    .trim()
    .toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}

export async function resolveNfeExternalIdsForSalesOrders(
  prisma: PrismaClient,
  salesOrderIds: string[]
): Promise<number[]> {
  const ids = [...new Set(salesOrderIds)].filter((id) => id.trim().length > 0);
  if (ids.length === 0) return [];
  const links = await prisma.salesOrderNfeLink.findMany({
    where: { salesOrderId: { in: ids } },
    select: { nfeExternalId: true },
  });
  return [
    ...new Set(
      links
        .map((l) => l.nfeExternalId)
        .filter((id): id is number => id != null && Number.isFinite(id) && id > 0)
    ),
  ];
}

/**
 * Dispara sync pontual de DS após sync de pedidos bem-sucedido.
 */
export async function runNomusStockDocumentsAfterSalesOrdersSync(
  args: RunNomusStockDocumentsAfterSalesOrdersSyncArgs
): Promise<StockDocumentsAfterSalesOrdersResult> {
  const env = args.env ?? process.env;
  const log = args.logger ?? ((m: string) => console.warn(m));

  if (!isStockDocumentsAfterSalesSyncEnabled(env)) {
    log(
      `${LOG_PREFIX} pós-sync desabilitado (${NOMUS_STOCK_DOCUMENTS_AFTER_SALES_SYNC_ENV}).`
    );
    return {
      skipped: true,
      skipReason: NOMUS_STOCK_DOCUMENTS_AFTER_SALES_SYNC_ENV,
      idNfes: [],
      sync: null,
    };
  }

  const salesOrderIds = [...new Set(args.salesOrderIds ?? [])].filter(
    (id) => id.trim().length > 0
  );
  const idNfes = await resolveNfeExternalIdsForSalesOrders(
    args.prisma,
    salesOrderIds
  );

  if (idNfes.length === 0) {
    log(
      `${LOG_PREFIX} pós-pedidos: nenhum idNfe em SalesOrderNfeLink (salesOrderIds=${salesOrderIds.length})`
    );
    return {
      skipped: true,
      skipReason: "no-nfe-links",
      idNfes: [],
      sync: null,
    };
  }

  const syncByIdNfes = args.syncByIdNfes ?? syncNomusStockDocumentsByIdNfes;
  log(
    `${LOG_PREFIX} pós-pedidos: sync DS por idNfe count=${idNfes.length} salesOrders=${salesOrderIds.length}`
  );

  const sync = await syncByIdNfes({
    prisma: args.prisma,
    idNfes,
    env,
    // Já sob lock global dos pedidos.
    respectGlobalLock: false,
    logger: log,
  });

  return {
    skipped: false,
    skipReason: null,
    idNfes,
    sync,
  };
}

export function formatStockDocumentsAfterSalesOrdersLogLine(
  result: StockDocumentsAfterSalesOrdersResult
): string {
  if (result.skipped) {
    return `stock-documents: skipped (${result.skipReason ?? "disabled"})`;
  }
  const s = result.sync;
  if (!s) return "stock-documents: sem summary";
  if (s.lockBlocked) {
    return `stock-documents: BLOCKED idNfes=${result.idNfes.length}`;
  }
  const c = s.counters;
  return [
    "stock-documents: by-idNfe",
    `idNfes=${result.idNfes.length}`,
    `received=${c.documentsReceived}`,
    `created=${c.documentsCreated}`,
    `updated=${c.documentsUpdated}`,
    `unchanged=${c.documentsUnchanged}`,
    `errors=${s.errors}`,
  ].join(" ");
}
