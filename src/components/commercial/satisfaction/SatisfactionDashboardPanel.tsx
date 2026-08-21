/**
 * Satisfação — Dashboard executivo-operacional.
 *
 * Todos os indicadores chegam prontos do backend (`/dashboard`). Esta tela não
 * calcula média, percentual nem taxa: se aparecer conta aqui, a semântica passa
 * a existir em dois lugares.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Minus, RefreshCw } from "lucide-react";
import {
  formatDate,
  formatPercent,
  formatRating,
  satisfactionApi,
  type SatisfactionCampaignRow,
  type SatisfactionDashboard,
} from "./satisfactionApi.js";

type Props = {
  campaigns: SatisfactionCampaignRow[];
};

type Filters = { campaignId: string; from: string; to: string };

const EMPTY_FILTERS: Filters = { campaignId: "", from: "", to: "" };

function KpiCard(props: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "bad";
}) {
  const tone =
    props.tone === "good"
      ? "text-[#047857]"
      : props.tone === "bad"
        ? "text-[#B91C1C]"
        : "text-[#0F172A]";
  return (
    <div className="rounded-lg border border-[#E2E8F0] bg-white p-4">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-[#64748B]">
        {props.label}
      </p>
      <p className={`mt-1 text-[26px] font-bold leading-tight ${tone}`}>{props.value}</p>
      {props.hint ? <p className="mt-1 text-[12px] text-[#94A3B8]">{props.hint}</p> : null}
    </div>
  );
}

function TrendIcon({ trend }: { trend: "UP" | "DOWN" | "STABLE" | "UNKNOWN" }) {
  if (trend === "UP") return <ArrowUpRight className="h-4 w-4 text-[#047857]" aria-label="subiu" />;
  if (trend === "DOWN") return <ArrowDownRight className="h-4 w-4 text-[#B91C1C]" aria-label="caiu" />;
  if (trend === "STABLE") return <Minus className="h-4 w-4 text-[#64748B]" aria-label="estável" />;
  return <span className="text-[#CBD5E1]" aria-label="sem comparativo">—</span>;
}

/** Barra 1–5 empilhada: composição percentual, legível sem depender só de cor. */
function DistributionBar({ distribution }: { distribution: Record<string, number> }) {
  const total = [1, 2, 3, 4, 5].reduce((acc, n) => acc + (distribution[String(n)] ?? 0), 0);
  if (total === 0) {
    return <div className="h-3 w-full rounded-full bg-[#F1F5F9]" aria-hidden="true" />;
  }
  const colors: Record<number, string> = {
    1: "#B91C1C",
    2: "#F97316",
    3: "#EAB308",
    4: "#65A30D",
    5: "#047857",
  };
  return (
    <div
      className="flex h-3 w-full overflow-hidden rounded-full"
      role="img"
      aria-label={[1, 2, 3, 4, 5]
        .map((n) => `nota ${n}: ${distribution[String(n)] ?? 0}`)
        .join(", ")}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const count = distribution[String(n)] ?? 0;
        if (count === 0) return null;
        return (
          <div
            key={n}
            style={{ width: `${(count / total) * 100}%`, backgroundColor: colors[n] }}
            title={`Nota ${n}: ${count}`}
          />
        );
      })}
    </div>
  );
}

export function SatisfactionDashboardPanel({ campaigns }: Props) {
  // Padrão da casa: rascunho × aplicado — a consulta pesada só roda no botão.
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);
  const [data, setData] = useState<SatisfactionDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (filters: Filters) => {
    setLoading(true);
    setError(null);
    try {
      const result = await satisfactionApi.dashboard({
        campaignIds: filters.campaignId || null,
        from: filters.from || null,
        to: filters.to || null,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar o dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(appliedFilters);
  }, [appliedFilters, load]);

  const hasData = (data?.kpis.responseCount ?? 0) > 0;

  const criteriaSorted = useMemo(() => data?.criteria ?? [], [data]);

  return (
    <div className="space-y-4">
      {/* ── Filtros ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[#E2E8F0] bg-white p-4">
        <label className="flex flex-col text-[12px] font-semibold text-[#475569]">
          Pesquisa
          <select
            className="mt-1 min-w-[220px] rounded-md border border-[#CBD5E1] px-3 py-2 text-[14px] font-normal text-[#0F172A]"
            value={draftFilters.campaignId}
            onChange={(e) =>
              setDraftFilters((prev) => ({ ...prev, campaignId: e.target.value }))
            }
          >
            <option value="">Todas as pesquisas</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col text-[12px] font-semibold text-[#475569]">
          De
          <input
            type="date"
            className="mt-1 rounded-md border border-[#CBD5E1] px-3 py-2 text-[14px] font-normal"
            value={draftFilters.from}
            onChange={(e) => setDraftFilters((prev) => ({ ...prev, from: e.target.value }))}
          />
        </label>

        <label className="flex flex-col text-[12px] font-semibold text-[#475569]">
          Até
          <input
            type="date"
            className="mt-1 rounded-md border border-[#CBD5E1] px-3 py-2 text-[14px] font-normal"
            value={draftFilters.to}
            onChange={(e) => setDraftFilters((prev) => ({ ...prev, to: e.target.value }))}
          />
        </label>

        <button
          type="button"
          className="ml-auto inline-flex items-center gap-2 rounded-md bg-[#1D4ED8] px-4 py-2 text-[14px] font-semibold text-white hover:bg-[#1E40AF]"
          onClick={() => setAppliedFilters(draftFilters)}
        >
          <RefreshCw className="h-4 w-4" />
          Aplicar
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-4 text-[14px] text-[#B91C1C]">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-[#F1F5F9]" />
          ))}
        </div>
      ) : !hasData ? (
        <div className="rounded-lg border border-dashed border-[#CBD5E1] bg-white p-10 text-center">
          <p className="text-[16px] font-semibold text-[#0F172A]">
            Ainda não há respostas neste recorte
          </p>
          <p className="mt-1 text-[14px] text-[#64748B]">
            Publique uma pesquisa e envie os links, ou importe o histórico do Google Forms.
          </p>
        </div>
      ) : (
        <>
          {/* ── KPIs ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <KpiCard label="Respostas" value={String(data!.kpis.responseCount)} />
            <KpiCard
              label="Nota média"
              value={formatRating(data!.kpis.averageRating)}
              hint="Escala 1 a 5"
            />
            <KpiCard
              label="Positivas"
              value={formatPercent(data!.kpis.positivePercent)}
              hint={`${data!.kpis.positiveCount} notas 4-5`}
              tone="good"
            />
            <KpiCard
              label="Críticas"
              value={formatPercent(data!.kpis.criticalPercent)}
              hint={`${data!.kpis.criticalCount} notas 1-2`}
              tone="bad"
            />
            <KpiCard
              label="Taxa de resposta"
              value={formatPercent(data!.kpis.responseRate)}
              hint={
                data!.kpis.responseRate == null
                  ? "Sem denominador confiável"
                  : `${data!.funnel.completed} de ${data!.funnel.invited}`
              }
            />
            <KpiCard
              label="Clientes em alerta"
              value={String(data!.kpis.alertCustomerCount)}
              hint="Com alguma nota ≤ 2"
              tone={data!.kpis.alertCustomerCount > 0 ? "bad" : "default"}
            />
          </div>

          {/* ── Funil ─────────────────────────────────────────────────── */}
          <div className="rounded-lg border border-[#E2E8F0] bg-white p-4">
            <h3 className="text-[14px] font-semibold text-[#0F172A]">Adesão</h3>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Convidados", value: String(data!.funnel.invited), rate: null },
                { label: "Abriram", value: String(data!.funnel.opened), rate: data!.funnel.openRate },
                { label: "Começaram", value: String(data!.funnel.started), rate: data!.funnel.startRate },
                {
                  label: "Concluíram",
                  value: String(data!.funnel.completed),
                  rate: data!.funnel.completionRate,
                },
              ].map((step) => (
                <div key={step.label} className="rounded-md bg-[#F8FAFC] p-3">
                  <p className="text-[12px] text-[#64748B]">{step.label}</p>
                  <p className="text-[20px] font-bold text-[#0F172A]">{step.value}</p>
                  {step.rate != null ? (
                    <p className="text-[12px] text-[#94A3B8]">{formatPercent(step.rate)}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {/* ── Satisfação por critério ───────────────────────────────── */}
          <div className="rounded-lg border border-[#E2E8F0] bg-white">
            <div className="border-b border-[#E2E8F0] px-4 py-3">
              <h3 className="text-[14px] font-semibold text-[#0F172A]">
                Satisfação por critério
              </h3>
              <p className="text-[12px] text-[#64748B]">
                Ordenado do pior para o melhor — o que precisa de ação vem primeiro.
              </p>
            </div>
            <div className="divide-y divide-[#F1F5F9]">
              {criteriaSorted.map((criterion) => (
                <div key={criterion.questionCode} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[14px] font-medium text-[#0F172A]">
                      {criterion.label}
                    </span>
                    <span className="flex items-center gap-2 text-[15px] font-bold text-[#0F172A]">
                      {formatRating(criterion.average)}
                      <TrendIcon trend={criterion.trend} />
                    </span>
                  </div>
                  <div className="mt-2">
                    <DistributionBar distribution={criterion.distribution} />
                  </div>
                  <div className="mt-1 flex gap-4 text-[12px] text-[#64748B]">
                    <span>{criterion.count} avaliações</span>
                    <span className="text-[#047857]">
                      {formatPercent(criterion.positivePercent)} positivas
                    </span>
                    <span className="text-[#B91C1C]">
                      {formatPercent(criterion.criticalPercent)} críticas
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Evolução ──────────────────────────────────────────────── */}
          {data!.evolution.length > 1 ? (
            <div className="rounded-lg border border-[#E2E8F0] bg-white p-4">
              <h3 className="text-[14px] font-semibold text-[#0F172A]">
                Evolução entre pesquisas
              </h3>
              <div className="mt-3 space-y-2">
                {data!.evolution.map((point) => (
                  <div key={point.campaignId} className="flex items-center gap-3">
                    <span className="w-40 shrink-0 truncate text-[13px] text-[#475569]">
                      {point.campaignName}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#F1F5F9]">
                      <div
                        className="h-full rounded-full bg-[#1D4ED8]"
                        style={{ width: `${((point.averageRating ?? 0) / 5) * 100}%` }}
                      />
                    </div>
                    <span className="w-12 shrink-0 text-right text-[13px] font-semibold">
                      {formatRating(point.averageRating)}
                    </span>
                    <span className="w-20 shrink-0 text-right text-[12px] text-[#94A3B8]">
                      {point.responseCount} resp.
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* ── Pontos de atenção ─────────────────────────────────────── */}
          <div className="rounded-lg border border-[#E2E8F0] bg-white">
            <div className="flex items-center gap-2 border-b border-[#E2E8F0] px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-[#B45309]" />
              <h3 className="text-[14px] font-semibold text-[#0F172A]">Pontos de atenção</h3>
            </div>
            {data!.attentionPoints.length === 0 ? (
              <p className="px-4 py-6 text-center text-[14px] text-[#64748B]">
                Nenhuma nota crítica neste recorte.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-[13px]">
                  <thead className="bg-[#F8FAFC] text-[12px] uppercase tracking-wide text-[#64748B]">
                    <tr>
                      <th className="px-4 py-2 font-semibold">Cliente</th>
                      <th className="px-4 py-2 font-semibold">Critério</th>
                      <th className="px-4 py-2 font-semibold">Nota</th>
                      <th className="px-4 py-2 font-semibold">Data</th>
                      <th className="px-4 py-2 font-semibold">Responsável</th>
                      <th className="px-4 py-2 font-semibold">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F5F9]">
                    {data!.attentionPoints.map((point, index) => (
                      <tr key={`${point.responseId}-${point.questionCode}-${index}`}>
                        <td className="px-4 py-2 font-medium text-[#0F172A]">
                          {point.customerName}
                        </td>
                        <td className="px-4 py-2 text-[#475569]">{point.criterion}</td>
                        <td className="px-4 py-2">
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#FEF2F2] font-bold text-[#B91C1C]">
                            {point.rating}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-[#475569]">
                          {formatDate(point.submittedAt)}
                        </td>
                        <td className="px-4 py-2 text-[#475569]">
                          {point.responsibleCommercialName ?? "—"}
                        </td>
                        <td className="px-4 py-2">
                          <Link
                            className="font-semibold text-[#1D4ED8] hover:underline"
                            to={`/commercial/satisfaction/responses/${point.responseId}`}
                          >
                            Ver resposta
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
