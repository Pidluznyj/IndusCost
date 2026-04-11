import React, { useEffect, useState } from "react";
import { 
  TrendingUp, 
  Users, 
  Cpu, 
  ArrowUpRight, 
  ArrowDownRight,
  PieChart,
  BarChart3,
  Loader2,
  Factory,
  LayoutDashboard,
  GitBranch
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
  AreaChart,
  Area
} from "recharts";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { motion } from "motion/react";
import { SalesFunnelPanel } from "@/src/components/dashboard/SalesFunnelPanel";

interface DashboardData {
  kpis: {
    totalEmployees: number;
    avgEmployeeCost: number;
    totalMachines: number;
    avgHM: number;
    totalCIF: number;
    totalOPEX: number;
  };
  productPerformance: any[];
  costComposition: {
    mp: number;
    hh: number;
    hm: number;
    cif: number;
    opex: number;
  };
}

export const DashboardModule = () => {
  const [dashboardTab, setDashboardTab] = useState<"operacao" | "funil">("operacao");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard");
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP error! status: ${res.status}, body: ${text.substring(0, 100)}...`);
      }
      setData(await res.json());
    } catch (error) {
      console.error("Erro ao buscar dashboard:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-wrap gap-2 p-1 bg-accent/40 rounded-xl border border-border w-full max-w-xl">
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

      {dashboardTab === "funil" && <SalesFunnelPanel />}

      {dashboardTab === "operacao" && (
        <>
          {(loading || !data) ? (
            <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-muted-foreground font-medium">Consolidando indicadores gerenciais...</p>
            </div>
          ) : (
            <OperationDashboardBody data={data} />
          )}
        </>
      )}
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
      {/* KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KPICard 
          title="Custo médio folha / colaborador" 
          value={formatCurrency(data.kpis.avgEmployeeCost)} 
          icon={Users} 
          trend="+2.4%" 
          trendUp={false}
          subtitle={`Média de custo mensal estimado por colaborador (não é a taxa HH global do motor de custo). ${data.kpis.totalEmployees} ativos.`}
        />
        <KPICard 
          title="Tarifa HM global (energia ÷ h úteis)" 
          value={formatCurrency(data.kpis.avgHM)} 
          icon={Cpu} 
          trend="-1.2%" 
          trendUp={true}
          subtitle={`Mesma base ENERGY_COST ÷ WORKING_HOURS usada no custeio de máquina. ${data.kpis.totalMachines} máquinas cadastradas.`}
        />
        <KPICard 
          title="CIF Mensal Total" 
          value={formatCurrency(data.kpis.totalCIF)} 
          icon={Factory} 
          trend="+0.5%" 
          trendUp={false}
          subtitle="Absorvido na produção"
        />
        <KPICard 
          title="OPEX Mensal Total" 
          value={formatCurrency(data.kpis.totalOPEX)} 
          icon={PieChart} 
          trend="-3.1%" 
          trendUp={true}
          subtitle="Despesas administrativas"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Cost Composition Chart */}
        <div className="lg:col-span-1 bg-card rounded-3xl border border-border p-8 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="font-bold text-lg">Composição média unitária (motor)</h3>
              <p className="text-[10px] text-muted-foreground mt-1">Média dos custos unitários por produto ativo — mesmo motor da análise de custo.</p>
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
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                />
                <Legend verticalAlign="bottom" height={36}/>
              </RePieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Product Performance Chart */}
        <div className="lg:col-span-2 bg-card rounded-3xl border border-border p-8 shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="font-bold text-lg">Margem líquida sobre preço sugerido</h3>
              <p className="text-[10px] text-muted-foreground mt-1 max-w-md">
                (Preço sugerido − impostos − comissão − frete − custo gerencial) ÷ preço sugerido. Custo gerencial = CIU + OPEX unitário (motor).
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
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
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

      {/* Tables Section */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* Top Profitable */}
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
                <th className="p-4 font-bold text-right" title="Preço sugerido − impostos − comissão − frete − custo gerencial">Margem líq. R$</th>
                <th className="p-4 font-bold text-right" title="Margem líquida ÷ preço sugerido">Margem líq. %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {topProducts.map((p) => (
                <tr key={p.id} className="hover:bg-accent/10 transition-colors">
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

        {/* Least Profitable */}
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
                <th className="p-4 font-bold text-right" title="Preço sugerido − impostos − comissão − frete − custo gerencial">Margem líq. R$</th>
                <th className="p-4 font-bold text-right" title="Margem líquida ÷ preço sugerido">Margem líq. %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {bottomProducts.map((p) => (
                <tr key={p.id} className="hover:bg-accent/10 transition-colors">
                  <td className="p-4">
                    <p className="font-bold">{p.name}</p>
                    <p className="text-[10px] text-muted-foreground">{p.sku}</p>
                  </td>
                  <td className="p-4 text-right font-medium">{formatCurrency(p.suggestedPrice)}</td>
                  <td className="p-4 text-right font-bold text-red-600">{formatCurrency(p.marginAbs)}</td>
                  <td className="p-4 text-right">
                    <span className={cn(
                      "px-2 py-0.5 rounded-full font-black",
                      p.marginPct > 0 ? "bg-orange-500/10 text-orange-600" : "bg-red-500/10 text-red-600"
                    )}>
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

const KPICard = ({ title, value, icon: Icon, trend, trendUp, subtitle }: any) => (
  <motion.div 
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="bg-card rounded-3xl border border-border p-6 shadow-sm hover:shadow-md transition-all"
  >
    <div className="flex items-start justify-between mb-4">
      <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
        <Icon className="h-6 w-6" />
      </div>
      <div className={cn(
        "flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-full",
        trendUp ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"
      )}>
        {trendUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
        {trend}
      </div>
    </div>
    <div className="space-y-1">
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{title}</p>
      <p className="text-2xl font-black">{value}</p>
      <p className="text-[10px] text-muted-foreground">{subtitle}</p>
    </div>
  </motion.div>
);
