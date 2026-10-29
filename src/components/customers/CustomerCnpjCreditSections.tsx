import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Loader2,
  Lock,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import {
  INTELLIGENCE_FACT_LABEL,
  presentCnpjSourceFact,
  type CnpjSourceFactInput,
  type CommercialCreditIntelligenceView,
  type CreditDecisionReason,
  type CreditDecisionSeverity,
} from "@/src/lib/commercial/commercialCreditIntelligenceView";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { CorporateLinkReviewPanel, type CorporateLinkReviewSubmit } from "./CorporateLinkReviewPanel";

type Props = {
  credit: CommercialCreditIntelligenceView | null;
  loading: boolean;
  error: string | null;
  sources?: CnpjSourceFactInput[];
  onRefresh?: () => void;
  customerId?: string | null;
  canReviewCorporateLinks?: boolean;
};

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <p className="min-w-0 break-words">
      <span className="text-slate-500">{label}: </span>
      <span>{value}</span>
    </p>
  );
}

const DECISION_TONE_CLASS: Record<
  CommercialCreditIntelligenceView["decisionTone"],
  { box: string; badge: string }
> = {
  critical: { box: "border-red-500 bg-red-100 text-red-950", badge: "bg-red-700 text-white" },
  blocked: { box: "border-red-300 bg-red-50 text-red-900", badge: "bg-red-600 text-white" },
  review: { box: "border-amber-300 bg-amber-50 text-amber-900", badge: "bg-amber-500 text-white" },
  released: { box: "border-emerald-300 bg-emerald-50 text-emerald-900", badge: "bg-emerald-600 text-white" },
  undetermined: { box: "border-slate-300 bg-slate-100 text-slate-800", badge: "bg-slate-500 text-white" },
};

function DecisionIcon({ tone, className }: { tone: CommercialCreditIntelligenceView["decisionTone"]; className?: string }) {
  if (tone === "released") return <CheckCircle2 className={className} aria-hidden />;
  if (tone === "review") return <AlertTriangle className={className} aria-hidden />;
  if (tone === "undetermined") return <HelpCircle className={className} aria-hidden />;
  if (tone === "critical") return <ShieldAlert className={className} aria-hidden />;
  return <Lock className={className} aria-hidden />;
}

const SEVERITY_LABEL: Record<CreditDecisionSeverity, string> = {
  CRITICAL: "Crítico",
  HIGH: "Alto",
  MEDIUM: "Atenção",
  INFO: "Informativo",
};

const SEVERITY_CLASS: Record<CreditDecisionSeverity, string> = {
  CRITICAL: "bg-red-700 text-white",
  HIGH: "bg-red-600 text-white",
  MEDIUM: "bg-amber-500 text-white",
  INFO: "bg-slate-500 text-white",
};

/**
 * Cabeçalho executivo de decisão de crédito (estados A–E).
 * A decisão vem do motor comercial; nunca do score cadastral.
 */
export function CreditDecisionHeader({
  credit,
  loading,
  error,
  sticky = false,
}: {
  credit: CommercialCreditIntelligenceView | null;
  loading: boolean;
  error: string | null;
  sticky?: boolean;
}) {
  const tone: CommercialCreditIntelligenceView["decisionTone"] =
    error || !credit ? "undetermined" : credit.decisionTone;
  const title = error
    ? "CRÉDITO NÃO DETERMINADO"
    : credit?.decisionTitle ?? "CRÉDITO NÃO DETERMINADO";
  const description = error
    ? "A situação de crédito ficou indisponível. É necessária análise antes da venda a prazo."
    : credit?.decisionDescription ??
      "Não foi possível confirmar as condições de crédito. É necessária análise antes da venda a prazo.";
  const toneClass = DECISION_TONE_CLASS[tone];
  const reasons = credit?.decisionReasons ?? [];
  return (
    <div
      className={cn(
        "rounded-2xl border-l-[6px] border p-4 shadow-sm",
        toneClass.box,
        sticky && "top-0 z-20"
      )}
      data-testid="cnpj-credit-decision-header"
      data-decision-state={error || !credit ? "NAO_DETERMINADO" : credit.decisionState}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <DecisionIcon tone={tone} className="mt-0.5 h-8 w-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-black uppercase leading-none tracking-tight sm:text-[28px]">
            {loading && !credit ? "Avaliando crédito…" : title}
          </p>
          <p className="mt-2 text-sm font-medium opacity-90">{description}</p>
          {tone === "blocked" || tone === "critical" ? (
            <p className="mt-1 text-sm font-black uppercase tracking-wide">Não vender a prazo sem liberação autorizada</p>
          ) : null}
          <p className="mt-2 text-[11px] uppercase tracking-wide opacity-70">
            Decisão do motor comercial · Última avaliação:{" "}
            {credit?.decisionEvaluatedAtLabel ?? INTELLIGENCE_FACT_LABEL.NOT_CONSULTED}
          </p>
          {reasons.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {reasons.map((reason) => (
                <span
                  key={reason.code}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                    reason.severity === "CRITICAL" || reason.severity === "HIGH"
                      ? "bg-white/80 text-red-900"
                      : reason.severity === "MEDIUM"
                        ? "bg-white/80 text-amber-950"
                        : "bg-white/70 text-slate-800"
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", SEVERITY_CLASS[reason.severity])} />
                  {reason.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function renderReasonCard(reason: CreditDecisionReason) {
  const rail =
    reason.severity === "CRITICAL" || reason.severity === "HIGH"
      ? "border-l-red-600 bg-red-50/60"
      : reason.severity === "MEDIUM"
        ? "border-l-amber-500 bg-amber-50/70"
        : "border-l-slate-400 bg-slate-50";
  return (
    <li
      key={reason.code}
      className={cn("rounded-lg border border-l-4 border-slate-200 p-3", rail)}
      data-testid="cnpj-credit-reason"
      data-reason-code={reason.code}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-slate-800">{reason.label}</p>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
            SEVERITY_CLASS[reason.severity]
          )}
        >
          {SEVERITY_LABEL[reason.severity]}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-700">{reason.description}</p>
      <p className="mt-1 text-[11px] text-slate-500">Origem: {reason.origin}</p>
    </li>
  );
}

/** "POR QUE ESTE CLIENTE ESTÁ BLOQUEADO?" — motivos reais do motor. */
export function CreditDecisionReasons({ credit }: { credit: CommercialCreditIntelligenceView | null }) {
  const reasons = credit?.decisionReasons ?? [];
  if (reasons.length === 0) return null;
  const heading =
    credit?.decisionState === "EM_ANALISE"
      ? "POR QUE ESTE CLIENTE EXIGE ANÁLISE?"
      : "POR QUE ESTE CLIENTE ESTÁ BLOQUEADO?";
  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      data-testid="cnpj-credit-reasons"
    >
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">{heading}</h3>
      <ul className="mt-3 grid gap-2 md:grid-cols-2">{reasons.map(renderReasonCard)}</ul>
    </section>
  );
}

export function CustomerCnpjCreditSections({
  credit,
  loading,
  error,
  sources = [],
  onRefresh,
  customerId = null,
  canReviewCorporateLinks = false,
}: Props) {
  const sourceFacts = sources.map((source) => presentCnpjSourceFact(source));
  // A falha volta para o painel (mensagem do servidor); o sucesso recarrega só o crédito, sem recarregar a página.
  const reviewLink: CorporateLinkReviewSubmit = async ({ relatedCustomerId, action, justification }) => {
    if (!customerId) throw new Error("Cliente não identificado.");
    await fetchJsonOk(`/api/customers/${customerId}/corporate-links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relatedCustomerId, action, justification }),
    });
    onRefresh?.();
  };

  return (
    <section className="space-y-3" data-testid="cnpj-credit-sections">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">Crédito comercial</h3>
        {onRefresh ? (
          <button
            type="button"
            className="cnpj-intelligence-no-print inline-flex items-center gap-1 rounded border px-2 py-1 text-xs"
            onClick={onRefresh}
            disabled={loading}
            data-testid="cnpj-credit-refresh"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Atualizar crédito
          </button>
        ) : null}
      </div>

      {loading && !credit ? (
        <div
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600"
          data-testid="cnpj-credit-loading"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando situação de crédito…
        </div>
      ) : null}

      {error ? (
        <div
          className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          data-testid="cnpj-credit-error"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error} A situação de crédito ficou indisponível.</span>
        </div>
      ) : null}

      <CreditDecisionReasons credit={credit} />

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="min-w-0 rounded-xl border border-l-4 border-slate-200 border-l-slate-400 bg-white p-4 text-sm shadow-sm" data-testid="cnpj-credit-cadastral">
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Qualidade cadastral</h4>
          <p className="text-2xl font-extrabold text-slate-900">
            Qualidade cadastral: {credit?.cadastralScoreLabel ?? INTELLIGENCE_FACT_LABEL.NOT_CONSULTED}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Indicador de consistência e características cadastrais. Não representa aprovação de crédito.
          </p>
          <p className="mt-3 text-lg font-extrabold text-slate-900" data-testid="cnpj-credit-confidence">
            Score de Confiança: {credit?.confidenceScoreLabel ?? INTELLIGENCE_FACT_LABEL.NOT_CONSULTED}
          </p>
          <p className="mt-1 text-xs text-slate-600">{credit?.confidenceDetail}</p>
          {credit?.confidenceNote ? (
            <p className="mt-2 text-xs font-semibold text-red-800" data-testid="cnpj-credit-confidence-note">
              {credit.confidenceNote}
            </p>
          ) : null}
        </div>
        <div className="min-w-0 rounded-xl border border-l-4 border-slate-200 border-l-blue-700 bg-white p-4 text-sm shadow-sm" data-testid="cnpj-credit-internal">
          <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-blue-800">2. Situação de crédito interno — Histórico financeiro (Nomus)</h4>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-red-50 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-red-700">Valor vencido</p>
              <p className="text-base font-extrabold text-red-950">{credit?.overdueAmountLabel ?? (error ? INTELLIGENCE_FACT_LABEL.UNAVAILABLE : INTELLIGENCE_FACT_LABEL.NOT_CONSULTED)}</p>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Títulos</p>
              <p className="text-base font-extrabold">{credit?.overdueTitleCountLabel ?? (error ? INTELLIGENCE_FACT_LABEL.UNAVAILABLE : INTELLIGENCE_FACT_LABEL.NOT_CONSULTED)}</p>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Maior atraso</p>
              <p className="text-base font-extrabold">{credit?.maxDaysOverdueLabel ?? (error ? INTELLIGENCE_FACT_LABEL.UNAVAILABLE : INTELLIGENCE_FACT_LABEL.NOT_CONSULTED)}</p>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Protesto interno</p>
              <p className="text-base font-extrabold">{credit?.internalProtestLabel ?? (error ? INTELLIGENCE_FACT_LABEL.UNAVAILABLE : INTELLIGENCE_FACT_LABEL.NOT_CONSULTED)}</p>
            </div>
          </div>
          <div className="mt-3 space-y-1 text-xs text-slate-600">
            <Fact label="Situação da análise" value={credit?.situationLabel ?? (error ? INTELLIGENCE_FACT_LABEL.UNAVAILABLE : INTELLIGENCE_FACT_LABEL.NOT_CONSULTED)} />
            <Fact label="Última sincronização Nomus" value={credit?.lastSyncedAtLabel ?? (error ? INTELLIGENCE_FACT_LABEL.UNAVAILABLE : INTELLIGENCE_FACT_LABEL.NOT_CONSULTED)} />
            <Fact label="Motivo do bloqueio" value={credit?.blockReason ?? (credit ? INTELLIGENCE_FACT_LABEL.CLEAR : error ? INTELLIGENCE_FACT_LABEL.UNAVAILABLE : INTELLIGENCE_FACT_LABEL.NOT_CONSULTED)} />
          </div>
          {credit?.financialDetailsRestricted ? (
            <p className="mt-2 text-xs text-slate-500" data-testid="cnpj-credit-restricted">
              Valores financeiros restritos à permissão de Contas a Receber.
            </p>
          ) : null}
        </div>

        {(credit?.overdueTitles.length ?? 0) > 0 ? (
          <div
            className="min-w-0 rounded-xl border border-l-4 border-slate-200 border-l-red-600 bg-white p-4 text-sm shadow-sm lg:col-span-2"
            data-testid="cnpj-credit-overdue-titles"
          >
            <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-red-800">Títulos vencidos — Nomus</h4>
            <div className="max-h-64 overflow-auto rounded-lg border border-red-100">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-red-50 text-left text-[10px] uppercase tracking-wide text-red-800">
                  <tr>
                    <th className="px-3 py-2">Documento</th>
                    <th className="px-3 py-2">Descrição</th>
                    <th className="px-3 py-2">Vencimento</th>
                    <th className="px-3 py-2">Atraso</th>
                    <th className="px-3 py-2 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {credit!.overdueTitles.map((title) => (
                    <tr key={title.id} className="border-t border-red-50 odd:bg-white even:bg-red-50/40">
                      <td className="px-3 py-1.5 font-semibold">
                        {title.documentLabel}
                        {title.protested ? (
                          <span className="ml-1 rounded-full bg-red-700 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                            Protesto
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-1.5 text-slate-700">{title.descriptionLabel}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{title.dueDateLabel}</td>
                      <td className="px-3 py-1.5 font-semibold text-red-800">{title.daysOverdueLabel}</td>
                      <td className="px-3 py-1.5 text-right font-extrabold tabular-nums text-red-950">{title.amountLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div className="min-w-0 rounded-xl border border-l-4 border-slate-200 border-l-amber-500 bg-white p-4 text-sm shadow-sm lg:col-span-2" data-testid="cnpj-credit-external">
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-800">3. Restrições externas verificadas</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Fact label="Banco Central do Brasil" value={credit?.bcbLabel ?? INTELLIGENCE_FACT_LABEL.NOT_APPLICABLE} />
              <p className="mt-1 text-xs text-slate-600" data-testid="cnpj-bcb-detail">
                {credit?.bcbDetail ?? "Não aplicável. Nenhuma consulta ao Banco Central foi realizada."}
              </p>
            </div>
            <div>
              <Fact label="Protesto externo" value={credit?.externalProtestLabel ?? (error ? INTELLIGENCE_FACT_LABEL.UNAVAILABLE : INTELLIGENCE_FACT_LABEL.NOT_CONSULTED)} />
              {credit?.externalProtestDetail ? <p className="text-xs text-slate-600">{credit.externalProtestDetail}</p> : null}
              <Fact label="Protesto nacional IEPTB" value={credit?.ieptbSituationLabel ?? INTELLIGENCE_FACT_LABEL.NOT_CONSULTED} />
            </div>
          </div>
          {sourceFacts.length > 0 ? (
            <ul className="mt-3 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
              {sourceFacts.map((fact) => (
                <li key={fact.label} className="break-words rounded-md bg-slate-50 px-2 py-1">
                  {fact.label}: {fact.stateLabel}. {fact.detail}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {credit ? (
        <CorporateLinkReviewPanel
          credit={credit}
          customerId={customerId}
          canReview={canReviewCorporateLinks}
          onSubmit={reviewLink}
        />
      ) : null}

      <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm" data-testid="cnpj-credit-decision">
        <h4 className="mb-2 font-semibold">4. Decisão comercial final</h4>
        {credit?.customerStatus ? (
          <p className="text-xs font-semibold" data-testid="cnpj-credit-status-code">
            Status comercial: {credit.customerStatus}
          </p>
        ) : null}
        <p className="font-medium">
          {credit?.headline ?? credit?.situationLabel ?? (error ? "Indisponível" : "Não consultado")}
        </p>
        <p className="mt-1 text-slate-700">{credit?.reason ?? "A decisão de prazo depende do crédito interno, não do score cadastral."}</p>
        <p className="mt-2 text-xs text-slate-500" data-testid="cnpj-credit-evidence">
          {credit?.evidenceOrigin ?? "Origem não consultada."}
        </p>
      </div>
    </section>
  );
}
