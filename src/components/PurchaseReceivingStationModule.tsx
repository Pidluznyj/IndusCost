import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Package,
  RotateCcw,
  ShoppingCart,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { PurchaseChainViewNav } from "@/src/components/supply-chain/PurchaseChainViewNav";
import { OverlayBadge, OVERLAY_CONTROL_CLASS } from "@/src/components/ui/overlay";
import { OVERLAY_LABEL_DENSE, OVERLAY_TABLE_HEAD } from "@/src/lib/overlay/overlayTypography";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess";
import { fetchSupplyChainFeatureStatus } from "@/src/lib/supply-chain/supplyChainClient";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { PurchaseChainTrail } from "@/src/components/supply-chain/flow/PurchaseChainTrail";
import {
  resolvePurchaseOrderGuidance,
  stageForPurchaseOrderStatus,
} from "@/src/lib/purchasing/purchaseChainGuidance";
import {
  purchaseOrderStatusLabel,
  purchaseOrderStatusTone,
} from "@/src/lib/purchasing/purchaseOrderUi";
import type { PurchaseOrderStatusName } from "@/src/lib/purchasing/purchaseOrderWorkflow";

type BoardRow = {
  id: string;
  code: string;
  status: string;
  supplierName: string;
  itemCount: number;
  receiptCount: number;
  quantityOrdered: number;
  quantityReceived: number;
  quantityAcceptedConfirmed: number;
  quantityRejected: number;
  quantityCancelled: number;
  quantityPending: number;
  futureEntryPending: boolean;
  href: string;
};

type StationDetail = {
  order: {
    id: string;
    code: string;
    status: string;
    supplierName: string;
    supplierDocument: string | null;
    confirmedAt: string | null;
    futureEntryPending: boolean;
    currency: string;
    notes: string | null;
  };
  lines: Array<{
    id: string;
    lineNumber: number;
    description: string;
    materialCode: string | null;
    unit: string;
    quantityOrdered: number;
    quantityReceived: number;
    quantityAcceptedConfirmed: number;
    quantityRejected: number;
    quantityCancelled: number;
    quantityPending: number;
    negotiatedUnitCost: number | null;
    receivedUnitCost: number | null;
    lots: Array<string | null>;
  }>;
  receipts: Array<{
    id: string;
    code: string;
    status: string;
    receivedAt: string | null;
    warehouseCode: string | null;
    location: { code: string; name: string } | null;
    documentNumber: string | null;
    entryDocumentRef: string | null;
    nfeNumber: string | null;
    freightValueActual: number | null;
    expensesActual: number | null;
    notes: string | null;
    responsibleUserName: string | null;
    confirmedAt: string | null;
    reverseReason: string | null;
    items: Array<{
      id: string;
      purchaseOrderItemId: string;
      quantityReceived: number;
      quantityAccepted: number;
      quantityRejected: number;
      lotNumber: string | null;
      effectiveUnitCost: number | null;
      inventoryMovementId: string | null;
      reversalMovementId: string | null;
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
  }>;
  orderHistory: Array<{
    id: string;
    action: string;
    fromStatus: string | null;
    toStatus: string | null;
    reason: string | null;
    userName: string | null;
    createdAt: string;
  }>;
  evidences: Array<{
    id: string;
    entityType: string;
    originalFileName: string;
    evidenceType: string;
    uploadedByName: string | null;
    uploadedAt: string;
  }>;
  inventoryMovements: Array<{
    id: string;
    movementType: string;
    quantity: number;
    unit: string;
    lotNumber: string | null;
    documentNumber: string | null;
    unitCost: number | null;
    reason: string;
    createdAt: string;
    reversedMovementId: string | null;
  }>;
  warehouses: Array<{ id: string; code: string; name: string }>;
  banners: {
    confirmedOrderIsNotStock: string;
    onlyConfirmedReceiptChangesBalance: string;
    noNomusNoAp: string;
  };
};

type DraftLine = {
  purchaseOrderItemId: string;
  label: string;
  pending: number;
  unit: string;
  negotiatedUnitCost: number | null;
  quantityReceived: string;
  quantityAccepted: string;
  quantityRejected: string;
  lotNumber: string;
  effectiveUnitCost: string;
};

const PO_STATUS_LABEL: Record<string, string> = {
  CONFIRMADO: "Confirmado (sem estoque)",
  PARCIALMENTE_RECEBIDO: "Parcialmente recebido",
  RECEBIDO: "Recebido",
};

const RECEIPT_STATUS_LABEL: Record<string, string> = {
  RASCUNHO: "Rascunho / conferência",
  EM_CONFERENCIA: "Em conferência",
  DIVERGENTE: "Divergente",
  APROVADO: "Confirmado (estoque)",
  ESTORNADO: "Estornado",
  CANCELADO: "Cancelado",
};

function money(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function qty(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

function ReceivingBanners({ banners }: { banners: StationDetail["banners"] }) {
  return (
    <div className="space-y-2" data-testid="receiving-banners">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 flex gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">Pedido confirmado ≠ estoque</p>
          <p className="text-amber-900/90">{banners.confirmedOrderIsNotStock}</p>
        </div>
      </div>
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 flex gap-2">
        <Package className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">Saldo físico só no recebimento confirmado</p>
          <p className="text-emerald-900/90">{banners.onlyConfirmedReceiptChangesBalance}</p>
          <p className="text-xs mt-1 text-emerald-800/80">{banners.noNomusNoAp}</p>
        </div>
      </div>
    </div>
  );
}

export function PurchaseReceivingStationModule() {
  const { orderId } = useParams<{ orderId?: string }>();
  const navigate = useNavigate();
  const auth = useAuth();
  const permissions = usePermissions();

  const allowView =
    auth.hasPermission("purchases.view") ||
    permissions.canViewResource(OPERATIONS_RESOURCE_KEYS.purchases) ||
    auth.hasPermission("operations.supply_chain.receiving.view");
  const allowUpdate =
    auth.hasPermission("purchases.edit") ||
    permissions.canPerformAction(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.update);
  const allowApprove =
    auth.hasPermission("purchases.approve") ||
    permissions.canPerformAction(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.approve);

  const [flagEnabled, setFlagEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const [detail, setDetail] = useState<StationDetail | null>(null);
  const [q, setQ] = useState("");
  const [poStatus, setPoStatus] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

  const [showDraft, setShowDraft] = useState(false);
  const [warehouseId, setWarehouseId] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [entryDocumentRef, setEntryDocumentRef] = useState("");
  const [freight, setFreight] = useState("");
  const [expenses, setExpenses] = useState("");
  const [notes, setNotes] = useState("");
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchSupplyChainFeatureStatus(controller.signal)
      .then((s) => {
        if (!controller.signal.aborted) setFlagEnabled(s.enabled.receiving);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFlagEnabled(false);
      });
    return () => controller.abort();
  }, []);

  const loadBoard = useCallback(async () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (poStatus) params.set("poStatus", poStatus);
    params.set("page", String(page));
    params.set("pageSize", "20");
    const data = await fetchJsonOk<{
      rows: BoardRow[];
      pagination: typeof pagination;
    }>(`/api/receiving-station?${params}`);
    setBoard(data.rows);
    setPagination(data.pagination);
  }, [q, poStatus, page]);

  const loadDetail = useCallback(async (id: string) => {
    const data = await fetchJsonOk<StationDetail>(`/api/receiving-station/orders/${id}`);
    setDetail(data);
    setWarehouseId(data.warehouses[0]?.id ?? "");
    setDraftLines(
      data.lines
        .filter((l) => l.quantityPending > 0)
        .map((l) => ({
          purchaseOrderItemId: l.id,
          label: `${l.lineNumber}. ${l.materialCode ?? l.description}`,
          pending: l.quantityPending,
          unit: l.unit,
          negotiatedUnitCost: l.negotiatedUnitCost,
          quantityReceived: String(l.quantityPending),
          quantityAccepted: String(l.quantityPending),
          quantityRejected: "0",
          lotNumber: "",
          effectiveUnitCost:
            l.negotiatedUnitCost != null ? String(l.negotiatedUnitCost) : "",
        }))
    );
  }, []);

  useEffect(() => {
    if (!allowView || flagEnabled === false) {
      setLoading(false);
      return;
    }
    if (flagEnabled === null) return;
    setLoading(true);
    void (async () => {
      try {
        if (orderId) await loadDetail(orderId);
        else await loadBoard();
      } catch (e) {
        alert(e instanceof Error ? e.message : "Erro ao carregar estação de recebimento.");
      } finally {
        setLoading(false);
      }
    })();
  }, [allowView, flagEnabled, orderId, loadBoard, loadDetail]);

  const boardTotals = useMemo(() => {
    return board.reduce(
      (acc, r) => {
        acc.pending += r.quantityPending;
        acc.accepted += r.quantityAcceptedConfirmed;
        acc.rejected += r.quantityRejected;
        return acc;
      },
      { pending: 0, accepted: 0, rejected: 0 }
    );
  }, [board]);

  if (!allowView) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="receiving-station-denied">
        Sem permissão para ver a estação de recebimento.
      </p>
    );
  }

  if (flagEnabled === false) {
    return (
      <div
        className="rounded-lg border border-amber-200 bg-amber-50 p-6 space-y-2"
        data-testid="receiving-station-flag-off"
      >
        <h3 className="text-lg font-semibold text-amber-950">Recebimento desabilitado</h3>
        <p className="text-sm text-amber-900">
          Feature flag <code>SUPPLY_CHAIN_RECEIVING_MODULE_ENABLED</code> está desligada (padrão).
        </p>
        <Link to="/purchases/orders" className="text-sm font-medium underline text-amber-950">
          Ir aos pedidos de compra
        </Link>
      </div>
    );
  }

  if (loading || flagEnabled === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando estação de recebimento…
      </div>
    );
  }

  const runConfirm = async (receiptId: string) => {
    if (!allowApprove) {
      alert("Sem permissão de aprovação para confirmar recebimento.");
      return;
    }
    if (!window.confirm("Confirmar recebimento? Isso gera PURCHASE_RECEIPT e altera o saldo físico.")) {
      return;
    }
    setBusy(true);
    try {
      await fetchJsonOk(`/api/purchase-receipts/${receiptId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": `ui-${receiptId}` },
        body: JSON.stringify({}),
      });
      if (orderId) await loadDetail(orderId);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao confirmar.");
    } finally {
      setBusy(false);
    }
  };

  const runReverse = async (receiptId: string) => {
    if (!allowApprove) {
      alert("Reversão autorizada exige permissão de aprovação.");
      return;
    }
    const reason = window.prompt("Motivo da reversão formal (obrigatório):");
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      await fetchJsonOk(`/api/purchase-receipts/${receiptId}/reverse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (orderId) await loadDetail(orderId);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao estornar.");
    } finally {
      setBusy(false);
    }
  };

  const submitDraft = async () => {
    if (!detail || !allowUpdate) return;
    if (!warehouseId) {
      alert("Selecione o almoxarifado de destino.");
      return;
    }
    const items = draftLines
      .map((l) => ({
        purchaseOrderItemId: l.purchaseOrderItemId,
        quantityReceived: Number(l.quantityReceived),
        quantityAccepted: Number(l.quantityAccepted),
        quantityRejected: Number(l.quantityRejected || 0),
        lotNumber: l.lotNumber || null,
        effectiveUnitCost: l.effectiveUnitCost ? Number(l.effectiveUnitCost) : null,
        unitCostSnapshot: l.negotiatedUnitCost,
      }))
      .filter((i) => i.quantityReceived > 0 || i.quantityAccepted > 0);
    if (!items.length) {
      alert("Informe quantidades em ao menos uma linha.");
      return;
    }
    setBusy(true);
    try {
      await fetchJsonOk(`/api/purchase-receipts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purchaseOrderId: detail.order.id,
          warehouseId,
          documentNumber: documentNumber || null,
          entryDocumentRef: entryDocumentRef || null,
          nfeNumber: entryDocumentRef || null,
          freightValueActual: freight ? Number(freight) : null,
          expensesActual: expenses ? Number(expenses) : null,
          notes: notes || null,
          items,
        }),
      });
      setShowDraft(false);
      await loadDetail(detail.order.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao criar recebimento.");
    } finally {
      setBusy(false);
    }
  };

  if (!orderId) {
    return (
      <div className="space-y-3" data-testid="receiving-station-board">
        {/* Título e descrição já vêm da casca da página; aqui vale a navegação. */}
        <PurchaseChainViewNav current="receiving" />

        <div
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"
          data-testid="receiving-board-banner"
        >
          <strong>Pedido confirmado ≠ estoque.</strong> Somente o recebimento confirmado gera{" "}
          <code>PURCHASE_RECEIPT</code> e altera o saldo físico.
        </div>

        <SummaryKpiGrid minColumnWidth={140} className={SYSTEM_TOTALIZER_GRID_CLASS}>
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Pendentes (página)"
            amount={boardTotals.pending}
            amountFormat="number"
            tone="warning"
            icon={ClipboardCheck}
            loading={loading}
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Aceitos confirmados"
            amount={boardTotals.accepted}
            amountFormat="number"
            tone="success"
            icon={CheckCircle2}
            loading={loading}
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Rejeitados"
            amount={boardTotals.rejected}
            amountFormat="number"
            tone="danger"
            icon={AlertTriangle}
            loading={loading}
          />
        </SummaryKpiGrid>

        <form
          className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2"
          data-testid="receiving-station-filters"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setLoading(true);
            void loadBoard().finally(() => setLoading(false));
          }}
        >
          <input
            aria-label="Buscar pedido ou fornecedor"
            className={cn(OVERLAY_CONTROL_CLASS, "min-w-[220px] flex-1")}
            placeholder="Buscar PC ou fornecedor"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            aria-label="Filtrar por status do pedido"
            className={cn(OVERLAY_CONTROL_CLASS, "sm:w-[190px]")}
            value={poStatus}
            onChange={(e) => setPoStatus(e.target.value)}
          >
            <option value="">Status do pedido</option>
            <option value="CONFIRMADO">Confirmado</option>
            <option value="PARCIALMENTE_RECEBIDO">Parcial</option>
            <option value="RECEBIDO">Recebido</option>
          </select>
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Filtrar
          </button>
        </form>

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] text-sm">
              <thead className="border-b border-border bg-muted/40">
                <tr className={cn(OVERLAY_TABLE_HEAD, "text-left")}>
                  <th className="px-3 py-2">Pedido</th>
                  <th className="px-3 py-2">Fornecedor</th>
                  <th className="w-[150px] px-3 py-2">Status</th>
                  {/* Quantidade se lê alinhada à direita, não à esquerda. */}
                  <th className="w-[84px] px-3 py-2 text-right">Pedida</th>
                  <th className="w-[84px] px-3 py-2 text-right">Recebida</th>
                  <th className="w-[84px] px-3 py-2 text-right">Aceita</th>
                  <th className="w-[84px] px-3 py-2 text-right">Rejeitada</th>
                  <th className="w-[84px] px-3 py-2 text-right">Cancelada</th>
                  <th className="w-[84px] px-3 py-2 text-right">Pendente</th>
                </tr>
              </thead>
              <tbody>
                {board.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-6 text-center text-muted-foreground">
                      Nenhum pedido elegível para recebimento.
                    </td>
                  </tr>
                ) : (
                  board.map((row) => (
                    <tr key={row.id} className="border-t border-border hover:bg-muted/20">
                      <td className="px-3 py-2">
                        <Link to={row.href} className="font-mono font-medium text-primary hover:underline">
                          {row.code}
                        </Link>
                        <div className="text-[11px] text-muted-foreground">
                          {row.itemCount} iten(s) · {row.receiptCount} receb.
                        </div>
                      </td>
                      <td className="px-3 py-2">{row.supplierName}</td>
                      <td className="px-3 py-2">
                        <OverlayBadge tone={purchaseOrderStatusTone(row.status)}>
                          {purchaseOrderStatusLabel(row.status)}
                        </OverlayBadge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{qty(row.quantityOrdered)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{qty(row.quantityReceived)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {qty(row.quantityAcceptedConfirmed)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{qty(row.quantityRejected)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{qty(row.quantityCancelled)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {qty(row.quantityPending)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs">
            <span className="text-muted-foreground">
              Página {pagination.page} de {pagination.totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md border border-border px-2.5 py-1 disabled:opacity-40"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Anterior
              </button>
              <button
                type="button"
                className="rounded-md border border-border px-2.5 py-1 disabled:opacity-40"
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!detail) {
    return <p className="text-sm text-muted-foreground">Pedido não encontrado.</p>;
  }

  return (
    <div className="space-y-3" data-testid="receiving-station-detail">
      {/* Cabeçalho do documento: código, partes e situação numa faixa só. */}
      <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => navigate("/purchases/receiving")}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar à estação
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <ShoppingCart className="h-4 w-4 shrink-0 text-primary" />
            <h3 className="font-mono text-base font-semibold">{detail.order.code}</h3>
            <OverlayBadge tone={purchaseOrderStatusTone(detail.order.status)} emphasized>
              {purchaseOrderStatusLabel(detail.order.status)}
            </OverlayBadge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {[detail.order.supplierName, detail.order.supplierDocument || null]
              .filter(Boolean)
              .join("  ·  ")}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            to={`/purchases/orders/${detail.order.id}`}
            className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent"
          >
            Ver pedido
          </Link>
          <Link
            to={`/purchases/orders/${detail.order.id}/savings`}
            className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent"
          >
            Ganho negociado × realizado
          </Link>
          {allowUpdate && detail.order.status !== "RECEBIDO" ? (
            <button
              type="button"
              className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
              disabled={busy || draftLines.length === 0}
              onClick={() => setShowDraft((v) => !v)}
            >
              Novo recebimento parcial
            </button>
          ) : null}
        </div>
      </div>

      {/* Mesma trilha do Pedido: as duas telas contam a mesma história. */}
      <PurchaseChainTrail
        currentStage={stageForPurchaseOrderStatus(
          detail.order.status as PurchaseOrderStatusName
        )}
        guidance={resolvePurchaseOrderGuidance({
          status: detail.order.status as PurchaseOrderStatusName,
          // Estar nesta tela já prova que o módulo de Recebimento está ligado.
          flags: { receiving: true, supplierPerformance: false },
          permissions: { canUpdate: allowUpdate, canApprove: allowApprove },
        })}
      />

      <ReceivingBanners banners={detail.banners} />

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Itens do pedido ({detail.lines.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-sm" data-testid="receiving-lines-table">
            <thead className="border-b border-border bg-muted/20">
              <tr className={cn(OVERLAY_TABLE_HEAD, "text-left")}>
                <th className="px-3 py-2">Item</th>
                <th className="w-[96px] px-3 py-2 text-right">Pedida</th>
                <th className="w-[84px] px-3 py-2 text-right">Recebida</th>
                <th className="w-[84px] px-3 py-2 text-right">Aceita</th>
                <th className="w-[84px] px-3 py-2 text-right">Rejeitada</th>
                <th className="w-[84px] px-3 py-2 text-right">Cancelada</th>
                <th className="w-[84px] px-3 py-2 text-right">Pendente</th>
                <th className="w-[120px] px-3 py-2">Lote(s)</th>
                <th className="w-[96px] px-3 py-2 text-right">Custo neg.</th>
                <th className="w-[96px] px-3 py-2 text-right">Custo rec.</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((line) => (
                <tr key={line.id} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      <span className="font-mono text-xs text-muted-foreground">
                        {line.lineNumber}.
                      </span>{" "}
                      {line.materialCode ?? "—"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{line.description}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {qty(line.quantityOrdered)}{" "}
                    <span className="text-[11px] text-muted-foreground">{line.unit}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(line.quantityReceived)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {qty(line.quantityAcceptedConfirmed)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(line.quantityRejected)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(line.quantityCancelled)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {qty(line.quantityPending)}
                  </td>
                  <td className="px-3 py-2 text-xs">{line.lots.filter(Boolean).join(", ") || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {money(line.negotiatedUnitCost)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {money(line.receivedUnitCost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showDraft ? (
        <div className="rounded-xl border border-border bg-card" data-testid="receiving-draft-form">
          <h4 className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Conferência / recebimento parcial
          </h4>
          <div className="space-y-3 px-3 py-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className={cn(OVERLAY_LABEL_DENSE, "flex flex-col gap-1")}>
              Almoxarifado destino *
              <select
                className={OVERLAY_CONTROL_CLASS}
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
              >
                <option value="">Selecione…</option>
                {detail.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={cn(OVERLAY_LABEL_DENSE, "flex flex-col gap-1")}>
              Documento
              <input
                className={OVERLAY_CONTROL_CLASS}
                value={documentNumber}
                onChange={(e) => setDocumentNumber(e.target.value)}
              />
            </label>
            <label className={cn(OVERLAY_LABEL_DENSE, "flex flex-col gap-1")}>
              NF-e / doc. entrada (referência)
              <input
                className={OVERLAY_CONTROL_CLASS}
                value={entryDocumentRef}
                onChange={(e) => setEntryDocumentRef(e.target.value)}
              />
            </label>
            <label className={cn(OVERLAY_LABEL_DENSE, "flex flex-col gap-1")}>
              Frete real
              <input
                className={cn(OVERLAY_CONTROL_CLASS, "text-right tabular-nums")}
                value={freight}
                onChange={(e) => setFreight(e.target.value)}
              />
            </label>
            <label className={cn(OVERLAY_LABEL_DENSE, "flex flex-col gap-1")}>
              Despesas reais
              <input
                className={cn(OVERLAY_CONTROL_CLASS, "text-right tabular-nums")}
                value={expenses}
                onChange={(e) => setExpenses(e.target.value)}
              />
            </label>
            <label className={cn(OVERLAY_LABEL_DENSE, "flex flex-col gap-1 md:col-span-3")}>
              Observações
              <input
                className={OVERLAY_CONTROL_CLASS}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </div>

          <div className="space-y-2">
            {draftLines.map((line, idx) => (
              <div key={line.purchaseOrderItemId} className="grid grid-cols-2 gap-2 rounded-lg border border-border px-3 py-2.5 md:grid-cols-6">
                <div className="md:col-span-2 text-sm">
                  <div className="font-medium">{line.label}</div>
                  <div className="text-xs text-muted-foreground">
                    Pendente {qty(line.pending)} {line.unit}
                  </div>
                </div>
                {(
                  [
                    ["Recebida", "quantityReceived"],
                    ["Aceita", "quantityAccepted"],
                    ["Rejeitada", "quantityRejected"],
                    ["Lote", "lotNumber"],
                    ["Custo efetivo", "effectiveUnitCost"],
                  ] as const
                ).map(([label, key]) => (
                  <label key={key} className={cn(OVERLAY_LABEL_DENSE, "flex flex-col gap-1")}>
                    {label}
                    <input
                      className={cn(
                        OVERLAY_CONTROL_CLASS,
                        "px-2 py-1.5",
                        key !== "lotNumber" && "text-right tabular-nums"
                      )}
                      value={line[key]}
                      onChange={(e) => {
                        const next = [...draftLines];
                        next[idx] = { ...next[idx]!, [key]: e.target.value };
                        setDraftLines(next);
                      }}
                    />
                  </label>
                ))}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <button
              type="button"
              className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
              disabled={busy}
              onClick={() => void submitDraft()}
            >
              Salvar conferência (rascunho)
            </button>
            <button
              type="button"
              className="rounded-lg border border-border px-4 py-2 text-sm"
              onClick={() => setShowDraft(false)}
            >
              Fechar
            </button>
            <p className="text-[11px] text-muted-foreground">
              O rascunho não altera estoque. Use Confirmar no recebimento para gerar PURCHASE_RECEIPT.
            </p>
          </div>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border bg-card" data-testid="receiving-receipts-list">
        <div className="border-b border-border bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Recebimentos · documentos · destino
        </div>
        {detail.receipts.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Nenhum recebimento ainda.</p>
        ) : (
          <div className="divide-y divide-border">
            {detail.receipts.map((r) => (
              <div key={r.id} className="p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">
                      {r.code} · {RECEIPT_STATUS_LABEL[r.status] ?? r.status}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Almox: {r.warehouseCode ?? "—"}
                      {r.location ? ` / ${r.location.code}` : ""}
                      {" · Doc: "}
                      {r.documentNumber ?? "—"}
                      {" · NF-e ref: "}
                      {r.entryDocumentRef ?? r.nfeNumber ?? "—"}
                      {" · Resp: "}
                      {r.responsibleUserName ?? "—"}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {r.status === "RASCUNHO" || r.status === "EM_CONFERENCIA" || r.status === "DIVERGENTE" ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50"
                        disabled={busy || !allowApprove}
                        onClick={() => void runConfirm(r.id)}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Confirmar
                      </button>
                    ) : null}
                    {r.status === "APROVADO" ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg border border-rose-300 text-rose-800 disabled:opacity-50"
                        disabled={busy || !allowApprove}
                        onClick={() => void runReverse(r.id)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Reversão autorizada
                      </button>
                    ) : null}
                  </div>
                </div>
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground text-left">
                    <tr>
                      <th className="py-1">Recebida</th>
                      <th className="py-1">Aceita</th>
                      <th className="py-1">Rejeitada</th>
                      <th className="py-1">Lote</th>
                      <th className="py-1">Custo efetivo</th>
                      <th className="py-1">Movimento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.items.map((i) => (
                      <tr key={i.id} className="border-t border-border/60">
                        <td className="py-1">{qty(i.quantityReceived)}</td>
                        <td className="py-1">{qty(i.quantityAccepted)}</td>
                        <td className="py-1">{qty(i.quantityRejected)}</td>
                        <td className="py-1">{i.lotNumber ?? "—"}</td>
                        <td className="py-1">{money(i.effectiveUnitCost)}</td>
                        <td className="py-1 font-mono text-[10px]">
                          {i.inventoryMovementId ?? "—"}
                          {i.reversalMovementId ? ` → rev ${i.reversalMovementId}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {r.history.length > 0 ? (
                  <ul className="text-xs text-muted-foreground space-y-1">
                    {r.history.map((h) => (
                      <li key={h.id}>
                        {new Date(h.createdAt).toLocaleString("pt-BR")} · {h.action}
                        {h.toStatus ? ` → ${h.toStatus}` : ""}
                        {h.userName ? ` · ${h.userName}` : ""}
                        {h.reason ? ` · ${h.reason}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border p-4" data-testid="receiving-evidences">
          <h4 className="font-medium text-sm mb-2">Evidências</h4>
          {detail.evidences.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma evidência vinculada.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {detail.evidences.map((e) => (
                <li key={e.id}>
                  {e.originalFileName}{" "}
                  <span className="text-xs text-muted-foreground">
                    ({e.evidenceType} · {e.entityType})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-2xl border border-border p-4" data-testid="receiving-movements">
          <h4 className="font-medium text-sm mb-2">Movimentos de estoque gerados</h4>
          {detail.inventoryMovements.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum movimento ainda — confirme um recebimento para gerar PURCHASE_RECEIPT.
            </p>
          ) : (
            <ul className="text-sm space-y-2">
              {detail.inventoryMovements.map((m) => (
                <li key={m.id} className="border-b border-border/50 pb-2">
                  <span className="font-medium">{m.movementType}</span> · {qty(m.quantity)} {m.unit}
                  {m.lotNumber ? ` · lote ${m.lotNumber}` : ""}
                  <div className="text-xs text-muted-foreground">
                    {m.reason} · {money(m.unitCost)} · {new Date(m.createdAt).toLocaleString("pt-BR")}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-border p-4" data-testid="receiving-order-history">
        <h4 className="font-medium text-sm mb-2">Histórico do pedido</h4>
        {detail.orderHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem eventos.</p>
        ) : (
          <ul className="text-xs text-muted-foreground space-y-1 max-h-48 overflow-auto">
            {detail.orderHistory.map((h) => (
              <li key={h.id}>
                {new Date(h.createdAt).toLocaleString("pt-BR")} · {h.action}
                {h.fromStatus || h.toStatus ? ` (${h.fromStatus ?? "—"} → ${h.toStatus ?? "—"})` : ""}
                {h.userName ? ` · ${h.userName}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
