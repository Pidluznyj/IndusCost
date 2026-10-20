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

type Props = {
  credit: CommercialCreditIntelligenceView | null;
  loading: boolean;
  error: string | null;
  sources?: CnpjSourceFactInput[];
  onRefresh?: () => void;
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
  return (
    <div
      className={cn(
        "rounded-xl border-2 p-4",
        toneClass.box,
        sticky && "sticky top-0 z-20 shadow-sm"
      )}
      data-testid="cnpj-credit-decision-header"
      data-decision-state={error || !credit ? "NAO_DETERMINADO" : credit.decisionState}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <DecisionIcon tone={tone} className="mt-0.5 h-7 w-7 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-lg font-extrabold uppercase leading-tight tracking-tight sm:text-xl">
            {loading && !credit ? "Avaliando crédito…" : title}
          </p>
          <p className="mt-1 text-sm font-medium opacity-90">{description}</p>
          <p className="mt-2 text-[11px] uppercase tracking-wide opacity-70">
            Decisão do motor comercial · Última avaliação:{" "}
            {credit?.decisionEvaluatedAtLabel ?? INTELLIGENCE_FACT_LABEL.NOT_CONSULTED}
          </p>
        </div>
      </div>
    </div>
  );
}

function renderReasonCard(reason: CreditDecisionReason) {
  return (
    <li
      key={reason.code}
      className="rounded-lg border border-slate-200 bg-white p-3"
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
      className="rounded-xl border border-slate-200 bg-slate-50 p-4"
      data-testid="cnpj-credit-reasons"
    >
      <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">{heading}</h3>
      <ul className="mt-3 space-y-2">{reasons.map(renderReasonCard)}</ul>
    </section>
  );
}

export function CustomerCnpjCreditSections({ credit, loading, error, sources = [], onRefresh }: Props) {
  const sourceFacts = sources.map((source) => presentCnpjSourceFact(source));

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

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-lg border p-3 text-sm" data-testid="cnpj-credit-cadastral">
          <h4 className="mb-2 font-semibold">Qualidade cadastral</h4>
          <p>
            Qualidade cadastral: {credit?.cadastralScoreLabel ?? INTELLIGENCE_FACT_LABEL.NOT_CONSULTED}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Indicador de consistência e características cadastrais. Não representa aprovação de crédito.
          </p>
        </div>
        <div className="min-w-0 rounded-lg border p-3 text-sm" data-testid="cnpj-credit-internal">
          <h4 className="mb-2 font-semibold">2. Situação de crédito interno — Histórico financeiro (Nomus)</h4>
          <Fact label="Situação da análise" value={credit?.situationLabel ?? (error ? INTELLIGENCE_FACT_LABEL.UNAVAILABLE : INTELLIGENCE_FACT_LABEL.NOT_CONSULTED)} />
          <Fact label="Valor vencido" value={credit?.overdueAmountLabel ?? (error ? INTELLIGENCE_FACT_LABEL.UNAVAILABLE : INTELLIGENCE_FACT_LABEL.NOT_CONSULTED)} />
          <Fact label="Quantidade de títulos" value={credit?.overdueTitleCountLabel ?? (error ? INTELLIGENCE_FACT_LABEL.UNAVAILABLE : INTELLIGENCE_FACT_LABEL.NOT_CONSULTED)} />
          <Fact label="Maior atraso" value={credit?.maxDaysOverdueLabel ?? (error ? INTELLIGENCE_FACT_LABEL.UNAVAILABLE : INTELLIGENCE_FACT_LABEL.NOT_CONSULTED)} />
          <Fact label="Protesto interno" value={credit?.internalProtestLabel ?? (error ? INTELLIGENCE_FACT_LABEL.UNAVAILABLE : INTELLIGENCE_FACT_LABEL.NOT_CONSULTED)} />
          <Fact label="Última sincronização Nomus" value={credit?.lastSyncedAtLabel ?? (error ? INTELLIGENCE_FACT_LABEL.UNAVAILABLE : INTELLIGENCE_FACT_LABEL.NOT_CONSULTED)} />
          <Fact label="Motivo do bloqueio" value={credit?.blockReason ?? (credit ? INTELLIGENCE_FACT_LABEL.CLEAR : error ? INTELLIGENCE_FACT_LABEL.UNAVAILABLE : INTELLIGENCE_FACT_LABEL.NOT_CONSULTED)} />
          {credit?.financialDetailsRestricted ? (
            <p className="mt-2 text-xs text-slate-500" data-testid="cnpj-credit-restricted">
              Valores financeiros restritos à permissão de Contas a Receber.
            </p>
          ) : null}
        </div>

        <div className="min-w-0 rounded-lg border p-3 text-sm" data-testid="cnpj-credit-external">
          <h4 className="mb-2 font-semibold">3. Restrições externas verificadas</h4>
          <Fact label="Banco Central do Brasil" value={credit?.bcbLabel ?? INTELLIGENCE_FACT_LABEL.NOT_APPLICABLE} />
          <p className="mt-1 text-xs text-slate-600" data-testid="cnpj-bcb-detail">
            {credit?.bcbDetail ?? "Não aplicável. Nenhuma consulta ao Banco Central foi realizada."}
          </p>
          <Fact label="Protesto externo" value={credit?.externalProtestLabel ?? (error ? INTELLIGENCE_FACT_LABEL.UNAVAILABLE : INTELLIGENCE_FACT_LABEL.NOT_CONSULTED)} />
          {credit?.externalProtestDetail ? <p className="text-xs text-slate-600">{credit.externalProtestDetail}</p> : null}
          {sourceFacts.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {sourceFacts.map((fact) => (
                <li key={fact.label} className="break-words">
                  {fact.label}: {fact.stateLabel}. {fact.detail}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {credit ? (
        <div className="min-w-0 rounded-lg border p-3 text-sm" data-testid="cnpj-credit-relations">
          <h4 className="mb-2 font-semibold">Vínculos societários</h4>
          <p className="mb-2 text-xs text-slate-600">
            Alerta de análise. Não transfere dívida e não gera bloqueio crítico por si só.
          </p>
          {credit.corporateRelations.length === 0 ? (
            <p>Nenhum vínculo societário comprovado entre CNPJs cadastrados.</p>
          ) : (
            <ul className="space-y-2">
              {credit.corporateRelations.map((relation) => (
                <li key={`${relation.kindLabel}-${relation.relatedCompany}`} className="break-words">
                  <p className="font-medium">
                    {relation.kindLabel} · {relation.relatedCompany}
                  </p>
                  <p className="text-xs text-slate-600">Crédito da relacionada: {relation.creditStatusLabel}</p>
                  <p className="text-xs text-slate-600">{relation.evidence}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="min-w-0 rounded-lg border bg-slate-50 p-3 text-sm" data-testid="cnpj-credit-decision">
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
