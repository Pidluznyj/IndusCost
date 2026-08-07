import React from "react";
import { AlertTriangle, Ban, Check, ChevronDown, Info, Loader2, Minus } from "lucide-react";
import { cn, formatCurrencyAdaptive, formatNumberAdaptive } from "@/src/lib/utils";
import {
  buyByBlockedReasonLabel,
  formatYmdPtBr,
  RAW_MATERIAL_PLANNING_CONFIDENCE_LABELS,
  RAW_MATERIAL_PLANNING_CONFIDENCE_TONE,
  RAW_MATERIAL_PLANNING_STATUS_LABELS,
  RAW_MATERIAL_PLANNING_STATUS_TONE,
  STATUS_TONE_CLASSES,
  type RawMaterialPlanningRow,
} from "@/src/components/materials/rawMaterialPlanningUi";

function num(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatNumberAdaptive(v);
}

function money(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatCurrencyAdaptive(v);
}

/** Ícone por tom — mesma linguagem dos alerts Info/Warning/Error/Success. */
const TONE_ICON: Record<
  ReturnType<typeof toneOf>,
  React.ComponentType<{ className?: string }>
> = {
  info: Info,
  warning: AlertTriangle,
  danger: Ban,
  success: Check,
  neutral: Minus,
};

function toneOf(situation: RawMaterialPlanningRow["situation"]) {
  return RAW_MATERIAL_PLANNING_STATUS_TONE[situation];
}

function StatusBadge({ situation }: { situation: RawMaterialPlanningRow["situation"] }) {
  const tone = RAW_MATERIAL_PLANNING_STATUS_TONE[situation];
  const IconEl = TONE_ICON[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-[11px] font-semibold shadow-sm",
        STATUS_TONE_CLASSES[tone]
      )}
    >
      <IconEl className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {RAW_MATERIAL_PLANNING_STATUS_LABELS[situation]}
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: RawMaterialPlanningRow["confidence"] }) {
  const tone = RAW_MATERIAL_PLANNING_CONFIDENCE_TONE[confidence];
  const IconEl = TONE_ICON[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-[11px] shadow-sm",
        STATUS_TONE_CLASSES[tone]
      )}
      title="Confiança operacional — qualidade dos dados usados no cálculo, não é estatística."
    >
      <IconEl className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="font-bold">Confiança:</span>
      {RAW_MATERIAL_PLANNING_CONFIDENCE_LABELS[confidence]}
    </span>
  );
}

function RawMaterialPlanningTimelineTable({ row }: { row: RawMaterialPlanningRow }) {
  if (row.timeline.length === 0) {
    return <p className="text-xs text-muted-foreground">Sem eventos de demanda ou entrada no horizonte.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border/70">
      <table className="w-full text-[11px]">
        <thead className="bg-muted/20 border-b border-border/70">
          <tr>
            <th className="p-2 text-left font-semibold">Data</th>
            <th className="p-2 text-right font-semibold">Saldo abertura</th>
            <th className="p-2 text-right font-semibold">Entrada</th>
            <th className="p-2 text-right font-semibold">Saída (demanda)</th>
            <th className="p-2 text-right font-semibold">Saldo fechamento</th>
            <th className="p-2 text-right font-semibold">Proteção</th>
            <th className="p-2 text-right font-semibold">Saldo livre</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {row.timeline.map((point) => (
            <tr key={point.date} className={cn(point.shortfall > 0 && "bg-red-50/50 dark:bg-red-950/20")}>
              <td className="p-2 whitespace-nowrap font-medium">{formatYmdPtBr(point.date)}</td>
              <td className="p-2 text-right tabular-nums">{num(point.openingBalance)}</td>
              <td className="p-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                {point.inbound > 0 ? `+${num(point.inbound)}` : "—"}
              </td>
              <td className="p-2 text-right tabular-nums text-red-700 dark:text-red-400">
                {point.outbound > 0 ? `-${num(point.outbound)}` : "—"}
              </td>
              <td className="p-2 text-right tabular-nums font-semibold">{num(point.closingBalance)}</td>
              <td className="p-2 text-right tabular-nums text-muted-foreground">{num(point.protectionTotal)}</td>
              <td
                className={cn(
                  "p-2 text-right tabular-nums font-semibold",
                  point.freeBalance < 0 ? "text-red-700 dark:text-red-400" : "text-foreground"
                )}
              >
                {num(point.freeBalance)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RawMaterialPlanningConsumingOrdersTable({ row }: { row: RawMaterialPlanningRow }) {
  if (row.consumingOrders.length === 0) {
    return <p className="text-xs text-muted-foreground">Nenhum pedido de venda consumindo esta matéria-prima no filtro atual.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border/70">
      <table className="w-full text-[11px]">
        <thead className="bg-muted/20 border-b border-border/70">
          <tr>
            <th className="p-2 text-left font-semibold">Pedido</th>
            <th className="p-2 text-left font-semibold">Cliente</th>
            <th className="p-2 text-left font-semibold">Produto</th>
            <th className="p-2 text-right font-semibold">Qtde produto (aberto)</th>
            <th className="p-2 text-right font-semibold">Qtde MP</th>
            <th className="p-2 text-left font-semibold">Data de necessidade</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {row.consumingOrders.map((order, idx) => (
            <tr key={`${order.salesOrderId}-${order.productId}-${idx}`}>
              <td className="p-2 whitespace-nowrap font-medium">{order.orderCode ?? order.salesOrderId}</td>
              <td className="p-2">{order.customerName ?? "—"}</td>
              <td className="p-2">
                {order.productSku ? `[${order.productSku}] ` : ""}
                {order.productName}
              </td>
              <td className="p-2 text-right tabular-nums">{num(order.openQuantity)}</td>
              <td className="p-2 text-right tabular-nums font-semibold">
                {num(order.materialQuantity)} {order.unit}
              </td>
              <td className="p-2 whitespace-nowrap">
                {formatYmdPtBr(order.needByDate)}
                {order.needByDateSource === "none" ? (
                  <span
                    className={cn(
                      "ml-1.5 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold align-middle",
                      STATUS_TONE_CLASSES.warning
                    )}
                    title="Sem data de entrega prevista — tratado como necessidade imediata"
                  >
                    <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                    Sem data
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RawMaterialPlanningInboundTable({ row }: { row: RawMaterialPlanningRow }) {
  if (row.confirmedInbound.length === 0) {
    return <p className="text-xs text-muted-foreground">Nenhuma entrada de compra confirmada para esta matéria-prima.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border/70">
      <table className="w-full text-[11px]">
        <thead className="bg-muted/20 border-b border-border/70">
          <tr>
            <th className="p-2 text-left font-semibold">Pedido de compra</th>
            <th className="p-2 text-left font-semibold">Status</th>
            <th className="p-2 text-right font-semibold">Qtde pendente</th>
            <th className="p-2 text-left font-semibold">Entrega prevista</th>
            <th className="p-2 text-left font-semibold">Chega antes do risco?</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {row.confirmedInbound.map((inbound, idx) => (
            <tr key={`${inbound.purchaseOrderId}-${idx}`}>
              <td className="p-2 whitespace-nowrap font-medium">{inbound.purchaseOrderCode ?? inbound.purchaseOrderId}</td>
              <td className="p-2">{inbound.status}</td>
              <td className="p-2 text-right tabular-nums">
                {num(inbound.quantity)} {inbound.unit}
                {inbound.unitMismatch ? (
                  <span
                    className={cn(
                      "ml-1.5 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold align-middle",
                      STATUS_TONE_CLASSES.danger
                    )}
                    title="Unidade diferente da cadastrada no material — não somada à cobertura"
                  >
                    <Ban className="h-3 w-3 shrink-0" aria-hidden />
                    Unidade
                  </span>
                ) : null}
              </td>
              <td className="p-2 whitespace-nowrap">{formatYmdPtBr(inbound.expectedDeliveryDate)}</td>
              <td className="p-2">
                {inbound.unitMismatch ? (
                  "—"
                ) : inbound.arrivesBeforeRisk == null ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                      STATUS_TONE_CLASSES.neutral
                    )}
                  >
                    <Minus className="h-3 w-3 shrink-0" aria-hidden />
                    Sem risco
                  </span>
                ) : inbound.arrivesBeforeRisk ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                      STATUS_TONE_CLASSES.success
                    )}
                  >
                    <Check className="h-3 w-3 shrink-0" aria-hidden />
                    Sim
                  </span>
                ) : (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                      STATUS_TONE_CLASSES.danger
                    )}
                  >
                    <Ban className="h-3 w-3 shrink-0" aria-hidden />
                    Não (atrasada)
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RawMaterialPlanningCalculationMemory({ row }: { row: RawMaterialPlanningRow }) {
  const blockedReasonText = buyByBlockedReasonLabel(row.buyByBlockedReason);
  return (
    <div className="rounded-lg border border-border/70 bg-muted/10 p-3 space-y-1.5 text-[11px] text-muted-foreground">
      <p>
        <span className="font-semibold text-foreground">Saldo contado:</span> {num(row.countedBalance)} {row.unit}
        {row.lastStockConferenceAt ? ` (contagem de ${formatYmdPtBr(row.lastStockConferenceAt.slice(0, 10))})` : " (sem última contagem registrada)"}
      </p>
      <p>
        <span className="font-semibold text-foreground">Proteção (mínimo + contingência):</span> {num(row.protectionTotal)} {row.unit}
        {row.minimumQuantity != null || row.contingencyQuantity != null
          ? ` — mínimo ${num(row.minimumQuantity)} + contingência ${num(row.contingencyQuantity)}`
          : ""}
      </p>
      <p>
        <span className="font-semibold text-foreground">Menor saldo projetado no horizonte:</span> {num(row.lowestProjectedBalance)} {row.unit}
        {row.lowestProjectedBalanceDate ? ` em ${formatYmdPtBr(row.lowestProjectedBalanceDate)}` : ""}
      </p>
      <p>
        <span className="font-semibold text-foreground">Necessidade técnica:</span> max(0, proteção − menor saldo projetado) = {num(row.technicalNeed)} {row.unit}
      </p>
      <p>
        <span className="font-semibold text-foreground">Quantidade sugerida:</span> {num(row.suggestedQuantity)} {row.unit}
        {row.adjustmentNote ? ` (${row.adjustmentNote})` : " (sem ajuste de lote/múltiplo — não cadastrado)"}
      </p>
      <p>
        <span className="font-semibold text-foreground">Lead time considerado:</span>{" "}
        {row.leadTimeDays != null
          ? `${row.leadTimeDays} dias (média de ${row.leadTimeSampleCount} compra(s) anteriores)`
          : "não disponível — sem histórico de compras deste material"}
      </p>
      <p>
        <span className="font-semibold text-foreground">Data limite de compra (buy-by):</span>{" "}
        {row.buyByDate ? formatYmdPtBr(row.buyByDate) : blockedReasonText ?? "não calculada"}
      </p>
      {row.confidenceReasons.length > 0 ? (
        <p>
          <span className="font-semibold text-foreground">Motivos da confiança:</span> {row.confidenceReasons.join("; ")}
        </p>
      ) : null}
    </div>
  );
}

export type RawMaterialPurchasePlanPatch = {
  purchaseDate: string | null;
  expectedArrivalDate: string | null;
  purchaseOrderRef: string | null;
  purchasedQuantity: number | null;
};

/** "1.234,56" / "1234.56" → número; vazio/inválido → null. */
function parseQuantityInput(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Células editáveis de compra (Data da compra / Previsão de chegada /
 * Pedido de compra). Salvam direto no blur/troca; sem `onSave` (impressão)
 * renderizam somente leitura. stopPropagation: a linha inteira faz o
 * drilldown no clique.
 */
function PurchasePlanCells({
  row,
  onSave,
  saving,
}: {
  row: RawMaterialPlanningRow;
  onSave?: (materialId: string, patch: RawMaterialPurchasePlanPatch) => Promise<void>;
  saving: boolean;
}) {
  const plan = row.purchasePlan;
  const [purchaseDate, setPurchaseDate] = React.useState(plan?.purchaseDate ?? "");
  const [arrivalDate, setArrivalDate] = React.useState(plan?.expectedArrivalDate ?? "");
  const [orderRef, setOrderRef] = React.useState(plan?.purchaseOrderRef ?? "");
  const [purchasedQty, setPurchasedQty] = React.useState(
    plan?.purchasedQuantity != null ? String(plan.purchasedQuantity) : ""
  );

  React.useEffect(() => {
    setPurchaseDate(plan?.purchaseDate ?? "");
    setArrivalDate(plan?.expectedArrivalDate ?? "");
    setOrderRef(plan?.purchaseOrderRef ?? "");
    setPurchasedQty(
      plan?.purchasedQuantity != null ? String(plan.purchasedQuantity) : ""
    );
  }, [
    plan?.purchaseDate,
    plan?.expectedArrivalDate,
    plan?.purchaseOrderRef,
    plan?.purchasedQuantity,
  ]);

  const save = (patch: Partial<RawMaterialPurchasePlanPatch>) => {
    if (!onSave) return;
    void onSave(row.materialId, {
      purchaseDate: purchaseDate || null,
      expectedArrivalDate: arrivalDate || null,
      purchaseOrderRef: orderRef.trim() || null,
      purchasedQuantity: parseQuantityInput(purchasedQty),
      ...patch,
    });
  };

  // Saldo APÓS a compra = menor saldo projetado no horizonte + qtde comprada.
  // Positivo = a compra cobre a necessidade; negativo = ainda falta.
  // Usa o valor digitado (feedback imediato, antes mesmo de salvar).
  const liveQty = parseQuantityInput(purchasedQty);
  const balanceAfter =
    liveQty != null ? row.lowestProjectedBalance + liveQty : null;
  const balanceAfterCell = (
    <td
      className={cn(
        "p-3 text-right tabular-nums whitespace-nowrap font-semibold",
        balanceAfter == null
          ? "text-muted-foreground"
          : balanceAfter >= 0
            ? "text-emerald-700 dark:text-emerald-400"
            : "text-red-700 dark:text-red-400"
      )}
      title="Menor saldo projetado no horizonte + quantidade comprada. Positivo = compra cobre a necessidade."
    >
      {balanceAfter == null ? "—" : num(balanceAfter)}
    </td>
  );

  if (!onSave) {
    return (
      <>
        <td className="p-3 whitespace-nowrap">{formatYmdPtBr(plan?.purchaseDate ?? null)}</td>
        <td className="p-3 whitespace-nowrap">{formatYmdPtBr(plan?.expectedArrivalDate ?? null)}</td>
        <td className="p-3 whitespace-nowrap">{plan?.purchaseOrderRef ?? "—"}</td>
        <td className="p-3 text-right tabular-nums whitespace-nowrap">
          {plan?.purchasedQuantity != null ? num(plan.purchasedQuantity) : "—"}
        </td>
        {balanceAfterCell}
      </>
    );
  }

  const inputClass =
    "h-8 w-full min-w-[8.5rem] rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60";
  return (
    <>
      <td className="p-2" onClick={(e) => e.stopPropagation()}>
        <input
          type="date"
          value={purchaseDate}
          disabled={saving}
          onChange={(e) => {
            setPurchaseDate(e.target.value);
            save({ purchaseDate: e.target.value || null });
          }}
          className={inputClass}
          aria-label="Data da compra"
          data-testid={`rmp-purchase-date-${row.materialId}`}
        />
      </td>
      <td className="p-2" onClick={(e) => e.stopPropagation()}>
        <input
          type="date"
          value={arrivalDate}
          disabled={saving}
          onChange={(e) => {
            setArrivalDate(e.target.value);
            save({ expectedArrivalDate: e.target.value || null });
          }}
          className={inputClass}
          aria-label="Previsão de chegada"
          data-testid={`rmp-arrival-date-${row.materialId}`}
        />
      </td>
      <td className="p-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={orderRef}
            disabled={saving}
            placeholder="Nº pedido"
            maxLength={80}
            onChange={(e) => setOrderRef(e.target.value)}
            onBlur={() => {
              const next = orderRef.trim() || null;
              if (next !== (plan?.purchaseOrderRef ?? null)) {
                save({ purchaseOrderRef: next });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className={cn(inputClass, "min-w-[7rem]")}
            aria-label="Número do pedido de compra"
            data-testid={`rmp-order-ref-${row.materialId}`}
          />
        </div>
      </td>
      <td className="p-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            inputMode="decimal"
            value={purchasedQty}
            disabled={saving}
            placeholder="0,00"
            onChange={(e) => setPurchasedQty(e.target.value)}
            onBlur={() => {
              const next = parseQuantityInput(purchasedQty);
              if (next !== (plan?.purchasedQuantity ?? null)) {
                save({ purchasedQuantity: next });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className={cn(inputClass, "min-w-[6rem] text-right")}
            aria-label="Quantidade comprada"
            data-testid={`rmp-purchased-qty-${row.materialId}`}
          />
          {saving ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden /> : null}
        </div>
      </td>
      {balanceAfterCell}
    </>
  );
}

function RawMaterialPlanningExpandedDetail({ row }: { row: RawMaterialPlanningRow }) {
  return (
    <tr>
      <td colSpan={11} className="bg-muted/10 p-4">
        <div className="space-y-4">
          {/* Situação e Confiança saíram do grid (deram lugar aos campos de
              compra) e vivem aqui, junto com a data-limite calculada. */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <StatusBadge situation={row.situation} />
            <ConfidenceBadge confidence={row.confidence} />
            <span className="text-muted-foreground">
              Comprar até: <span className="font-semibold text-foreground">{formatYmdPtBr(row.buyByDate)}</span>
              {row.buyByBlockedReason ? ` — ${buyByBlockedReasonLabel(row.buyByBlockedReason)}` : ""}
            </span>
          </div>
          {row.alerts.length > 0 ? (
            <div
              className={cn(
                "rounded-lg border p-3 shadow-sm",
                STATUS_TONE_CLASSES.warning
              )}
            >
              <ul className="space-y-1.5 text-xs font-medium">
                {row.alerts.map((alert, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>
                      <span className="font-bold">Aviso:</span> {alert}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {/* Memória do cálculo em drilldown próprio — fechada por padrão,
              abre só quando o usuário quer auditar os números. */}
          <details className="group rounded-lg border border-border/70">
            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground hover:text-foreground">
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden />
              Memória do cálculo
              <span className="font-normal normal-case tracking-normal">— como chegamos nesses números</span>
            </summary>
            <div className="border-t border-border/70 p-3">
              <RawMaterialPlanningCalculationMemory row={row} />
            </div>
          </details>
          <div>
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Linha do tempo projetada</h4>
            <RawMaterialPlanningTimelineTable row={row} />
          </div>
          <div>
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Pedidos de venda que consomem esta matéria-prima</h4>
            <RawMaterialPlanningConsumingOrdersTable row={row} />
          </div>
          <div>
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Entradas de compra confirmadas</h4>
            <RawMaterialPlanningInboundTable row={row} />
          </div>
        </div>
      </td>
    </tr>
  );
}

export function RawMaterialPlanningTable({
  rows,
  expandedMaterialId,
  onToggleRow,
  onSavePurchasePlan,
  savingPlanMaterialId,
}: {
  rows: RawMaterialPlanningRow[];
  expandedMaterialId: string | null;
  onToggleRow: (materialId: string) => void;
  /** Ausente (ex.: impressão) → colunas de compra ficam somente leitura. */
  onSavePurchasePlan?: (
    materialId: string,
    patch: RawMaterialPurchasePlanPatch
  ) => Promise<void>;
  savingPlanMaterialId?: string | null;
}) {
  if (rows.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Nenhuma matéria-prima encontrada para os filtros selecionados.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-slate-100 border-b-2 border-slate-300 dark:bg-slate-800 dark:border-slate-600">
          <tr>
            <th className="px-3 py-3.5 text-left w-8" />
            <th className="px-3 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">Matéria-prima</th>
            <th className="px-3 py-3.5 text-right text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">Saldo atual</th>
            <th className="px-3 py-3.5 text-right text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">Necessidade técnica</th>
            <th className="px-3 py-3.5 text-right text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">Qtde sugerida</th>
            <th className="px-3 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">Data da compra</th>
            <th className="px-3 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">Previsão de chegada</th>
            <th className="px-3 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">Pedido de compra</th>
            <th className="px-3 py-3.5 text-right text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">Qtde comprada</th>
            <th className="px-3 py-3.5 text-right text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">Saldo após compra</th>
            <th className="px-3 py-3.5 text-right text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">Valor estimado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {/* Ordem vem pronta do chamador (controle de ordenação da página);
              ordenar aqui de novo quebraria a paginação e a impressão. */}
          {rows.map((row) => {
            const expanded = expandedMaterialId === row.materialId;
            return (
              <React.Fragment key={row.materialId}>
                <tr
                  className={cn("cursor-pointer hover:bg-muted/30", expanded && "bg-muted/20")}
                  onClick={() => onToggleRow(row.materialId)}
                  data-testid={`raw-material-planning-row-${row.materialId}`}
                >
                  <td className="p-3">
                    <ChevronDown className={cn("h-4 w-4 transition-transform text-muted-foreground", expanded && "rotate-180")} />
                  </td>
                  <td className="p-3 font-semibold break-words">
                    {row.code ? `[${row.code}] ` : ""}
                    {row.description}
                    <span className="ml-1 text-muted-foreground font-normal">· {row.unit}</span>
                  </td>
                  <td className="p-3 text-right tabular-nums whitespace-nowrap">{num(row.countedBalance)}</td>
                  <td className="p-3 text-right tabular-nums whitespace-nowrap">{num(row.technicalNeed)}</td>
                  <td className="p-3 text-right tabular-nums font-semibold whitespace-nowrap">{num(row.suggestedQuantity)}</td>
                  <PurchasePlanCells
                    row={row}
                    onSave={onSavePurchasePlan}
                    saving={savingPlanMaterialId === row.materialId}
                  />
                  <td className="p-3 text-right tabular-nums whitespace-nowrap">{money(row.estimatedPurchaseValue)}</td>
                </tr>
                {expanded ? <RawMaterialPlanningExpandedDetail row={row} /> : null}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
