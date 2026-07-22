import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess";

type PoListRow = {
  id: string;
  code: string;
  status: string;
  supplierDisplayNameSnapshot: string;
  totalAmountSnapshot: string | number | null;
  currency: string;
  quotationId: string | null;
  quotation?: { id: string; code: string } | null;
  futureEntryPending?: boolean;
  createdAt: string;
};

type PoDetail = PoListRow & {
  supplierDocumentSnapshot: string | null;
  paymentTermsSnapshot: string | null;
  deliveryTermsSnapshot: string | null;
  freightValueSnapshot: string | number | null;
  nonRecoverableTaxesSnapshot: string | number | null;
  discountsSnapshot: string | number | null;
  leadTimeDaysSnapshot: number | null;
  initialComparableTotalSnapshot: string | number | null;
  negotiatedComparableTotalSnapshot: string | number | null;
  totalGainSnapshot: string | number | null;
  quotationCodeSnapshot: string | null;
  awardJustificationSnapshot: string | null;
  evidenceCountSnapshot: number;
  operationalCommitmentAt: string | null;
  approvedAt: string | null;
  approvedByUserName: string | null;
  sentAt: string | null;
  confirmedAt: string | null;
  cancelReason: string | null;
  notes: string | null;
  awardId: string | null;
  items: Array<{
    id: string;
    lineNumber: number;
    description: string;
    materialCodeSnapshot: string | null;
    quantityOrdered: string | number;
    unit: string;
    initialUnitPriceSnapshot: string | number | null;
    unitPriceSnapshot: string | number;
    lineTotalSnapshot: string | number;
    lineGainSnapshot: string | number | null;
  }>;
  history: Array<{
    id: string;
    action: string;
    fromStatus: string | null;
    toStatus: string | null;
    reason: string | null;
    userName: string | null;
    createdAt: string;
  }>;
};

const STATUS_LABEL: Record<string, string> = {
  RASCUNHO: "Rascunho",
  APROVADO: "Aprovado",
  ENVIADO: "Enviado",
  EMITIDO: "Emitido",
  CONFIRMADO: "Confirmado",
  PARCIALMENTE_RECEBIDO: "Parcialmente recebido",
  RECEBIDO: "Recebido",
  CANCELADO: "Cancelado",
  ENCERRADO: "Encerrado",
};

function money(v: string | number | null | undefined, currency = "BRL"): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(n);
  } catch {
    return n.toFixed(2);
  }
}

export function PurchaseOrderModule() {
  const { orderId } = useParams<{ orderId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const permissions = usePermissions();
  const allowView =
    auth.hasPermission("purchases.view") ||
    permissions.canViewResource(OPERATIONS_RESOURCE_KEYS.purchases);
  const allowEdit =
    auth.hasPermission("purchases.edit") ||
    permissions.canPerformAction(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.update);
  const allowApprove =
    auth.hasPermission("purchases.approve") ||
    permissions.canPerformAction(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.approve);

  const [list, setList] = useState<PoListRow[]>([]);
  const [detail, setDetail] = useState<PoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const quotationFilter = searchParams.get("quotationId");

  const loadList = useCallback(async () => {
    const qs = quotationFilter ? `?quotationId=${encodeURIComponent(quotationFilter)}` : "";
    const data = await fetchJsonOk<{ rows: PoListRow[] }>(`/api/purchase-orders${qs}`);
    setList(data.rows);
  }, [quotationFilter]);

  const loadDetail = useCallback(async (id: string) => {
    const row = await fetchJsonOk<PoDetail>(`/api/purchase-orders/${id}`);
    setDetail(row);
  }, []);

  useEffect(() => {
    if (!allowView) return;
    setLoading(true);
    void (async () => {
      try {
        if (orderId) await loadDetail(orderId);
        else await loadList();
      } catch (e) {
        alert(e instanceof Error ? e.message : "Erro ao carregar pedidos.");
      } finally {
        setLoading(false);
      }
    })();
  }, [allowView, orderId, loadDetail, loadList]);

  const runAction = async (action: "approve" | "send" | "confirm" | "cancel") => {
    if (!detail) return;
    let reason: string | null = null;
    if (action === "cancel") {
      reason = window.prompt("Motivo do cancelamento (obrigatório):");
      if (!reason?.trim()) return;
    }
    setBusy(true);
    try {
      const row = await fetchJsonOk<PoDetail>(`/api/purchase-orders/${detail.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      setDetail(row);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro na ação.");
    } finally {
      setBusy(false);
    }
  };

  if (!allowView) {
    return <p className="text-sm text-muted-foreground">Sem permissão para ver pedidos de compra.</p>;
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando…
      </div>
    );
  }

  if (!orderId) {
    return (
      <div className="space-y-4" data-testid="purchase-orders-list">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="text-lg font-semibold">Pedidos de compra</h3>
            <p className="text-sm text-muted-foreground">
              Gerados a partir da cotação adjudicada. Aprovação cria compromisso operacional sem
              estoque nem Contas a Pagar.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link to="/purchases/receiving" className="text-sm text-primary hover:underline">
              Estação de recebimento
            </Link>
            <Link to="/purchases" className="text-sm text-primary hover:underline">
              Voltar às solicitações
            </Link>
          </div>
        </div>
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum pedido. Gere a partir de uma adjudicação aprovada.</p>
        ) : (
          <div className="rounded-2xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">Código</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Fornecedor</th>
                  <th className="p-3">Total</th>
                  <th className="p-3">Cotação</th>
                </tr>
              </thead>
              <tbody>
                {list.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-border/60 cursor-pointer hover:bg-muted/30"
                    onClick={() => navigate(`/purchases/orders/${row.id}`)}
                  >
                    <td className="p-3 font-mono">{row.code}</td>
                    <td className="p-3">{STATUS_LABEL[row.status] ?? row.status}</td>
                    <td className="p-3">{row.supplierDisplayNameSnapshot}</td>
                    <td className="p-3">{money(row.totalAmountSnapshot, row.currency)}</td>
                    <td className="p-3 font-mono text-xs">{row.quotation?.code ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (!detail) return null;

  return (
    <div className="space-y-6" data-testid="purchase-order-detail">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <button
            type="button"
            onClick={() => navigate("/purchases/orders")}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Lista de pedidos
          </button>
          <h3 className="text-lg font-semibold font-mono">{detail.code}</h3>
          <p className="text-sm text-muted-foreground">
            {STATUS_LABEL[detail.status] ?? detail.status}
            {detail.quotationCodeSnapshot ? ` · Cotação ${detail.quotationCodeSnapshot}` : ""}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <a
            href={`/api/purchase-orders/${detail.id}/pdf`}
            className="px-3 py-2 rounded-lg border border-border text-sm hover:bg-muted"
            target="_blank"
            rel="noreferrer"
          >
            PDF / Imprimir
          </a>
          <Link
            to={`/purchases/orders/${detail.id}/savings`}
            className="px-3 py-2 rounded-lg border border-border text-sm hover:bg-muted"
          >
            Ganho × realizado
          </Link>
          {detail.quotationId ? (
            <Link
              to={`/purchases/quotations/${detail.quotationId}/compare`}
              className="px-3 py-2 rounded-lg border border-border text-sm hover:bg-muted"
            >
              Comparação
            </Link>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs uppercase text-muted-foreground">Fornecedor</p>
          <p className="font-medium mt-1">{detail.supplierDisplayNameSnapshot}</p>
          <p className="text-xs text-muted-foreground">{detail.supplierDocumentSnapshot || "—"}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs uppercase text-muted-foreground">Total negociado</p>
          <p className="text-xl font-semibold mt-1">
            {money(detail.totalAmountSnapshot, detail.currency)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Ganho {money(detail.totalGainSnapshot, detail.currency)}
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
          <p className="text-xs uppercase text-emerald-800">Compromisso operacional</p>
          <p className="text-sm mt-1">
            {detail.operationalCommitmentAt
              ? `Ativo desde ${new Date(detail.operationalCommitmentAt).toLocaleString("pt-BR")}`
              : "Pendente de aprovação"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Entrada futura: {detail.futureEntryPending ? "pendente" : "não"} · sem estoque · sem AP
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div>Pagamento: {detail.paymentTermsSnapshot || "—"}</div>
        <div>Entrega: {detail.deliveryTermsSnapshot || "—"}</div>
        <div>Frete: {money(detail.freightValueSnapshot, detail.currency)}</div>
        <div>Impostos NR: {money(detail.nonRecoverableTaxesSnapshot, detail.currency)}</div>
        <div>Descontos: {money(detail.discountsSnapshot, detail.currency)}</div>
        <div>Prazo: {detail.leadTimeDaysSnapshot != null ? `${detail.leadTimeDaysSnapshot}d` : "—"}</div>
        <div>Evidências: {detail.evidenceCountSnapshot}</div>
        <div className="md:col-span-2">
          Justificativa: {detail.awardJustificationSnapshot || "—"}
        </div>
      </div>

      <div className="rounded-2xl border border-border overflow-x-auto">
        <table className="w-full text-sm min-w-[800px]">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-2">#</th>
              <th className="p-2">Item / MP</th>
              <th className="p-2">Qtd</th>
              <th className="p-2">Preço inicial</th>
              <th className="p-2">Preço negociado</th>
              <th className="p-2">Total</th>
              <th className="p-2">Ganho</th>
            </tr>
          </thead>
          <tbody>
            {detail.items.map((it) => (
              <tr key={it.id} className="border-t border-border/60">
                <td className="p-2">{it.lineNumber}</td>
                <td className="p-2">
                  {it.materialCodeSnapshot ? (
                    <span className="font-mono text-xs mr-1">{it.materialCodeSnapshot}</span>
                  ) : null}
                  {it.description}
                </td>
                <td className="p-2">
                  {Number(it.quantityOrdered)} {it.unit}
                </td>
                <td className="p-2">{money(it.initialUnitPriceSnapshot, detail.currency)}</td>
                <td className="p-2">{money(it.unitPriceSnapshot, detail.currency)}</td>
                <td className="p-2">{money(it.lineTotalSnapshot, detail.currency)}</td>
                <td className="p-2">{money(it.lineGainSnapshot, detail.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 flex-wrap">
        {allowApprove && detail.status === "RASCUNHO" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void runAction("approve")}
            className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm disabled:opacity-50"
          >
            Aprovar (compromisso)
          </button>
        ) : null}
        {allowEdit && (detail.status === "APROVADO" || detail.status === "EMITIDO") ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void runAction("send")}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm disabled:opacity-50"
          >
            Marcar enviado
          </button>
        ) : null}
        {allowEdit &&
        (detail.status === "ENVIADO" ||
          detail.status === "EMITIDO" ||
          detail.status === "APROVADO") ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void runAction("confirm")}
            className="px-4 py-2 rounded-lg border border-border text-sm disabled:opacity-50"
          >
            Confirmar fornecedor
          </button>
        ) : null}
        {allowEdit &&
        ["RASCUNHO", "APROVADO", "ENVIADO", "EMITIDO"].includes(detail.status) ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void runAction("cancel")}
            className="px-4 py-2 rounded-lg border border-red-200 text-red-800 text-sm disabled:opacity-50"
          >
            Cancelar
          </button>
        ) : null}
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
        <h4 className="text-xs font-bold uppercase text-muted-foreground">Histórico</h4>
        {detail.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem eventos.</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {detail.history.map((h) => (
              <li key={h.id} className="border-l-2 border-border pl-3">
                <div>
                  {new Date(h.createdAt).toLocaleString("pt-BR")} · {h.action}
                  {h.fromStatus || h.toStatus
                    ? ` (${h.fromStatus ?? "—"} → ${h.toStatus ?? "—"})`
                    : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  {h.userName || "—"}
                  {h.reason ? ` — ${h.reason}` : ""}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
