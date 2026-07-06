/**
 * Severidade operacional do auto-apply BOM após sync Nomus.
 * Bloqueios esperados (gates) ≠ erro técnico fatal do lote.
 */

import type {
  NomusBomAutoApplyProductResult,
  NomusBomAutoApplyTotals,
} from "./nomusBomAutoApplyAfterSyncTypes";

export type NomusBomAutoApplyBatchOutcome =
  | "SUCCESS"
  | "SUCCESS_WITH_BLOCKED"
  | "FAILED";

const OPERATIONAL_BLOCK_PATTERNS: RegExp[] = [
  /BOM efetiva bloqueada/i,
  /incompleta/i,
  /Opcionais de precificação/i,
  /opcionais? de precificação/i,
  /opcional(?:es)? pendente/i,
  /revisão de engenharia/i,
  /gates de segurança/i,
  /Aplicação bloqueada/i,
  /Produto não encontrado no IndusCost/i,
  /Plano desatualizado/i,
  /Confirmação inválida/i,
];

export function isOperationalAutoApplyBlockMessage(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return OPERATIONAL_BLOCK_PATTERNS.some((re) => re.test(text));
}

export function classifyProductBlockCategory(
  reasons: string[],
  errorMessage?: string | null
): "optionalPricing" | "engineering" | "missingProduct" | "other" {
  const hay = `${reasons.join(" ")} ${errorMessage ?? ""}`;
  if (/opcionais? de precificação|optional pricing/i.test(hay)) {
    return "optionalPricing";
  }
  if (/não encontrado|não cadastrado|missing product/i.test(hay)) {
    return "missingProduct";
  }
  if (/BOM efetiva|engenharia|revisão|gate/i.test(hay)) {
    return "engineering";
  }
  return "other";
}

export type NomusBomAutoApplyBlockingBreakdown = {
  applied: number;
  noChanges: number;
  skipped: number;
  blockedByOptionalPricing: number;
  blockedByEngineering: number;
  blockedByMissingProduct: number;
  blockedOther: number;
  technicalErrors: number;
};

export function buildAutoApplyBlockingBreakdown(
  products: NomusBomAutoApplyProductResult[]
): NomusBomAutoApplyBlockingBreakdown {
  const breakdown: NomusBomAutoApplyBlockingBreakdown = {
    applied: 0,
    noChanges: 0,
    skipped: 0,
    blockedByOptionalPricing: 0,
    blockedByEngineering: 0,
    blockedByMissingProduct: 0,
    blockedOther: 0,
    technicalErrors: 0,
  };

  for (const p of products) {
    if (p.status === "APPLIED") breakdown.applied += 1;
    else if (p.status === "NO_CHANGES") breakdown.noChanges += 1;
    else if (p.status === "SKIPPED") breakdown.skipped += 1;
    else if (p.status === "BLOCKED") {
      const cat = classifyProductBlockCategory(p.blockingReasons, p.errorMessage);
      if (cat === "optionalPricing") breakdown.blockedByOptionalPricing += 1;
      else if (cat === "missingProduct") breakdown.blockedByMissingProduct += 1;
      else if (cat === "engineering") breakdown.blockedByEngineering += 1;
      else breakdown.blockedOther += 1;
    } else if (p.status === "ERROR") {
      breakdown.technicalErrors += 1;
    }
  }

  return breakdown;
}

export function resolveAutoApplyBatchOutcome(
  totals: NomusBomAutoApplyTotals
): NomusBomAutoApplyBatchOutcome {
  if (totals.parentsErrored > 0) return "FAILED";
  if (totals.parentsBlocked > 0) return "SUCCESS_WITH_BLOCKED";
  return "SUCCESS";
}

export function orchestratorBomAutoApplyCountsAsSuccess(
  status: NomusBomAutoApplyBatchOutcome | "SKIPPED"
): boolean {
  return status === "SUCCESS" || status === "SUCCESS_WITH_BLOCKED" || status === "SKIPPED";
}

export function orchestratorPipelineSuccess(input: {
  results: Array<{ status: string }>;
  bomAutoApplyStatus: NomusBomAutoApplyBatchOutcome | "SKIPPED" | null;
}): boolean {
  const stepsOk = input.results.every((r) =>
    ["SUCCESS", "SUCCESS_WITH_BLOCKED", "SKIPPED"].includes(r.status)
  );
  const bomOk =
    input.bomAutoApplyStatus == null ||
    orchestratorBomAutoApplyCountsAsSuccess(input.bomAutoApplyStatus);
  return stepsOk && bomOk;
}
