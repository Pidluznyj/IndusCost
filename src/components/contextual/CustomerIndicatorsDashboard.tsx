import React, { useCallback, useEffect, useMemo, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn, formatNumber } from "@/src/lib/utils";
import type { CustomerIndicatorsResponse } from "@/src/lib/customerIndicators";
import { ContextualDashboardLayout } from "./ContextualDashboardLayout";
import { ContextualDashboardKpiCard } from "./ContextualDashboardKpiCard";
import { ContextualDashboardEmpty } from "./ContextualDashboardEmpty";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Loader2, X } from "lucide-react";

type ChartRow = { key: string; label: string; count: number };

type DrilldownCustomer = {
  id: string;
  companyName: string;
  tradeName: string | null;
  taxId: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  status: string;
};

export function CustomerIndicatorsDashboard() {
  const [data, setData] = useState<CustomerIndicatorsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedBucketKey, setSelectedBucketKey] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [drilldown, setDrilldown] = useState<DrilldownCustomer[] | null>(null);
  const [drilldownError, setDrilldownError] = useState<string | null>(null);
  const [drilldownLoading, setDrilldownLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchJsonOk<CustomerIndicatorsResponse>("/api/customers/indicators");
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setData(null);
          setError(e instanceof Error ? e.message : "Erro ao carregar indicadores de clientes.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const chartRows: ChartRow[] = useMemo(
    () => (data?.byState ?? []).map((r) => ({ key: r.key, label: r.label, count: r.count })),
    [data]
  );

  const loadDrilldown = useCallback(async (bucketKey: string) => {
    setDrilldownLoading(true);
    setDrilldownError(null);
    setDrilldown(null);
    try {
      const qs = new URLSearchParams({ bucket: bucketKey });
      const res = await fetchJsonOk<{ bucket: string; customers: DrilldownCustomer[] }>(
        `/api/customers/indicators/drilldown?${qs.toString()}`
      );
      setDrilldown(Array.isArray(res.customers) ? res.customers : []);
    } catch (e) {
      setDrilldown(null);
      setDrilldownError(e instanceof Error ? e.message : "Erro ao carregar clientes.");
    } finally {
      setDrilldownLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedBucketKey) {
      setDrilldown(null);
      setDrilldownError(null);
      return;
    }
    void loadDrilldown(selectedBucketKey);
  }, [selectedBucketKey, loadDrilldown]);

  const selectBucket = useCallback((row: ChartRow) => {
    setSelectedBucketKey(row.key);
    setSelectedLabel(row.label);
  }, []);

  const clearDrilldown = useCallback(() => {
    setSelectedBucketKey(null);
    setSelectedLabel(null);
    setDrilldown(null);
    setDrilldownError(null);
  }, []);

  if (loading) {
    return (
      <ContextualDashboardLayout moduleLabel="Clientes — indicadores" backPath="/customers">
        <p className="text-sm text-muted-foreground">Carregando...</p>
      </ContextualDashboardLayout>
    );
  }

  if (error) {
    return (
      <ContextualDashboardLayout moduleLabel="Clientes — indicadores" backPath="/customers">
        <p className="text-sm text-destructive">{error}</p>
      </ContextualDashboardLayout>
    );
  }

  if (!data || data.summary.totalCustomers === 0) {
    return (
      <ContextualDashboardLayout moduleLabel="Clientes — indicadores" backPath="/customers">
        <ContextualDashboardEmpty message="Não há clientes cadastrados. Os indicadores aparecerão quando houver dados." />
      </ContextualDashboardLayout>
    );
  }

  const s = data.summary;

  return (
    <ContextualDashboardLayout moduleLabel="Clientes — indicadores" backPath="/customers">
      <div className="space-y-2">
        <h3 className="text-lg font-bold tracking-tight">Carteira e geografia</h3>
        <p className="text-sm text-muted-foreground">
          {data.semantics.label}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ContextualDashboardKpiCard label="Clientes cadastrados" value={String(s.totalCustomers)} />
        <ContextualDashboardKpiCard label="Ativos" value={String(s.activeCount)} />
        <ContextualDashboardKpiCard label="Inativos" value={String(s.inactiveCount)} />
        <ContextualDashboardKpiCard
          label="Com ao menos uma proposta"
          value={String(s.withProposalCount)}
          hint="Contagem de clientes com vínculo em proposta."
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ContextualDashboardKpiCard label="Sem UF preenchido" value={String(s.withoutStateCount)} />
        <ContextualDashboardKpiCard label="Com e-mail" value={String(s.withEmailCount)} />
        <ContextualDashboardKpiCard label="Com telefone" value={String(s.withPhoneCount)} />
        <ContextualDashboardKpiCard label="Novos (últimos 30 dias)" value={String(s.newLast30Days)} />
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
              Clientes por UF (cadastro)
            </h4>
            <p className="text-xs text-muted-foreground mt-1">
              Ordenado por quantidade (maior primeiro). Clique em uma barra para ver a lista de clientes daquele
              agrupamento.
            </p>
          </div>
        </div>
        {chartRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem dados para exibir.</p>
        ) : (
          <div className="h-[min(420px,60vh)] w-full [&_.recharts-bar-rectangle]:cursor-pointer">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={chartRows} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="label" width={100} tick={{ fontSize: 10 }} interval={0} />
                <Tooltip
                  formatter={(v: number) => [formatNumber(v, 0), "Clientes"]}
                  contentStyle={{ borderRadius: "8px", fontSize: "12px" }}
                />
                <Bar
                  dataKey="count"
                  name="Clientes"
                  fill="hsl(var(--primary))"
                  radius={[0, 4, 4, 0]}
                  maxBarSize={28}
                  onClick={(props: { payload?: ChartRow } & Partial<ChartRow>) => {
                    const row = props.payload ?? (props.key != null ? (props as ChartRow) : null);
                    if (row?.key) selectBucket(row);
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {selectedBucketKey != null ? (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-accent/30 px-5 py-3">
            <div>
              <h4 className="text-sm font-bold">Clientes no agrupamento</h4>
              <p className="text-xs text-muted-foreground">
                {selectedLabel ?? selectedBucketKey}
                {drilldown != null ? ` · ${drilldown.length} registro(s)` : null}
              </p>
            </div>
            <button
              type="button"
              onClick={clearDrilldown}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-accent"
            >
              <X className="h-4 w-4" />
              Fechar lista
            </button>
          </div>
          <div className="overflow-x-auto">
            {drilldownLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground text-sm">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                Carregando clientes…
              </div>
            ) : drilldownError ? (
              <p className="p-5 text-sm text-destructive">{drilldownError}</p>
            ) : drilldown && drilldown.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">Nenhum cliente neste agrupamento.</p>
            ) : drilldown && drilldown.length > 0 ? (
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border bg-accent/20">
                    <th className="p-3 font-semibold">Cliente</th>
                    <th className="p-3 font-semibold">CNPJ</th>
                    <th className="p-3 font-semibold">Cidade / UF</th>
                    <th className="p-3 font-semibold">E-mail</th>
                    <th className="p-3 font-semibold">Telefone</th>
                    <th className="p-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {drilldown.map((c) => (
                    <tr key={c.id} className="hover:bg-accent/20">
                      <td className="p-3 align-top">
                        <p className="font-medium">{c.companyName}</p>
                        <p className="text-xs text-muted-foreground">{c.tradeName ?? "—"}</p>
                      </td>
                      <td className="p-3 align-top font-mono text-xs">{c.taxId}</td>
                      <td className="p-3 align-top text-xs">
                        {[c.city, c.state].filter(Boolean).join(" - ") || "—"}
                      </td>
                      <td className="p-3 align-top text-xs break-all">{c.email ?? "—"}</td>
                      <td className="p-3 align-top text-xs whitespace-nowrap">{c.phone ?? "—"}</td>
                      <td className="p-3 align-top">
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                            c.status === "ACTIVE" ? "bg-green-500/15 text-green-700" : "bg-red-500/15 text-red-700"
                          )}
                        >
                          {c.status === "ACTIVE" ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Segmentos (top)</h4>
        <ul className="divide-y divide-border text-sm">
          {data.topSegments.map((t) => (
            <li key={t.segment} className="flex justify-between gap-4 py-2">
              <span className="min-w-0 break-words">{t.segment}</span>
              <span className="shrink-0 font-semibold tabular-nums">{t.count}</span>
            </li>
          ))}
        </ul>
      </div>
    </ContextualDashboardLayout>
  );
}
