import React from "react";
import { AlertTriangle, Ban, Check, ChevronDown, Info, Minus } from "lucide-react";
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
                  <span className="ml-1 text-amber-600 dark:text-amber-400" title="Sem data de entrega prevista — tratado como necessidade imediata">
                    ⚠
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
                  <span className="ml-1 text-red-600 dark:text-red-400" title="Unidade diferente da cadastrada no material — não somada à cobertura">
                    ⚠
                  </span>
                ) : null}
              </td>
              <td className="p-2 whitespace-nowrap">{formatYmdPtBr(inbound.expectedDeliveryDate)}</td>
              <td className="p-2">
                {inbound.unitMismatch
                  ? "—"
                  : inbound.arrivesBeforeRisk == null
                    ? "Sem risco"
                    : inbound.arrivesBeforeRisk
                      ? "Sim"
                      : "Não (atrasada)"}
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

function RawMaterialPlanningExpandedDetail({ row }: { row: RawMaterialPlanningRow }) {
  return (
    <tr>
      <td colSpan={9} className="bg-muted/10 p-4">
        <div className="space-y-4">
          {row.alerts.length > 0 ? (
            <div className="rounded-lg border border-amber-200/80 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20 p-3">
              <ul className="list-disc pl-4 space-y-1 text-xs text-amber-800 dark:text-amber-300">
                {row.alerts.map((alert, idx) => (
                  <li key={idx}>{alert}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Memória do cálculo</h4>
            <RawMaterialPlanningCalculationMemory row={row} />
          </div>
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
}: {
  rows: RawMaterialPlanningRow[];
  expandedMaterialId: string | null;
  onToggleRow: (materialId: string) => void;
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
            <th className="px-3 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">Situação</th>
            <th className="px-3 py-3.5 text-right text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">Saldo atual</th>
            <th className="px-3 py-3.5 text-right text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">Necessidade técnica</th>
            <th className="px-3 py-3.5 text-right text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">Qtde sugerida</th>
            <th className="px-3 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">Comprar até</th>
            <th className="px-3 py-3.5 text-right text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">Valor estimado</th>
            <th className="px-3 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">Confiança</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {[...rows].sort((a, b) => (b.technicalNeed ?? 0) - (a.technicalNeed ?? 0)).map((row) => {
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
                  <td className="p-3">
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge situation={row.situation} />
                    </div>
                  </td>
                  <td className="p-3 text-right tabular-nums whitespace-nowrap">{num(row.countedBalance)}</td>
                  <td className="p-3 text-right tabular-nums whitespace-nowrap">{num(row.technicalNeed)}</td>
                  <td className="p-3 text-right tabular-nums font-semibold whitespace-nowrap">{num(row.suggestedQuantity)}</td>
                  <td className="p-3 whitespace-nowrap">{formatYmdPtBr(row.buyByDate)}</td>
                  <td className="p-3 text-right tabular-nums whitespace-nowrap">{money(row.estimatedPurchaseValue)}</td>
                  <td className="p-3">
                    <ConfidenceBadge confidence={row.confidence} />
                  </td>
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
