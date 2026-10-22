import React from "react";
import { Lock, Search } from "lucide-react";
import { cn } from "@/src/lib/utils";
import type { PortfolioCreditDecisionPublic } from "@/src/lib/commercial/portfolioCredit";

type CreditSignalTone = "released" | "review" | "blocked" | "unread";

const SIGNAL_TONE: Record<CreditSignalTone, { dot: string; label: string; hint: string }> = {
  released: { dot: "bg-emerald-500", label: "Liberado", hint: "Prazo sem restrição impeditiva." },
  review: { dot: "bg-amber-400", label: "Em análise", hint: "Falta confirmação antes de liberar o prazo." },
  blocked: { dot: "bg-red-500", label: "Bloqueado", hint: "Restrição impeditiva confirmada." },
  unread: { dot: "bg-slate-400", label: "Sem leitura", hint: "A avaliação não pôde ser lida." },
};

export function creditSignalTone(
  decision: Pick<PortfolioCreditDecisionPublic, "customerStatus"> | null | undefined
): CreditSignalTone | null {
  if (!decision) return null;
  if (decision.customerStatus === "BLOQUEADO" || decision.customerStatus === "BLOQUEIO_CRITICO") return "blocked";
  if (decision.customerStatus === "LEITURA_INDISPONIVEL") return "unread";
  if (decision.customerStatus === "EM_ANALISE") return "review";
  return "released";
}

function creditSignalText(decision: PortfolioCreditDecisionPublic): string {
  return `${decision.decisionTitle}. ${decision.reasonLabel}.`;
}

/** Legenda curta da grade. O detalhe fica no ponto de cada cliente. */
export function CustomerCreditSignalLegend({ className }: { className?: string }) {
  return (
    <ul
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground", className)}
      data-testid="customer-credit-legend"
    >
      {(Object.keys(SIGNAL_TONE) as CreditSignalTone[]).map((tone) => (
        <li key={tone} className="inline-flex items-center gap-1.5" title={SIGNAL_TONE[tone].hint}>
          <span className={cn("h-2 w-2 rounded-full", SIGNAL_TONE[tone].dot)} aria-hidden />
          {SIGNAL_TONE[tone].label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Selo da decisão oficial. Na grade, um ponto com tooltip.
 * Não usa a inadimplência própria como substituto e não repete o veredito cadastral.
 */
export function CustomerCreditPostureBadge({
  decision,
  appearance = "label",
  className,
}: {
  decision: PortfolioCreditDecisionPublic | null | undefined;
  appearance?: "label" | "signal";
  className?: string;
}) {
  if (!decision) return null;
  const tone = creditSignalTone(decision) ?? "released";
  const text = creditSignalText(decision);
  const blocked = tone === "blocked";
  const review = tone === "review" || tone === "unread";
  if (appearance === "signal") {
    return (
      <span
        className={cn("inline-flex shrink-0", className)}
        title={text}
        role="img"
        aria-label={text}
        data-testid="customer-credit-posture"
        data-reason-group={decision.reasonGroup}
        data-signal={tone}
        data-read-failed={decision.readFailed ? "true" : "false"}
      >
        <span className={cn("h-2.5 w-2.5 rounded-full ring-2 ring-white", SIGNAL_TONE[tone].dot)} />
      </span>
    );
  }
  const labelTone = blocked
    ? "border-red-300 bg-red-50 text-red-800"
    : review
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <div
      className={cn(
        "inline-flex max-w-full flex-wrap items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        labelTone,
        className
      )}
      title={`${text} Política ${decision.policyVersion}.`}
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
