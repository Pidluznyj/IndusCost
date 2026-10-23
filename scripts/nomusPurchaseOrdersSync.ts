/**
 * CLI oficial do espelho de Pedidos de Compra Nomus (`GET /rest/pedidoscompra`). Read-only no ERP.
 *
 * Só monta a requisição e chama o serviço canônico `runNomusPurchaseOrdersSync`
 * (lock de entidade, run em NomusSourceSyncRun, completude, presença). Sem lógica de negócio aqui.
 *
 *   tsx scripts/nomusPurchaseOrdersSync.ts <preview|apply> [--incremental|--reconcile|--backfill|--lookup=<id>]
 *       [--trigger=SCHEDULED_HOURLY|SCHEDULED_DAILY|CHAIN_AFTER_AR|ADMIN_PANEL|CLI|TARGETED_AUDIT]
 *
 * Saída: 0 sucesso ou pulado (registrado como SKIPPED), 3 inconclusivo, 1 falha.
 */
import "dotenv/config";
import { runNomusPurchaseOrdersSync } from "@/src/lib/nomus/nomusCanonicalSync.server.js";
import {
  NOMUS_CANONICAL_SOURCE_TRIGGERS,
  type NomusCanonicalSourceTrigger,
  type NomusCanonicalSyncStrategy,
} from "@/src/lib/nomus/nomusCanonicalSyncContract.js";
import {
  disconnectPurchaseOrderSyncPrisma,
  purchaseOrderSyncExitCode,
  recordPurchaseOrderSkippedRun,
} from "@/src/lib/nomus/nomusPurchaseOrderSyncService.server.js";

const LOG_PREFIX = "[nomus-purchase-orders]";

export type PurchaseOrderCliRequest = {
  mode: "preview" | "apply";
  strategy: NomusCanonicalSyncStrategy;
  trigger: NomusCanonicalSourceTrigger;
  allowMissingDetection: boolean;
  allowMissingConfirmation: boolean;
  targetExternalId: number | null;
};

export function parsePurchaseOrderCliRequest(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): PurchaseOrderCliRequest {
  const mode = argv.includes("apply") || argv.includes("--apply") ? "apply" : "preview";
  const lookupArg = argv.find((a) => a.startsWith("--lookup="));
  const targetExternalId = lookupArg ? Number.parseInt(lookupArg.slice("--lookup=".length), 10) || null : null;
  const reconcile = argv.includes("--reconcile") || argv.includes("reconcile");
  const backfill = argv.includes("--backfill") || argv.includes("backfill");

  const strategy: NomusCanonicalSyncStrategy = targetExternalId
    ? "TARGETED_LOOKUP"
    : reconcile || backfill
      ? "FULL_RECONCILIATION"
      : "RECENT_WINDOW";

  // Trigger explícito por argumento ou NOMUS_PO_TRIGGER (o runner de CR exporta
  // NOMUS_CANONICAL_SOURCE_TRIGGER para si; não herdamos aquele valor).
  const triggerArg = argv.find((a) => a.startsWith("--trigger="))?.slice("--trigger=".length);
  const rawTrigger = (triggerArg ?? env.NOMUS_PO_TRIGGER ?? "CLI").trim().toUpperCase();
  const trigger = (NOMUS_CANONICAL_SOURCE_TRIGGERS as readonly string[]).includes(rawTrigger)
    ? (rawTrigger as NomusCanonicalSourceTrigger)
    : "CLI";

  return {
    mode,
    strategy,
    trigger,
    // Backfill = upsert do universo sem avaliar ausência; reconcile = avaliação (ainda sujeita às flags).
    allowMissingDetection: reconcile,
    allowMissingConfirmation: reconcile,
    targetExternalId,
  };
}

async function main() {
  const request = parsePurchaseOrderCliRequest(process.argv.slice(2));
  console.warn(
    `${LOG_PREFIX} start mode=${request.mode} strategy=${request.strategy} trigger=${request.trigger}${
      request.targetExternalId ? ` target=${request.targetExternalId}` : ""
    }`
  );

  let exitCode = 1;
  try {
    const result = await runNomusPurchaseOrdersSync({
      strategy: request.strategy,
      mode: request.mode,
      scope: undefined,
      sourceTrigger: request.trigger,
      allowMissingDetection: request.allowMissingDetection,
      allowMissingConfirmation: request.allowMissingConfirmation,
      requestedBy: process.env.NOMUS_PO_REQUESTED_BY ?? null,
      correlationId: process.env.NOMUS_PO_CORRELATION_ID ?? null,
      targetExternalId: request.targetExternalId,
    });

    let runId = result.runId;
    if (result.status === "SKIPPED_LOCKED" && !runId) {
      // Lock de entidade ocupado: outra execução de Pedidos de Compra em andamento.
      // Registra o pulo (nunca conta como sucesso nem atualiza "último sucesso").
      const { PrismaClient } = await import("@prisma/client");
      const prisma = new PrismaClient();
      try {
        runId = await recordPurchaseOrderSkippedRun({
          prisma,
          strategy: request.mode === "preview" ? `${request.strategy}_PREVIEW` : request.strategy,
          trigger: request.trigger,
          reason: "ENTITY_LOCK_HELD",
          startedAt: new Date(result.startedAt),
          correlationId: result.correlationId,
        });
      } finally {
        await prisma.$disconnect();
      }
    }

    console.warn(
      `${LOG_PREFIX} summary ${JSON.stringify({
        status: result.status,
        runId,
        payloadComplete: result.payloadComplete,
        counters: result.counters,
        message: result.message ?? null,
      })}`
    );
    exitCode = purchaseOrderSyncExitCode(result.status);
  } catch (error) {
    console.error(`${LOG_PREFIX} falha`, error instanceof Error ? error.message : String(error));
    exitCode = 1;
  } finally {
    await disconnectPurchaseOrderSyncPrisma();
  }
  process.exit(exitCode);
}

const invokedDirectly = (process.argv[1] ?? "").replace(/\\/g, "/").endsWith("scripts/nomusPurchaseOrdersSync.ts");
if (invokedDirectly) void main();
