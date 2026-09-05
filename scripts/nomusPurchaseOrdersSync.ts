import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  buildNomusUrl,
  describeNomusCredential,
  fetchNomusJson,
  redactHeadersForLog,
  redactNomusUrlForLog,
} from "@/src/lib/nomusRestClient.js";
import { mapNomusPurchaseOrderPayload } from "@/src/lib/nomus/nomusPurchaseOrderMapper.js";
import { applyNomusPurchaseOrderRows } from "@/src/lib/nomus/nomusPurchaseOrderPersist.js";
import {
  NOMUS_PURCHASE_ORDER_RESOURCE,
  buildPurchaseOrderPageParams,
  computePurchaseOrderPaginationPlan,
  hasNextPurchaseOrderPage,
  parsePurchaseOrderSyncCli,
  pickPurchaseOrderPageItems,
  resolvePurchaseOrderPageSize,
  resolvePurchaseOrderWindow,
} from "@/src/lib/nomus/nomusPurchaseOrderSyncLogic.js";
import type { MappedNomusPurchaseOrder } from "@/src/lib/nomus/nomusPurchaseOrderTypes.js";

const prisma = new PrismaClient();
const LOG_PREFIX = "[nomus-purchase-orders]";

function getRequiredEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

async function fetchAllPages(
  baseUrl: string,
  options: ReturnType<typeof parsePurchaseOrderSyncCli>,
  window: { startDate: string; endDate: string }
) {
  const pageSize = resolvePurchaseOrderPageSize(process.env);
  const { firstPage, lastPage } = computePurchaseOrderPaginationPlan(options);
  const rows: MappedNomusPurchaseOrder[] = [];
  let pagesRead = 0;
  let recordsRead = 0;
  let mapErrors = 0;
  let http429Count = 0;
  let stoppedBecauseEmpty = false;
  let stoppedBecauseNoNext = false;
  let stoppedBecauseMaxPages = false;

  for (let page = firstPage; page <= lastPage; page += 1) {
    const url = buildNomusUrl(
      baseUrl,
      NOMUS_PURCHASE_ORDER_RESOURCE,
      buildPurchaseOrderPageParams(page, pageSize, window)
    );
    const payload = await fetchNomusJson(url, {
      logPrefix: LOG_PREFIX,
      logContext: { resource: NOMUS_PURCHASE_ORDER_RESOURCE, page },
      onRetryableStatus: ({ status }) => {
        if (status === 429) http429Count += 1;
      },
    });
    const items = pickPurchaseOrderPageItems(payload);
    pagesRead += 1;
    recordsRead += items.length;
    console.warn(`${LOG_PREFIX} página ${page} lida: ${items.length} registros.`);

    for (const item of items) {
      const mapped = mapNomusPurchaseOrderPayload(item);
      if (!mapped.ok) {
        mapErrors += 1;
        continue;
      }
      rows.push(mapped.row);
    }

    if (items.length === 0) {
      stoppedBecauseEmpty = true;
      break;
    }
    if (options.singlePage != null) {
      stoppedBecauseMaxPages = true;
      break;
    }
    if (!hasNextPurchaseOrderPage(payload, page, items.length, pageSize)) {
      stoppedBecauseNoNext = true;
      break;
    }
    if (page >= lastPage) {
      stoppedBecauseMaxPages = true;
      break;
    }
  }

  return {
    pagesRead,
    recordsRead,
    rows,
    mapErrors,
    http429Count,
    stoppedBecauseEmpty,
    stoppedBecauseNoNext,
    stoppedBecauseMaxPages,
  };
}

async function main() {
  const startedMs = Date.now();
  const options = parsePurchaseOrderSyncCli(process.argv.slice(2));
  const window = resolvePurchaseOrderWindow({
    incremental: options.incremental,
    backfill: options.backfill || !options.incremental,
    startDate: process.env.NOMUS_PO_START_DATE,
    endDate: process.env.NOMUS_PO_END_DATE,
  });
  const baseUrl = getRequiredEnv("NOMUS_BASE_URL");
  const pageSize = resolvePurchaseOrderPageSize(process.env);

  const envForLog = redactHeadersForLog(
    Object.fromEntries(
      Object.entries(process.env)
        .filter(([key]) => key.startsWith("NOMUS_"))
        .map(([key, value]) => [key, value ?? ""])
    )
  );

  console.warn(
    `${LOG_PREFIX} start mode=${options.mode} strategy=${options.syncStrategy} incremental=${options.incremental} backfill=${options.backfill} window=${window.startDate}..${window.endDate}`
  );
  console.warn(`${LOG_PREFIX} env Nomus (redigido): ${JSON.stringify(envForLog)}`);
  console.warn(
    `${LOG_PREFIX} credencial: ${JSON.stringify(describeNomusCredential(process.env.NOMUS_AUTH_HEADER_VALUE || process.env.NOMUS_TOKEN))}`
  );
  console.warn(
    `${LOG_PREFIX} endpoint=${redactNomusUrlForLog(buildNomusUrl(baseUrl, NOMUS_PURCHASE_ORDER_RESOURCE, buildPurchaseOrderPageParams(1, pageSize, window)))}`
  );

  let exitCode = 0;
  let errorMessage: string | null = null;
  let fetched: Awaited<ReturnType<typeof fetchAllPages>> | null = null;
  let applied = { created: 0, updated: 0, unchanged: 0, errors: 0 };

  try {
    fetched = await fetchAllPages(baseUrl, options, window);
    if (options.mode === "apply") {
      applied = await applyNomusPurchaseOrderRows(prisma, fetched.rows, new Date());
    }
  } catch (error) {
    exitCode = 1;
    errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`${LOG_PREFIX} falha`, errorMessage);
  }

  const canceled = fetched?.rows.filter((row) => row.stage === "CANCELED").length ?? 0;
  const summary = {
    mode: options.mode,
    strategy: options.syncStrategy,
    window,
    pages: fetched?.pagesRead ?? 0,
    recordsRead: fetched?.recordsRead ?? 0,
    mapped: fetched?.rows.length ?? 0,
    created: options.mode === "apply" ? applied.created : 0,
    updated: options.mode === "apply" ? applied.updated : 0,
    unchanged: options.mode === "apply" ? applied.unchanged : 0,
    previewWouldCreate: options.mode === "preview" ? (fetched?.rows.length ?? 0) : 0,
    canceled,
    mapErrors: fetched?.mapErrors ?? 0,
    applyErrors: applied.errors,
    http429Count: fetched?.http429Count ?? 0,
    stoppedBecauseEmpty: fetched?.stoppedBecauseEmpty ?? false,
    stoppedBecauseNoNext: fetched?.stoppedBecauseNoNext ?? false,
    stoppedBecauseMaxPages: fetched?.stoppedBecauseMaxPages ?? false,
    durationMs: Date.now() - startedMs,
    persisted: options.mode === "apply",
    error: errorMessage,
  };

  console.warn(`${LOG_PREFIX} summary ${JSON.stringify(summary)}`);
  if (options.mode === "preview") {
    console.warn(`${LOG_PREFIX} preview não grava.`);
  }

  await prisma.$disconnect();
  process.exit(exitCode);
}

void main();
