import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FileText, Calendar, Download, Filter, RefreshCw } from "lucide-react";
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
// Utilitário compartilhado de captura (html-to-image sob demanda — nada no
// bundle inicial; o mesmo motor validado nas telas de cenários da Tesouraria).
import {
  buildTreasuryJpegFileName,
  exportTreasuryElementToJpeg,
} from "@/src/lib/treasury/treasuryChartJpegExport";

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

/**
 * Largura LÓGICA da folha de impressão: A4 retrato a 96 CSS px/polegada
 * (210mm ≈ 794px). Com o fator 300/96 do utilitário, o JPEG final sai com
 * ~2480px de largura = A4 a 300 DPI — nítido na impressora.
 */
const ONE_PAGE_PRINT_WIDTH_PX = 794;

type OnePageChartRow = {
  name: string;
  "Ano Anterior (Acum.)": number | null;
  "Ano Atual (Acum.)": number | null;
  "Meta (Acum.)": number | null;
  Projeção: number | null;
};

export function FinanceOnePage() {
  const auth = useAuth();
  const canView = auth.hasPermission("finance.onePage.view");

  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [period, setPeriod] = useState("ytd");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OnePageDashboardPayload | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement | null>(null);

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

  const faturamentoChartData = useMemo<OnePageChartRow[]>(() => {
    if (!data?.faturamento?.chartData) return [];
    return data.faturamento.chartData.map((pt) => ({
      name: pt.monthLabel,
      "Ano Anterior (Acum.)": pt.previousYear ? Math.round(pt.previousYear / 1000) / 1000 : null,
      "Ano Atual (Acum.)": pt.currentYear ? Math.round(pt.currentYear / 1000) / 1000 : null,
      "Meta (Acum.)": pt.target ? Math.round(pt.target / 1000) / 1000 : null,
      "Projeção": pt.projected ? Math.round(pt.projected / 1000) / 1000 : null,
    }));
  }, [data]);

  const pedidoChartData = useMemo<OnePageChartRow[]>(() => {
    if (!data?.pedidoVenda?.chartData) return [];
    return data.pedidoVenda.chartData.map((pt) => ({
      name: pt.monthLabel,
      "Ano Anterior (Acum.)": pt.previousYear ? Math.round(pt.previousYear / 1000) / 1000 : null,
      "Ano Atual (Acum.)": pt.currentYear ? Math.round(pt.currentYear / 1000) / 1000 : null,
      "Meta (Acum.)": pt.target ? Math.round(pt.target / 1000) / 1000 : null,
      "Projeção": pt.projected ? Math.round(pt.projected / 1000) / 1000 : null,
    }));
  }, [data]);

  /**
   * Baixar em JPEG: monta uma instância de IMPRESSÃO fora da tela (largura
   * A4 retrato, cards em 3 colunas, gráficos sem animação), espera o layout
   * assentar e captura. O arquivo cai em Downloads — o usuário abre e imprime.
   */
  const handleDownloadJpeg = useCallback(() => {
    if (!data || printing) return;
    setPrintError(null);
    setPrinting(true);
  }, [data, printing]);

  useEffect(() => {
    if (!printing) return;
    let cancelled = false;
    // Recharts mede o contêiner via ResizeObserver e desenha no tick
    // seguinte; a folga cobre layout + fontes antes da captura.
    const timer = setTimeout(() => {
      const element = printRef.current;
      if (!element || cancelled) {
        setPrinting(false);
        return;
      }
      void exportTreasuryElementToJpeg(
        element,
        buildTreasuryJpegFileName("one-page-financeiro")
      )
        .catch((cause: unknown) => {
          console.error(cause);
          if (!cancelled) {
            setPrintError(
              "Não foi possível gerar o JPEG do relatório. Tente novamente."
            );
          }
        })
        .finally(() => {
          if (!cancelled) setPrinting(false);
        });
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [printing]);

  const periodLabel =
    MONTH_OPTIONS.find((opt) => opt.value === period)?.label ?? period;

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

            <button
              onClick={handleDownloadJpeg}
              disabled={!data || loading || printing}
              className={`${financeBiButtonOutlineClass} disabled:opacity-50`}
              data-testid="finance-one-page-download-jpeg"
              title="Baixar o relatório completo em JPEG (A4 retrato, alta resolução)"
            >
              <Download className="h-3.5 w-3.5" />
              {printing ? "Gerando…" : "Baixar JPEG"}
            </button>
          </div>
        </div>
      </div>

      {error ? <FinanceModuleErrorBanner message={error} /> : null}
      {printError ? <FinanceModuleErrorBanner message={printError} /> : null}

      {loading ? (
        <FinanceModulePageLoading label="Carregando painel executivo One Page…" />
      ) : data ? (
        <OnePageReportBody
          data={data}
          faturamentoChartData={faturamentoChartData}
          pedidoChartData={pedidoChartData}
          print={false}
        />
      ) : null}

      {/* Instância de IMPRESSÃO: montada só durante a captura, fora da tela
          mas com layout real (display:none zeraria o ResponsiveContainer).
          O ref fica no FILHO estático, nunca no wrapper posicionado: o clone
          da captura preserva o computed style do nó raiz, e position:fixed
          com left:-10000px deslocaria o conteúdo para fora do quadro —
          a imagem sairia em branco (provado em teste real). */}
      {printing && data ? (
        <div
          aria-hidden
          style={{
            position: "fixed",
            left: -10000,
            top: 0,
            zIndex: -1,
            pointerEvents: "none",
          }}
        >
          <div
            ref={printRef}
            data-testid="finance-one-page-print-surface"
            className="space-y-5 bg-white p-6"
            style={{ width: ONE_PAGE_PRINT_WIDTH_PX }}
          >
            <div className="border-b-2 border-[#111827] pb-3">
              <h1 className="text-xl font-extrabold text-[#111827]">
                One Page — Financeiro
              </h1>
              <p className="mt-1 text-xs text-[#6B7280]">
                {periodLabel} · {year} · Dados atualizados até {data.updatedAt ?? "—"} ·
                Gerado em {new Date().toLocaleDateString("pt-BR")}{" "}
                {new Date().toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
            <OnePageReportBody
              data={data}
              faturamentoChartData={faturamentoChartData}
              pedidoChartData={pedidoChartData}
              print
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Corpo do relatório — usado DUAS vezes: na tela (responsivo) e na folha de
 * impressão (largura A4 fixa). `print` troca só o que muda entre os modos:
 * grid de KPIs em 3 colunas, gráfico um pouco menor e sem animação (uma
 * captura no meio da animação sairia com as linhas pela metade).
 */
function OnePageReportBody({
  data,
  faturamentoChartData,
  pedidoChartData,
  print,
}: {
  data: OnePageDashboardPayload;
  faturamentoChartData: OnePageChartRow[];
  pedidoChartData: OnePageChartRow[];
  print: boolean;
}) {
  const kpiGridClass = print
    ? "grid grid-cols-3 gap-3"
    : "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4";
  const sectionClass = print
    ? `${financeBiCardClass} p-4 space-y-4`
    : `${financeBiCardClass} p-6 space-y-6`;

  return (
    <div className={print ? "space-y-5" : "space-y-6"}>
      {/* SEÇÃO FATURAMENTO */}
      <div className={sectionClass}>
        <div className="border-b border-[#E5E7EB] pb-3">
          <h2 className="text-lg font-bold text-[#111827]">Faturamento</h2>
          <p className="text-xs text-[#6B7280]">
            Acompanhamento mensal, acumulado YTD, targets e atingimento.
          </p>
        </div>

        <div className={kpiGridClass}>
          <OnePageKpiCard
            label={`Mês — ${data.monthLabel}`}
            value={data.faturamento.liquidoFormatted}
            note={data.faturamento.liquidoGrowthPercentFormatted}
            noteClass={
              (data.faturamento.liquidoGrowthPercent ?? 0) >= 0
                ? "text-[#059669]"
                : "text-[#DC2626]"
            }
          />
          <OnePageKpiCard
            label={`YTD ${data.year}`}
            value={data.faturamento.ytdFormatted}
            note={data.faturamento.ytdVariationFormatted}
            noteClass={
              (data.faturamento.ytdVariation ?? 0) >= 0
                ? "text-[#059669]"
                : "text-[#DC2626]"
            }
          />
          <OnePageKpiCard
            label={`YTD ${data.year - 1}`}
            value={data.faturamento.ytdPreviousFormatted}
          />
          <OnePageKpiCard
            label="Diferença YTD"
            value={data.faturamento.ytdDiffFormatted}
          />
          <OnePageKpiCard
            label="Variação YTD"
            value={data.faturamento.ytdVariationFormatted}
            valueClass={
              (data.faturamento.ytdVariation ?? 0) >= 0
                ? "text-[#059669]"
                : "text-[#DC2626]"
            }
          />
          <OnePageKpiCard
            label="Meta Anual (Atingimento)"
            value={data.faturamento.metaFormatted}
            note={`Atingido ${data.faturamento.atingimentoFormatted} (YTD)`}
            noteClass="text-[#2563EB]"
          />
        </div>

        <OnePageEvolutionChart
          title="Evolução Acumulada Mensal (R$ Milhões)"
          rows={faturamentoChartData}
          print={print}
        />
      </div>

      {/* SEÇÃO PEDIDOS DE VENDA */}
      <div className={sectionClass}>
        <div className="border-b border-[#E5E7EB] pb-3">
          <h2 className="text-lg font-bold text-[#111827]">Pedidos de Venda</h2>
          <p className="text-xs text-[#6B7280]">
            Acompanhamento de entrada de pedidos, margem comercial e backlog.
          </p>
        </div>

        <div className={kpiGridClass}>
          <OnePageKpiCard
            label={`Entrada — ${data.monthLabel}`}
            value={data.pedidoVenda.totalFormatted}
            note={data.pedidoVenda.totalGrowthPercentFormatted}
            noteClass={
              (data.pedidoVenda.totalGrowthPercent ?? 0) >= 0
                ? "text-[#059669]"
                : "text-[#DC2626]"
            }
          />
          <OnePageKpiCard
            label="Margem Comercial"
            value={data.pedidoVenda.margemFormatted}
            valueClass="text-[#2563EB]"
            note={data.pedidoVenda.margemPeriodLabel}
            noteClass="text-[#6B7280]"
          />
          <OnePageKpiCard
            label={`YTD ${data.year}`}
            value={data.pedidoVenda.ytdFormatted}
          />
          <OnePageKpiCard
            label={`YTD ${data.year - 1}`}
            value={data.pedidoVenda.ytdPreviousFormatted}
          />
          <OnePageKpiCard
            label="Variação YTD"
            value={data.pedidoVenda.ytdVariationFormatted}
            valueClass={
              (data.pedidoVenda.ytdVariation ?? 0) >= 0
                ? "text-[#059669]"
                : "text-[#DC2626]"
            }
          />
          <OnePageKpiCard
            label="Backlog Comercial"
            value={data.pedidoVenda.backlogFormatted}
            valueClass="text-[#D97706]"
          />
        </div>

        <OnePageEvolutionChart
          title="Evolução Acumulada de Pedidos (R$ Milhões)"
          rows={pedidoChartData}
          print={print}
        />
      </div>

      {/* LEITURA EXECUTIVA */}
      <div className={print ? `${financeBiCardClass} p-4` : `${financeBiCardClass} p-6`}>
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

      {/* DRE GERENCIAL — RESUMO DO PERÍODO (exclusivamente snapshot canônico) */}
      <OnePageDreSummarySection dre={data.dre} print={print} />
    </div>
  );
}

function OnePageDreSummarySection({
  dre,
  print,
}: {
  dre: OnePageDashboardPayload["dre"];
  print: boolean;
}) {
  const sectionClass = print
    ? `${financeBiCardClass} p-4 space-y-4`
    : `${financeBiCardClass} p-6 space-y-5`;

  return (
    <div className={sectionClass} data-testid="one-page-dre-summary">
      <div className="border-b border-[#E5E7EB] pb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-[#111827]">
            DRE Gerencial — Resumo do Período
          </h2>
          <p className="text-xs text-[#6B7280]">
            {dre.periodLabel} · valores oficiais da DRE Gerencial (competência emissão NF-e).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dre.freshness === "stale" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Atualização pendente
            </span>
          ) : null}
          {dre.updatedAtLabel ? (
            <span className="text-[10px] font-semibold text-[#6B7280]">
              Atualizado {dre.updatedAtLabel}
            </span>
          ) : null}
        </div>
      </div>

      {!dre.available ? (
        <p className="text-sm text-[#6B7280] py-2">
          Dados da DRE em preparação — o resumo aparecerá automaticamente após o
          próximo cálculo do snapshot da DRE Gerencial.
        </p>
      ) : (
        <>
          {/* Linha lógica: entrou → deduz → sobra, passo a passo, com
              explicação para quem não é do financeiro. */}
          <div className="rounded-xl border border-[#E5E7EB] overflow-hidden">
            <DreFlowRow
              sign="start"
              label="Receita Bruta"
              description="Tudo o que entrou em vendas: total das notas fiscais emitidas no período."
              value={dre.receitaBrutaFormatted}
              print={print}
            />
            <DreFlowRow
              sign="minus"
              label="Deduções sobre Vendas"
              description="Impostos destacados nas notas (ICMS, IPI, PIS/COFINS) e devoluções de clientes."
              value={dre.deducoesFormatted}
              print={print}
            />
            <DreFlowRow
              sign="equals"
              label="Receita Líquida"
              description="O que realmente sobra das vendas depois dos impostos e devoluções."
              value={dre.receitaLiquidaFormatted}
              emphasize
              print={print}
            />
            <DreFlowRow
              sign="minus"
              label="Custos"
              description="Quanto custou produzir e entregar o que foi vendido."
              detail={`CMV ${dre.cmvFormatted} · Fretes ${dre.fretesFormatted} · Embalagens ${dre.embalagensFormatted}`}
              value={dre.custosFormatted}
              print={print}
            />
            <DreFlowRow
              sign="equals"
              label="Lucro Bruto"
              description="O ganho das vendas antes das despesas de funcionamento da empresa."
              value={dre.lucroBrutoFormatted}
              badge={`Margem bruta ${dre.margemBrutaPctFormatted}`}
              emphasize
              print={print}
            />
            <DreFlowRow
              sign="minus"
              label="Despesas Operacionais"
              description="Despesas administrativas para manter a empresa funcionando (centros de custo)."
              value={dre.despesasOperacionaisFormatted}
              print={print}
            />
            <DreFlowRow
              sign="equals"
              label="Resultado Operacional"
              description="O que a operação de fato gerou no período, depois de custos e despesas."
              value={dre.resultadoOperacionalFormatted}
              valueNegative={(dre.resultadoOperacional ?? 0) < 0}
              badge={`Margem operacional ${dre.margemOperacionalPctFormatted}`}
              emphasize
              print={print}
            />
          </div>

          <p
            className={`text-xs font-semibold inline-flex items-center gap-1.5 ${
              dre.quality.status === "ok"
                ? "text-[#047857]"
                : dre.quality.status === "critical"
                  ? "text-[#DC2626]"
                  : "text-[#B45309]"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                dre.quality.status === "ok"
                  ? "bg-[#059669]"
                  : dre.quality.status === "critical"
                    ? "bg-[#DC2626]"
                    : "bg-[#D97706]"
              }`}
            />
            {dre.quality.label}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Uma linha da cascata da DRE: sinal (entrada / deduz / resultado), nome,
 * explicação em linguagem simples e o valor à direita. Linhas de resultado
 * ("=") ganham fundo e peso — é onde a história "o que sobrou" se conta.
 */
function DreFlowRow({
  sign,
  label,
  description,
  detail,
  value,
  badge,
  emphasize = false,
  valueNegative = false,
  print,
}: {
  sign: "start" | "minus" | "equals";
  label: string;
  description: string;
  detail?: string;
  value: string;
  badge?: string;
  emphasize?: boolean;
  valueNegative?: boolean;
  print: boolean;
}) {
  const signStyles =
    sign === "minus"
      ? "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]"
      : sign === "equals"
        ? "bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE]"
        : "bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]";
  const signChar = sign === "minus" ? "−" : sign === "equals" ? "=" : "+";

  return (
    <div
      className={`flex items-start gap-3 border-b border-[#F3F4F6] last:border-b-0 ${
        print ? "px-4 py-2.5" : "px-5 py-3.5"
      } ${emphasize ? "bg-[#F9FAFB]" : "bg-white"}`}
    >
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${signStyles}`}
        aria-hidden
      >
        {signChar}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span
            className={`${
              emphasize ? "text-sm font-extrabold text-[#111827]" : "text-sm font-semibold text-[#374151]"
            }`}
          >
            {label}
          </span>
          {badge ? (
            <span className="text-[10px] font-bold text-[#2563EB] uppercase tracking-wider">
              {badge}
            </span>
          ) : null}
        </div>
        <p className="text-[11px] text-[#6B7280] leading-snug mt-0.5">{description}</p>
        {detail ? (
          <p className="text-[11px] text-[#9CA3AF] leading-snug mt-0.5">{detail}</p>
        ) : null}
      </div>
      <span
        className={`shrink-0 tabular-nums ${
          emphasize ? "text-base font-extrabold" : "text-sm font-bold"
        } ${
          valueNegative
            ? "text-[#DC2626]"
            : sign === "minus"
              ? "text-[#DC2626]"
              : "text-[#111827]"
        }`}
      >
        {sign === "minus" ? `− ${value}` : value}
      </span>
    </div>
  );
}

function OnePageKpiCard({
  label,
  value,
  valueClass = "text-[#111827]",
  note,
  noteClass = "",
}: {
  label: string;
  value: string;
  valueClass?: string;
  note?: string;
  noteClass?: string;
}) {
  return (
    <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg p-3.5">
      <span className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider block">
        {label}
      </span>
      <span className={`text-lg font-extrabold block mt-1 ${valueClass}`}>
        {value}
      </span>
      {note ? (
        <span className={`text-[10px] font-semibold mt-0.5 block ${noteClass}`}>
          {note}
        </span>
      ) : null}
    </div>
  );
}

function OnePageEvolutionChart({
  title,
  rows,
  print,
}: {
  title: string;
  rows: OnePageChartRow[];
  print: boolean;
}) {
  return (
    <div
      className={`${print ? "h-[260px]" : "h-[280px]"} w-full border border-[#E5E7EB] rounded-xl p-4`}
    >
      <span className="text-xs font-bold text-[#111827] block mb-3">{title}</span>
      <ResponsiveContainer width="100%" height="90%">
        <LineChart data={rows} margin={{ left: -10, right: 10, top: 5, bottom: 5 }}>
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
            isAnimationActive={!print}
          />
          <Line
            type="monotone"
            dataKey="Ano Atual (Acum.)"
            stroke="#2563EB"
            strokeWidth={3}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
            isAnimationActive={!print}
          />
          <Line
            type="monotone"
            dataKey="Meta (Acum.)"
            stroke="#D97706"
            strokeDasharray="5 5"
            strokeWidth={2}
            dot={false}
            isAnimationActive={!print}
          />
          <Line
            type="monotone"
            dataKey="Projeção"
            stroke="#059669"
            strokeDasharray="3 3"
            strokeWidth={2}
            dot={false}
            isAnimationActive={!print}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
