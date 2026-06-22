import React from "react";
import { formatDatePtBr } from "@/src/components/contextual/materialDemandDashboardUi";
import {
  agingBandLabel,
  estimationStatusBadgeClass,
  formatConfidenceLabel,
  MATERIAL_DEMAND_INTELLIGENCE_INTERPRETATION,
  safeDisplayNumber,
} from "@/src/lib/materialDemandIntelligenceUi";
import type {
  RawMaterialIntelligenceAudit,
  RawMaterialIntelligenceBlock,
  RawMaterialIntelligenceMaterialRow,
  RawMaterialIntelligenceOrderRow,
  RawMaterialIntelligenceReviewItem,
  RawMaterialIntelligenceUnservedBalanceRow,
} from "@/src/lib/salesOrderRawMaterialIntelligenceTypes";
import { cn, formatNumberAdaptive } from "@/src/lib/utils";

function money(v: number): string {
  const n = safeDisplayNumber(v);
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

function qty(v: number): string {
  return formatNumberAdaptive(safeDisplayNumber(v));
}

function pctFactor(v: number): string {
  const n = safeDisplayNumber(v);
  if (n >= 1) return "100%";
  return `${formatNumberAdaptive(n * 100)}%`;
}

export function MaterialDemandInterpretationBlock() {
  return (
    <section
      className="rounded-xl border border-border bg-muted/20 p-4 space-y-3"
      data-testid="material-intelligence-interpretation"
    >
      <h3 className="text-sm font-semibold text-foreground">Como interpretar</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {MATERIAL_DEMAND_INTELLIGENCE_INTERPRETATION.map((item) => (
          <div key={item.title} className="text-sm">
            <p className="font-medium text-foreground">{item.title}</p>
            <p className="text-muted-foreground mt-0.5">{item.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function MaterialDemandIntelligenceAuditPanel({
  audit,
  summary,
}: {
  audit: RawMaterialIntelligenceAudit;
  summary: RawMaterialIntelligenceBlock["summary"];
}) {
  return (
    <section
      className="rounded-xl border border-border bg-muted/30 p-4 space-y-3"
      data-testid="material-intelligence-audit"
    >
      <h3 className="text-sm font-semibold text-foreground">Dados e auditoria</h3>
      <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
        <p>
          <span className="font-medium text-foreground">Fonte:</span> {audit.source || "—"}
        </p>
        <p>
          <span className="font-medium text-foreground">Versão das regras:</span>{" "}
          {audit.rulesVersion || "—"}
        </p>
        <p data-testid="material-intelligence-audit-14d">
          <span className="font-medium text-foreground">Janela de faturamento:</span>{" "}
          {audit.billingCycleDays} dias após emissão ou última NF parcial
        </p>
        <p data-testid="material-intelligence-audit-30d">
          <span className="font-medium text-foreground">Saldo crítico:</span> após{" "}
          {audit.staleBalanceDays} dias fora da janela viva
        </p>
        <p>
          <span className="font-medium text-foreground">Pedidos excluídos (faturados):</span>{" "}
          {summary.excludedFullyInvoicedCount}
        </p>
        <p>
          <span className="font-medium text-foreground">Itens em revisão:</span>{" "}
          {summary.reviewItemsCount}
        </p>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {audit.warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </section>
  );
}

export function MaterialDemandIntelligenceMaterialsTable({
  rows,
}: {
  rows: RawMaterialIntelligenceMaterialRow[];
}) {
  return (
    <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden" data-testid="material-intelligence-materials-table">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Estimativa por matéria-prima</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2">Matéria-prima</th>
              <th className="px-3 py-2">Unidade</th>
              <th className="px-3 py-2 text-right">Recomendada</th>
              <th className="px-3 py-2 text-right">Conservadora</th>
              <th className="px-3 py-2 text-right">Diferença</th>
              <th className="px-3 py-2 text-right">Pedidos</th>
              <th className="px-3 py-2 text-right">Produtos</th>
              <th className="px-3 py-2 text-right">Em revisão</th>
              <th className="px-3 py-2">Confiança</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                  Nenhuma matéria-prima na estimativa para os filtros aplicados.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.materialId} className="border-b border-border/70">
                  <td className="px-3 py-2">
                    <div className="font-medium">{row.materialName}</div>
                    <div className="text-xs text-muted-foreground font-mono">{row.materialCode ?? "—"}</div>
                  </td>
                  <td className="px-3 py-2">{row.unitLabel}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(row.recommendedQuantity)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(row.conservativeQuantity)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(row.uncertaintyQuantity)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.relatedOrdersCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.relatedProductsCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(row.reviewQuantity)}</td>
                  <td className="px-3 py-2">{formatConfidenceLabel(row.confidence)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function MaterialDemandIntelligenceOrdersTable({ rows }: { rows: RawMaterialIntelligenceOrderRow[] }) {
  return (
    <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden" data-testid="material-intelligence-orders-table">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Pedidos considerados</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1200px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2">Pedido</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Produto</th>
              <th className="px-3 py-2 text-right">Vendida</th>
              <th className="px-3 py-2 text-right">Faturada</th>
              <th className="px-3 py-2 text-right">Saldo</th>
              <th className="px-3 py-2">Emissão</th>
              <th className="px-3 py-2">Entrega</th>
              <th className="px-3 py-2">Última NF</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Fator</th>
              <th className="px-3 py-2 text-right">Valor aberto</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-4 py-8 text-center text-muted-foreground">
                  Nenhum pedido considerado na estimativa.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={`${row.orderId}-${row.productCode}`} className="border-b border-border/70">
                  <td className="px-3 py-2 font-medium">{row.orderNumber}</td>
                  <td className="px-3 py-2">{row.customerName ?? "—"}</td>
                  <td className="px-3 py-2 max-w-[160px] truncate" title={row.productName ?? undefined}>
                    {row.productName ?? row.productCode ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(row.soldQuantity)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(row.invoicedQuantity)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(row.openQuantity)}</td>
                  <td className="px-3 py-2">{formatDatePtBr(row.issueDate)}</td>
                  <td className="px-3 py-2">{formatDatePtBr(row.expectedDeliveryDate)}</td>
                  <td className="px-3 py-2">{formatDatePtBr(row.lastInvoiceDate)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
                        estimationStatusBadgeClass(row.estimationStatus)
                      )}
                    >
                      {row.estimationStatusLabel}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{pctFactor(row.factorUsed)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(row.openNetAmount)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function MaterialDemandIntelligenceUnservedTable({
  rows,
}: {
  rows: RawMaterialIntelligenceUnservedBalanceRow[];
}) {
  return (
    <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden" data-testid="material-intelligence-unserved-table">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Saldos antigos não atendidos</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Saldo vendido com faturamento pendente fora da janela viva de compra.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2">Pedido</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Vendedor</th>
              <th className="px-3 py-2">Produto</th>
              <th className="px-3 py-2 text-right">Saldo</th>
              <th className="px-3 py-2 text-right">Valor</th>
              <th className="px-3 py-2">Última NF</th>
              <th className="px-3 py-2 text-right">Dias fora</th>
              <th className="px-3 py-2">Faixa</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                  Nenhum saldo antigo não atendido no período filtrado.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={`${row.orderId}-${row.productCode}-unserved`} className="border-b border-border/70">
                  <td className="px-3 py-2 font-medium">{row.orderNumber}</td>
                  <td className="px-3 py-2">{row.customerName ?? "—"}</td>
                  <td className="px-3 py-2">{row.sellerName ?? "—"}</td>
                  <td className="px-3 py-2">{row.productName ?? row.productCode ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(row.openQuantity)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(row.openNetAmount)}</td>
                  <td className="px-3 py-2">{formatDatePtBr(row.lastInvoiceDate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.daysAfterLiveWindow}</td>
                  <td className="px-3 py-2 text-xs">{agingBandLabel(row.daysAfterLiveWindow)}</td>
                  <td className="px-3 py-2 text-xs">{row.statusLabel}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function MaterialDemandIntelligenceReviewTable({
  rows,
}: {
  rows: RawMaterialIntelligenceReviewItem[];
}) {
  return (
    <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden" data-testid="material-intelligence-review-table">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Itens em revisão</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Não comprar automaticamente — conferir motivo e ação sugerida.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2">Motivo</th>
              <th className="px-3 py-2">Pedido</th>
              <th className="px-3 py-2">Produto</th>
              <th className="px-3 py-2">Impacto</th>
              <th className="px-3 py-2">Ação sugerida</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Nenhum item em revisão.
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={`${row.orderId}-${idx}`} className="border-b border-border/70">
                  <td className="px-3 py-2">{row.reason}</td>
                  <td className="px-3 py-2 font-medium">{row.orderNumber}</td>
                  <td className="px-3 py-2">{row.productName ?? row.productCode ?? "—"}</td>
                  <td className="px-3 py-2">{row.impact}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.suggestedAction}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
