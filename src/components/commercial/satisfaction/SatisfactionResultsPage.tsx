/**
 * Resultado completo de uma pesquisa — página inteira (não modal), com abas
 * Resumo, Critérios, Respostas e Comentários.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download } from "lucide-react";
import {
  formatDate,
  formatPercent,
  formatRating,
  satisfactionApi,
  type SatisfactionDashboard,
  type SatisfactionResponseRow,
} from "./satisfactionApi.js";
import {
  CustomerAutocompleteFilter,
  type EntityAutocompleteSelection,
} from "@/src/components/common/CustomerAutocompleteFilter";

type TabId = "summary" | "criteria" | "responses" | "comments";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "summary", label: "Resumo" },
  { id: "criteria", label: "Critérios" },
  { id: "responses", label: "Respostas" },
  { id: "comments", label: "Comentários" },
];

const ALERT_BADGE: Record<SatisfactionResponseRow["alertLevel"], string> = {
  NONE: "border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B]",
  ATTENTION: "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]",
  CRITICAL: "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]",
};

const ALERT_LABEL: Record<SatisfactionResponseRow["alertLevel"], string> = {
  NONE: "OK",
  ATTENTION: "Atenção",
  CRITICAL: "Crítico",
};

export function SatisfactionResultsPage() {
  const { campaignId = "" } = useParams();
  const [tab, setTab] = useState<TabId>("summary");
  const [data, setData] = useState<(SatisfactionDashboard & { campaign: any }) | null>(null);
  const [responses, setResponses] = useState<SatisfactionResponseRow[]>([]);
  const [responsesTotal, setResponsesTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [onlyCritical, setOnlyCritical] = useState(false);
  // Autocomplete de cliente (nome/CNPJ) — a seleção filtra por id exato.
  const [customerFilter, setCustomerFilter] =
    useState<EntityAutocompleteSelection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const pageSize = 25;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await satisfactionApi.results(campaignId);
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Falha ao carregar os resultados.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const loadResponses = useCallback(async () => {
    try {
      const result = await satisfactionApi.listResponses(campaignId, {
        page,
        pageSize,
        onlyCritical,
        customerId: customerFilter?.id ?? null,
      });
      setResponses(result.rows);
      setResponsesTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar respostas.");
    }
  }, [campaignId, onlyCritical, page, customerFilter]);

  useEffect(() => {
    if (tab === "responses" || tab === "comments") void loadResponses();
  }, [tab, loadResponses]);

  /** Exportação é sob demanda — nunca faz parte do carregamento da página. */
  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await satisfactionApi.exportResults(campaignId);
      const blob = new Blob([JSON.stringify(result.rows, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `satisfacao-${data?.campaign?.code ?? campaignId}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao exportar.");
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-[#F1F5F9]" />
        ))}
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-4 text-[14px] text-[#B91C1C]">
        {error}
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(responsesTotal / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/commercial/satisfaction"
          className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#1D4ED8] hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para Satisfação
        </Link>
        <button
          type="button"
          disabled={exporting}
          onClick={() => void handleExport()}
          className="inline-flex items-center gap-2 rounded-md border border-[#CBD5E1] px-4 py-2 text-[13px] font-semibold text-[#334155] hover:bg-[#F8FAFC] disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          {exporting ? "Exportando…" : "Exportar"}
        </button>
      </div>

      <div className="flex gap-1 border-b border-[#E2E8F0]" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={`-mb-px border-b-2 px-4 py-2 text-[14px] font-semibold ${
              tab === entry.id
                ? "border-[#1D4ED8] text-[#1D4ED8]"
                : "border-transparent text-[#64748B] hover:text-[#334155]"
            }`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "summary" ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "Respostas", value: String(data!.kpis.responseCount) },
            { label: "Nota média", value: formatRating(data!.kpis.averageRating) },
            { label: "Positivas", value: formatPercent(data!.kpis.positivePercent) },
            { label: "Críticas", value: formatPercent(data!.kpis.criticalPercent) },
            { label: "Taxa de resposta", value: formatPercent(data!.kpis.responseRate) },
            { label: "Convidados", value: String(data!.funnel.invited) },
            { label: "Concluíram", value: String(data!.funnel.completed) },
            { label: "Clientes em alerta", value: String(data!.kpis.alertCustomerCount) },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-lg border border-[#E2E8F0] bg-white p-4">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-[#64748B]">
                {kpi.label}
              </p>
              <p className="mt-1 text-[24px] font-bold text-[#0F172A]">{kpi.value}</p>
            </div>
          ))}
        </div>
      ) : null}

      {tab === "criteria" ? (
        <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-[#F8FAFC] text-[12px] uppercase tracking-wide text-[#64748B]">
              <tr>
                <th className="px-4 py-3 font-semibold">Critério</th>
                <th className="px-4 py-3 text-right font-semibold">Média</th>
                <th className="px-4 py-3 text-right font-semibold">Avaliações</th>
                <th className="px-4 py-3 text-right font-semibold">% positivas</th>
                <th className="px-4 py-3 text-right font-semibold">% críticas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {data!.criteria.map((criterion) => (
                <tr key={criterion.questionCode}>
                  <td className="px-4 py-3 font-medium text-[#0F172A]">{criterion.label}</td>
                  <td className="px-4 py-3 text-right font-bold">
                    {formatRating(criterion.average)}
                  </td>
                  <td className="px-4 py-3 text-right text-[#475569]">{criterion.count}</td>
                  <td className="px-4 py-3 text-right text-[#047857]">
                    {formatPercent(criterion.positivePercent)}
                  </td>
                  <td className="px-4 py-3 text-right text-[#B91C1C]">
                    {formatPercent(criterion.criticalPercent)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "responses" || tab === "comments" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-4">
            <div
              className="min-w-[260px] max-w-[420px] flex-1"
              data-testid="satisfaction-responses-customer-filter"
            >
              <CustomerAutocompleteFilter
                label="Cliente (nome ou CNPJ)"
                placeholder="Buscar por nome ou CNPJ…"
                value={customerFilter}
                onChange={(selection) => {
                  setPage(1);
                  setCustomerFilter(selection);
                }}
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-[13px] text-[#334155]">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={onlyCritical}
                onChange={(e) => {
                  setPage(1);
                  setOnlyCritical(e.target.checked);
                }}
              />
              Mostrar apenas respostas com nota crítica (≤ 2)
            </label>
          </div>

          <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-[13px]">
                <thead className="bg-[#F8FAFC] text-[12px] uppercase tracking-wide text-[#64748B]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Cliente</th>
                    <th className="px-4 py-3 font-semibold">Respondente</th>
                    <th className="px-4 py-3 font-semibold">Data</th>
                    <th className="px-4 py-3 text-right font-semibold">Nota média</th>
                    <th className="px-4 py-3 text-right font-semibold">Menor nota</th>
                    <th className="px-4 py-3 font-semibold">Situação</th>
                    <th className="px-4 py-3 font-semibold">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  {responses.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-[14px] text-[#64748B]">
                        Nenhuma resposta neste recorte.
                      </td>
                    </tr>
                  ) : (
                    responses.map((response) => (
                      <tr key={response.id} className="hover:bg-[#F8FAFC]">
                        <td className="px-4 py-3 font-medium text-[#0F172A]">
                          {response.customerName}
                          {response.matchStatus === "UNMATCHED" ? (
                            <span className="ml-2 rounded bg-[#FFFBEB] px-1.5 py-0.5 text-[11px] font-semibold text-[#92400E]">
                              não identificado
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-[#475569]">
                          {response.respondentName ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-[#475569]">
                          {formatDate(response.submittedAt)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold">
                          {formatRating(response.averageRating)}
                        </td>
                        <td className="px-4 py-3 text-right">{response.lowestRating ?? "—"}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-[12px] font-semibold ${ALERT_BADGE[response.alertLevel]}`}
                          >
                            {ALERT_LABEL[response.alertLevel]}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            className="text-[12px] font-semibold text-[#1D4ED8] hover:underline"
                            to={`/commercial/satisfaction/responses/${response.id}`}
                          >
                            Ver
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {responsesTotal > pageSize ? (
              <div className="flex items-center justify-between border-t border-[#E2E8F0] px-4 py-3 text-[13px]">
                <span className="text-[#64748B]">
                  {responsesTotal} respostas — página {page} de {totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-[#CBD5E1] px-3 py-1 font-semibold disabled:opacity-40"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-[#CBD5E1] px-3 py-1 font-semibold disabled:opacity-40"
                    disabled={page >= totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    Próxima
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
