import React, { useEffect, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import type { CommercialCreditIntelligenceView } from "@/src/lib/commercial/commercialCreditIntelligenceView";
import {
  buildCommercialCreditOperationSummary,
  type CommercialCreditOperationSummary,
} from "@/src/lib/commercial/commercialCreditOperation";

export function CustomerCreditOperationSummaryView({
  summary,
}: {
  summary: CommercialCreditOperationSummary;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-3 text-sm" data-testid="customer-credit-operation">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Crédito comercial</h3>
        {summary.headline ? (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-900">{summary.headline}</span>
        ) : (
          <span className="text-xs font-semibold text-slate-700">{summary.creditStatusLabel}</span>
        )}
      </div>
      {summary.statusCode ? (
        <p className="mb-2 text-xs font-semibold" data-testid="customer-credit-status-code">
          Status comercial: {summary.statusCode}
        </p>
      ) : null}
      <p className="mb-2 text-xs text-slate-600">
        Alerta visual. A venda a prazo só segue se o servidor autorizar. O score cadastral não autoriza crédito.
      </p>
      <dl className="grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-[10px] font-bold uppercase text-slate-500">Score cadastral</dt>
          <dd>{summary.cadastralScoreLabel}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase text-slate-500">Score de Confiança</dt>
          <dd data-testid="customer-credit-confidence">{summary.confidenceScoreLabel}</dd>
          {summary.confidenceNote ? <p className="text-xs font-semibold text-red-800">{summary.confidenceNote}</p> : null}
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase text-slate-500">Status de crédito</dt>
          <dd>{summary.creditStatusLabel}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase text-slate-500">Valor vencido</dt>
          <dd>{summary.overdueAmountLabel}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase text-slate-500">Títulos vencidos</dt>
          <dd>{summary.overdueTitleCountLabel}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase text-slate-500">Protesto interno</dt>
          <dd>{summary.internalProtestLabel}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase text-slate-500">Protesto externo verificado</dt>
          <dd>{summary.externalProtestLabel}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[10px] font-bold uppercase text-slate-500">Vínculo societário</dt>
          <dd>{summary.corporateAlert ?? "Nenhum vínculo societário comprovado entre CNPJs cadastrados."}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase text-slate-500">Última atualização</dt>
          <dd>{summary.lastUpdatedLabel}</dd>
        </div>
      </dl>
      <div className="mt-2">
        <p className="text-[10px] font-bold uppercase text-slate-500">Exceções autorizadas</p>
        {summary.exceptions.length === 0 ? <p>Nenhuma exceção vigente.</p> : summary.exceptions.map((line) => <p key={line}>{line}</p>)}
      </div>
      <div className="mt-2">
        <p className="text-[10px] font-bold uppercase text-slate-500">Decisões</p>
        {summary.evaluations.length === 0 ? (
          <p>Nenhuma decisão registrada nesta consulta.</p>
        ) : (
          summary.evaluations.map((line) => <p key={line}>{line}</p>)
        )}
      </div>
    </section>
  );
}

export function CustomerCreditOperationCard({ customerId }: { customerId: string | null }) {
  const [summary, setSummary] = useState<CommercialCreditOperationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!customerId) {
      setSummary(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setError(null);
    Promise.all([
      fetchJsonOk<CommercialCreditIntelligenceView>(`/api/customers/${customerId}/commercial-credit`),
      fetchJsonOk<{ lines?: string[] }>(`/api/customers/${customerId}/commercial-credit/history`).catch(() => ({ lines: [] })),
    ])
      .then(([view, history]) => {
        if (!cancelled) setSummary(buildCommercialCreditOperationSummary(view, history.lines ?? []));
      })
      .catch(() => {
        if (!cancelled) setError("Situação de crédito indisponível.");
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  if (!customerId) return null;
  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!summary) return <p className="text-sm text-slate-500">Carregando crédito...</p>;
  return <CustomerCreditOperationSummaryView summary={summary} />;
}
