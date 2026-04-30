import React, { useEffect, useMemo, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatCurrency, formatNumber } from "@/src/lib/utils";
import { ContextualDashboardLayout } from "./ContextualDashboardLayout";
import { ContextualDashboardKpiCard } from "./ContextualDashboardKpiCard";
import { ContextualDashboardEmpty } from "./ContextualDashboardEmpty";
import { cn } from "@/src/lib/utils";

type SalesOrderRow = {
  id: string;
  status: string;
  totalItems: number;
  totalNetValue: unknown;
  totalMarginPerc: unknown;
};

type SalesOrderListResponse = {
  data: SalesOrderRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Rascunho",
  READY_TO_SEND: "Pronto para envio",
  SENT_TO_NOMUS: "Enviado ao Nomus",
  CANCELLED: "Cancelado",
  ERROR: "Erro",
};

const STATUS_ORDER = ["DRAFT", "READY_TO_SEND", "SENT_TO_NOMUS", "CANCELLED", "ERROR"] as const;
const BAR_TONE = ["bg-slate-700", "bg-slate-600", "bg-slate-500", "bg-slate-400", "bg-slate-300"];

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function fetchAllSalesOrders(): Promise<SalesOrderRow[]> {
  const rows: SalesOrderRow[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const data = await fetchJsonOk<SalesOrderListResponse>(`/api/sales-orders?page=${page}&pageSize=100`);
    rows.push(...(Array.isArray(data.data) ? data.data : []));
    totalPages = Math.max(1, Number(data.totalPages) || 1);
    page += 1;
  } while (page <= totalPages);
  return rows;
}

export function SalesOrdersIndicatorsDashboard() {
  const [rows, setRows] = useState<SalesOrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchAllSalesOrders();
        if (!cancelled) setRows(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erro ao carregar pedidos de venda.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const metrics = useMemo(() => {
    if (!rows) return null;
    const total = rows.length;
    const totalNet = rows.reduce((acc, r) => acc + safeNum(r.totalNetValue), 0);
    const totalItems = rows.reduce((acc, r) => acc + (Number.isFinite(Number(r.totalItems)) ? Number(r.totalItems) : 0), 0);
    const avgTicket = total > 0 ? totalNet / total : 0;
    const withMargin = rows.filter((r) => Number.isFinite(Number(r.totalMarginPerc)));
    const avgMarginPerc =
      withMargin.length > 0 ? withMargin.reduce((acc, r) => acc + safeNum(r.totalMarginPerc), 0) / withMargin.length : 0;
    return { total, totalNet, totalItems, avgTicket, avgMarginPerc };
  }, [rows]);

  const byStatus = useMemo(() => {
    if (!rows) return [];
    const total = Math.max(1, rows.length);
    return STATUS_ORDER.map((status) => {
      const list = rows.filter((r) => r.status === status);
      const count = list.length;
      const value = list.reduce((acc, r) => acc + safeNum(r.totalNetValue), 0);
      return { status, count, pct: (count / total) * 100, value };
    });
  }, [rows]);

  if (error) {
    return (
      <ContextualDashboardLayout moduleLabel="Pedidos de venda — indicadores" backPath="/sales-orders">
        <p className="text-sm text-destructive">{error}</p>
      </ContextualDashboardLayout>
    );
  }

  if (rows === null) {
    return (
      <ContextualDashboardLayout moduleLabel="Pedidos de venda — indicadores" backPath="/sales-orders">
        <p className="text-sm text-muted-foreground">Carregando...</p>
      </ContextualDashboardLayout>
    );
  }

  if (rows.length === 0) {
    return (
      <ContextualDashboardLayout moduleLabel="Pedidos de venda — indicadores" backPath="/sales-orders">
        <ContextualDashboardEmpty message="Não há pedidos de venda registrados para consolidar indicadores." />
      </ContextualDashboardLayout>
    );
  }

  return (
    <ContextualDashboardLayout moduleLabel="Pedidos de venda — indicadores" backPath="/sales-orders">
      <div>
        <h3 className="text-lg font-bold tracking-tight">Dashboard executivo de pedidos de venda</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Visão consolidada dos pedidos internos com foco em volume, valor líquido e qualidade de margem.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <ContextualDashboardKpiCard label="Pedidos" value={String(metrics!.total)} />
        <ContextualDashboardKpiCard label="Itens totais" value={formatNumber(metrics!.totalItems, 0)} />
        <ContextualDashboardKpiCard label="Valor líquido total" value={formatCurrency(metrics!.totalNet)} />
        <ContextualDashboardKpiCard label="Ticket médio" value={formatCurrency(metrics!.avgTicket)} />
        <ContextualDashboardKpiCard label="Margem média (%)" value={`${formatNumber(metrics!.avgMarginPerc, 2)}%`} />
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
        <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Distribuição por status</h4>
        <div className="space-y-3">
          {byStatus.map((row, i) => (
            <div key={row.status} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span>{STATUS_LABELS[row.status] ?? row.status}</span>
                <span className="font-semibold tabular-nums">
                  {row.count} ({formatNumber(row.pct, 1)}%) · {formatCurrency(row.value)}
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn("h-full rounded-full print:bg-slate-600", BAR_TONE[i % BAR_TONE.length])}
                  style={{ width: `${Math.min(100, row.pct)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </ContextualDashboardLayout>
  );
}
