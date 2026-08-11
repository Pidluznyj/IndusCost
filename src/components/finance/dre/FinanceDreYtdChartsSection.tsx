import React, { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { BarChart3, TrendingUp, Layers } from "lucide-react";
import type { FinanceDreReport, FinanceDreLine } from "@/src/lib/financeDreTypes";
import { formatFinanceKpiCurrency } from "@/src/lib/financeKpiFormat";
import { FINANCE_BI_COLORS, financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceBiChartExpandButton } from "@/src/components/finance/bi/FinanceBiChartExpandButton";
import {
  FinanceBiChartExpandModal,
  useFinanceBiExpandedChartHeight,
} from "@/src/components/finance/bi/FinanceBiChartExpandModal";
import { cn } from "@/src/lib/utils";

export type DreYtdChartPoint = {
  monthIndex: number;
  monthLabel: string;
  /** true para meses ainda sem realização (> mês em destaque): séries ficam null. */
  isFuture: boolean;
  // Monthly values (null nos meses futuros — evita barra-fantasma)
  receitaBruta: number | null;
  receitaLiquida: number | null;
  lucroBruto: number | null;
  resultadoOperacional: number | null;
  ebitda: number | null;
  lucroLiquido: number | null;
  // YTD cumulative values (null nos meses futuros — a linha termina no mês atual, sem flatline)
  receitaBrutaYtd: number | null;
  receitaLiquidaYtd: number | null;
  lucroBrutoYtd: number | null;
  resultadoOperacionalYtd: number | null;
  ebitdaYtd: number | null;
  lucroLiquidoYtd: number | null;
  // Margins %
  margemBrutaPct: number | null;
  margemBrutaYtdPct: number | null;
  margemOperacionalPct: number | null;
  margemOperacionalYtdPct: number | null;
  ebitdaPct: number | null;
  ebitdaYtdPct: number | null;
  margemLiquidaPct: number | null;
  margemLiquidaYtdPct: number | null;
};

function safePct(numerator: number, denominator: number): number | null {
  if (!denominator || !Number.isFinite(denominator) || denominator === 0) return null;
  const pct = (numerator / denominator) * 100;
  return Number.isFinite(pct) ? Math.round(pct * 10) / 10 : null;
}

function formatPct(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return "—";
  return `${val.toFixed(1).replace(".", ",")}%`;
}

function buildDreYtdChartPoints(report: FinanceDreReport): DreYtdChartPoint[] {
  const findLine = (id: string): FinanceDreLine | undefined =>
    report.lines.find((l) => l.id === id);

  const recBruta = findLine("receita_bruta")?.values.byMonth ?? Array(12).fill(0);
  const recLiquida = findLine("receita_liquida")?.values.byMonth ?? Array(12).fill(0);
  const lucroBruto = findLine("lucro_bruto")?.values.byMonth ?? Array(12).fill(0);
  const resOperacional = findLine("resultado_operacional")?.values.byMonth ?? Array(12).fill(0);
  const lucroLiquido = findLine("lucro_liquido_aproximado")?.values.byMonth ?? Array(12).fill(0);
  const ebitdaMonthly = report.kpis.ebitdaByMonth ?? resOperacional;

  // Último mês com realização = mês em destaque. Meses posteriores não têm dado:
  // suas séries ficam null para a linha YTD terminar no mês atual (sem flatline
  // reta até dezembro) e para não desenhar barras-fantasma.
  const lastRealMonthIdx = Math.min(
    Math.max((report.filters.highlightMonth ?? 12) - 1, 0),
    11
  );

  let sumRecBruta = 0;
  let sumRecLiquida = 0;
  let sumLucroBruto = 0;
  let sumResOperacional = 0;
  let sumEbitda = 0;
  let sumLucroLiquido = 0;

  return Array.from({ length: 12 }, (_, i): DreYtdChartPoint => {
    const monthLabel = report.monthLabels[i] ?? `Mês ${i + 1}`;
    const isFuture = i > lastRealMonthIdx;

    if (isFuture) {
      return {
        monthIndex: i,
        monthLabel,
        isFuture: true,
        receitaBruta: null,
        receitaLiquida: null,
        lucroBruto: null,
        resultadoOperacional: null,
        ebitda: null,
        lucroLiquido: null,
        receitaBrutaYtd: null,
        receitaLiquidaYtd: null,
        lucroBrutoYtd: null,
        resultadoOperacionalYtd: null,
        ebitdaYtd: null,
        lucroLiquidoYtd: null,
        margemBrutaPct: null,
        margemBrutaYtdPct: null,
        margemOperacionalPct: null,
        margemOperacionalYtdPct: null,
        ebitdaPct: null,
        ebitdaYtdPct: null,
        margemLiquidaPct: null,
        margemLiquidaYtdPct: null,
      };
    }

    const rb = recBruta[i] ?? 0;
    const rl = recLiquida[i] ?? 0;
    const lb = lucroBruto[i] ?? 0;
    const ro = resOperacional[i] ?? 0;
    const eb = ebitdaMonthly[i] ?? ro;
    const ll = lucroLiquido[i] ?? 0;

    sumRecBruta += rb;
    sumRecLiquida += rl;
    sumLucroBruto += lb;
    sumResOperacional += ro;
    sumEbitda += eb;
    sumLucroLiquido += ll;

    return {
      monthIndex: i,
      monthLabel,
      isFuture: false,
      receitaBruta: rb,
      receitaLiquida: rl,
      lucroBruto: lb,
      resultadoOperacional: ro,
      ebitda: eb,
      lucroLiquido: ll,
      receitaBrutaYtd: sumRecBruta,
      receitaLiquidaYtd: sumRecLiquida,
      lucroBrutoYtd: sumLucroBruto,
      resultadoOperacionalYtd: sumResOperacional,
      ebitdaYtd: sumEbitda,
      lucroLiquidoYtd: sumLucroLiquido,
      margemBrutaPct: safePct(lb, rl),
      margemBrutaYtdPct: safePct(sumLucroBruto, sumRecLiquida),
      margemOperacionalPct: safePct(ro, rl),
      margemOperacionalYtdPct: safePct(sumResOperacional, sumRecLiquida),
      ebitdaPct: safePct(eb, rl),
      ebitdaYtdPct: safePct(sumEbitda, sumRecLiquida),
      margemLiquidaPct: safePct(ll, rl),
      margemLiquidaYtdPct: safePct(sumLucroLiquido, sumRecLiquida),
    };
  });
}

type CardMetricKey =
  | "ebitda"
  | "receitaBruta"
  | "receitaLiquida"
  | "lucroBruto"
  | "resultadoOperacional"
  | "lucroLiquido";

interface CardMetricConfig {
  key: CardMetricKey;
  ytdKey: keyof DreYtdChartPoint;
  pctKey?: keyof DreYtdChartPoint;
  pctYtdKey?: keyof DreYtdChartPoint;
  title: string;
  shortTitle: string;
  color: string;
  ytdColor: string;
  subtitleHint?: string;
  toneStrategy: "positive_negative" | "always_neutral";
}

const CARD_METRICS: CardMetricConfig[] = [
  {
    key: "ebitda",
    ytdKey: "ebitdaYtd",
    pctKey: "ebitdaPct",
    pctYtdKey: "ebitdaYtdPct",
    title: "EBITDA Gerencial",
    shortTitle: "EBITDA",
    color: "#A855F7",
    ytdColor: "#7E22CE",
    subtitleHint: "Antes de IRPJ/CSLL · Add-back investimento sócios",
    toneStrategy: "positive_negative",
  },
  {
    key: "receitaBruta",
    ytdKey: "receitaBrutaYtd",
    title: "Receita Bruta",
    shortTitle: "Rec. Bruta",
    color: "#3B82F6",
    ytdColor: "#1D4ED8",
    subtitleHint: "NF-e emitida (valor líquido de itens)",
    toneStrategy: "always_neutral",
  },
  {
    key: "receitaLiquida",
    ytdKey: "receitaLiquidaYtd",
    title: "Receita Líquida",
    shortTitle: "Rec. Líquida",
    color: "#0284C7",
    ytdColor: "#0369A1",
    subtitleHint: "Após deduções fiscais e devoluções · Base 100%",
    toneStrategy: "always_neutral",
  },
  {
    key: "lucroBruto",
    ytdKey: "lucroBrutoYtd",
    pctKey: "margemBrutaPct",
    pctYtdKey: "margemBrutaYtdPct",
    title: "Lucro Bruto",
    shortTitle: "Lucro Bruto",
    color: "#10B981",
    ytdColor: "#047857",
    subtitleHint: "Receita Líquida (-) CMV, Embalagens e Fretes",
    toneStrategy: "positive_negative",
  },
  {
    key: "resultadoOperacional",
    ytdKey: "resultadoOperacionalYtd",
    pctKey: "margemOperacionalPct",
    pctYtdKey: "margemOperacionalYtdPct",
    title: "Resultado Operacional",
    shortTitle: "Res. Operacional",
    color: "#F59E0B",
    ytdColor: "#B45309",
    subtitleHint: "Lucro Bruto (-) Despesas operacionais/adm",
    toneStrategy: "positive_negative",
  },
  {
    key: "lucroLiquido",
    ytdKey: "lucroLiquidoYtd",
    pctKey: "margemLiquidaPct",
    pctYtdKey: "margemLiquidaYtdPct",
    title: "Lucro Líquido (pós IRPJ/CSLL)",
    shortTitle: "Lucro Líquido",
    color: "#059669",
    ytdColor: "#064E3B",
    subtitleHint: "Estimativa gerencial mensal de impostos sobre o lucro",
    toneStrategy: "positive_negative",
  },
];

function CustomCardTooltip({
  active,
  payload,
  label,
  config,
}: {
  active?: boolean;
  payload?: Array<{ payload?: DreYtdChartPoint }>;
  label?: string;
  config: CardMetricConfig;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  // Mês futuro (sem realização) não abre tooltip.
  if (point.isFuture || (point[config.key] == null && point[config.ytdKey] == null)) {
    return null;
  }

  const monthlyVal = Number(point[config.key] ?? 0);
  const ytdVal = Number(point[config.ytdKey] ?? 0);
  const monthPct = config.pctKey ? (point[config.pctKey] as number | null) : null;
  const ytdPct = config.pctYtdKey ? (point[config.pctYtdKey] as number | null) : null;

  return (
    <div className="rounded-lg border border-border bg-card p-2.5 shadow-md text-xs space-y-1 min-w-[190px]">
      <p className="font-semibold text-foreground border-b border-border pb-1">{label}</p>
      <div className="flex justify-between items-center gap-2">
        <span className="text-muted-foreground">Mês:</span>
        <span className="font-semibold tabular-nums text-foreground">
          {formatFinanceKpiCurrency(monthlyVal)}
        </span>
      </div>
      {monthPct != null ? (
        <div className="flex justify-between items-center gap-2 text-[11px]">
          <span className="text-muted-foreground">Margem (Mês):</span>
          <span className="font-medium text-foreground">{formatPct(monthPct)}</span>
        </div>
      ) : null}
      <div className="flex justify-between items-center gap-2 pt-1 border-t border-border/50">
        <span className="text-muted-foreground font-medium">Acumulado YTD:</span>
        <span className="font-bold tabular-nums" style={{ color: config.ytdColor }}>
          {formatFinanceKpiCurrency(ytdVal)}
        </span>
      </div>
      {ytdPct != null ? (
        <div className="flex justify-between items-center gap-2 text-[11px]">
          <span className="text-muted-foreground">Margem YTD:</span>
          <span className="font-medium text-foreground">{formatPct(ytdPct)}</span>
        </div>
      ) : null}
    </div>
  );
}

function computeZeroAlignedDomains(
  monthlyVals: number[],
  ytdVals: number[]
): {
  monthlyDomain: [number, number];
  ytdDomain: [number, number];
  hasNegative: boolean;
} {
  const validM = monthlyVals.filter((v) => Number.isFinite(v));
  const validY = ytdVals.filter((v) => Number.isFinite(v));

  if (validM.length === 0 && validY.length === 0) {
    return { monthlyDomain: [0, 100], ytdDomain: [0, 100], hasNegative: false };
  }

  const rawMinM = Math.min(0, ...validM);
  const rawMaxM = Math.max(1, ...validM);
  const rawMinY = Math.min(0, ...validY);
  const rawMaxY = Math.max(1, ...validY);

  const hasNegative = rawMinM < 0 || rawMinY < 0;

  if (!hasNegative) {
    // Ambas as séries são estritamente >= 0: zero fica no rodapé (0%) para ambos os eixos
    return {
      monthlyDomain: [0, Math.ceil(rawMaxM * 1.15)],
      ytdDomain: [0, Math.ceil(rawMaxY * 1.15)],
      hasNegative: false,
    };
  }

  // Quando há valores negativos em alguma série: alinhamos o ponto zero (y=0)
  // exatamente na mesma altura proporcional para ambos os eixos.
  const fracM = Math.abs(rawMinM) / (rawMaxM - rawMinM);
  const fracY = Math.abs(rawMinY) / (rawMaxY - rawMinY);
  const targetFracBelowZero = Math.min(Math.max(fracM, fracY, 0.15), 0.5);

  const maxM = rawMaxM * 1.1;
  const minM = -(maxM * targetFracBelowZero) / (1 - targetFracBelowZero);

  const maxY = rawMaxY * 1.1;
  const minY = -(maxY * targetFracBelowZero) / (1 - targetFracBelowZero);

  return {
    monthlyDomain: [Math.floor(minM), Math.ceil(maxM)],
    ytdDomain: [Math.floor(minY), Math.ceil(maxY)],
    hasNegative: true,
  };
}

function SingleCardChartBody({
  points,
  config,
  height,
  highlightMonthIndex,
  showAxes = false,
}: {
  points: DreYtdChartPoint[];
  config: CardMetricConfig;
  height: number;
  highlightMonthIndex: number;
  /** Modal expandido mostra os eixos numéricos; no card compacto ficam ocultos (números já estão nas caixas acima). */
  showAxes?: boolean;
}) {
  const monthlyVals = useMemo(
    () => points.map((p) => p[config.key]).filter((v): v is number => v != null),
    [points, config.key]
  );
  const ytdVals = useMemo(
    () => points.map((p) => p[config.ytdKey]).filter((v): v is number => v != null),
    [points, config.ytdKey]
  );

  // Calcula domínios sincronizados para que o Y=0 fique rigorosamente na mesma altura dos dois eixos
  const domains = useMemo(
    () => computeZeroAlignedDomains(monthlyVals, ytdVals),
    [monthlyVals, ytdVals]
  );

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 8, right: showAxes ? 8 : 4, left: showAxes ? 0 : 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={FINANCE_BI_COLORS.border} vertical={false} />
          <XAxis
            dataKey="monthLabel"
            tick={{ fontSize: 10, fill: FINANCE_BI_COLORS.textSecondary }}
            axisLine={false}
            tickLine={false}
          />
          {/* Eixo esquerdo: linha ACUMULADA (YTD) — escala grande com zero sincronizado */}
          <YAxis
            yAxisId="ytd"
            domain={domains.ytdDomain}
            tick={{ fontSize: 9, fill: FINANCE_BI_COLORS.textSecondary }}
            tickFormatter={(v: number) => formatFinanceKpiCurrency(v)}
            width={showAxes ? 68 : 0}
            hide={!showAxes}
            axisLine={false}
            tickLine={false}
          />
          {/* Eixo direito (escala própria): barras NO MÊS — com zero sincronizado na mesma altura */}
          <YAxis
            yAxisId="mensal"
            orientation="right"
            domain={domains.monthlyDomain}
            tick={{ fontSize: 9, fill: FINANCE_BI_COLORS.textSecondary }}
            tickFormatter={(v: number) => formatFinanceKpiCurrency(v)}
            width={showAxes ? 60 : 0}
            hide={!showAxes}
            axisLine={false}
            tickLine={false}
          />
          {domains.hasNegative ? (
            <ReferenceLine yAxisId="ytd" y={0} stroke={FINANCE_BI_COLORS.risk} strokeWidth={1} strokeDasharray="2 2" />
          ) : null}
          <Tooltip content={<CustomCardTooltip config={config} />} />
          <Legend
            wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
            iconSize={9}
            verticalAlign="bottom"
            height={20}
          />
          <Bar yAxisId="mensal" dataKey={config.key} name="No mês" maxBarSize={18} radius={[3, 3, 0, 0]}>
            {points.map((entry) => {
              const val = entry[config.key];
              const cellColor = val != null && val < 0 ? FINANCE_BI_COLORS.risk : config.color;
              // Mês em destaque com opacidade cheia; demais mais suaves (liga o gráfico à caixa "Mês").
              const opacity = entry.monthIndex === highlightMonthIndex ? 0.95 : 0.45;
              return <Cell key={`bar-${entry.monthIndex}`} fill={cellColor} fillOpacity={opacity} />;
            })}
          </Bar>
          <Line
            yAxisId="ytd"
            type="monotone"
            dataKey={config.ytdKey}
            name="Acumulado YTD"
            stroke={config.ytdColor}
            strokeWidth={2.5}
            dot={{ r: 2.5, fill: config.ytdColor }}
            activeDot={{ r: 4 }}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function SingleCardChartBlock({
  points,
  config,
  report,
}: {
  points: DreYtdChartPoint[];
  config: CardMetricConfig;
  report: FinanceDreReport;
}) {
  const [expanded, setExpanded] = useState(false);
  const expandedHeight = useFinanceBiExpandedChartHeight(500);

  const highlightMonthIndex = report.filters.highlightMonth - 1;
  const highlightPoint = points[highlightMonthIndex] ?? points[points.length - 1];

  const monthVal = highlightPoint ? Number(highlightPoint[config.key]) : 0;
  const ytdVal = highlightPoint ? Number(highlightPoint[config.ytdKey]) : 0;
  const monthPct = config.pctKey && highlightPoint ? (highlightPoint[config.pctKey] as number | null) : null;
  const ytdPct = config.pctYtdKey && highlightPoint ? (highlightPoint[config.pctYtdKey] as number | null) : null;

  const isNegativeMonth = config.toneStrategy === "positive_negative" && monthVal < 0;
  const isNegativeYtd = config.toneStrategy === "positive_negative" && ytdVal < 0;

  const borderClass =
    config.toneStrategy === "positive_negative"
      ? isNegativeYtd
        ? "border-rose-200 bg-rose-50/20"
        : "border-emerald-200 bg-emerald-50/10"
      : "border-border bg-card";

  return (
    <>
      <div
        className={cn(financeBiCardClass, "p-3.5 flex flex-col justify-between transition-shadow hover:shadow-md", borderClass)}
        data-testid={`finance-dre-chart-card-${config.key}`}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <div className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: config.ytdColor }}
                aria-hidden="true"
              />
              <h4 className="text-xs font-bold uppercase tracking-wide text-foreground">
                {config.title}
              </h4>
            </div>
            {config.subtitleHint ? (
              <p className="mt-0.5 text-[10px] text-muted-foreground line-clamp-1" title={config.subtitleHint}>
                {config.subtitleHint}
              </p>
            ) : null}
          </div>
          <FinanceBiChartExpandButton
            onClick={() => setExpanded(true)}
            testId={`finance-dre-chart-expand-${config.key}`}
            className="h-6 w-6"
          />
        </div>

        {/* Resumo Mês x YTD nos moldes dos cards superiores */}
        <div className="grid grid-cols-2 gap-2 my-2 py-2 px-2.5 rounded-lg bg-accent/30 border border-border/40 text-xs">
          <div>
            <span className="text-[10px] uppercase font-medium text-muted-foreground block">
              Mês ({report.monthLabels[highlightMonthIndex]})
            </span>
            <span
              className={cn(
                "font-bold text-sm tracking-tight block mt-0.5",
                isNegativeMonth ? "text-rose-600" : "text-foreground"
              )}
            >
              {formatFinanceKpiCurrency(monthVal)}
            </span>
            {monthPct != null ? (
              <span className="text-[10px] text-muted-foreground block mt-0.5">
                Margem {formatPct(monthPct)}
              </span>
            ) : null}
          </div>

          <div className="border-l border-border/50 pl-2.5">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
              Acumulado (YTD)
            </span>
            <span
              className={cn(
                "font-bold text-sm tracking-tight block mt-0.5",
                isNegativeYtd ? "text-rose-600" : "text-foreground"
              )}
            >
              {formatFinanceKpiCurrency(ytdVal)}
            </span>
            {ytdPct != null ? (
              <span className="text-[10px] text-muted-foreground block mt-0.5 font-medium">
                Margem {formatPct(ytdPct)}
              </span>
            ) : null}
          </div>
        </div>

        {/* Gráfico no corpo do card */}
        <div className="mt-1">
          <SingleCardChartBody
            points={points}
            config={config}
            height={150}
            highlightMonthIndex={highlightMonthIndex}
          />
        </div>
      </div>

      {/* Modal expandido para visualização em tela cheia */}
      <FinanceBiChartExpandModal
        open={expanded}
        title={`Evolução Mês a Mês x YTD — ${config.title}`}
        subtitle={`${config.subtitleHint ?? ""} · Ano ${report.filters.year} (${report.companyLabel})`}
        onClose={() => setExpanded(false)}
        testId={`finance-dre-chart-expand-modal-${config.key}`}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4 p-3 rounded-xl bg-accent/40 text-sm">
            <div>
              <span className="text-xs text-muted-foreground block">Mês Destaque:</span>
              <strong className={isNegativeMonth ? "text-rose-600" : "text-foreground"}>
                {formatFinanceKpiCurrency(monthVal)}
              </strong>
              {monthPct != null ? ` (${formatPct(monthPct)})` : ""}
            </div>
            <div className="h-6 w-px bg-border" />
            <div>
              <span className="text-xs text-muted-foreground block">Total Acumulado YTD:</span>
              <strong className={isNegativeYtd ? "text-rose-600" : "text-foreground"}>
                {formatFinanceKpiCurrency(ytdVal)}
              </strong>
              {ytdPct != null ? ` (${formatPct(ytdPct)})` : ""}
            </div>
          </div>
          <SingleCardChartBody
            points={points}
            config={config}
            height={expandedHeight - 80}
            highlightMonthIndex={highlightMonthIndex}
            showAxes
          />
        </div>
      </FinanceBiChartExpandModal>
    </>
  );
}

function ConsolidatedYtdChart({
  points,
  height,
}: {
  points: DreYtdChartPoint[];
  height: number;
}) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 12, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={FINANCE_BI_COLORS.border} />
          <ReferenceLine y={0} stroke={FINANCE_BI_COLORS.textSecondary} strokeWidth={1} strokeDasharray="2 2" />
          <XAxis
            dataKey="monthLabel"
            tick={{ fontSize: 11, fill: FINANCE_BI_COLORS.textSecondary }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: FINANCE_BI_COLORS.textSecondary }}
            tickFormatter={(v: number) => formatFinanceKpiCurrency(v)}
            width={76}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value: unknown, name: unknown) => [
              formatFinanceKpiCurrency(Number(value ?? 0)),
              String(name),
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
          <Line
            type="monotone"
            dataKey="receitaBrutaYtd"
            name="Rec. Bruta YTD"
            stroke="#3B82F6"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="receitaLiquidaYtd"
            name="Rec. Líquida YTD"
            stroke="#0284C7"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="lucroBrutoYtd"
            name="Lucro Bruto YTD"
            stroke="#10B981"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="resultadoOperacionalYtd"
            name="Res. Operacional YTD"
            stroke="#F59E0B"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="ebitdaYtd"
            name="EBITDA YTD"
            stroke="#8B5CF6"
            strokeWidth={2.5}
            strokeDasharray="4 2"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="lucroLiquidoYtd"
            name="Lucro Líquido YTD"
            stroke="#059669"
            strokeWidth={2.5}
            dot={{ r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function MonthlyComparisonChart({
  points,
  height,
}: {
  points: DreYtdChartPoint[];
  height: number;
}) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 12, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={FINANCE_BI_COLORS.border} />
          <ReferenceLine y={0} stroke={FINANCE_BI_COLORS.textSecondary} strokeWidth={1} />
          <XAxis
            dataKey="monthLabel"
            tick={{ fontSize: 11, fill: FINANCE_BI_COLORS.textSecondary }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: FINANCE_BI_COLORS.textSecondary }}
            tickFormatter={(v: number) => formatFinanceKpiCurrency(v)}
            width={76}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value: unknown, name: unknown) => [
              formatFinanceKpiCurrency(Number(value ?? 0)),
              String(name),
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
          <Bar dataKey="receitaBruta" name="Rec. Bruta" fill="#3B82F6" maxBarSize={12} />
          <Bar dataKey="receitaLiquida" name="Rec. Líquida" fill="#0284C7" maxBarSize={12} />
          <Bar dataKey="lucroBruto" name="Lucro Bruto" fill="#10B981" maxBarSize={12} />
          <Bar dataKey="resultadoOperacional" name="Res. Operacional" fill="#F59E0B" maxBarSize={12} />
          <Bar dataKey="ebitda" name="EBITDA" fill="#8B5CF6" maxBarSize={12} />
          <Bar dataKey="lucroLiquido" name="Lucro Líquido" fill="#059669" maxBarSize={12} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function FinanceDreYtdChartsSection({ report }: { report: FinanceDreReport }) {
  const [viewMode, setViewMode] = useState<"cards" | "consolidated" | "monthly">("cards");
  const points = useMemo<DreYtdChartPoint[]>(() => buildDreYtdChartPoints(report), [report]);

  return (
    <section
      className="space-y-4 pt-2 no-print"
      data-testid="finance-dre-ytd-charts-section"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold tracking-tight text-foreground">
              Gráficos Mês a Mês & Acumulado YTD
            </h3>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
              {report.filters.year}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Evolução mensal e acumulada dos 6 indicadores dos cards executivos da DRE Gerencial.
          </p>
        </div>

        {/* Chaveador de Visões */}
        <div className="inline-flex rounded-lg border border-border bg-card p-1 text-xs">
          <button
            type="button"
            onClick={() => setViewMode("cards")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-semibold transition-colors",
              viewMode === "cards"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
            data-testid="finance-dre-chart-mode-cards"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Cards Individuais (6)
          </button>
          <button
            type="button"
            onClick={() => setViewMode("consolidated")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-semibold transition-colors",
              viewMode === "consolidated"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
            data-testid="finance-dre-chart-mode-consolidated"
          >
            <TrendingUp className="h-3.5 w-3.5" />
            Trajetória YTD
          </button>
          <button
            type="button"
            onClick={() => setViewMode("monthly")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-semibold transition-colors",
              viewMode === "monthly"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
            data-testid="finance-dre-chart-mode-monthly"
          >
            <Layers className="h-3.5 w-3.5" />
            Comparativo Mensal
          </button>
        </div>
      </div>

      {viewMode === "cards" ? (
        <div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="finance-dre-cards-charts-grid"
        >
          {CARD_METRICS.map((config) => (
            <SingleCardChartBlock
              key={config.key}
              config={config}
              points={points}
              report={report}
            />
          ))}
        </div>
      ) : viewMode === "consolidated" ? (
        <div className={cn(financeBiCardClass, "p-4")} data-testid="finance-dre-consolidated-ytd-chart">
          <div className="mb-3">
            <h4 className="text-sm font-bold text-foreground">
              Trajetória Acumulada YTD dos Indicadores
            </h4>
            <p className="text-xs text-muted-foreground">
              Acompanhamento mês a mês do acúmulo da Receita, Lucro, EBITDA e Resultado final ({report.filters.year}).
            </p>
          </div>
          <ConsolidatedYtdChart points={points} height={340} />
        </div>
      ) : (
        <div className={cn(financeBiCardClass, "p-4")} data-testid="finance-dre-monthly-comparison-chart">
          <div className="mb-3">
            <h4 className="text-sm font-bold text-foreground">
              Comparativo Mensal Isolado (Jan a Dez)
            </h4>
            <p className="text-xs text-muted-foreground">
              Desempenho isolado de cada mês da DRE (sem acumulado).
            </p>
          </div>
          <MonthlyComparisonChart points={points} height={340} />
        </div>
      )}
    </section>
  );
}
