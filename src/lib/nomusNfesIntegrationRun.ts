import { Prisma, PrismaClient } from "@prisma/client";
import { NOMUS_NFE_SYNC_TARGET } from "./nomusNfesSyncConstants.js";

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

export type NfesIntegrationRunInput = {
  mode: "apply" | "preview";
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  exitCode: number;
  logFile?: string | null;
  command?: string | null;
  summary: Record<string, unknown>;
  applied: Record<string, unknown> | null;
  errorMessage?: string | null;
};

export async function persistNfesIntegrationRun(input: NfesIntegrationRunInput): Promise<void> {
  const success = input.exitCode === 0;
  const status = success ? "SUCCESS" : "FAILED";
  const summary = input.summary;
  const applied = input.applied;

  const integrationRunData: Prisma.IntegrationRunUncheckedCreateInput = {
    sourceSystem: "NOMUS",
    kind: "sync",
    target: NOMUS_NFE_SYNC_TARGET,
    mode: input.mode === "apply" ? "apply" : "dry",
    status,
    success,
    command: input.command ?? "sync:nomus:nfes:apply",
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs,
    exitCode: input.exitCode,
    logFile: input.logFile ?? null,
    pageRead: safeNumber(summary.pagesRead),
    ordersRead: safeNumber(summary.recordsRead),
    eligibleCount: safeNumber(summary.mapped),
    createdCount: safeNumber(applied?.created ?? summary.created),
    updatedCount: safeNumber(applied?.updated ?? summary.updated),
    summaryJson: {
      mode: input.mode,
      summary,
      applied,
      syncStrategy: summary.syncStrategy ?? null,
    } as Prisma.InputJsonValue,
    errorMessage: input.errorMessage ? maskSensitive(input.errorMessage).slice(0, 2000) : null,
  };

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
    console.error("[nomus-nfes] falha ao registrar IntegrationRun:", err);
  }
}

export async function disconnectNfesIntegrationPrisma(): Promise<void> {
  await prisma.$disconnect();
}
