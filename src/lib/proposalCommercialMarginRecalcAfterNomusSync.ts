/**
 * Política do hook pós-sync Nomus → recálculo de margem comercial de Propostas.
 * Sem Prisma / sem I/O.
 *
 * Default seguro: dry-run (só analisa). Apply exige confirmação explícita.
 */
import {
  PROPOSAL_COMMERCIAL_RECALC_CONFIRM,
  type ProposalCommercialRecalcCliArgs,
  type ProposalCommercialRecalcPreview,
} from "./proposalCommercialMarginRecalc.js";

export const PROPOSAL_COMMERCIAL_MARGIN_RECALC_AFTER_SYNC_ENV =
  "PROPOSAL_COMMERCIAL_MARGIN_RECALC_AFTER_SYNC" as const;

export const PROPOSAL_COMMERCIAL_MARGIN_RECALC_CONFIRM_ENV =
  "PROPOSAL_COMMERCIAL_MARGIN_RECALC_CONFIRM" as const;

export type ProposalMarginRecalcAfterSyncMode = "off" | "dry-run" | "apply";

export type ProposalMarginRecalcAfterSyncDecision = {
  mode: ProposalMarginRecalcAfterSyncMode;
  /** true quando pediram apply sem confirmação — cai para dry-run. */
  applyDowngradedToDryRun: boolean;
  source: ProposalCommercialRecalcCliArgs["source"];
  forceFromFormation: boolean;
  confirmApply: string | null;
  reason: string;
};

export type ProposalMarginRecalcAfterSyncResult = {
  enabled: boolean;
  skipped: boolean;
  skipReason?: string;
  mode: ProposalMarginRecalcAfterSyncMode;
  applyDowngradedToDryRun: boolean;
  preview?: ProposalCommercialRecalcPreview & { pagesProcessed?: number };
  error?: string;
};

function hasFlag(argv: string[], name: string): boolean {
  return argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
}

function readArg(argv: string[], name: string): string | null {
  const pref = `--${name}=`;
  for (const a of argv) {
    if (a.startsWith(pref)) return a.slice(pref.length) || null;
  }
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1]!.startsWith("--")) {
    return argv[idx + 1]!;
  }
  return null;
}

function normalizeMode(raw: string | null | undefined): ProposalMarginRecalcAfterSyncMode | null {
  if (raw == null) return null;
  const v = raw.trim().toLowerCase();
  if (v === "off" || v === "false" || v === "0" || v === "disabled") return "off";
  if (v === "dry-run" || v === "dry" || v === "preview") return "dry-run";
  if (v === "apply" || v === "true" || v === "1") return "apply";
  return null;
}

/**
 * Resolve modo do hook: CLI > env > default `dry-run`.
 * Apply sem token de confirmação (CLI ou env) desce para dry-run.
 */
export function resolveProposalMarginRecalcAfterSyncDecision(input?: {
  argv?: string[];
  env?: Record<string, string | undefined>;
}): ProposalMarginRecalcAfterSyncDecision {
  const argv = input?.argv ?? [];
  const env = input?.env ?? process.env;

  if (hasFlag(argv, "skip-margin-recalc")) {
    return {
      mode: "off",
      applyDowngradedToDryRun: false,
      source: "IMPORTED",
      forceFromFormation: true,
      confirmApply: null,
      reason: "flag --skip-margin-recalc",
    };
  }

  const cliMode = normalizeMode(readArg(argv, "margin-recalc"));
  const envMode = normalizeMode(env[PROPOSAL_COMMERCIAL_MARGIN_RECALC_AFTER_SYNC_ENV]);
  let mode: ProposalMarginRecalcAfterSyncMode = cliMode ?? envMode ?? "dry-run";

  const sourceRaw = (readArg(argv, "margin-recalc-source") ?? "IMPORTED").toUpperCase();
  const source: ProposalCommercialRecalcCliArgs["source"] =
    sourceRaw === "ALL" || sourceRaw === "INTERNAL" || sourceRaw === "IMPORTED"
      ? sourceRaw
      : "IMPORTED";

  const forceFromFormation = !hasFlag(argv, "margin-recalc-keep-snapshot");
  const confirmApply =
    readArg(argv, "confirm-margin-recalc") ??
    env[PROPOSAL_COMMERCIAL_MARGIN_RECALC_CONFIRM_ENV]?.trim() ??
    null;

  let applyDowngradedToDryRun = false;
  if (mode === "apply" && confirmApply !== PROPOSAL_COMMERCIAL_RECALC_CONFIRM) {
    mode = "dry-run";
    applyDowngradedToDryRun = true;
  }

  const reasonParts = [
    cliMode ? `cli=${cliMode}` : null,
    !cliMode && envMode ? `env=${envMode}` : null,
    !cliMode && !envMode ? "default=dry-run" : null,
    applyDowngradedToDryRun
      ? `apply→dry-run (falta --confirm-margin-recalc=${PROPOSAL_COMMERCIAL_RECALC_CONFIRM} ou env ${PROPOSAL_COMMERCIAL_MARGIN_RECALC_CONFIRM_ENV})`
      : null,
  ].filter(Boolean);

  return {
    mode,
    applyDowngradedToDryRun,
    source,
    forceFromFormation,
    confirmApply,
    reason: reasonParts.join("; "),
  };
}

export function buildProposalMarginRecalcArgsForAfterSync(
  decision: ProposalMarginRecalcAfterSyncDecision
): ProposalCommercialRecalcCliArgs {
  const apply = decision.mode === "apply";
  return {
    dryRun: !apply,
    apply,
    confirmApply: apply ? PROPOSAL_COMMERCIAL_RECALC_CONFIRM : null,
    proposalId: null,
    proposalCode: null,
    dateFrom: null,
    dateTo: null,
    source: decision.source,
    limit: 200,
    skip: 0,
    onlyMissing: false,
    forceFromFormation: decision.forceFromFormation,
    json: false,
    batchSize: 25,
  };
}

export function formatProposalMarginRecalcAfterSyncLog(
  result: ProposalMarginRecalcAfterSyncResult
): string {
  const prefix = "[proposal-margin-recalc-after-sync]";
  if (!result.enabled || result.mode === "off") {
    return `${prefix} desabilitado (${result.skipReason ?? "mode=off"})`;
  }
  if (result.skipped) {
    return `${prefix} ignorado reason=${result.skipReason ?? "unknown"}`;
  }
  if (result.error) {
    return `${prefix} ERRO mode=${result.mode} error=${result.error}`;
  }
  const p = result.preview;
  if (!p) {
    return `${prefix} concluído mode=${result.mode} sem resumo`;
  }
  const downgrade = result.applyDowngradedToDryRun ? " downgradedApply→dry-run" : "";
  return (
    `${prefix} mode=${result.mode}${downgrade} pages=${p.pagesProcessed ?? "?"} ` +
    `propostas=${p.proposalsAnalyzed} itens=${p.itemsAnalyzed} ` +
    `complete=${p.itemsComplete} changed=${p.itemsChanged} ` +
    `unavailable=${p.itemsUnavailable} coverage%=${p.coveragePercent ?? "n/a"}`
  );
}
