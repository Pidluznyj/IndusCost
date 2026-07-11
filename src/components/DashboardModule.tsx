import React, { useCallback, useEffect, useState } from "react";
import {
  Users,
  Cpu,
  ArrowUpRight,
  ArrowDownRight,
  PieChart,
  BarChart3,
  Loader2,
  Factory,
  LayoutDashboard,
  GitBranch,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart as RePieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { motion } from "motion/react";
import { OrderToCashFunnelPanel } from "@/src/components/dashboard/order-to-cash-funnel/OrderToCashFunnelPanel";
import { ExecutiveDashboardPanel } from "@/src/components/dashboard/ExecutiveDashboardPanel";
import type { ExecutiveDashboardSummary } from "@/src/lib/executiveDashboardTypes";
import { GuidedTour } from "@/src/components/tour/GuidedTour";
import { TourHelpButton } from "@/src/components/tour/TourHelpButton";
import { DASHBOARD_TOUR_STEPS } from "@/src/tours/dashboardTourSteps";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { FinanceExecutiveTotalizerCard } from "@/src/components/finance/shared/FinanceExecutiveTotalizerCard";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";

interface DashboardData {
  kpis: {
    totalEmployees: number;
    avgEmployeeCost: number;
    totalMachines: number;
    avgHM: number;
    totalCIF: number;
    totalOPEX: number;
  };
  productPerformance: Array<{
    productId: string;
    sku: string;
    name: string;
    suggestedPrice: number;
    marginAbs: number;
    marginPct: number;
  }>;
  costComposition: {
    mp: number;
    hh: number;
    hm: number;
    cif: number;
    opex: number;
  };
}

export const DashboardModule = () => {
  const [dashboardTab, setDashboardTab] = useState<"executivo" | "operacao" | "funil">("executivo");
  const [data, setData] = useState<DashboardData | null>(null);
  const [executiveData, setExecutiveData] = useState<ExecutiveDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [executiveLoading, setExecutiveLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [executiveError, setExecutiveError] = useState<string | null>(null);
  const [tourOpen, setTourOpen] = useState(false);

  const [executiveYear, setExecutiveYear] = useState(() => new Date().getFullYear());

  const fetchExecutive = useCallback(async () => {
    setExecutiveLoading(true);
    setExecutiveError(null);
    try {
      const json = await fetchJsonOk<ExecutiveDashboardSummary>(
        `/api/dashboard/executive-summary?year=${executiveYear}`
      );
      setExecutiveData(json);
      setExecutiveError(null);
      if (json.selectedYear && json.selectedYear !== executiveYear) {
        setExecutiveYear(json.selectedYear);
      }
    } catch (error) {
      console.error("Erro ao buscar visão executiva:", error);
      setExecutiveError(error instanceof Error ? error.message : "Falha ao carregar visão executiva.");
    } finally {
      setExecutiveLoading(false);
    }
  }, [executiveYear]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const json = await fetchJsonOk<DashboardData>("/api/dashboard");
      setData(json);
      setFetchError(null);
    } catch (error) {
      console.error("Erro ao buscar dashboard:", error);
      setFetchError(error instanceof Error ? error.message : "Falha ao carregar o dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchExecutive();
    void fetchData();
  }, [fetchExecutive, fetchData]);

  return (
    <div data-tour="dashboard-module" className="space-y-6 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div
          data-tour="dashboard-tabs"
          className="flex flex-wrap gap-2 p-1 bg-accent/40 rounded-xl border border-border w-full max-w-3xl"
        >
          <button
            type="button"
            onClick={() => setDashboardTab("executivo")}
            className={cn(
              "flex-1 min-w-[140px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all",
              dashboardTab === "executivo"
                ? "bg-card text-primary shadow-sm border border-border"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Sparkles className="h-4 w-4" />
            Visão Executiva
          </button>
          <button
            type="button"
            onClick={() => setDashboardTab("operacao")}
            className={cn(
              "flex-1 min-w-[140px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all",
              dashboardTab === "operacao"
                ? "bg-card text-primary shadow-sm border border-border"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <LayoutDashboard className="h-4 w-4" />
            Operação / Financeiro
          </button>
          <button
            type="button"
            onClick={() => setDashboardTab("funil")}
            className={cn(
              "flex-1 min-w-[140px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all",
              dashboardTab === "funil"
                ? "bg-card text-primary shadow-sm border border-border"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <GitBranch className="h-4 w-4" />
            Funil de Vendas
          </button>
        </div>
        <TourHelpButton onClick={() => setTourOpen(true)} />
      </div>

      <div data-tour="dashboard-main-area" className="space-y-6">
        {dashboardTab === "executivo" && (
          <ExecutiveDashboardPanel
            data={executiveData}
            loading={executiveLoading}
            error={executiveError}
            selectedYear={executiveYear}
            onYearChange={setExecutiveYear}
            onRefresh={() => void fetchExecutive()}
          />
        )}

        {dashboardTab === "funil" && <OrderToCashFunnelPanel />}

        {dashboardTab === "operacao" && (
          <>
            {fetchError && data && !loading ? (
              <div className="flex flex-col gap-3 rounded-xl border border-amber-200/80 bg-amber-50/70 px-4 py-4 text-sm dark:border-amber-900/50 dark:bg-amber-950/30 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="font-semibold text-foreground">Não foi possível carregar o dashboard</p>
                  <p className="text-muted-foreground">
                    Tente novamente. Se o problema persistir, acione o suporte técnico. Os indicadores abaixo refletem o
                    último carregamento bem-sucedido.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void fetchData()}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  Tentar novamente
                </button>
              </div>
            ) : null}

            {loading && !data ? (
              <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <p className="text-muted-foreground font-medium">Consolidando indicadores gerenciais...</p>
              </div>
            ) : fetchError && !data && !loading ? (
              <div className="mx-auto max-w-lg rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
                <h3 className="text-lg font-semibold text-foreground">Não foi possível carregar o dashboard</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Tente novamente. Se o problema persistir, acione o suporte técnico.
                </p>
                <button
                  type="button"
                  onClick={() => void fetchData()}
                  className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  Tentar novamente
                </button>
              </div>
            ) : data ? (
              <OperationDashboardBody data={data} />
            ) : null}
          </>
        )}
      </div>

      <GuidedTour
        open={tourOpen}
        onClose={() => setTourOpen(false)}
        steps={DASHBOARD_TOUR_STEPS}
        tourName="Tour do Dashboard"
      />
    </div>
  );
};

const COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444"];

function OperationDashboardBody({ data }: { data: DashboardData }) {
  const costCompositionData = [
    { name: "Matéria-Prima", value: data.costComposition.mp },
    { name: "Mão de Obra (HH)", value: data.costComposition.hh },
    { name: "Máquinas (HM)", value: data.costComposition.hm },
    { name: "CIF (Indiretos)", value: data.costComposition.cif },
    { name: "OPEX (Adm/Com)", value: data.costComposition.opex },
  ];

  const topProducts = data.productPerformance.slice(0, 5);
  const bottomProducts = [...data.productPerformance].reverse().slice(0, 5);

  return (
    <div className="space-y-8">
      <ExecutiveSummarySection
        title="Indicadores operacionais do motor de custo"
        eyebrow="Dashboard · operação"
        testId="dashboard-kpi-cards"
      >
        <SummaryKpiGrid minColumnWidth={220} className={SYSTEM_TOTALIZER_GRID_CLASS}>
          <FinanceExecutiveTotalizerCard
            label="Custo médio folha / colaborador"
            amount={data.kpis.avgEmployeeCost}
            amountFormat="currency"
            subtitle={`Média de custo mensal estimado por colaborador (não é a taxa HH global do motor de custo). ${data.kpis.totalEmployees} ativos.`}
            tone="money"
            icon={Users}
          />
          <FinanceExecutiveTotalizerCard
            label="Tarifa HM global (energia ÷ h úteis)"
            amount={data.kpis.avgHM}
            amountFormat="currency"
            subtitle={`Mesma base ENERGY_COST ÷ WORKING_HOURS usada no custeio de máquina. ${data.kpis.totalMachines} máquinas cadastradas.`}
            tone="info"
            icon={Cpu}
          />
          <FinanceExecutiveTotalizerCard
            label="CIF Mensal Total"
            amount={data.kpis.totalCIF}
            amountFormat="currency"
            subtitle="Absorvido na produção"
            tone="neutral"
            icon={Factory}
          />
          <FinanceExecutiveTotalizerCard
            label="OPEX Mensal Total"
            amount={data.kpis.totalOPEX}
            amountFormat="currency"
            subtitle="Despesas administrativas"
            tone="neutral"
            icon={PieChart}
          />
        </SummaryKpiGrid>
      </ExecutiveSummarySection>

      <div data-tour="dashboard-charts-block" className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 bg-card rounded-3xl border border-border p-8 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="font-bold text-lg">Composição média unitária (motor)</h3>
              <p className="text-[10px] text-muted-foreground mt-1">
                Média dos custos unitários por produto ativo — mesmo motor da análise de custo.
              </p>
            </div>
            <PieChart className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <RePieChart>
                <Pie
                  data={costCompositionData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {costCompositionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => formatCurrency(value)}
                  contentStyle={{
                    borderRadius: "12px",
                    border: "none",
                    boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
                  }}
                />
                <Legend verticalAlign="bottom" height={36} />
              </RePieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-2 bg-card rounded-3xl border border-border p-8 shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="font-bold text-lg">Margem líquida sobre preço sugerido</h3>
              <p className="text-[10px] text-muted-foreground mt-1 max-w-md">
                (Preço sugerido − impostos − comissão − frete − custo gerencial) ÷ preço sugerido. Custo gerencial = CIU
                + OPEX unitário (motor).
              </p>
            </div>
            <BarChart3 className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topProducts}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="sku" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 600 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 600 }} />
                <Tooltip
                  formatter={(value: number) => `${formatNumber(value)}%`}
                  contentStyle={{
                    borderRadius: "12px",
                    border: "none",
                    boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
                  }}
                />
                <Bar dataKey="marginPct" radius={[6, 6, 0, 0]}>
                  {topProducts.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.marginPct > 0 ? "#10b981" : "#ef4444"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <div className="bg-card rounded-3xl border border-border overflow-hidden shadow-sm">
          <div className="p-6 border-b border-border bg-accent/30 flex items-center justify-between">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <ArrowUpRight className="h-4 w-4 text-green-600" />
              Top 5 Produtos Mais Rentáveis
            </h3>
          </div>
          <table className="w-full text-left text-xs">
            <thead className="bg-accent/10 border-b border-border">
              <tr>
                <th className="p-4 font-bold">Produto</th>
                <th className="p-4 font-bold text-right">Preço Sug.</th>
                <th className="p-4 font-bold text-right" title="Preço sugerido − impostos − comissão − frete − custo gerencial">
                  Margem líq. R$
                </th>
                <th className="p-4 font-bold text-right" title="Margem líquida ÷ preço sugerido">
                  Margem líq. %
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {topProducts.map((p) => (
                <tr key={p.productId} className="hover:bg-accent/10 transition-colors">
                  <td className="p-4">
                    <p className="font-bold">{p.name}</p>
                    <p className="text-[10px] text-muted-foreground">{p.sku}</p>
                  </td>
                  <td className="p-4 text-right font-medium">{formatCurrency(p.suggestedPrice)}</td>
                  <td className="p-4 text-right font-bold text-green-600">{formatCurrency(p.marginAbs)}</td>
                  <td className="p-4 text-right">
                    <span className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 font-black">
                      {formatNumber(p.marginPct)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-card rounded-3xl border border-border overflow-hidden shadow-sm">
          <div className="p-6 border-b border-border bg-accent/30 flex items-center justify-between">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <ArrowDownRight className="h-4 w-4 text-red-600" />
              Produtos com Menor Margem
            </h3>
          </div>
          <table className="w-full text-left text-xs">
            <thead className="bg-accent/10 border-b border-border">
              <tr>
                <th className="p-4 font-bold">Produto</th>
                <th className="p-4 font-bold text-right">Preço Sug.</th>
                <th className="p-4 font-bold text-right" title="Preço sugerido − impostos − comissão − frete − custo gerencial">
                  Margem líq. R$
                </th>
                <th className="p-4 font-bold text-right" title="Margem líquida ÷ preço sugerido">
                  Margem líq. %
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {bottomProducts.map((p) => (
                <tr key={p.productId} className="hover:bg-accent/10 transition-colors">
                  <td className="p-4">
                    <p className="font-bold">{p.name}</p>
                    <p className="text-[10px] text-muted-foreground">{p.sku}</p>
                  </td>
                  <td className="p-4 text-right font-medium">{formatCurrency(p.suggestedPrice)}</td>
                  <td className="p-4 text-right font-bold text-red-600">{formatCurrency(p.marginAbs)}</td>
                  <td className="p-4 text-right">
                    <span
                      className={cn(
                        "px-2 py-0.5 rounded-full font-black",
                        p.marginPct > 0 ? "bg-orange-500/10 text-orange-600" : "bg-red-500/10 text-red-600"
                      )}
                    >
                      {formatNumber(p.marginPct)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
