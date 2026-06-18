import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ShieldAlert,
  X,
} from "lucide-react";
import type { SalesOrderIntelligencePayload } from "@/src/lib/salesOrderIntelligence";
import {
  COMPLETION_STATUS_LABELS,
  formatDeadlineBadge,
  formatInvoiceBadge,
  formatItemSituation,
  formatProductionBadge,
  formatSalesOrderDate,
  formatSalesOrderPercent,
  INTELLIGENCE_DRAWER_TABS,
  ITEM_NOMUS_STATUS_LABELS,
  TIMELINE_STATUS_LABELS,
  type SalesOrderIntelligenceDrawerTabId,
} from "@/src/lib/salesOrderManagementUi";
import { formatCurrency } from "@/src/lib/utils";
import { cn } from "@/src/lib/utils";
import "./sales-order-intelligence.css";

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function TimelineView({
  events,
}: {
  events: SalesOrderIntelligencePayload["timeline"];
}) {
  return (
    <ol className="so-intel-timeline space-y-3" data-testid="sales-order-intelligence-timeline">
      {events.map((event) => (
        <li
          key={event.key}
          className={cn(
            "so-intel-timeline-step rounded-lg border px-3 py-2",
            `so-intel-timeline-step--${event.status}`
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">{event.label}</p>
              {event.description ? (
                <p className="text-xs text-muted-foreground mt-0.5">{event.description}</p>
              ) : null}
            </div>
            <span className="text-[10px] font-bold uppercase shrink-0">
              {TIMELINE_STATUS_LABELS[event.status]}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {formatSalesOrderDate(event.date ?? null)}
          </p>
        </li>
      ))}
    </ol>
  );
}

function TabPanel({
  tab,
  payload,
}: {
  tab: SalesOrderIntelligenceDrawerTabId;
  payload: SalesOrderIntelligencePayload;
}) {
  const { lifecycle, order, items, production, invoicing, risks, suggestedActions, dataQuality } =
    payload;

  if (tab === "summary") {
    const topRisks = risks.slice(0, 3);
    const mainAction = suggestedActions[0];
    return (
      <div className="space-y-4" data-testid="sales-order-intelligence-summary">
        <div className="grid grid-cols-2 gap-3">
          <SummaryCard label="Status gerencial" value={lifecycle.executiveStatusLabel} />
          <SummaryCard
            label="Prazo"
            value={formatDeadlineBadge(lifecycle.deadlineStatus, lifecycle.daysOverdue)}
          />
          <SummaryCard
            label="NF"
            value={formatInvoiceBadge(lifecycle.hasInvoice, lifecycle.invoicedPercent)}
          />
          <SummaryCard
            label="OP"
            value={formatProductionBadge(
              production.hasLinkedProductionOrder,
              lifecycle.productionOrderLate,
              {
                status: production.productionOrders[0]?.status ?? production.dataQuality.source,
              }
            )}
          />
          <SummaryCard
            label="Completeza"
            value={COMPLETION_STATUS_LABELS[lifecycle.completionStatus]}
          />
          <SummaryCard label="Valor" value={formatCurrency(order.totalNetValue)} />
          <SummaryCard
            label="% faturado"
            value={formatSalesOrderPercent(lifecycle.invoicedPercent)}
          />
          <SummaryCard
            label="% atendido"
            value={formatSalesOrderPercent(lifecycle.fulfilledPercent)}
          />
        </div>
        {mainAction ? (
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-3">
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Ação sugerida</p>
            <p className="text-sm font-semibold mt-1">{mainAction.label}</p>
            <p className="text-xs text-muted-foreground mt-1">{mainAction.description}</p>
          </div>
        ) : null}
        {topRisks.length > 0 ? (
          <div>
            <h3 className="text-xs font-bold uppercase text-muted-foreground mb-2">
              Riscos principais
            </h3>
            <ul className="space-y-2">
              {topRisks.map((risk) => (
                <li key={risk.code} className="text-sm flex items-start gap-2">
                  <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                  <span>
                    <span className="font-semibold">{risk.title}</span>
                    <span className="text-muted-foreground"> — {risk.description}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }

  if (tab === "timeline") {
    return <TimelineView events={payload.timeline} />;
  }

  if (tab === "items") {
    return (
      <div className="overflow-x-auto" data-testid="sales-order-intelligence-items">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border bg-accent/40">
            <tr>
              <th className="p-2 font-semibold">Produto</th>
              <th className="p-2 font-semibold">Status Nomus</th>
              <th className="p-2 font-semibold">Normalizado</th>
              <th className="p-2 font-semibold text-right">Pedida</th>
              <th className="p-2 font-semibold text-right">Atendida</th>
              <th className="p-2 font-semibold text-right">Faturada</th>
              <th className="p-2 font-semibold text-right">Pendente</th>
              <th className="p-2 font-semibold">OP</th>
              <th className="p-2 font-semibold">NF</th>
              <th className="p-2 font-semibold">Situação</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-border/60">
                <td className="p-2">
                  <div className="font-medium">{item.productName}</div>
                  <div className="text-muted-foreground">{item.productCode}</div>
                </td>
                <td className="p-2">{item.originalStatus ?? "—"}</td>
                <td className="p-2">{ITEM_NOMUS_STATUS_LABELS[item.normalizedStatus]}</td>
                <td className="p-2 text-right tabular-nums">{item.orderedQuantity}</td>
                <td className="p-2 text-right tabular-nums">{item.fulfilledQuantity ?? "—"}</td>
                <td className="p-2 text-right tabular-nums">{item.invoicedQuantity ?? "—"}</td>
                <td className="p-2 text-right tabular-nums">{item.pendingQuantity ?? "—"}</td>
                <td className="p-2">
                  {item.linkedProductionOrderNumbers.length > 0
                    ? item.linkedProductionOrderNumbers.join(", ")
                    : "—"}
                </td>
                <td className="p-2">
                  {(item.invoicedQuantity ?? 0) > 0 && invoicing.invoiceNumbers.length > 0
                    ? invoicing.invoiceNumbers.join(", ")
                    : "—"}
                </td>
                <td className="p-2">{formatItemSituation(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (tab === "production") {
    const opNotSynced = production.dataQuality.source === "not_available";
    return (
      <div className="space-y-4" data-testid="sales-order-intelligence-production">
        {production.productionOrders.length === 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
            <p className="font-semibold">Nenhuma OP vinculada encontrada.</p>
            {opNotSynced ? (
              <p className="mt-1 text-xs">
                OP não sincronizada/disponível no IndusCost para este pedido.
              </p>
            ) : (
              <p className="mt-1 text-xs">
                Se o pedido exige produção, verifique abertura ou sincronização da OP.
              </p>
            )}
            {production.dataQuality.warnings.map((w) => (
              <p key={w} className="mt-2 text-xs">
                {w}
              </p>
            ))}
          </div>
        ) : (
          production.productionOrders.map((op, idx) => (
            <div key={op.number ?? idx} className="rounded-lg border border-border bg-card p-3">
              <p className="font-semibold">OP {op.number ?? "—"}</p>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">Produto</dt>
                  <dd>{op.productName ?? op.productCode ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>{op.status ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Planejada</dt>
                  <dd>{op.plannedQuantity ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Produzida</dt>
                  <dd>{op.producedQuantity ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Pendente</dt>
                  <dd>{op.pendingQuantity ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Abertura</dt>
                  <dd>{formatSalesOrderDate(op.openedAt ?? null)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Início</dt>
                  <dd>{formatSalesOrderDate(op.startedAt ?? null)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Fim</dt>
                  <dd>{formatSalesOrderDate(op.finishedAt ?? null)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Prazo</dt>
                  <dd>{formatSalesOrderDate(op.dueDate ?? null)}</dd>
                </div>
              </dl>
              {op.isLate ? (
                <p className="mt-2 text-xs font-semibold text-red-700">OP atrasada</p>
              ) : null}
            </div>
          ))
        )}
      </div>
    );
  }

  if (tab === "invoicing") {
    const timingLabel =
      invoicing.invoiceTiming === "after_due_date"
        ? "NF após prazo"
        : invoicing.invoiceTiming === "on_due_date"
          ? "NF no prazo"
          : invoicing.invoiceTiming === "before_due_date"
            ? "NF antecipada"
            : invoicing.invoiceTiming.replace(/_/g, " ");
    const partialOrTotal =
      invoicing.invoicedPercent != null && invoicing.invoicedPercent >= 99.5
        ? "Total"
        : invoicing.hasInvoice
          ? "Parcial"
          : "—";
    return (
      <div className="space-y-3" data-testid="sales-order-intelligence-invoicing">
        <SummaryCard
          label="Notas vinculadas"
          value={
            invoicing.invoiceNumbers.length > 0
              ? invoicing.invoiceNumbers.join(", ")
              : "Nenhuma NF processada"
          }
        />
        <SummaryCard
          label="Primeira emissão"
          value={formatSalesOrderDate(invoicing.firstInvoiceDate ?? null)}
        />
        <SummaryCard
          label="Última emissão"
          value={formatSalesOrderDate(invoicing.lastInvoiceDate ?? null)}
        />
        <SummaryCard label="Valor faturado" value={formatCurrency(invoicing.invoicedAmount ?? 0)} />
        <SummaryCard label="Timing" value={timingLabel} />
        <SummaryCard label="Parcial/total" value={partialOrTotal} />
        <SummaryCard
          label="% faturado"
          value={formatSalesOrderPercent(invoicing.invoicedPercent)}
        />
      </div>
    );
  }

  if (tab === "risks") {
    return (
      <div className="space-y-3" data-testid="sales-order-intelligence-risks">
        {risks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum risco identificado no momento.</p>
        ) : (
          risks.map((risk) => (
            <div
              key={risk.code}
              className={cn(
                "rounded-lg border px-3 py-3",
                risk.severity === "high"
                  ? "border-red-200 bg-red-50"
                  : risk.severity === "medium"
                    ? "border-amber-200 bg-amber-50"
                    : "border-slate-200 bg-slate-50"
              )}
            >
              <div className="flex items-start gap-2">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold">{risk.title}</p>
                  <p className="text-xs mt-1">{risk.description}</p>
                  <p className="text-xs mt-2 font-medium">Ação: {risk.suggestedAction}</p>
                </div>
              </div>
            </div>
          ))
        )}
        {suggestedActions.length > 0 ? (
          <div className="pt-2">
            <h3 className="text-xs font-bold uppercase text-muted-foreground mb-2">
              Ações sugeridas
            </h3>
            <ul className="space-y-2">
              {suggestedActions.map((action) => (
                <li key={`${action.priority}-${action.label}`} className="text-sm">
                  <span className="font-semibold">{action.label}:</span> {action.description}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="sales-order-intelligence-audit">
      <div>
        <h3 className="text-xs font-bold uppercase text-muted-foreground">Fontes de dados</h3>
        <ul className="mt-2 list-disc pl-4 text-sm space-y-1">
          <li>SalesOrder — cabeçalho, status e valores do pedido</li>
          <li>SalesOrderItem — itens persistidos no IndusCost</li>
          <li>nomusRawResponse.nfes — NF-e processadas no Nomus</li>
          <li>
            OP —{" "}
            {production.dataQuality.source === "nomus_raw"
              ? "nomusRawResponse (sem modelo Prisma dedicado)"
              : "não sincronizada/disponível"}
          </li>
          <li>nomusRawResponse.itensPedido — quantidades e status por item</li>
        </ul>
      </div>
      <div>
        <h3 className="text-xs font-bold uppercase text-muted-foreground">Status original Nomus</h3>
        <p className="text-sm mt-1">{lifecycle.originalStatus ?? "—"}</p>
      </div>
      {dataQuality.missingLinks.length > 0 ? (
        <div>
          <h3 className="text-xs font-bold uppercase text-muted-foreground">Vínculos ausentes</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {dataQuality.missingLinks.map((link) => (
              <li key={link} className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                {link === "nota_fiscal" ? "Sem vínculo NF" : "Sem vínculo OP"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {dataQuality.warnings.length > 0 ? (
        <div>
          <h3 className="text-xs font-bold uppercase text-muted-foreground">Avisos de qualidade</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {dataQuality.warnings.map((w) => (
              <li key={w} className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                {w}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          Sem avisos de qualidade de dados.
        </p>
      )}
      {dataQuality.sourceNotes.length > 0 ? (
        <div>
          <h3 className="text-xs font-bold uppercase text-muted-foreground">Notas de origem</h3>
          <ul className="mt-2 list-disc pl-4 text-xs text-muted-foreground space-y-1">
            {dataQuality.sourceNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function SalesOrderIntelligenceDrawer({
  open,
  onClose,
  loading,
  error,
  payload,
  orderLabel,
}: {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  error: string | null;
  payload: SalesOrderIntelligencePayload | null;
  orderLabel: string;
}) {
  const [tab, setTab] = React.useState<SalesOrderIntelligenceDrawerTabId>("summary");

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

  useEffect(() => {
    if (open) setTab("summary");
  }, [open, payload?.order.id]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end bg-black/40"
      data-testid="sales-order-intelligence-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="Inteligência do Pedido de Venda"
      onClick={onClose}
    >
      <div
        className="flex h-[92vh] sm:h-full w-full sm:max-w-2xl lg:max-w-4xl flex-col bg-background shadow-xl rounded-t-2xl sm:rounded-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border px-4 py-3 shrink-0">
          <div>
            <h2 className="text-base font-bold">Inteligência do Pedido de Venda</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{orderLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-accent text-muted-foreground"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-2 shrink-0">
          {INTELLIGENCE_DRAWER_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                tab === t.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              )}
              data-testid={`sales-order-intelligence-tab-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Carregando inteligência…
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-900">
              {error}
            </div>
          ) : payload ? (
            <TabPanel tab={tab} payload={payload} />
          ) : (
            <p className="text-sm text-muted-foreground">Selecione um pedido.</p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
