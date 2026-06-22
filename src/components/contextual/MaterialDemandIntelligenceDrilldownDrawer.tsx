import React, { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { formatDatePtBr } from "@/src/components/contextual/materialDemandDashboardUi";
import {
  buildMaterialDrilldownView,
  buildOrderDrilldownView,
} from "@/src/lib/materialDemandIntelligenceDrilldown";
import {
  MATERIAL_DEMAND_CALCULATION_EXPLAINER,
  safeDisplayNumber,
} from "@/src/lib/materialDemandIntelligenceUi";
import type { RawMaterialIntelligenceBlock } from "@/src/lib/salesOrderRawMaterialIntelligenceTypes";
import { cn, formatNumberAdaptive } from "@/src/lib/utils";

export type IntelligenceDrilldownTarget =
  | { kind: "material"; materialId: string }
  | { kind: "order"; orderId: string };

function qty(v: number): string {
  return formatNumberAdaptive(safeDisplayNumber(v));
}

function pctFactor(v: number): string {
  const n = safeDisplayNumber(v);
  if (n >= 1) return "100%";
  return `${formatNumberAdaptive(n * 100)}%`;
}

function MaterialDrilldownContent({
  intelligence,
  materialId,
}: {
  intelligence: RawMaterialIntelligenceBlock;
  materialId: string;
}) {
  const view = useMemo(
    () => buildMaterialDrilldownView(materialId, intelligence),
    [intelligence, materialId]
  );

  if (!view) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="material-intelligence-drilldown-empty">
        Nenhum detalhe encontrado para esta matéria-prima.
      </p>
    );
  }

  return (
    <div className="space-y-6" data-testid="material-intelligence-material-drilldown">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Recomendada</p>
          <p className="text-sm font-semibold tabular-nums">{qty(view.totals.recommendedQuantity)}</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Conservadora</p>
          <p className="text-sm font-semibold tabular-nums">{qty(view.totals.conservativeQuantity)}</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Em revisão</p>
          <p className="text-sm font-semibold tabular-nums">{qty(view.totals.reviewQuantity)}</p>
        </div>
      </div>

      <section>
        <h3 className="text-sm font-semibold mb-2">Produtos que consomem</h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-2">Produto</th>
                <th className="px-2 py-2 text-right">BOM (qtd/un)</th>
                <th className="px-2 py-2 text-right">Recomendada</th>
                <th className="px-2 py-2 text-right">Conservadora</th>
                <th className="px-2 py-2 text-right">Revisão</th>
              </tr>
            </thead>
            <tbody>
              {view.products.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">
                    Nenhum produto vinculado.
                  </td>
                </tr>
              ) : (
                view.products.map((p) => (
                  <tr key={`${p.productCode}-${p.productName}`} className="border-b border-border/60">
                    <td className="px-2 py-2">{p.productName ?? p.productCode ?? "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{qty(p.bomQuantityPerUnit)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{qty(p.recommendedQuantity)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{qty(p.conservativeQuantity)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{qty(p.reviewQuantity)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-2">Pedidos que geraram necessidade</h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[900px] text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-2">Pedido</th>
                <th className="px-2 py-2">Cliente</th>
                <th className="px-2 py-2">Produto</th>
                <th className="px-2 py-2 text-right">Saldo</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2 text-right">Fator</th>
                <th className="px-2 py-2 text-right">BOM</th>
                <th className="px-2 py-2 text-right">Recomendada</th>
                <th className="px-2 py-2 text-right">Conservadora</th>
              </tr>
            </thead>
            <tbody>
              {view.orders.map((o) => (
                <tr key={`${o.orderId}-${o.productCode}`} className="border-b border-border/60">
                  <td className="px-2 py-2 font-medium">{o.orderNumber}</td>
                  <td className="px-2 py-2">{o.customerName ?? "—"}</td>
                  <td className="px-2 py-2">{o.productName ?? o.productCode ?? "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{qty(o.openQuantity)}</td>
                  <td className="px-2 py-2">{o.estimationStatusLabel}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{pctFactor(o.factorUsed)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{qty(o.bomQuantityPerUnit)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{qty(o.recommendedQuantity)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{qty(o.conservativeQuantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {view.orders.some((o) => o.warnings.length > 0) ? (
          <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground space-y-1">
            {view.orders.flatMap((o) =>
              o.warnings.map((w) => (
                <li key={`${o.orderId}-${w}`}>
                  {o.orderNumber}: {w}
                </li>
              ))
            )}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

function OrderDrilldownContent({
  intelligence,
  orderId,
}: {
  intelligence: RawMaterialIntelligenceBlock;
  orderId: string;
}) {
  const view = useMemo(
    () => buildOrderDrilldownView(orderId, intelligence),
    [intelligence, orderId]
  );

  if (!view) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="material-intelligence-drilldown-empty">
        Nenhum detalhe encontrado para este pedido.
      </p>
    );
  }

  return (
    <div className="space-y-6" data-testid="material-intelligence-order-drilldown">
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <p>
          <span className="font-medium text-foreground">Cliente:</span> {view.customerName ?? "—"}
        </p>
        <p>
          <span className="font-medium text-foreground">Vendedor:</span> {view.sellerName ?? "—"}
        </p>
      </div>

      {view.nfes.length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold mb-2">Notas fiscais relacionadas</h3>
          <ul className="text-xs text-muted-foreground space-y-1">
            {view.nfes.map((nfe, idx) => (
              <li key={`${nfe.numero}-${idx}`}>
                NF {nfe.numero ?? "—"}
                {nfe.serie ? ` / série ${nfe.serie}` : ""} — {formatDatePtBr(nfe.dataProcessamento)}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhuma NF vinculada disponível.</p>
      )}

      {view.items.map((item) => (
        <section
          key={`${item.productCode}-${item.productName}`}
          className="rounded-lg border border-border p-3 space-y-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-sm">{item.productName ?? item.productCode ?? "Item"}</p>
              <p className="text-xs text-muted-foreground">{item.estimationStatusLabel}</p>
            </div>
            <span
              className={cn(
                "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                item.recommendedIncluded
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {item.recommendedIncluded ? "Incluído (recomendado)" : "Não incluído (recomendado)"}
            </span>
          </div>

          <div className="grid gap-2 text-xs sm:grid-cols-3">
            <p>
              Vendida: <span className="font-medium tabular-nums">{qty(item.soldQuantity)}</span>
            </p>
            <p>
              Faturada: <span className="font-medium tabular-nums">{qty(item.invoicedQuantity)}</span>
            </p>
            <p>
              Saldo: <span className="font-medium tabular-nums">{qty(item.openQuantity)}</span>
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            Janela viva estimada: {formatDatePtBr(item.estimatedWindowStart)} —{" "}
            {formatDatePtBr(item.estimatedWindowEnd)}
          </p>
          <p className="text-xs">
            <span className="font-medium">Motivo:</span> {item.inclusionReason}
          </p>
          <p className="text-xs">
            <span className="font-medium">Fator:</span> {pctFactor(item.factorUsed)}
          </p>

          {item.materials.length > 0 ? (
            <div className="overflow-x-auto rounded border border-border/70">
              <table className="w-full min-w-[520px] text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-1.5">Matéria-prima</th>
                    <th className="px-2 py-1.5 text-right">BOM</th>
                    <th className="px-2 py-1.5 text-right">Recomendada</th>
                    <th className="px-2 py-1.5 text-right">Conservadora</th>
                  </tr>
                </thead>
                <tbody>
                  {item.materials.map((m) => (
                    <tr key={`${m.materialCode}-${m.materialName}`} className="border-b border-border/50">
                      <td className="px-2 py-1.5">{m.materialName}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{qty(m.bomQuantityPerUnit)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{qty(m.recommendedQuantity)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{qty(m.conservativeQuantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Sem consumo de matéria-prima calculado para este item.</p>
          )}
        </section>
      ))}
    </div>
  );
}

export function MaterialDemandIntelligenceDrilldownDrawer({
  open,
  target,
  intelligence,
  onClose,
}: {
  open: boolean;
  target: IntelligenceDrilldownTarget | null;
  intelligence: RawMaterialIntelligenceBlock | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !target || !intelligence) return null;

  const title =
    target.kind === "material"
      ? "Detalhe da matéria-prima"
      : "Detalhe do pedido";

  const subtitle =
    target.kind === "material"
      ? intelligence.materials.find((m) => m.materialId === target.materialId)?.materialName ??
        target.materialId
      : intelligence.orders.find((o) => o.orderId === target.orderId)?.orderNumber ?? target.orderId;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end bg-black/40"
      data-testid="material-intelligence-drilldown-drawer"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="flex h-[92vh] sm:h-full w-full sm:max-w-2xl lg:max-w-4xl flex-col bg-background shadow-xl rounded-t-2xl sm:rounded-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border px-4 py-3 shrink-0 gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-foreground">{title}</h2>
            <p className="text-sm text-muted-foreground truncate mt-0.5">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-muted text-muted-foreground shrink-0"
            aria-label="Fechar"
            data-testid="material-intelligence-drilldown-close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {target.kind === "material" ? (
            <MaterialDrilldownContent intelligence={intelligence} materialId={target.materialId} />
          ) : (
            <OrderDrilldownContent intelligence={intelligence} orderId={target.orderId} />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function MaterialDemandCalculationExplainerPanel() {
  return (
    <section
      className="rounded-xl border border-border bg-card p-4 space-y-3"
      data-testid="material-intelligence-calculation-explainer"
    >
      <h3 className="text-sm font-semibold text-foreground">Como este cálculo funciona</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {MATERIAL_DEMAND_CALCULATION_EXPLAINER.map((item) => (
          <div key={item.title} className="text-sm">
            <p className="font-medium text-foreground">{item.title}</p>
            <p className="text-muted-foreground mt-0.5">{item.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
