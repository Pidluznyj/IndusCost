import React, { useEffect, useMemo, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatNumber } from "@/src/lib/utils";
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

export function CustomerIndicatorsDashboard() {
  const [data, setData] = useState<CustomerIndicatorsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  const chartRows = useMemo(
    () => (data?.byState ?? []).map((r) => ({ label: r.label, count: r.count })),
    [data]
  );

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
        <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Clientes por UF (cadastro)
        </h4>
        <p className="text-xs text-muted-foreground">
          Estados normalizados para sigla quando o texto corresponde a UF ou nome completo; demais textos entram em
          &quot;Outros&quot;.
        </p>
        {chartRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem dados para exibir.</p>
        ) : (
          <div className="h-[min(420px,60vh)] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={chartRows}
                margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
              >
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
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

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
