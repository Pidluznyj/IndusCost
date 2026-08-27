import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Calendar, Filter, RefreshCw } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import {
  FinanceModuleErrorBanner,
  FinanceModulePageLoading,
} from "@/src/components/finance/shared/FinanceModuleStates";
import {
  financeBiCardClass,
  financeBiShellClass,
  financeBiHeaderClass,
  financeBiTitleClass,
  financeBiSubtitleClass,
  financeBiEyebrowClass,
  financeBiButtonOutlineClass,
  financeBiButtonPrimaryClass,
} from "@/src/lib/financeBiDashboardTheme";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { OnePageDashboardPayload } from "@/src/lib/finance/onePageTypes";

const YEAR_OPTIONS = Array.from(
  { length: 8 },
  (_, i) => String(new Date().getFullYear() - 3 + i)
);

const MONTH_OPTIONS = [
  { value: "ytd", label: "Acumulado YTD" },
  { value: "1", label: "Janeiro" },
  { value: "2", label: "Fevereiro" },
  { value: "3", label: "Março" },
  { value: "4", label: "Abril" },
  { value: "5", label: "Maio" },
  { value: "6", label: "Junho" },
  { value: "7", label: "Julho" },
  { value: "8", label: "Agosto" },
  { value: "9", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
];

export function FinanceOnePage() {
  const auth = useAuth();
  const canView = auth.hasPermission("finance.onePage.view");

  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [period, setPeriod] = useState("ytd");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OnePageDashboardPayload | null>(null);

  const loadData = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      setError("Você não possui permissão para visualizar o painel One Page.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const monthQuery = period === "ytd" ? "" : `&month=${period}`;
      const url = `/api/finance/one-page?year=${year}${monthQuery}`;
      const payload = await fetchJsonOk<OnePageDashboardPayload>(url, {
        credentials: "include",
      });
      setData(payload);
    } catch (err) {
      setData(null);
      setError(buildFinanceTabLoadError("Falha ao carregar o painel One Page.", err));
    } finally {
      setLoading(false);
    }
  }, [year, period, canView]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const faturamentoChartData = useMemo(() => {
    if (!data?.faturamento?.chartData) return [];
    return data.faturamento.chartData.map((pt) => ({
      name: pt.monthLabel,
      "Ano Anterior (Acum.)": pt.previousYear ? Math.round(pt.previousYear / 1000) / 1000 : null,
      "Ano Atual (Acum.)": pt.currentYear ? Math.round(pt.currentYear / 1000) / 1000 : null,
      "Meta (Acum.)": pt.target ? Math.round(pt.target / 1000) / 1000 : null,
      "Projeção": pt.projected ? Math.round(pt.projected / 1000) / 1000 : null,
    }));
  }, [data]);

  const pedidoChartData = useMemo(() => {
    if (!data?.pedidoVenda?.chartData) return [];
    return data.pedidoVenda.chartData.map((pt) => ({
      name: pt.monthLabel,
      "Ano Anterior (Acum.)": pt.previousYear ? Math.round(pt.previousYear / 1000) / 1000 : null,
      "Ano Atual (Acum.)": pt.currentYear ? Math.round(pt.currentYear / 1000) / 1000 : null,
      "Meta (Acum.)": pt.target ? Math.round(pt.target / 1000) / 1000 : null,
      "Projeção": pt.projected ? Math.round(pt.projected / 1000) / 1000 : null,
    }));
  }, [data]);

  if (!canView) {
    return <FinanceModuleErrorBanner message="Você não possui permissão para visualizar esta tela." />;
  }

  return (
    <div className={financeBiShellClass}>
      {/* Header com Filtros */}
      <div className={financeBiHeaderClass}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className={financeBiEyebrowClass}>Financeiro &gt; One Page</div>
            <h1 className={financeBiTitleClass}>One Page</h1>
            <p className={financeBiSubtitleClass}>
              Visão executiva · Dados atualizados até {data?.updatedAt ?? "—"}
            </p>
          </div>

          <div className="flex items-center flex-wrap gap-2">
            <div className="flex items-center gap-1 bg-[#F3F4F6] border border-[#E5E7EB] rounded-lg px-2 py-1">
              <Calendar className="h-4 w-4 text-[#6B7280]" />
              <select
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="bg-transparent text-xs font-semibold text-[#111827] focus:outline-none cursor-pointer"
              >
                {YEAR_OPTIONS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1 bg-[#F3F4F6] border border-[#E5E7EB] rounded-lg px-2 py-1">
              <Filter className="h-4 w-4 text-[#6B7280]" />
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="bg-transparent text-xs font-semibold text-[#111827] focus:outline-none cursor-pointer"
              >
                {MONTH_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => void loadData()}
              className={financeBiButtonOutlineClass}
              title="Recarregar dados"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {error ? <FinanceModuleErrorBanner message={error} /> : null}

      {loading ? (
        <FinanceModulePageLoading label="Carregando painel executivo One Page…" />
      ) : data ? (
        <div className="space-y-6">
          {/* SEÇÃO FATURAMENTO */}
          <div className={`${financeBiCardClass} p-6 space-y-6`}>
            <div className="border-b border-[#E5E7EB] pb-3">
              <h2 className="text-lg font-bold text-[#111827]">Faturamento</h2>
              <p className="text-xs text-[#6B7280]">
                Acompanhamento mensal, acumulado YTD, targets e atingimento.
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg p-3.5">
                <span className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider block">
                  Mês — {data.monthLabel}
                </span>
                <span className="text-lg font-extrabold text-[#111827] block mt-1">
                  {data.faturamento.liquidoFormatted}
                </span>
                <span
                  className={`text-[10px] font-semibold mt-0.5 block ${
                    (data.faturamento.liquidoGrowthPercent ?? 0) >= 0
                      ? "text-[#059669]"
                      : "text-[#DC2626]"
                  }`}
                >
                  {data.faturamento.liquidoGrowthPercentFormatted}
                </span>
              </div>

              <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg p-3.5">
                <span className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider block">
                  YTD {data.year}
                </span>
                <span className="text-lg font-extrabold text-[#111827] block mt-1">
                  {data.faturamento.ytdFormatted}
                </span>
                <span
                  className={`text-[10px] font-semibold mt-0.5 block ${
                    (data.faturamento.ytdVariation ?? 0) >= 0
                      ? "text-[#059669]"
                      : "text-[#DC2626]"
                  }`}
                >
                  {data.faturamento.ytdVariationFormatted}
                </span>
              </div>

              <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg p-3.5">
                <span className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider block">
                  YTD {data.year - 1}
                </span>
                <span className="text-lg font-extrabold text-[#111827] block mt-1">
                  {data.faturamento.ytdPreviousFormatted}
                </span>
              </div>

              <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg p-3.5">
                <span className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider block">
                  Diferença YTD
                </span>
                <span className="text-lg font-extrabold text-[#111827] block mt-1">
                  {data.faturamento.ytdDiffFormatted}
                </span>
              </div>

              <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg p-3.5">
                <span className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider block">
                  Variação YTD
                </span>
                <span
                  className={`text-lg font-extrabold block mt-1 ${
                    (data.faturamento.ytdVariation ?? 0) >= 0 ? "text-[#059669]" : "text-[#DC2626]"
                  }`}
                >
                  {data.faturamento.ytdVariationFormatted}
                </span>
              </div>

              <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg p-3.5">
                <span className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider block">
                  Meta Anual (Atingimento)
                </span>
                <span className="text-lg font-extrabold text-[#111827] block mt-1">
                  {data.faturamento.metaFormatted}
                </span>
                <span className="text-[10px] text-[#2563EB] font-semibold mt-0.5 block">
                  Atingido {data.faturamento.atingimentoFormatted} (YTD)
                </span>
              </div>
            </div>

            {/* Evolução Gráfico */}
            <div className="h-[280px] w-full border border-[#E5E7EB] rounded-xl p-4">
              <span className="text-xs font-bold text-[#111827] block mb-3">
                Evolução Acumulada Mensal (R$ Milhões)
              </span>
              <ResponsiveContainer width="100%" height="90%">
                <LineChart data={faturamentoChartData} margin={{ left: -10, right: 10, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="name" stroke="#9CA3AF" fontSize={11} tickLine={false} />
                  <YAxis stroke="#9CA3AF" fontSize={11} tickLine={false} />
                  <Tooltip formatter={(value) => [`R$ ${value} Mi`]} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    type="monotone"
                    dataKey="Ano Anterior (Acum.)"
                    stroke="#9CA3AF"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="Ano Atual (Acum.)"
                    stroke="#2563EB"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="Meta (Acum.)"
                    stroke="#D97706"
                    strokeDasharray="5 5"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="Projeção"
                    stroke="#059669"
                    strokeDasharray="3 3"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* SEÇÃO PEDIDOS DE VENDA */}
          <div className={`${financeBiCardClass} p-6 space-y-6`}>
            <div className="border-b border-[#E5E7EB] pb-3">
              <h2 className="text-lg font-bold text-[#111827]">Pedidos de Venda</h2>
              <p className="text-xs text-[#6B7280]">
                Acompanhamento de entrada de pedidos, margem comercial e backlog.
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg p-3.5">
                <span className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider block">
                  Entrada — {data.monthLabel}
                </span>
                <span className="text-lg font-extrabold text-[#111827] block mt-1">
                  {data.pedidoVenda.totalFormatted}
                </span>
                <span
                  className={`text-[10px] font-semibold mt-0.5 block ${
                    (data.pedidoVenda.totalGrowthPercent ?? 0) >= 0
                      ? "text-[#059669]"
                      : "text-[#DC2626]"
                  }`}
                >
                  {data.pedidoVenda.totalGrowthPercentFormatted}
                </span>
              </div>

              <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg p-3.5">
                <span className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider block">
                  Margem Comercial
                </span>
                <span className="text-lg font-extrabold text-[#2563EB] block mt-1">
                  {data.pedidoVenda.margemFormatted}
                </span>
                <span className="text-[10px] text-[#6B7280] font-semibold mt-0.5 block">
                  {data.pedidoVenda.margemPeriodLabel}
                </span>
              </div>

              <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg p-3.5">
                <span className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider block">
                  YTD {data.year}
                </span>
                <span className="text-lg font-extrabold text-[#111827] block mt-1">
                  {data.pedidoVenda.ytdFormatted}
                </span>
              </div>

              <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg p-3.5">
                <span className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider block">
                  YTD {data.year - 1}
                </span>
                <span className="text-lg font-extrabold text-[#111827] block mt-1">
                  {data.pedidoVenda.ytdPreviousFormatted}
                </span>
              </div>

              <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg p-3.5">
                <span className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider block">
                  Variação YTD
                </span>
                <span
                  className={`text-lg font-extrabold block mt-1 ${
                    (data.pedidoVenda.ytdVariation ?? 0) >= 0 ? "text-[#059669]" : "text-[#DC2626]"
                  }`}
                >
                  {data.pedidoVenda.ytdVariationFormatted}
                </span>
              </div>

              <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg p-3.5">
                <span className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider block">
                  Backlog Comercial
                </span>
                <span className="text-lg font-extrabold text-[#D97706] block mt-1">
                  {data.pedidoVenda.backlogFormatted}
                </span>
              </div>
            </div>

            {/* Evolução Gráfico */}
            <div className="h-[280px] w-full border border-[#E5E7EB] rounded-xl p-4">
              <span className="text-xs font-bold text-[#111827] block mb-3">
                Evolução Acumulada de Pedidos (R$ Milhões)
              </span>
              <ResponsiveContainer width="100%" height="90%">
                <LineChart data={pedidoChartData} margin={{ left: -10, right: 10, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="name" stroke="#9CA3AF" fontSize={11} tickLine={false} />
                  <YAxis stroke="#9CA3AF" fontSize={11} tickLine={false} />
                  <Tooltip formatter={(value) => [`R$ ${value} Mi`]} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    type="monotone"
                    dataKey="Ano Anterior (Acum.)"
                    stroke="#9CA3AF"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="Ano Atual (Acum.)"
                    stroke="#2563EB"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="Meta (Acum.)"
                    stroke="#D97706"
                    strokeDasharray="5 5"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="Projeção"
                    stroke="#059669"
                    strokeDasharray="3 3"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* LEITURA EXECUTIVA */}
          <div className={`${financeBiCardClass} p-6`}>
            <div className="border-b border-[#E5E7EB] pb-3 mb-4">
              <h2 className="text-lg font-bold text-[#111827] flex items-center gap-2">
                <FileText className="h-5 w-5 text-[#2563EB]" />
                Leitura Executiva
              </h2>
              <p className="text-xs text-[#6B7280]">
                Resumo gerencial e observações estratégicas baseadas nas métricas do período.
              </p>
            </div>

            <ul className="space-y-3.5">
              {data.leituraExecutiva.map((insight, idx) => (
                <li key={idx} className="flex gap-2.5 items-start text-sm text-[#374151]">
                  <span className="h-5 w-5 rounded-full bg-[#2563EB]/10 text-[#2563EB] flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <span className="leading-relaxed font-medium">{insight}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
