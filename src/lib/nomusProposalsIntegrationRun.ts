import { Prisma, PrismaClient } from "@prisma/client";
import { NOMUS_PROPOSALS_SYNC_TARGET } from "./nomusProposalsSyncConstants.js";

const prisma = new PrismaClient();

function maskSensitive(value: string): string {
  // Ordem importa: "Bearer/Basic <token>" primeiro — se "authorization: ..."
  // rodasse antes, ele mascararia só a palavra "Bearer" (para no primeiro
  // espaço) e o token em si sobreviveria, já que "Bearer" não existiria mais
  // pro segundo replace encontrar.
  return value
    .replace(/(\b(?:Bearer|Basic)\s+)([A-Za-z0-9\-._~+/]+=*)/gi, "$1***")
    .replace(/(authorization\s*[:=]\s*)(\S+(?:\s+\S+)?)/gi, "$1***")
    .replace(/(token\s*[:=]\s*)(\S+)/gi, "$1***");
}

function safeNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export type ProposalsIntegrationRunInput = {
  mode: "apply" | "dry";
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  exitCode: number;
  logFile?: string | null;
  command?: string | null;
  skipReason?: string | null;
  summary?: Record<string, unknown> | null;
  applied?: Record<string, unknown> | null;
  errorMessage?: string | null;
};

/**
 * Monta o registro do IntegrationRun a partir do input — separado da escrita
 * no banco para ser testável sem Prisma (mesma ideia da persistência de AR,
 * só que a AR não separa isso; aqui separamos para poder testar a
 * derivação de `status`/campos sem precisar de banco nesta sessão).
 */
export function buildProposalsIntegrationRunData(
  input: ProposalsIntegrationRunInput
): Prisma.IntegrationRunUncheckedCreateInput {
  const summary = input.summary ?? {};
  const applied = input.applied ?? null;

  return {
    sourceSystem: "NOMUS",
    kind: "sync",
    target: NOMUS_PROPOSALS_SYNC_TARGET,
    mode: input.mode,
    status: input.status,
    success: input.status === "SUCCESS",
    command: input.command ?? "sync:nomus:proposals:apply",
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs,
    exitCode: input.exitCode,
    logFile: input.logFile ?? null,
    pageRead: safeNumber((summary as Record<string, unknown>).totalRead),
    ordersRead: safeNumber((summary as Record<string, unknown>).totalRead),
    eligibleCount: safeNumber((summary as Record<string, unknown>).eligibleCount),
    blockedCount: safeNumber((summary as Record<string, unknown>).blockedCount),
    createdCount: safeNumber((applied as Record<string, unknown> | null)?.created),
    updatedCount: safeNumber((applied as Record<string, unknown> | null)?.updated),
    itemsCreated: safeNumber((applied as Record<string, unknown> | null)?.replacedItemsCount),
    summaryJson: {
      mode: input.mode,
      skipReason: input.skipReason ?? null,
      summary,
      applied,
    } as Prisma.InputJsonValue,
    errorMessage: input.errorMessage ? maskSensitive(input.errorMessage).slice(0, 2000) : null,
  };
}

/**
 * Registro oficial de UMA execução de Propostas — cobre sucesso, falha e
 * skip por lock (nunca fica RUNNING para sempre: sempre chamado com um
 * status final já resolvido pelo chamador). Dedup por logFile, mesmo padrão
 * de nomusAccountsReceivableIntegrationRun.ts.
 */
export async function persistProposalsIntegrationRun(
  input: ProposalsIntegrationRunInput
): Promise<void> {
  const data = buildProposalsIntegrationRunData(input);
  try {
    if (input.logFile) {
      const existing = await prisma.integrationRun.findFirst({
        where: { logFile: input.logFile },
      });
      if (existing) {
        await prisma.integrationRun.update({ where: { id: existing.id }, data });
        return;
      }
    }
    await prisma.integrationRun.create({ data });
  } catch (err) {
    console.error("[nomus-proposals] falha ao registrar IntegrationRun:", err);
  }
}

export async function disconnectProposalsIntegrationPrisma(): Promise<void> {
  await prisma.$disconnect();
}
