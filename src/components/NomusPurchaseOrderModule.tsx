import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, RefreshCw, Search } from "lucide-react";
import { formatCurrency } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { PurchaseChainViewNav } from "@/src/components/supply-chain/PurchaseChainViewNav";
import { OverlayBadge } from "@/src/components/ui/overlay";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  formatNomusPurchaseOrderProgress,
  nomusPurchaseOrderStageLabel,
  nomusPurchaseOrderStageTone,
} from "@/src/lib/nomus/nomusPurchaseOrderUi";

type ListItem = {
  id: string;
  externalId: number;
  orderNumber: string | null;
  supplierName: string | null;
  supplierTaxId: string | null;
  statusRaw: string | null;
  stage: string;
  issuedAt: string | null;
  expectedAt: string | null;
  totalAmount: number | null;
  itemCount: number;
  orderedQuantity: number | null;
  receivedQuantity: number | null;
  overdue: boolean;
  syncedAt: string;
};

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
  items: ListItem[];
};

type DetailResponse = ListItem & {
  paymentTerms: string | null;
  comments: string | null;
  currency: string | null;
  discountAmount: number | null;
  freightAmount: number | null;
  createdAtNomus: string | null;
  modifiedAtNomus: string | null;
  firstSeenAt: string;
  payloadHash: string;
  receivingAvailable: boolean;
  rawPayload?: unknown;
  items: Array<{
    id: string;
    productCode: string | null;
    description: string | null;
    unit: string | null;
    orderedQuantity: number | null;
    receivedQuantity: number | null;
    remainingQuantity: number | null;
    unitPrice: number | null;
    totalAmount: number | null;
  }>;
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR");
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR");
}

const STAGE_OPTIONS = [
  { value: "", label: "Todas as fases" },
  { value: "OPEN", label: "Aberto" },
  { value: "APPROVED", label: "Aprovado" },
  { value: "PARTIALLY_RECEIVED", label: "Parcial" },
  { value: "RECEIVED", label: "Recebido" },
  { value: "CANCELED", label: "Cancelado" },
  { value: "UNKNOWN", label: "Não classificado" },
];

export function NomusPurchaseOrderModule() {
  const { orderId } = useParams();
  if (orderId) return <NomusPurchaseOrderDetail id={orderId} />;
  return <NomusPurchaseOrderList />;
}

function NomusPurchaseOrderList() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [openOnly, setOpenOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ListResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (stage) params.set("stage", stage);
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
  }, [q, stage, openOnly, overdueOnly, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 25))),
    [data]
  );

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
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Pedido</th>
                <th className="px-3 py-2">Fornecedor</th>
                <th className="px-3 py-2">Emissão</th>
                <th className="px-3 py-2">Previsão</th>
                <th className="px-3 py-2">Fase</th>
                <th className="px-3 py-2">Status Nomus</th>
                <th className="px-3 py-2">Valor</th>
                <th className="px-3 py-2">Itens</th>
                <th className="px-3 py-2">Recebimento</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-t border-border hover:bg-muted/40"
                  onClick={() => navigate(`/purchases/nomus-orders/${row.id}`)}
                >
                  <td className="px-3 py-2 font-medium">{row.orderNumber ?? row.externalId}</td>
                  <td className="px-3 py-2">{row.supplierName ?? "—"}</td>
                  <td className="px-3 py-2">{formatDate(row.issuedAt)}</td>
                  <td className="px-3 py-2">
                    {formatDate(row.expectedAt)}
                    {row.overdue ? (
                      <OverlayBadge tone="rose" className="ml-2">
                        Atrasado
                      </OverlayBadge>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <OverlayBadge tone={nomusPurchaseOrderStageTone(row.stage)}>
                      {nomusPurchaseOrderStageLabel(row.stage)}
                    </OverlayBadge>
                  </td>
                  <td className="px-3 py-2">{row.statusRaw ?? "—"}</td>
                  <td className="px-3 py-2">{row.totalAmount == null ? "—" : formatCurrency(row.totalAmount)}</td>
                  <td className="px-3 py-2">{row.itemCount}</td>
                  <td className="px-3 py-2">
                    {formatNomusPurchaseOrderProgress(row)}
                  </td>
                </tr>
              ))}
              {(data?.items ?? []).length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-muted-foreground" colSpan={9}>
                    Nenhum pedido Nomus sincronizado.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

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
    </div>
  );
}

function NomusPurchaseOrderDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canSeeRaw = hasPermission("settings.nomus.view") || hasPermission("settings.view");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [row, setRow] = useState<DetailResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = canSeeRaw ? "?includeRaw=1" : "";
    fetchJsonOk<DetailResponse>(`/api/nomus/purchase-orders/${id}${qs}`)
      .then((json) => {
        if (!cancelled) setRow(json);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Pedido não encontrado.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, canSeeRaw]);

  return (
    <div className="space-y-4" data-testid="nomus-purchase-order-detail">
      <PurchaseChainViewNav current="nomus-orders" />
      <button
        type="button"
        onClick={() => navigate("/purchases/nomus-orders")}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Voltar à listagem Nomus
      </button>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando pedido…
        </p>
      ) : null}
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      {row ? (
        <>
          <div className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{row.orderNumber ?? `#${row.externalId}`}</h2>
              <OverlayBadge tone={nomusPurchaseOrderStageTone(row.stage)}>
                {nomusPurchaseOrderStageLabel(row.stage)}
              </OverlayBadge>
              {row.overdue ? <OverlayBadge tone="rose">Atrasado</OverlayBadge> : null}
            </div>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
              <Field label="Fornecedor" value={row.supplierName ?? "—"} />
              <Field label="CNPJ/CPF" value={row.supplierTaxId ?? "—"} />
              <Field label="Status Nomus" value={row.statusRaw ?? "—"} />
              <Field label="Emissão" value={formatDate(row.issuedAt)} />
              <Field label="Previsão" value={formatDate(row.expectedAt)} />
              <Field label="Valor" value={row.totalAmount == null ? "—" : formatCurrency(row.totalAmount)} />
              <Field label="Condição" value={row.paymentTerms ?? "—"} />
              <Field label="Última sync" value={formatDateTime(row.syncedAt)} />
            </dl>
            {row.comments ? <p className="mt-3 text-sm text-muted-foreground">{row.comments}</p> : null}
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Produto</th>
                  <th className="px-3 py-2">Qtd pedida</th>
                  <th className="px-3 py-2">Qtd recebida</th>
                  <th className="px-3 py-2">Saldo</th>
                  <th className="px-3 py-2">Preço</th>
                  <th className="px-3 py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {row.items.map((item) => (
                  <tr key={item.id} className="border-t border-border">
                    <td className="px-3 py-2">{item.productCode ?? "—"}</td>
                    <td className="px-3 py-2">{item.description ?? "—"}</td>
                    <td className="px-3 py-2">{item.orderedQuantity ?? "—"}</td>
                    <td className="px-3 py-2">{item.receivedQuantity ?? "—"}</td>
                    <td className="px-3 py-2">{item.remainingQuantity ?? "—"}</td>
                    <td className="px-3 py-2">{item.unitPrice == null ? "—" : formatCurrency(item.unitPrice)}</td>
                    <td className="px-3 py-2">{item.totalAmount == null ? "—" : formatCurrency(item.totalAmount)}</td>
                  </tr>
                ))}
                {row.items.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-muted-foreground" colSpan={7}>
                      {row.receivingAvailable
                        ? "Sem linhas neste pedido."
                        : "Informação de recebimento indisponível."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {canSeeRaw && row.rawPayload != null ? (
            <details className="rounded-lg border border-dashed border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">Dados técnicos / Payload Nomus</summary>
              <pre className="mt-2 max-h-80 overflow-auto text-xs">{JSON.stringify(row.rawPayload, null, 2)}</pre>
            </details>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-white p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
