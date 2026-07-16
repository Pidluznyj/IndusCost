/**
 * Pós-sync: Pedidos de Venda (apply OK) → Ordens de Produção incremental (OP-13).
 *
 * - Só incremental (nunca backfill / full scan).
 * - Soft-fail no chamador: falha de OP não invalida pedidos já gravados.
 * - Uma única execução de OP por fluxo de pedidos.
 * - respectGlobalLock=false: roda sob o flock global dos pedidos.
 */

import type { PrismaClient } from "@prisma/client";
import {
  NOMUS_PRODUCTION_ORDERS_INCREMENTAL_DEFAULT_MAX_PAGES,
  NOMUS_PRODUCTION_ORDERS_INCREMENTAL_DEFAULT_OVERLAP_HOURS,
  NOMUS_PRODUCTION_ORDERS_INCREMENTAL_DEFAULT_PAGE_SIZE,
  NOMUS_PRODUCTION_ORDERS_INCREMENTAL_FALLBACK_MAX_PAGES,
  type ProductionOrdersIncrementalSummary,
} from "@/src/lib/nomusProductionOrdersIncremental.js";
import { runNomusProductionOrdersIncremental } from "@/src/lib/nomusProductionOrdersIncremental.server.js";
import { reconcilePendingNomusProductionOrderSalesLinks } from "@/src/lib/nomusProductionOrdersSalesLinks.server.js";
import { isProductionOrdersAfterSalesSyncEnabled } from "@/src/lib/nomusProductionOrdersSyncLogic.js";
import { NOMUS_PRODUCTION_ORDERS_LOG_PREFIX } from "@/src/lib/nomusProductionOrdersSyncConstants.js";

const LOG_PREFIX = NOMUS_PRODUCTION_ORDERS_LOG_PREFIX;

export type ProductionOrdersAfterSalesOrdersResult = {
  /** Env desabilitou o pós-sync. */
  skipped: boolean;
  skipReason: string | null;
  summary: ProductionOrdersIncrementalSummary | null;
};

export type RunNomusProductionOrdersAfterSalesOrdersSyncArgs = {
  prisma: PrismaClient;
  salesOrderExternalIds?: number[];
  /** Injetável em testes. */
  runIncremental?: typeof runNomusProductionOrdersIncremental;
  reconcilePending?: typeof reconcilePendingNomusProductionOrderSalesLinks;
  env?: NodeJS.ProcessEnv;
  logger?: (message: string) => void;
};

/**
 * Dispara incremental apply de OP após sync de pedidos bem-sucedido.
 * Não chama backfill. Não inicia segunda execução no mesmo fluxo.
 */
export async function runNomusProductionOrdersAfterSalesOrdersSync(
  args: RunNomusProductionOrdersAfterSalesOrdersSyncArgs
): Promise<ProductionOrdersAfterSalesOrdersResult> {
  const env = args.env ?? process.env;
  const log = args.logger ?? ((m: string) => console.warn(m));

  if (!isProductionOrdersAfterSalesSyncEnabled(env)) {
    log(`${LOG_PREFIX} pós-sync desabilitado (NOMUS_PRODUCTION_ORDERS_AFTER_SYNC).`);
    return { skipped: true, skipReason: "NOMUS_PRODUCTION_ORDERS_AFTER_SYNC", summary: null };
  }

  const salesOrderExternalIds = [...new Set(args.salesOrderExternalIds ?? [])].filter(
    (id) => Number.isFinite(id) && id > 0
  );

  const runIncremental = args.runIncremental ?? runNomusProductionOrdersIncremental;

  log(
    `${LOG_PREFIX} pós-pedidos: iniciando incremental apply (salesOrderExternalIds=${salesOrderExternalIds.length})`
  );

  // Uma única chamada — sem backfill, sem SyncV1 full/point scan automático.
  const summary = await runIncremental({
    prisma: args.prisma,
    env,
    options: {
      mode: "apply",
      selector: null,
      overlapHours: NOMUS_PRODUCTION_ORDERS_INCREMENTAL_DEFAULT_OVERLAP_HOURS,
      pageSize: NOMUS_PRODUCTION_ORDERS_INCREMENTAL_DEFAULT_PAGE_SIZE,
      maxPages: NOMUS_PRODUCTION_ORDERS_INCREMENTAL_DEFAULT_MAX_PAGES,
      fallbackMaxPages: NOMUS_PRODUCTION_ORDERS_INCREMENTAL_FALLBACK_MAX_PAGES,
      stateFile:
        (env.NOMUS_PRODUCTION_ORDERS_INCREMENTAL_STATE_FILE ?? "").trim() || null,
      strictSelector: false,
    },
    // Já estamos sob o lock global dos pedidos (shell/cron/orquestrador).
    respectGlobalLock: false,
    logger: log,
  });

  if (summary.lockBlocked) {
    log(
      `${LOG_PREFIX} pós-pedidos: incremental BLOCKED (lock) — pedidos permanecem válidos. ${summary.audit?.finalMessage ?? ""}`
    );
  } else if ((summary.exitCode ?? 0) !== 0 || summary.errors > 0) {
    log(
      `${LOG_PREFIX} pós-pedidos: incremental com falhas errors=${summary.errors} exitCode=${summary.exitCode ?? 0} — pedidos permanecem válidos.`
    );
  } else {
    log(
      `${LOG_PREFIX} pós-pedidos: incremental ok pages=${summary.pagesRead} received=${summary.recordsReceived} created=${summary.created} updated=${summary.updated} unchanged=${summary.unchanged} cutoff=${summary.cutoffUsed}`
    );
  }

  const reconcile =
    args.reconcilePending ?? reconcilePendingNomusProductionOrderSalesLinks;
  try {
    const reconciled = await reconcile(args.prisma, {
      externalSalesOrderIds:
        salesOrderExternalIds.length > 0 ? salesOrderExternalIds : undefined,
      limit: 2000,
    });
    log(
      `${LOG_PREFIX} reconcile vínculos pendentes: scanned=${reconciled.scanned} updated=${reconciled.updated} salesOrderResolved=${reconciled.salesOrderResolved} salesOrderItemResolved=${reconciled.salesOrderItemResolved}`
    );
  } catch (error) {
    log(
      `${LOG_PREFIX} falha ao reconciliar vínculos pendentes (soft-fail): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  return { skipped: false, skipReason: null, summary };
}

/** Formata linha de status para o log do sync de pedidos. */
export function formatProductionOrdersAfterSalesOrdersLogLine(
  result: ProductionOrdersAfterSalesOrdersResult
): string {
  if (result.skipped) {
    return `production-orders: skipped (${result.skipReason ?? "disabled"})`;
  }
  const s = result.summary;
  if (!s) return "production-orders: sem summary";
  if (s.lockBlocked) {
    return `production-orders: BLOCKED pages=0 errors=0 message=${s.audit?.finalMessage ?? "lock"}`;
  }
  return [
    "production-orders: incremental",
    `pages=${s.pagesRead}`,
    `received=${s.recordsReceived}`,
    `created=${s.created}`,
    `updated=${s.updated}`,
    `unchanged=${s.unchanged}`,
    `invalid=${s.invalid}`,
    `errors=${s.errors}`,
    `cutoff=${s.cutoffUsed}`,
    `stateAdvanced=${s.stateAdvanced}`,
  ].join(" ");
}
