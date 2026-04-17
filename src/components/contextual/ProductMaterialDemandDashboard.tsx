import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronDown, Loader2, Search } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatCurrencyAdaptive, formatNumberAdaptive } from "@/src/lib/utils";
import { ContextualDashboardLayout } from "./ContextualDashboardLayout";
import { ContextualDashboardKpiCard } from "./ContextualDashboardKpiCard";
import { ContextualDashboardEmpty } from "./ContextualDashboardEmpty";

type FiltersState = {
  startDate: string;
  endDate: string;
  status: string;
  customerId: string;
  productId: string;
  materialId: string;
  companyIssuer: string;
  mode: "quantity" | "value" | "proposals" | "products";
  search: string;
};

type MaterialRow = {
  materialId: string;
  code: string | null;
  description: string;
  unit: string | null;
  quantityTotal: number;
  unitCostReference: number | null;
  estimatedValueTotal: number;
  proposalCount: number;
  productCount: number;
  latestUsageAt: string | null;
  pctOfTotalQuantity: number | null;
  pctOfTotalValue: number | null;
  topProducts: Array<{ productId: string; sku: string | null; name: string; quantity: number; value: number }>;
  topCustomers: Array<{ customerId: string; customerName: string; quantity: number; value: number }>;
  proposals: Array<{ proposalId: string; proposalNumber: number; proposalDate: string; proposalStatus: string; quantity: number; value: number }>;
};

type AnalysisResponse = {
  semantics: { label: string };
  summary: {
    totalEstimatedQuantity: number;
    totalEstimatedValue: number;
    uniqueMaterials: number;
    proposalCount: number;
    productCount: number;
    customerCount: number;
    leaderMaterial: null | { code: string | null; description: string };
    leaderSharePct: number | null;
  };
  charts: {
    paretoByQuantity: MaterialRow[];
    paretoByValue: MaterialRow[];
    evolution: Array<{ period: string; quantity: number; value: number; proposalCount: number }>;
  };
  rows: MaterialRow[];
  facets: {
    statuses: string[];
    customers: Array<{ id: string; companyName: string }>;
    products: Array<{ id: string; sku: string | null; name: string }>;
    materials: Array<{ materialId: string; code: string | null; description: string; unit: string | null }>;
    companyIssuers: string[];
  };
};

const INITIAL_FILTERS: FiltersState = {
  startDate: "",
  endDate: "",
  status: "",
  customerId: "",
  productId: "",
  materialId: "",
  companyIssuer: "",
  mode: "quantity",
  search: "",
};

function money(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatCurrencyAdaptive(v);
}

function num(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatNumberAdaptive(v);
}

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${formatNumberAdaptive(v)}%`;
}

function periodLabel(yyyymm: string): string {
  const [yy, mm] = yyyymm.split("-");
  if (!yy || !mm) return yyyymm;
  return `${mm}/${yy}`;
}

export function ProductMaterialDemandDashboard() {
  const [filters, setFilters] = useState<FiltersState>(INITIAL_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<FiltersState>(INITIAL_FILTERS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [expandedMaterialId, setExpandedMaterialId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams();
    (Object.entries(appliedFilters) as Array<[keyof FiltersState, string]>).forEach(([k, v]) => {
      if (v) qs.set(k, v);
    });

    setLoading(true);
    setError(null);
    fetchJsonOk<AnalysisResponse>(`/api/products/material-demand/analysis?${qs.toString()}`)
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setExpandedMaterialId(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setData(null);
          setError(e instanceof Error ? e.message : "Erro ao carregar análise de matéria-prima.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [appliedFilters]);

  const maxParetoQty = useMemo(
    () => Math.max(0, ...(data?.charts.paretoByQuantity.map((r) => r.quantityTotal) ?? [0])),
    [data]
  );
  const maxParetoVal = useMemo(
    () => Math.max(0, ...(data?.charts.paretoByValue.map((r) => r.estimatedValueTotal) ?? [0])),
    [data]
  );

  return (
    <ContextualDashboardLayout
      moduleLabel="Engenharia — demanda estimada de MP"
      backPath="/products"
      backLabel="Voltar para Engenharia"
    >
      <div className="space-y-2">
        <h3 className="text-lg font-bold tracking-tight">Inteligência de Matéria-Prima</h3>
        <p className="text-sm text-muted-foreground">Leitura analítica operacional derivada de itens de proposta.</p>
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-900 dark:text-amber-100 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <p>{data?.semantics.label ?? "Demanda/uso estimado de matéria-prima (não é consumo real de produção)."}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          <input type="date" value={filters.startDate} onChange={(e) => setFilters((p) => ({ ...p, startDate: e.target.value }))} className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
          <input type="date" value={filters.endDate} onChange={(e) => setFilters((p) => ({ ...p, endDate: e.target.value }))} className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
          <select value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))} className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20">
            <option value="">Status (todos)</option>
            {(data?.facets.statuses ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filters.customerId} onChange={(e) => setFilters((p) => ({ ...p, customerId: e.target.value }))} className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20">
            <option value="">Cliente (todos)</option>
            {(data?.facets.customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
          </select>
          <select value={filters.productId} onChange={(e) => setFilters((p) => ({ ...p, productId: e.target.value }))} className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20">
            <option value="">Produto (todos)</option>
            {(data?.facets.products ?? []).map((p) => <option key={p.id} value={p.id}>{(p.sku ? `[${p.sku}] ` : "") + p.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          <select value={filters.materialId} onChange={(e) => setFilters((p) => ({ ...p, materialId: e.target.value }))} className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20">
            <option value="">Matéria-prima (todas)</option>
            {(data?.facets.materials ?? []).map((m) => <option key={m.materialId} value={m.materialId}>{(m.code ? `[${m.code}] ` : "") + m.description}</option>)}
          </select>
          <select value={filters.companyIssuer} onChange={(e) => setFilters((p) => ({ ...p, companyIssuer: e.target.value }))} className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20">
            <option value="">Empresa emissora (todas)</option>
            {(data?.facets.companyIssuers ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filters.mode} onChange={(e) => setFilters((p) => ({ ...p, mode: e.target.value as FiltersState["mode"] }))} className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20">
            <option value="quantity">Modo: quantidade</option>
            <option value="value">Modo: valor</option>
            <option value="proposals">Modo: pedidos/propostas</option>
            <option value="products">Modo: produtos</option>
          </select>
          <div className="relative md:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={filters.search} onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))} placeholder="Buscar MP por código ou descrição" className="h-10 w-full rounded-lg border border-border bg-background pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setAppliedFilters(filters)} className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90">Aplicar filtros</button>
          <button type="button" onClick={() => { setFilters(INITIAL_FILTERS); setAppliedFilters(INITIAL_FILTERS); }} className="h-10 rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-accent">Limpar</button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="mt-3 text-sm">Carregando análise...</p>
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <ContextualDashboardKpiCard label="Qtd total estimada MP" value={num(data.summary.totalEstimatedQuantity)} />
            <ContextualDashboardKpiCard label="Valor total estimado MP" value={money(data.summary.totalEstimatedValue)} />
            <ContextualDashboardKpiCard label="Materiais únicos" value={String(data.summary.uniqueMaterials)} />
            <ContextualDashboardKpiCard label="Pedidos/propostas" value={String(data.summary.proposalCount)} />
            <ContextualDashboardKpiCard label="Produtos impactados" value={String(data.summary.productCount)} />
            <ContextualDashboardKpiCard label="Clientes impactados" value={String(data.summary.customerCount)} />
            <ContextualDashboardKpiCard
              label="Material líder"
              value={data.summary.leaderMaterial ? `${data.summary.leaderMaterial.code ? `[${data.summary.leaderMaterial.code}] ` : ""}${data.summary.leaderMaterial.description}` : "—"}
              hint={data.summary.leaderSharePct != null ? `${pct(data.summary.leaderSharePct)} da quantidade` : undefined}
              valueClassName="text-base font-semibold leading-snug sm:text-lg normal-nums"
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
              <h4 className="text-sm font-bold">Pareto por quantidade (Top 10)</h4>
              <div className="space-y-2">
                {data.charts.paretoByQuantity.slice(0, 10).map((row) => (
                  <div key={`q-${row.materialId}`} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate">{(row.code ? `[${row.code}] ` : "") + row.description}</span>
                      <span className="tabular-nums font-semibold">{num(row.quantityTotal)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-blue-600/80" style={{ width: `${maxParetoQty > 0 ? (row.quantityTotal / maxParetoQty) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
              <h4 className="text-sm font-bold">Pareto por valor (Top 10)</h4>
              <div className="space-y-2">
                {data.charts.paretoByValue.slice(0, 10).map((row) => (
                  <div key={`v-${row.materialId}`} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate">{(row.code ? `[${row.code}] ` : "") + row.description}</span>
                      <span className="tabular-nums font-semibold">{money(row.estimatedValueTotal)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-emerald-600/80" style={{ width: `${maxParetoVal > 0 ? (row.estimatedValueTotal / maxParetoVal) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
            <h4 className="text-sm font-bold">Evolução mensal estimada</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="py-2 text-left font-semibold">Período</th>
                    <th className="py-2 text-right font-semibold">Qtd estimada</th>
                    <th className="py-2 text-right font-semibold">Valor estimado</th>
                    <th className="py-2 text-right font-semibold">Pedidos/propostas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.charts.evolution.map((r) => (
                    <tr key={r.period}>
                      <td className="py-2">{periodLabel(r.period)}</td>
                      <td className="py-2 text-right tabular-nums">{num(r.quantity)}</td>
                      <td className="py-2 text-right tabular-nums">{money(r.value)}</td>
                      <td className="py-2 text-right tabular-nums">{r.proposalCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b border-border bg-accent/30">
              <h4 className="text-sm font-bold">Grid analítico de matéria-prima</h4>
              <p className="text-xs text-muted-foreground mt-1">Clique em uma linha para investigar produtos, clientes e pedidos/propostas relacionados.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-accent/10 border-b border-border">
                  <tr>
                    <th className="p-3 text-left font-semibold">Matéria-prima</th>
                    <th className="p-3 text-left font-semibold">Unid.</th>
                    <th className="p-3 text-right font-semibold">Qtd total</th>
                    <th className="p-3 text-right font-semibold">Custo unit. ref.</th>
                    <th className="p-3 text-right font-semibold">Valor total</th>
                    <th className="p-3 text-right font-semibold">Pedidos</th>
                    <th className="p-3 text-right font-semibold">Produtos</th>
                    <th className="p-3 text-right font-semibold">Últ. uso</th>
                    <th className="p-3 text-right font-semibold">% qtd</th>
                    <th className="p-3 text-right font-semibold">% valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.rows.map((row) => (
                    <React.Fragment key={row.materialId}>
                      <tr className="hover:bg-accent/10 cursor-pointer" onClick={() => setExpandedMaterialId((prev) => (prev === row.materialId ? null : row.materialId))}>
                        <td className="p-3">
                          <div className="flex items-start gap-2">
                            <ChevronDown className={`h-4 w-4 mt-0.5 shrink-0 transition-transform ${expandedMaterialId === row.materialId ? "rotate-180" : ""}`} />
                            <div className="min-w-0">
                              <p className="font-semibold break-words">{(row.code ? `[${row.code}] ` : "") + row.description}</p>
                            </div>
                          </div>
                        </td>
                        <td className="p-3">{row.unit ?? "—"}</td>
                        <td className="p-3 text-right tabular-nums">{num(row.quantityTotal)}</td>
                        <td className="p-3 text-right tabular-nums">{money(row.unitCostReference)}</td>
                        <td className="p-3 text-right tabular-nums font-semibold">{money(row.estimatedValueTotal)}</td>
                        <td className="p-3 text-right tabular-nums">{row.proposalCount}</td>
                        <td className="p-3 text-right tabular-nums">{row.productCount}</td>
                        <td className="p-3 text-right tabular-nums">{row.latestUsageAt ? new Date(row.latestUsageAt).toLocaleDateString("pt-BR") : "—"}</td>
                        <td className="p-3 text-right tabular-nums">{pct(row.pctOfTotalQuantity)}</td>
                        <td className="p-3 text-right tabular-nums">{pct(row.pctOfTotalValue)}</td>
                      </tr>
                      {expandedMaterialId === row.materialId ? (
                        <tr className="bg-accent/5">
                          <td colSpan={10} className="p-3">
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                              <div className="rounded-lg border border-border bg-background p-3">
                                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Top produtos</p>
                                <ul className="space-y-1 text-xs">
                                  {row.topProducts.slice(0, 6).map((p) => <li key={`${row.materialId}-${p.productId}`}>{(p.sku ? `[${p.sku}] ` : "") + p.name} · {money(p.value)}</li>)}
                                </ul>
                              </div>
                              <div className="rounded-lg border border-border bg-background p-3">
                                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Top clientes</p>
                                <ul className="space-y-1 text-xs">
                                  {row.topCustomers.slice(0, 6).map((c) => <li key={`${row.materialId}-${c.customerId}`}>{c.customerName} · {money(c.value)}</li>)}
                                </ul>
                              </div>
                              <div className="rounded-lg border border-border bg-background p-3">
                                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Pedidos/propostas</p>
                                <ul className="space-y-1 text-xs">
                                  {row.proposals.slice(0, 6).map((p) => <li key={`${row.materialId}-${p.proposalId}`}>#{p.proposalNumber} ({p.proposalStatus}) · {new Date(p.proposalDate).toLocaleDateString("pt-BR")} · {money(p.value)}</li>)}
                                </ul>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <ContextualDashboardEmpty message="Sem dados para o recorte atual." />
      )}
    </ContextualDashboardLayout>
  );
}

