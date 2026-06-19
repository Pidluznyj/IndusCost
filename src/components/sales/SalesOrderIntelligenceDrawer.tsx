import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Loader2,
  ShieldAlert,
  X,
} from "lucide-react";
import type { SalesOrderIntelligencePayload } from "@/src/lib/salesOrderIntelligence";
import {
  formatDeadlineBadge,
  formatInvoiceBadge,
  formatProductionBadge,
  formatSalesOrderDate,
  formatSalesOrderPercent,
  INTELLIGENCE_DRAWER_TABS,
  ITEM_NOMUS_STATUS_LABELS,
  TIMELINE_STATUS_LABELS,
  type SalesOrderIntelligenceDrawerTabId,
} from "@/src/lib/salesOrderManagementUi";
import {
  formatItemStatusSourceLabel,
  formatRawMatchedByLabel,
} from "@/src/lib/salesOrderStatusAudit";
import { cn, formatCurrency } from "@/src/lib/utils";
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

function CollapsibleJson({
  title,
  data,
  testId,
}: {
  title: string;
  data: unknown;
  testId?: string;
}) {
  return (
    <details className="rounded-lg border border-border bg-card" data-testid={testId}>
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold">{title}</summary>
      <pre className="max-h-64 overflow-auto border-t border-border p-3 text-[10px] leading-relaxed">
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  );
}

function SourceBadge({ source }: { source: string }) {
  const tone =
    source === "nomus_raw"
      ? "bg-blue-100 text-blue-900"
      : source === "induscost"
        ? "bg-violet-100 text-violet-900"
        : source === "calculated"
          ? "bg-amber-100 text-amber-900"
          : "bg-slate-100 text-slate-800";
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase", tone)}>
      {source.replace(/_/g, " ")}
    </span>
  );
}

function TabPanel({
  tab,
  payload,
}: {
  tab: SalesOrderIntelligenceDrawerTabId;
  payload: SalesOrderIntelligencePayload;
}) {
  const {
    lifecycle,
    order,
    items,
    production,
    invoicing,
    invoices,
    risks,
    suggestedActions,
    dataQuality,
    rawData,
    audit,
  } = payload;

  if (tab === "summary") {
    const topRisks = risks.slice(0, 3);
    const mainAction = suggestedActions[0];
    return (
      <div className="space-y-4" data-testid="sales-order-intelligence-summary">
        <div className="grid grid-cols-2 gap-3">
          <SummaryCard label="Pedido" value={order.orderCode} />
          <SummaryCard label="Cliente" value={order.customerName} />
          <SummaryCard label="Emissão" value={formatSalesOrderDate(order.issueDate)} />
          <SummaryCard
            label="Previsão"
            value={formatSalesOrderDate(order.expectedDeliveryDate)}
          />
          <SummaryCard label="Valor" value={formatCurrency(order.totalNetValue)} />
          <SummaryCard label="Status gerencial" value={lifecycle.executiveStatusLabel} />
          <SummaryCard label="Status IndusCost" value={order.statusIndusCost} />
          <SummaryCard
            label="Status Nomus"
            value={order.statusNomusLabel ?? "Não localizado na integração"}
          />
          <SummaryCard
            label="Prazo"
            value={formatDeadlineBadge(
              lifecycle.deadlineStatus,
              lifecycle.daysOverdue,
              lifecycle.operationalStatus
            )}
          />
          <SummaryCard
            label="NF"
            value={formatInvoiceBadge(
              lifecycle.hasInvoice,
              lifecycle.invoicedPercent,
              lifecycle.operationalStatus
            )}
          />
          <SummaryCard
            label="OP"
            value={formatProductionBadge(
              production.hasLinkedProductionOrder,
              lifecycle.productionOrderLate,
              {
                status: production.productionOrders[0]?.status ?? production.dataQuality.source,
                operationalStatus: lifecycle.operationalStatus,
              }
            )}
          />
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
        ) : (
          <SummaryCard label="Ação sugerida" value={lifecycle.suggestedActionLabel} />
        )}
        {topRisks.length > 0 ? (
          <div>
            <h3 className="text-xs font-bold uppercase text-muted-foreground mb-2">Riscos</h3>
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
      <div className="overflow-x-auto space-y-3" data-testid="sales-order-intelligence-items">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border bg-accent/40">
            <tr>
              <th className="p-2 font-semibold">Item</th>
              <th className="p-2 font-semibold">Código</th>
              <th className="p-2 font-semibold">Descrição</th>
              <th className="p-2 font-semibold text-right">Qtde pedida</th>
              <th className="p-2 font-semibold text-right">Qtde atendida</th>
              <th className="p-2 font-semibold text-right">Qtde faturada</th>
              <th className="p-2 font-semibold text-right">Qtde cancelada</th>
              <th className="p-2 font-semibold">Status Nomus</th>
              <th className="p-2 font-semibold">Status IndusCost</th>
              <th className="p-2 font-semibold">Origem do status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <React.Fragment key={item.id}>
                <tr className="border-b border-border/60">
                  <td className="p-2">{item.itemNumber ?? "—"}</td>
                  <td className="p-2">{item.sku ?? item.productCode}</td>
                  <td className="p-2">{item.description ?? item.productName}</td>
                  <td className="p-2 text-right tabular-nums">{item.quantityOrdered}</td>
                  <td className="p-2 text-right tabular-nums">
                    {item.quantityFulfilled ?? "Não informado"}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {item.quantityInvoiced ?? "Não informado"}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {item.quantityCancelled ?? "Não informado"}
                  </td>
                  <td className="p-2">{item.statusLabel ?? item.statusRaw ?? "Não informado"}</td>
                  <td className="p-2">
                    {ITEM_NOMUS_STATUS_LABELS[item.statusNormalized ?? item.normalizedStatus]}
                  </td>
                  <td className="p-2">
                    {formatItemStatusSourceLabel(item.statusSource)}
                    <span className="block text-[10px] text-muted-foreground">
                      {formatRawMatchedByLabel(item.rawMatchedBy)}
                    </span>
                  </td>
                </tr>
                <tr className="border-b border-border/40 bg-muted/20">
                  <td colSpan={10} className="p-2">
                    <CollapsibleJson
                      title="Ver raw do item"
                      data={item.rawSummary}
                      testId={`sales-order-item-raw-${item.id}`}
                    />
                  </td>
                </tr>
              </React.Fragment>
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
            <p className="font-semibold">Nenhuma OP vinculada localizada na integração.</p>
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
    if (invoices.length === 0) {
      return (
        <div className="space-y-3" data-testid="sales-order-intelligence-invoicing">
          <p className="text-sm text-muted-foreground">
            Nenhuma nota fiscal vinculada localizada na integração.
          </p>
          <SummaryCard
            label="Resumo"
            value={invoicing.hasInvoice ? "Indício de NF sem detalhes no raw" : "Sem NF"}
          />
        </div>
      );
    }
    return (
      <div className="overflow-x-auto space-y-3" data-testid="sales-order-intelligence-invoicing">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border bg-accent/40">
            <tr>
              <th className="p-2 font-semibold">NF</th>
              <th className="p-2 font-semibold">Série</th>
              <th className="p-2 font-semibold">Chave</th>
              <th className="p-2 font-semibold">Emissão</th>
              <th className="p-2 font-semibold">Processamento</th>
              <th className="p-2 font-semibold text-right">Valor</th>
              <th className="p-2 font-semibold">Status</th>
              <th className="p-2 font-semibold">Ações</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <React.Fragment key={String(inv.id ?? inv.number)}>
                <tr className="border-b border-border/60">
                  <td className="p-2">{inv.number ?? "Não informado"}</td>
                  <td className="p-2">{inv.series ?? "—"}</td>
                  <td className="p-2 max-w-[8rem] truncate" title={inv.accessKey ?? undefined}>
                    {inv.accessKey ?? "Não informado"}
                  </td>
                  <td className="p-2">{formatSalesOrderDate(inv.issueDate)}</td>
                  <td className="p-2">{formatSalesOrderDate(inv.processingDate)}</td>
                  <td className="p-2 text-right tabular-nums">
                    {inv.totalValue != null ? formatCurrency(inv.totalValue) : "—"}
                  </td>
                  <td className="p-2">{inv.status ?? "—"}</td>
                  <td className="p-2">
                    <div className="flex flex-col gap-1">
                      {inv.links.map((link) =>
                        link.type === "copy" ? (
                          <button
                            key={link.label}
                            type="button"
                            className="text-left text-primary underline text-[11px]"
                            onClick={() => void navigator.clipboard?.writeText(link.href)}
                          >
                            {link.label}
                          </button>
                        ) : (
                          <a
                            key={link.label}
                            href={link.href}
                            className="text-primary underline text-[11px]"
                          >
                            {link.label}
                          </a>
                        )
                      )}
                    </div>
                  </td>
                </tr>
                <tr className="border-b border-border/40 bg-muted/20">
                  <td colSpan={8} className="p-2">
                    <CollapsibleJson title="Ver dados raw da NF" data={inv.rawSummary ?? {}} />
                  </td>
                </tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (tab === "nomus-data") {
    return (
      <div className="space-y-3" data-testid="sales-order-intelligence-nomus-data">
        {!rawData.orderRawAvailable ? (
          <p className="text-sm text-muted-foreground">
            Dados brutos da integração não disponíveis para este pedido.
          </p>
        ) : (
          <>
            <div>
              <h3 className="text-xs font-bold uppercase text-muted-foreground">
                Chaves principais do raw
              </h3>
              <p className="mt-1 text-xs break-words">{rawData.orderRawKeys.join(", ")}</p>
            </div>
            {rawData.previewTruncated ? (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                Prévia limitada. Dados completos disponíveis no banco.
              </p>
            ) : null}
            <CollapsibleJson title="Raw do pedido (prévia)" data={rawData.orderRawPreview} />
            {rawData.itemsRawPreview.map((item, i) => (
              <div key={`item-raw-${i}`}>
                <CollapsibleJson title={`Raw do item #${i + 1}`} data={item} />
              </div>
            ))}
            {rawData.invoicesRawPreview.map((nfe, i) => (
              <div key={`nfe-raw-${i}`}>
                <CollapsibleJson title={`Raw da NF #${i + 1}`} data={nfe} />
              </div>
            ))}
          </>
        )}
      </div>
    );
  }

  if (tab === "rule-audit") {
    const { logisticStatus, logisticVsExecutive, managementCard } = payload;
    return (
      <div className="space-y-4" data-testid="sales-order-intelligence-rule-audit">
        <div className="rounded-lg border border-border bg-card px-3 py-3">
          <h3 className="text-xs font-bold uppercase text-muted-foreground">
            Status Logístico (BI)
          </h3>
          <p className="text-sm font-semibold mt-1">{logisticStatus.label}</p>
          <p className="text-xs text-muted-foreground mt-2">{logisticStatus.ruleExplanation}</p>
          <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Data planejada</dt>
              <dd className="font-medium">
                {formatSalesOrderDate(logisticStatus.evidence.plannedDeliveryDate)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">NF processada</dt>
              <dd className="font-medium">
                {formatSalesOrderDate(logisticStatus.evidence.invoiceProcessingDate)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Status item (raw)</dt>
              <dd className="font-medium">
                {logisticStatus.evidence.itemStatusCodes.length > 0
                  ? logisticStatus.evidence.itemStatusCodes.join(", ")
                  : "Não informado"}
              </dd>
            </div>
          </dl>
        </div>
        <div className="rounded-lg border border-border bg-card px-3 py-3">
          <h3 className="text-xs font-bold uppercase text-muted-foreground">
            Status gerencial interno (secundário)
          </h3>
          <p className="text-sm font-semibold mt-1">{managementCard.executiveStatusLabel}</p>
        </div>
        {logisticVsExecutive.diverges ? (
          <div
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950"
            data-testid="sales-order-logistic-executive-divergence"
          >
            <p className="font-semibold flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              {logisticVsExecutive.message}
            </p>
          </div>
        ) : null}
        <div>
          <h3 className="text-xs font-bold uppercase text-muted-foreground mb-2">
            Passo a passo das regras
          </h3>
          <ol className="space-y-2">
            {lifecycle.ruleTrace.map((entry, index) => (
              <li
                key={`${entry.rule}-${index}`}
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">
                    Regra {index + 1}: {entry.rule}
                  </p>
                  <SourceBadge source={entry.source} />
                </div>
                <p className="mt-1">
                  Resultado: <span className="font-medium">{entry.result}</span>
                </p>
                {entry.evidence ? (
                  <p className="text-xs text-muted-foreground mt-1">Evidência: {entry.evidence}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
        {risks.length > 0 ? (
          <div>
            <h3 className="text-xs font-bold uppercase text-muted-foreground mb-2">
              Divergências e alertas
            </h3>
            <ul className="space-y-2">
              {risks.map((risk) => (
                <li key={risk.code} className="text-sm flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                  <span>
                    <span className="font-semibold">{risk.title}</span>
                    <span className="text-muted-foreground"> — {risk.description}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div>
          <h3 className="text-xs font-bold uppercase text-muted-foreground">Auditoria</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Gerado em {formatSalesOrderDate(audit.generatedAt)}
          </p>
          <p className="text-xs mt-2">Fontes: {audit.sourcesUsed.join(", ")}</p>
          {audit.missingData.length > 0 ? (
            <p className="text-xs mt-2 text-amber-800">
              Ausentes: {audit.missingData.join(", ")}
            </p>
          ) : null}
        </div>
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

  return (
    <div className="space-y-3" data-testid="sales-order-intelligence-audit-fallback">
      <p className="text-sm text-muted-foreground">Aba não disponível.</p>
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
