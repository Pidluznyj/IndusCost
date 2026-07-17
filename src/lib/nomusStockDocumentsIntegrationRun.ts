/**
 * Persistência best-effort de IntegrationRun para sync de Documentos de Saída.
 * Espelha o padrão NF-e/AR — falha de registro não derruba o sync.
 */

import { Prisma, PrismaClient } from "@prisma/client";
import { NOMUS_STOCK_DOCUMENTS_SYNC_TARGET } from "./nomusStockDocumentsSyncConstants.js";
import type { StockDocumentsSyncAuditRecord } from "./nomusStockDocumentsSyncLifecycle.js";

const prisma = new PrismaClient();

function maskSensitive(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*)([^\s]+)/gi, "$1***")
    .replace(/(token\s*[:=]\s*)([^\s]+)/gi, "$1***")
    .replace(/(\b(?:Bearer|Basic)\s+)([A-Za-z0-9\-._~+/]+=*)/gi, "$1***");
}

function safeNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export type StockDocumentsIntegrationRunInput = {
  audit: StockDocumentsSyncAuditRecord;
  logFile?: string | null;
  command?: string | null;
};

/** Mapeia audit → payload Prisma (puro / testável sem DB). */
export function buildStockDocumentsIntegrationRunData(
  input: StockDocumentsIntegrationRunInput
): Prisma.IntegrationRunUncheckedCreateInput {
  const audit = input.audit;
  const success = audit.exitCode === 0 && audit.completeness !== "failed";
  const status =
    audit.lockSkipped
      ? "SKIPPED"
      : success
        ? "SUCCESS"
        : audit.completeness === "partial"
          ? "PARTIAL"
          : "FAILED";

  return {
    sourceSystem: "NOMUS",
    kind: "sync",
    target: NOMUS_STOCK_DOCUMENTS_SYNC_TARGET,
    mode: audit.mode === "apply" ? "apply" : "dry",
    status,
    success,
    command:
      input.command ??
      (audit.mode === "apply"
        ? "sync:nomus:stock-documents:apply"
        : "sync:nomus:stock-documents:preview"),
    startedAt: new Date(audit.startedAt),
    finishedAt: new Date(audit.finishedAt),
    durationMs: audit.durationMs,
    exitCode: audit.exitCode,
    logFile: input.logFile ?? null,
    pageRead: safeNumber(audit.counters.documentsReceived),
    ordersRead: safeNumber(audit.counters.documentsReceived),
    eligibleCount: safeNumber(audit.counters.documentsReceived),
    createdCount: safeNumber(audit.counters.documentsCreated),
    updatedCount: safeNumber(audit.counters.documentsUpdated),
    itemsCreated: safeNumber(audit.counters.itemsReplaced),
    summaryJson: {
      audit,
      syncStrategy: "window_or_idNfe_upsert",
      presence: {
        firstSeenAt: "on_create",
        lastSeenAt: "on_every_presence",
        presentInLastPayload: "true_on_presence_never_mark_absent_on_partial",
        hashUnchanged: "presence_and_syncedAt_only",
      },
    } as Prisma.InputJsonValue,
    errorMessage: audit.errorMessage
      ? maskSensitive(audit.errorMessage).slice(0, 2000)
      : null,
  };
}

export async function persistStockDocumentsIntegrationRun(
  input: StockDocumentsIntegrationRunInput
): Promise<void> {
  const integrationRunData = buildStockDocumentsIntegrationRunData(input);

  try {
    if (input.logFile) {
      const existing = await prisma.integrationRun.findFirst({
        where: { logFile: input.logFile },
      });
      if (existing) {
        await prisma.integrationRun.update({
          where: { id: existing.id },
          data: integrationRunData,
        });
        return;
      }
    }
    await prisma.integrationRun.create({ data: integrationRunData });
  } catch (err) {
    console.error(
      "[nomus-stock-documents] falha ao registrar IntegrationRun:",
      err
    );
  }
}

export async function disconnectStockDocumentsIntegrationPrisma(): Promise<void> {
  await prisma.$disconnect();
}
