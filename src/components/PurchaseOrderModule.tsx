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
import { PurchaseOrderSupplierEvaluationCard } from "@/src/components/supply-chain/supplier-performance/PurchaseOrderSupplierEvaluationCard";
import { OverlayBadge, OverlaySection } from "@/src/components/ui/overlay";
import { PurchaseChainTrail } from "@/src/components/supply-chain/flow/PurchaseChainTrail";
import { PurchaseChainViewNav } from "@/src/components/supply-chain/PurchaseChainViewNav";
import { useSupplyChainFeatureFlags } from "@/src/lib/supply-chain/supplyChainClient";
import {
  resolvePurchaseOrderGuidance,
  stageForPurchaseOrderStatus,
} from "@/src/lib/purchasing/purchaseChainGuidance";
import {
  purchaseOrderHistoryActionLabel,
  purchaseOrderStatusLabel,
  purchaseOrderStatusTone,
} from "@/src/lib/purchasing/purchaseOrderUi";
import type { PurchaseOrderStatusName } from "@/src/lib/purchasing/purchaseOrderWorkflow";

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

/** Campo somente-leitura no padrão do repositório (dl/dt/dd). */
function Term({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string | null | undefined;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2 lg:col-span-4" : undefined}>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm font-medium text-foreground">{value || "—"}</dd>
    </div>
  );
}

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

  // Fail-closed enquanto carrega: null nunca vira "ligado".
  const flags = useSupplyChainFeatureFlags();

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

  const runAction = async (
    action: "approve" | "send" | "confirm" | "cancel" | "close",
    requiresReason = false
  ) => {
    if (!detail) return;
    let reason: string | null = null;
    if (action === "cancel" || requiresReason) {
      reason = window.prompt(
        action === "cancel"
          ? "Motivo do cancelamento (obrigatório):"
          : "Motivo do encerramento com saldo pendente (obrigatório):"
      );
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
        <PurchaseChainViewNav current="orders" variant="nomus" />
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
                    <td className="p-3">
                      <OverlayBadge tone={purchaseOrderStatusTone(row.status)} variant="soft">
                        {purchaseOrderStatusLabel(row.status)}
                      </OverlayBadge>
                    </td>
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

  // A orientação é derivada: status + flags + permissões deste usuário.
  const guidance = resolvePurchaseOrderGuidance({
    status: detail.status as PurchaseOrderStatusName,
    flags: {
      receiving: flags?.receiving === true,
      supplierPerformance: flags?.supplierPerformance === true,
    },
    permissions: { canUpdate: allowEdit, canApprove: allowApprove },
  });

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
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold font-mono">{detail.code}</h3>
            <OverlayBadge tone={purchaseOrderStatusTone(detail.status)} emphasized>
              {purchaseOrderStatusLabel(detail.status)}
            </OverlayBadge>
          </div>
          <p className="text-sm text-muted-foreground">
            {detail.supplierDisplayNameSnapshot}
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

      <OverlaySection title="Fase do pedido" testId="purchase-order-phase">
        <PurchaseChainTrail
          currentStage={stageForPurchaseOrderStatus(detail.status as PurchaseOrderStatusName)}
          terminalLabel={
            detail.status === "CANCELADO" || detail.status === "ENCERRADO"
              ? purchaseOrderStatusLabel(detail.status)
              : null
          }
          guidance={guidance}
          busy={busy}
          onAction={(g) => void runAction(g.action!.endpoint, g.action!.requiresReason)}
        />
      </OverlaySection>

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
            {detail.futureEntryPending
              ? "Material ainda não recebido. Aprovar não movimenta estoque nem gera Contas a Pagar."
              : "Sem entrada pendente."}
          </p>
        </div>
      </div>

      <OverlaySection title="Condições comerciais" testId="purchase-order-terms">
        <dl className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Term label="Pagamento" value={detail.paymentTermsSnapshot} />
          <Term label="Entrega" value={detail.deliveryTermsSnapshot} />
          <Term label="Frete" value={money(detail.freightValueSnapshot, detail.currency)} />
          <Term
            label="Impostos não recuperáveis"
            value={money(detail.nonRecoverableTaxesSnapshot, detail.currency)}
          />
          <Term label="Descontos" value={money(detail.discountsSnapshot, detail.currency)} />
          <Term
            label="Prazo de entrega"
            value={detail.leadTimeDaysSnapshot != null ? `${detail.leadTimeDaysSnapshot} dias` : null}
          />
          <Term label="Evidências anexadas" value={String(detail.evidenceCountSnapshot)} />
          <Term label="Aprovado por" value={detail.approvedByUserName} />
          <Term
            label="Justificativa da escolha"
            value={detail.awardJustificationSnapshot}
            wide
          />
          {detail.notes ? <Term label="Observações" value={detail.notes} wide /> : null}
          {detail.cancelReason ? (
            <Term label="Motivo do cancelamento" value={detail.cancelReason} wide />
          ) : null}
        </dl>
      </OverlaySection>

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
          <tfoot className="border-t border-border bg-muted/30 font-semibold">
            <tr>
              <td className="p-2" colSpan={5}>
                Total do pedido
              </td>
              <td className="p-2">{money(detail.totalAmountSnapshot, detail.currency)}</td>
              <td className="p-2">{money(detail.totalGainSnapshot, detail.currency)}</td>
            </tr>
          </tfoot>
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
        {allowEdit && detail.status === "APROVADO" ? (
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
        (detail.status === "ENVIADO" || detail.status === "APROVADO") ? (
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
        ["RASCUNHO", "APROVADO", "ENVIADO"].includes(detail.status) ? (
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

      <PurchaseOrderSupplierEvaluationCard
        purchaseOrderId={detail.id}
        purchaseOrderCode={detail.code}
        supplierName={detail.supplierDisplayNameSnapshot}
        canEvaluate={allowEdit}
      />

      <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
        <h4 className="text-xs font-bold uppercase text-muted-foreground">Histórico</h4>
        {detail.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem eventos.</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {detail.history.map((h) => (
              <li key={h.id} className="border-l-2 border-border pl-3">
                <div>
                  {new Date(h.createdAt).toLocaleString("pt-BR")} ·{" "}
                  {purchaseOrderHistoryActionLabel(h.action)}
                  {h.fromStatus || h.toStatus
                    ? ` (${h.fromStatus ? purchaseOrderStatusLabel(h.fromStatus) : "—"} → ${h.toStatus ? purchaseOrderStatusLabel(h.toStatus) : "—"})`
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
