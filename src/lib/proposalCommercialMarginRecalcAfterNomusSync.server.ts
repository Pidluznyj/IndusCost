/**
 * Hook pós-sync Nomus Proposals → recálculo de margem comercial.
 * Falha do hook não deve derrubar o sync oficial (best-effort + log).
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildProposalMarginRecalcArgsForAfterSync,
  formatProposalMarginRecalcAfterSyncLog,
  resolveProposalMarginRecalcAfterSyncDecision,
  type ProposalMarginRecalcAfterSyncDecision,
  type ProposalMarginRecalcAfterSyncResult,
} from "./proposalCommercialMarginRecalcAfterNomusSync.js";
import { runProposalCommercialMarginRecalcAllPages } from "./proposalCommercialMarginRecalc.server.js";

export type ProposalMarginRecalcAfterSyncDeps = {
  runAllPages: typeof runProposalCommercialMarginRecalcAllPages;
  persistAudit: (
    db: PrismaClient,
    input: {
      decision: ProposalMarginRecalcAfterSyncDecision;
      result: ProposalMarginRecalcAfterSyncResult;
      startedAt: Date;
      finishedAt: Date;
    }
  ) => Promise<void>;
};

async function persistProposalMarginRecalcAuditBestEffort(
  db: PrismaClient,
  input: {
    decision: ProposalMarginRecalcAfterSyncDecision;
    result: ProposalMarginRecalcAfterSyncResult;
    startedAt: Date;
    finishedAt: Date;
  }
): Promise<void> {
  try {
    const status = input.result.error
      ? "FAILED"
      : input.result.skipped || input.result.mode === "off"
        ? "SKIPPED"
        : "SUCCESS";

    const data: Prisma.IntegrationRunUncheckedCreateInput = {
      sourceSystem: "INDUSCOST",
      target: "proposal-commercial-margin-recalc:proposals",
      kind: "post-sync",
      mode: input.result.mode === "apply" ? "apply" : "dry",
      status,
      success: status === "SUCCESS",
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      durationMs: input.finishedAt.getTime() - input.startedAt.getTime(),
      summaryJson: {
        decision: input.decision,
        preview: input.result.preview
          ? {
              pagesProcessed: input.result.preview.pagesProcessed ?? null,
              proposalsAnalyzed: input.result.preview.proposalsAnalyzed,
              itemsAnalyzed: input.result.preview.itemsAnalyzed,
              itemsComplete: input.result.preview.itemsComplete,
              itemsChanged: input.result.preview.itemsChanged,
              itemsUnavailable: input.result.preview.itemsUnavailable,
              coveragePercent: input.result.preview.coveragePercent,
              bySource: input.result.preview.bySource,
            }
          : null,
        skipped: input.result.skipped,
        skipReason: input.result.skipReason ?? null,
        applyDowngradedToDryRun: input.result.applyDowngradedToDryRun,
      },
      errorMessage: input.result.error ?? input.result.skipReason ?? null,
    };

    await db.integrationRun.create({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[proposal-margin-recalc-after-sync] falha ao registrar auditoria: ${message}`
    );
  }
}

const defaultDeps: ProposalMarginRecalcAfterSyncDeps = {
  runAllPages: runProposalCommercialMarginRecalcAllPages,
  persistAudit: persistProposalMarginRecalcAuditBestEffort,
};

/**
 * Executa o hook após apply do sync de propostas.
 * Em sync dry-run, chamar com syncMode="dry" → skip.
 */
export async function runProposalCommercialMarginRecalcAfterNomusSync(
  db: PrismaClient,
  input?: {
    syncMode?: "apply" | "dry";
    argv?: string[];
    env?: Record<string, string | undefined>;
    deps?: Partial<ProposalMarginRecalcAfterSyncDeps>;
  }
): Promise<ProposalMarginRecalcAfterSyncResult> {
  const deps: ProposalMarginRecalcAfterSyncDeps = {
    ...defaultDeps,
    ...input?.deps,
  };
  const startedAt = new Date();
  const syncMode = input?.syncMode ?? "apply";

  const decision = resolveProposalMarginRecalcAfterSyncDecision({
    argv: input?.argv,
    env: input?.env,
  });

  if (syncMode !== "apply") {
    const result: ProposalMarginRecalcAfterSyncResult = {
      enabled: false,
      skipped: true,
      skipReason: "sync não está em apply",
      mode: "off",
      applyDowngradedToDryRun: false,
    };
    return result;
  }

  if (decision.mode === "off") {
    const result: ProposalMarginRecalcAfterSyncResult = {
      enabled: false,
      skipped: true,
      skipReason: decision.reason,
      mode: "off",
      applyDowngradedToDryRun: false,
    };
    await deps.persistAudit(db, {
      decision,
      result,
      startedAt,
      finishedAt: new Date(),
    });
    return result;
  }

  try {
    const args = buildProposalMarginRecalcArgsForAfterSync(decision);
    const preview = await deps.runAllPages(db, args, {
      performedBy: "hook:proposal-margin-recalc-after-nomus-sync",
      pageSize: 200,
    });
    const result: ProposalMarginRecalcAfterSyncResult = {
      enabled: true,
      skipped: false,
      mode: decision.mode,
      applyDowngradedToDryRun: decision.applyDowngradedToDryRun,
      preview,
    };
    await deps.persistAudit(db, {
      decision,
      result,
      startedAt,
      finishedAt: new Date(),
    });
    console.warn(formatProposalMarginRecalcAfterSyncLog(result));
    if (decision.applyDowngradedToDryRun) {
      console.warn(
        "[proposal-margin-recalc-after-sync] Para gravar snapshots na próxima vez: " +
          "PROPOSAL_COMMERCIAL_MARGIN_RECALC_AFTER_SYNC=apply e " +
          "PROPOSAL_COMMERCIAL_MARGIN_RECALC_CONFIRM=RECALCULATE_PROPOSAL_MARGINS " +
          "(ou --margin-recalc=apply --confirm-margin-recalc=RECALCULATE_PROPOSAL_MARGINS)."
      );
    } else if (decision.mode === "dry-run") {
      console.warn(
        "[proposal-margin-recalc-after-sync] Dry-run concluído (nenhuma escrita). " +
          "Após revisar, habilite apply com confirmação (env ou flags)."
      );
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result: ProposalMarginRecalcAfterSyncResult = {
      enabled: true,
      skipped: false,
      mode: decision.mode,
      applyDowngradedToDryRun: decision.applyDowngradedToDryRun,
      error: message,
    };
    await deps.persistAudit(db, {
      decision,
      result,
      startedAt,
      finishedAt: new Date(),
    });
    console.warn(formatProposalMarginRecalcAfterSyncLog(result));
    return result;
  }
}
