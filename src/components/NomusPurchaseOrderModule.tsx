import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { formatCurrency } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { PurchaseChainViewNav } from "@/src/components/supply-chain/PurchaseChainViewNav";
import { NomusPurchaseOrderListTable } from "@/src/components/purchases/NomusPurchaseOrderListTable";
import type { NomusPurchaseOrderListRowDto } from "@/src/lib/nomus/nomusPurchaseOrder360";

const NomusPurchaseOrderDetailDialog = React.lazy(() =>
  import("@/src/components/purchases/NomusPurchaseOrderDetailDialog").then((mod) => ({
    default: mod.NomusPurchaseOrderDetailDialog,
  }))
);

type ListResponse = {
  page: number;
  pageSize: number;
  total: number;
  lastSyncedAt: string | null;
  kpis: {
    openCount: number;
    openAmount: number;
    overdueCount: number;
    partialCount: number;
    expectedNext7Days: number;
    expectedNext30Days: number;
  };
  items: NomusPurchaseOrderListRowDto[];
};

const STAGE_OPTIONS = [
  { value: "", label: "Todas as fases" },
  { value: "OPEN", label: "Aberto" },
  { value: "APPROVED", label: "Aprovado / Liberado" },
  { value: "PARTIALLY_RECEIVED", label: "Parcial" },
  { value: "RECEIVED", label: "Recebido" },
  { value: "CANCELED", label: "Cancelado" },
  { value: "UNKNOWN", label: "Não classificado" },
];

const FISCAL_OPTIONS = [
  { value: "", label: "Situação fiscal" },
  { value: "WITHOUT_NFE", label: "Sem NF" },
  { value: "WITH_NFE", label: "Com NF" },
];

const FINANCIAL_OPTIONS = [
  { value: "", label: "Situação financeira" },
  { value: "PLANNED_ONLY", label: "Somente planejado" },
  { value: "CONFIRMED", label: "Confirmado" },
  { value: "PARTIALLY_PAID", label: "Parcial pago" },
  { value: "PAID", label: "Pago" },
  { value: "NO_FINANCIAL_DATA", label: "Sem vínculo" },
];

export function NomusPurchaseOrderModule() {
  const { orderId } = useParams();
  return <NomusPurchaseOrderList initialDetailId={orderId ?? null} />;
}

function NomusPurchaseOrderList({ initialDetailId }: { initialDetailId: string | null }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [fiscalStatus, setFiscalStatus] = useState("");
  const [financialStatus, setFinancialStatus] = useState("");
  const [openOnly, setOpenOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ListResponse | null>(null);
  const [detailId, setDetailId] = useState<string | null>(initialDetailId);

  useEffect(() => {
    setDetailId(initialDetailId);
  }, [initialDetailId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (stage) params.set("stage", stage);
    if (fiscalStatus) params.set("fiscalStatus", fiscalStatus);
    if (financialStatus) params.set("financialStatus", financialStatus);
    if (openOnly) params.set("openOnly", "1");
    if (overdueOnly) params.set("overdueOnly", "1");
    params.set("page", String(page));
    params.set("pageSize", "25");
    try {
      const json = await fetchJsonOk<ListResponse>(`/api/nomus/purchase-orders?${params}`);
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar pedidos Nomus.");
    } finally {
      setLoading(false);
    }
  }, [q, stage, fiscalStatus, financialStatus, openOnly, overdueOnly, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 25))),
    [data]
  );

  const selectedRow = data?.items.find((row) => row.id === detailId) ?? null;

  const openDetail = useCallback((id: string) => {
    setDetailId(id);
  }, []);

  const closeDetail = useCallback(() => {
    setDetailId(null);
    if (initialDetailId) navigate("/purchases/nomus-orders");
  }, [initialDetailId, navigate]);

  return (
    <div className="space-y-4" data-testid="nomus-purchase-order-list">
      <PurchaseChainViewNav current="nomus-orders" />
      <p className="text-sm text-muted-foreground">
        Espelho somente leitura dos pedidos oficiais do Nomus. Não edita o ERP e não se mistura com
        a solicitação de compra interna.
      </p>

      {data?.kpis ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Kpi label="Pedidos abertos" value={String(data.kpis.openCount)} />
          <Kpi label="Valor aberto" value={formatCurrency(data.kpis.openAmount)} />
          <Kpi label="Atrasados" value={String(data.kpis.overdueCount)} />
          <Kpi label="Parciais" value={String(data.kpis.partialCount)} />
          <Kpi
            label="Previsão 7 / 30 dias"
            value={`${data.kpis.expectedNext7Days} / ${data.kpis.expectedNext30Days}`}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/30 p-3">
        <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Busca
          <span className="relative">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4" />
            <input
              value={q}
              onChange={(e) => {
                setPage(1);
                setQ(e.target.value);
              }}
              className="w-full rounded-md border border-border bg-white py-2 pl-8 pr-3 text-sm text-foreground"
              placeholder="Pedido, fornecedor, produto…"
            />
          </span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Fase
          <select
            value={stage}
            onChange={(e) => {
              setPage(1);
              setStage(e.target.value);
            }}
            className="rounded-md border border-border bg-white px-3 py-2 text-sm text-foreground"
          >
            {STAGE_OPTIONS.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Fiscal
          <select
            value={fiscalStatus}
            onChange={(e) => {
              setPage(1);
              setFiscalStatus(e.target.value);
            }}
            className="rounded-md border border-border bg-white px-3 py-2 text-sm text-foreground"
          >
            {FISCAL_OPTIONS.map((option) => (
              <option key={option.value || "fiscal-all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Financeiro
          <select
            value={financialStatus}
            onChange={(e) => {
              setPage(1);
              setFinancialStatus(e.target.value);
            }}
            className="rounded-md border border-border bg-white px-3 py-2 text-sm text-foreground"
          >
            {FINANCIAL_OPTIONS.map((option) => (
              <option key={option.value || "fin-all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={openOnly} onChange={(e) => { setPage(1); setOpenOnly(e.target.checked); }} />
          Somente abertos
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => { setPage(1); setOverdueOnly(e.target.checked); }} />
          Somente atrasados
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-3 py-2 text-sm"
        >
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        Última sincronização: {formatDateTime(data?.lastSyncedAt ?? null)} · {data?.total ?? 0} pedido(s)
      </p>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      <NomusPurchaseOrderListTable
        rows={data?.items ?? []}
        loading={loading}
        selectedOrderId={detailId}
        onOpenDetail={openDetail}
      />

      <div className="flex items-center gap-2 text-sm">
        <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded border px-2 py-1 disabled:opacity-50">
          Anterior
        </button>
        <span>
          Página {page} de {totalPages}
        </span>
        <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded border px-2 py-1 disabled:opacity-50">
          Próxima
        </button>
      </div>

      <React.Suspense fallback={null}>
        <NomusPurchaseOrderDetailDialog
          open={Boolean(detailId)}
          orderId={detailId}
          orderCode={selectedRow?.orderNumber ?? null}
          onClose={closeDetail}
        />
      </React.Suspense>
    </div>
  );
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR");
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-white p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
