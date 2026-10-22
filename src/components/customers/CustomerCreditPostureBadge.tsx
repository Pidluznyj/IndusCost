import React from "react";
import { Lock, Search } from "lucide-react";
import { cn } from "@/src/lib/utils";
import type { PortfolioCreditDecisionPublic } from "@/src/lib/commercial/portfolioCredit";

/**
 * Selo da decisão oficial. Não usa a inadimplência própria como substituto
 * e não repete o veredito cadastral.
 */
export function CustomerCreditPostureBadge({
  decision,
  className,
}: {
  decision: PortfolioCreditDecisionPublic | null | undefined;
  className?: string;
}) {
  if (!decision) return null;
  const blocked = decision.customerStatus === "BLOQUEADO" || decision.customerStatus === "BLOQUEIO_CRITICO";
  const review = decision.customerStatus === "EM_ANALISE" || decision.customerStatus === "LEITURA_INDISPONIVEL";
  const tone = blocked
    ? "border-red-300 bg-red-50 text-red-800"
    : review
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <div
      className={cn(
        "inline-flex max-w-full flex-wrap items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        tone,
        className
      )}
      title={`${decision.decisionTitle}. ${decision.reasonLabel}. Política ${decision.policyVersion}.`}
      data-testid="customer-credit-posture"
      data-reason-group={decision.reasonGroup}
      data-read-failed={decision.readFailed ? "true" : "false"}
    >
      {blocked ? <Lock className="h-3 w-3 shrink-0" aria-hidden /> : review ? <Search className="h-3 w-3 shrink-0" aria-hidden /> : null}
      <span className="min-w-0 leading-tight">
        {decision.decisionTitle}
        {decision.reasonGroup !== "regular" ? ` · ${decision.reasonLabel}` : ""}
      </span>
    </div>
  );
}
