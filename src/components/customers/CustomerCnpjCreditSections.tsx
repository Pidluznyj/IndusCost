import React from "react";
import { AlertTriangle, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import {
  INTELLIGENCE_FACT_LABEL,
  presentCnpjSourceFact,
  type CnpjSourceFactInput,
  type CommercialCreditIntelligenceView,
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

      {credit?.headline ? (
        <div
          className="rounded-lg border border-red-300 bg-red-50 px-3 py-3 text-red-950"
          data-testid="cnpj-credit-blocked"
        >
          <p className="flex items-center gap-2 text-base font-semibold">
            <ShieldAlert className="h-5 w-5" />
            {credit.headline}
          </p>
          <p className="mt-1 text-xs">
            O bloqueio vale mesmo com score cadastral alto. O veredito cadastral não autoriza venda a prazo.
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-lg border p-3 text-sm" data-testid="cnpj-credit-cadastral">
          <h4 className="mb-2 font-semibold">1. Score cadastral</h4>
          <p>
            Score cadastral: {credit?.cadastralScoreLabel ?? INTELLIGENCE_FACT_LABEL.NOT_CONSULTED}
            {credit?.cadastralVerdict ? ` · ${credit.cadastralVerdict}` : ""}
          </p>
          <p className="mt-1 text-xs text-slate-600">Veredito cadastral. Não autoriza crédito nem venda a prazo.</p>
        </div>
        <div className="min-w-0 rounded-lg border p-3 text-sm" data-testid="cnpj-credit-internal">
          <h4 className="mb-2 font-semibold">2. Situação de crédito interno</h4>
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
