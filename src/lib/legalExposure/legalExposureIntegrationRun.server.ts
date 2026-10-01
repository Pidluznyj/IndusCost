/**
 * IntegrationRun do Exposure: startedAt real, finishedAt real, durationMs, RUNNING.
 * Reutiliza a tabela existente. Sem chamada às fontes.
 */

import type { PrismaClient } from "@prisma/client";

export const LEGAL_EXPOSURE_INTEGRATION_SOURCE = "CNJ";

export type ExposureRunStartInput = {
  target: string;
  mode: string;
  trigger: "SCHEDULED" | "MANUAL";
  job?: string;
  command?: string;
};

export type ExposureRunFinishInput = {
  id: string;
  status: string;
  summary: Record<string, unknown>;
  startedAt: Date;
};

export async function startExposureIntegrationRun(
  prisma: PrismaClient,
  input: ExposureRunStartInput
): Promise<{ id: string; startedAt: Date }> {
  const startedAt = new Date();
  const row = await prisma.integrationRun.create({
    data: {
      sourceSystem: LEGAL_EXPOSURE_INTEGRATION_SOURCE,
      target: input.target,
      mode: input.mode,
      kind: input.job ?? input.trigger,
      status: "RUNNING",
      success: null,
      command: input.command ?? `${input.trigger}:${input.target}`,
      startedAt,
      finishedAt: null,
      durationMs: null,
      summaryJson: { trigger: input.trigger, job: input.job ?? null, running: true },
    },
  });
  return { id: row.id, startedAt };
}

export async function finishExposureIntegrationRun(
  prisma: PrismaClient,
  input: ExposureRunFinishInput
): Promise<void> {
  const finishedAt = new Date();
  const durationMs = Math.max(0, finishedAt.getTime() - input.startedAt.getTime());
  const success =
    input.status === "SUCCESS" || input.status === "NO_RESULTS" || input.status === "PARTIAL";
  await prisma.integrationRun.update({
    where: { id: input.id },
    data: {
      status: input.status,
      success,
      finishedAt,
      durationMs,
      summaryJson: input.summary as object,
      errorMessage:
        typeof input.summary.sanitizedError === "string" ? String(input.summary.sanitizedError).slice(0, 500) : null,
      updatedAt: finishedAt,
    },
  });
}

export async function findRunningExposureJob(
  prisma: PrismaClient,
  target: string
): Promise<{ id: string; startedAt: Date | null } | null> {
  const row = await prisma.integrationRun.findFirst({
    where: { sourceSystem: LEGAL_EXPOSURE_INTEGRATION_SOURCE, target, status: "RUNNING" },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true },
  });
  return row;
}

export async function listExposureIntegrationRuns(
  prisma: PrismaClient,
  input?: { target?: string; take?: number }
) {
  const rows = await prisma.integrationRun.findMany({
    where: {
      sourceSystem: LEGAL_EXPOSURE_INTEGRATION_SOURCE,
      ...(input?.target ? { target: input.target } : {}),
    },
    orderBy: { startedAt: "desc" },
    take: input?.take ?? 50,
  });
  return rows.map((row) => {
    const summary = (row.summaryJson ?? {}) as Record<string, unknown>;
    const target = String(row.target ?? "");
    const source = target.replace(/^LEGAL_EXPOSURE_/, "");
    return {
      id: row.id,
      source,
      job: row.kind ?? (typeof summary.job === "string" ? summary.job : null),
      status: row.status,
      trigger: typeof summary.trigger === "string" ? summary.trigger : row.kind,
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      durationMs: row.durationMs,
      outcome: typeof summary.outcome === "string" ? summary.outcome : row.status,
      processesRequested: typeof summary.processesRequested === "number" ? summary.processesRequested : null,
      processesFound: typeof summary.processesFound === "number" ? summary.processesFound : null,
      movementsReceived: typeof summary.movementsReceived === "number" ? summary.movementsReceived : null,
      communicationsReceived: typeof summary.communicationsReceived === "number" ? summary.communicationsReceived : null,
      entitiesProcessed: typeof summary.entitiesProcessed === "number" ? summary.entitiesProcessed : null,
      errorCode: typeof summary.errorCode === "string" ? summary.errorCode : null,
      sanitizedError:
        typeof summary.sanitizedError === "string"
          ? summary.sanitizedError
          : row.errorMessage,
      externalCall: typeof summary.externalCall === "boolean" ? summary.externalCall : null,
    };
  });
}
