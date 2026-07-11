import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Thermometer, X } from "lucide-react";
import {
  formatFinanceCurrency,
  formatFinanceInteger,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import { HttpError } from "@/src/lib/http";
import {
  fetchOrderToCashFunnelDetail,
  type OrderToCashFulfillmentMapDto,
  type OrderToCashFunnelDetailPayload,
} from "@/src/lib/sales/salesOrderToCashFunnelClient";
import {
  ORDER_TO_CASH_FUNNEL_ERROR_FALLBACK,
  TONE_CLASSES,
  temperatureTone,
} from "@/src/lib/sales/salesOrderToCashFunnelUiCopy";
import { cn } from "@/src/lib/utils";
import { PortfolioFulfillmentItemsGrid } from "@/src/components/finance/portfolio-reconciliation/PortfolioFulfillmentItemsGrid";
import { PortfolioFulfillmentDocumentsGrid } from "@/src/components/finance/portfolio-reconciliation/PortfolioFulfillmentDocumentsGrid";
import { PortfolioFulfillmentReceivablesGrid } from "@/src/components/finance/portfolio-reconciliation/PortfolioFulfillmentReceivablesGrid";

type TabId =
  | "resumo"
  | "mapa"
  | "pedido"
  | "documento"
  | "cr"
  | "timeline"
  | "obs";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "resumo", label: "Resumo do funil" },
  { id: "mapa", label: "Mapa de atendimento" },
  { id: "pedido", label: "Pedido e itens" },
  { id: "documento", label: "Documento de saída / NF" },
  { id: "cr", label: "Contas a Receber" },
  { id: "timeline", label: "Timeline" },
  { id: "obs", label: "Dados indisponíveis / observações" },
];

const UNAVAILABLE = "Informação não disponível.";
const OP_UNAVAILABLE = "Ordem de produção não disponível na integração atual.";

function daysBetweenIso(fromIso: string | null | undefined, to = new Date()): number | null {
  if (!fromIso || !/^\d{4}-\d{2}-\d{2}/.test(fromIso)) return null;
  const [y, m, d] = fromIso.slice(0, 10).split("-").map(Number);
  const from = new Date(y!, m! - 1, d!);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#EAECF0] bg-white px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#667085]">{label}</p>
      <p className="mt-1 text-[14px] font-semibold text-[#101828]">{value}</p>
    </div>
  );
}

function BlockCard({
  title,
  tone,
  children,
}: {
  title: string;
  tone: keyof typeof TONE_CLASSES;
  children: React.ReactNode;
}) {
  const t = TONE_CLASSES[tone];
  return (
    <div className={cn("rounded-xl border border-l-4 bg-white p-3 shadow-sm", t.border, t.accent)}>
      <p className={cn("text-[12px] font-semibold uppercase tracking-wide", t.text)}>{title}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">{children}</div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <p className="rounded-xl border border-dashed border-[#EAECF0] bg-[#F9FAFB] px-4 py-8 text-center text-sm text-[#667085]">
      {message}
    </p>
  );
}

function ChainTimeline({ detail }: { detail: OrderToCashFunnelDetailPayload }) {
  const events = detail.timeline ?? [];
  const find = (kinds: string[]) =>
    events.find((e) => kinds.some((k) => e.kind.toUpperCase().includes(k)));

  const steps = [
    {
      label: "Pedido emitido",
      at: detail.order?.issueDate ?? find(["ORDER"])?.at ?? null,
    },
    {
      label: "Previsão entrega",
      at: detail.order?.expectedDeliveryDate ?? find(["DELIVERY"])?.at ?? null,
    },
    {
      label: "Documento",
      at:
        detail.documents.find((d) => d.date)?.date ??
        find(["STOCK", "DOCUMENT", "DOC"])?.at ??
        null,
    },
    {
      label: "NF",
      at: detail.nfes.find((n) => n.processedAt)?.processedAt ?? find(["NFE", "NF"])?.at ?? null,
    },
    {
      label: "CR",
      at:
        detail.receivables.find((r) => r.dueDate)?.dueDate ??
        find(["RECEIVABLE", "DUE", "CR"])?.at ??
        null,
    },
    {
      label: "Baixa",
      at:
        detail.receivables.find((r) => r.settlementDate)?.settlementDate ??
        find(["SETTLE", "BAIXA", "RECEIPT"])?.at ??
        null,
    },
  ];

  return (
    <ol className="space-y-3" data-testid="otc-drawer-chain-timeline">
      {steps.map((step, idx) => (
        <li key={step.label} className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <span
              className={cn(
                "mt-1 h-3 w-3 rounded-full border-2",
                step.at ? "border-[#067647] bg-[#ABEFC6]" : "border-[#D0D5DD] bg-white"
              )}
            />
            {idx < steps.length - 1 ? <span className="mt-1 h-8 w-px bg-[#EAECF0]" /> : null}
          </div>
          <div>
            <p className="text-[13px] font-semibold text-[#101828]">{step.label}</p>
            <p className="text-[12px] text-[#667085]">{step.at ?? "não encontrado"}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function FulfillmentMapView({ map }: { map: OrderToCashFulfillmentMapDto }) {
  const s = map.fulfillmentSummary ?? {};
  const items = (map.orderItemsCoverage ?? []) as Parameters<
    typeof PortfolioFulfillmentItemsGrid
  >[0]["rows"];
  const docs = (map.stockDocumentsCoverage ?? []) as Parameters<
    typeof PortfolioFulfillmentDocumentsGrid
  >[0]["rows"];
  const recs = (map.receivablesCoverage ?? []) as Parameters<
    typeof PortfolioFulfillmentReceivablesGrid
  >[0]["rows"];

  return (
    <div className="space-y-5" data-testid="otc-drawer-fulfillment-map">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <MiniStat label="Valor do pedido" value={formatFinanceCurrency(s.orderValue)} />
        <MiniStat
          label="Valor atribuído"
          value={formatFinanceCurrency(
            s.attributedOrderValueByOrderPrice ?? s.attributedOrderValue
          )}
        />
        <MiniStat
          label="Cabeçalho NF/doc"
          value={formatFinanceCurrency(s.nfeHeaderTotalValue ?? s.nfeHeaderTotal)}
        />
        <MiniStat
          label="Fora deste pedido"
          value={formatFinanceCurrency(
            s.nfeHeaderNotAttributedToOrderValue ?? s.nfeHeaderNotAttributed
          )}
        />
        <MiniStat
          label="% atendimento"
          value={
            s.fulfillmentPercent != null ? formatFinancePercent(s.fulfillmentPercent) : "—"
          }
        />
        <MiniStat
          label="Excedente (qtd)"
          value={formatFinanceInteger(s.totalExcessQuantity ?? 0)}
        />
      </div>
      {s.hasHeaderInflationRisk ? (
        <p className="rounded-xl border border-[#FDBA74] bg-[#FFF6ED] px-3 py-2 text-xs text-[#C2410C]">
          Cabeçalho de NF é maior que o valor do pedido. O cabeçalho não é o valor do pedido e
          não deve ser somado à carteira.
        </p>
      ) : null}
      {s.hasProductsOutsideOrder ? (
        <p className="rounded-xl border border-[#FDBA74] bg-[#FFF6ED] px-3 py-2 text-xs text-[#C2410C]">
          Há produto fora do pedido nos documentos.
        </p>
      ) : null}
      <div>
        <h4 className="text-[14px] font-bold text-[#101828]">Itens do pedido</h4>
        <div className="mt-2">
          <PortfolioFulfillmentItemsGrid rows={items} />
        </div>
      </div>
      <div>
        <h4 className="text-[14px] font-bold text-[#101828]">Documentos / excedentes</h4>
        <div className="mt-2">
          <PortfolioFulfillmentDocumentsGrid rows={docs} />
        </div>
      </div>
      <div>
        <h4 className="text-[14px] font-bold text-[#101828]">CR no mapa</h4>
        <div className="mt-2">
          <PortfolioFulfillmentReceivablesGrid rows={recs} />
        </div>
      </div>
      {map.executiveConclusion ? (
        <p className="rounded-[12px] border border-[#EAECF0] bg-[#F9FAFB] p-4 text-sm text-[#344054]">
          {map.executiveConclusion}
        </p>
      ) : null}
    </div>
  );
}

type Props = {
  salesOrderId: string;
  onClose: () => void;
};

export function OrderToCashFunnelDrawer({ salesOrderId, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderToCashFunnelDetailPayload | null>(null);
  const [tab, setTab] = useState<TabId>("resumo");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTab("resumo");
    void fetchOrderToCashFunnelDetail(salesOrderId)
      .then((payload) => {
        if (cancelled) return;
        if (!payload.ok) {
          setError(payload.message || "Pedido não encontrado no funil.");
          setDetail(payload);
          return;
        }
        setDetail(payload);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg =
          err instanceof HttpError
            ? err.message
            : err instanceof Error
              ? err.message
              : ORDER_TO_CASH_FUNNEL_ERROR_FALLBACK;
        setError(msg || ORDER_TO_CASH_FUNNEL_ERROR_FALLBACK);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [salesOrderId]);

  const classification = detail?.classification;
  const order = detail?.order;
  const map = detail?.fulfillmentMap;
  const summary = map?.fulfillmentSummary;
  const ageDays = daysBetweenIso(order?.issueDate);
  const tempTone = temperatureTone(classification?.temperature ?? "");
  const tClasses = TONE_CLASSES[tempTone];

  const nextDue = useMemo(() => {
    const opens = (detail?.receivables ?? [])
      .filter((r) => (r.openValue ?? 0) > 0.01 && r.dueDate)
      .map((r) => r.dueDate!)
      .sort();
    return opens[0] ?? null;
  }, [detail?.receivables]);

  const openCr = useMemo(
    () =>
      round2(
        (detail?.receivables ?? []).reduce((s, r) => s + Number(r.openValue || 0), 0) ||
          Number(summary?.openReceivableValue || 0)
      ),
    [detail?.receivables, summary?.openReceivableValue]
  );
  const received = useMemo(
    () =>
      round2(
        (detail?.receivables ?? []).reduce((s, r) => s + Number(r.receivedValue || 0), 0) ||
          Number(summary?.receivedValue || 0)
      ),
    [detail?.receivables, summary?.receivedValue]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      data-testid="otc-drawer"
      role="dialog"
      aria-modal="true"
    >
      <button type="button" className="flex-1 cursor-default" aria-label="Fechar" onClick={onClose} />
      <aside
        className="flex h-full w-[75vw] min-w-[720px] max-w-[1200px] flex-col bg-white shadow-xl"
        data-testid="otc-drawer-panel"
      >
        <header className="shrink-0 border-b border-[#EAECF0] px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="text-[12px] font-semibold uppercase text-[#667085]">
                Detalhe — Funil Pedido → Caixa
              </p>
              <h2 className="truncate text-[20px] font-bold text-[#101828]" data-testid="otc-drawer-order">
                {order?.orderCode ?? salesOrderId}
              </h2>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-[#475467]">
                <span>Cliente: {order?.customerName ?? "—"}</span>
                <span>Vendedor: {order?.sellerName ?? "—"}</span>
                <span className="font-semibold text-[#101828]">
                  Valor: {formatFinanceCurrency(order?.orderValue)}
                </span>
              </div>
              {classification ? (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span
                    className="rounded-full border border-[#EAECF0] bg-[#F9FAFB] px-2.5 py-0.5 text-[12px] font-semibold text-[#344054]"
                    data-testid="otc-drawer-stage"
                  >
                    {classification.funnelStageLabel}
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[12px] font-semibold",
                      tClasses.border,
                      tClasses.bg,
                      tClasses.text
                    )}
                    data-testid="otc-drawer-temperature"
                  >
                    <Thermometer className="h-3 w-3" />
                    {classification.temperature}
                  </span>
                  <span className="text-[12px] text-[#667085]">
                    Confiança {classification.confidenceScore} ({classification.confidenceLabel})
                  </span>
                </div>
              ) : null}
              {classification?.actionRecommendation ? (
                <p
                  className="pt-1 text-[13px] font-medium text-[#101828]"
                  data-testid="otc-drawer-action"
                >
                  Ação recomendada: {classification.actionRecommendation}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-[#667085] hover:bg-[#F9FAFB]"
              aria-label="Fechar detalhe"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-20 text-[#667085]">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm">Carregando detalhe…</p>
            </div>
          ) : error && !classification ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-800">
              {error}
            </div>
          ) : classification && order ? (
            <div className="space-y-5">
              <div
                className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4"
                data-testid="otc-drawer-top-cards"
              >
                <BlockCard title="Comercial / Pedido" tone="blue">
                  <MiniStat label="Emissão" value={order.issueDate ?? "—"} />
                  <MiniStat label="Previsão entrega" value={order.expectedDeliveryDate ?? "—"} />
                  <MiniStat label="Valor" value={formatFinanceCurrency(order.orderValue)} />
                  <MiniStat
                    label="Idade do pedido"
                    value={ageDays != null ? `${ageDays} dias` : UNAVAILABLE}
                  />
                </BlockCard>
                <BlockCard title="Operacional" tone="amber">
                  <MiniStat
                    label="Status operacional"
                    value={map?.operationalStatusLabel ?? map?.operationalStatus ?? UNAVAILABLE}
                  />
                  <MiniStat
                    label="% atendimento"
                    value={
                      summary?.fulfillmentPercent != null
                        ? formatFinancePercent(summary.fulfillmentPercent)
                        : UNAVAILABLE
                    }
                  />
                  <MiniStat
                    label="Itens atendidos (qtd)"
                    value={formatFinanceInteger(
                      summary?.totalAttendedQuantityCapped ?? summary?.attendedQuantity ?? 0
                    )}
                  />
                  <MiniStat
                    label="Itens pendentes (qtd)"
                    value={formatFinanceInteger(
                      summary?.totalRemainingQuantity ?? summary?.remainingQuantity ?? 0
                    )}
                  />
                  <MiniStat
                    label="Excedente (qtd)"
                    value={formatFinanceInteger(summary?.totalExcessQuantity ?? 0)}
                  />
                </BlockCard>
                <BlockCard title="Financeiro" tone="green">
                  <MiniStat
                    label="Status financeiro"
                    value={map?.financialStatusLabel ?? map?.financialStatus ?? UNAVAILABLE}
                  />
                  <MiniStat label="CR aberto" value={formatFinanceCurrency(openCr)} />
                  <MiniStat label="Recebido" value={formatFinanceCurrency(received)} />
                  <MiniStat label="Próximo vencimento" value={nextDue ?? UNAVAILABLE} />
                </BlockCard>
                <BlockCard title="Risco / Ação" tone="red">
                  <MiniStat
                    label="Alertas"
                    value={
                      classification.alerts.length
                        ? classification.alerts.join(", ")
                        : "Nenhum alerta"
                    }
                  />
                  <MiniStat
                    label="Responsável sugerido"
                    value={classification.responsibleArea || UNAVAILABLE}
                  />
                  <MiniStat
                    label="Ação recomendada"
                    value={classification.actionRecommendation || UNAVAILABLE}
                  />
                </BlockCard>
              </div>

              <div className="border-b border-[#EAECF0]" data-testid="otc-drawer-tabs">
                <div className="flex flex-wrap gap-1">
                  {TABS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTab(t.id)}
                      className={cn(
                        "rounded-t-lg px-3 py-2 text-[12px] font-semibold",
                        tab === t.id
                          ? "bg-[#F9FAFB] text-[#175CD3] ring-1 ring-[#EAECF0]"
                          : "text-[#667085] hover:bg-[#F9FAFB]"
                      )}
                      data-testid={`otc-drawer-tab-${t.id}`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div data-testid={`otc-drawer-tab-panel-${tab}`}>
                {tab === "resumo" ? (
                  <div className="space-y-3 rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-4">
                    <p className="text-[12px] font-semibold uppercase text-[#667085]">
                      Estágio atual
                    </p>
                    <p className="text-[18px] font-bold text-[#101828]">
                      {classification.funnelStageLabel}
                    </p>
                    <p className="text-[13px] text-[#475467]">{classification.explanation}</p>
                    <p className="text-[13px] text-[#344054]">
                      <strong>Por que está nesse estágio:</strong> evidência{" "}
                      {classification.evidenceSource}; temperatura {classification.temperature}.
                    </p>
                    <p className="text-[13px] text-[#101828]">
                      <strong>Próxima ação:</strong> {classification.actionRecommendation}
                    </p>
                    <p className="text-[13px] text-[#101828]">
                      <strong>Responsável sugerido:</strong> {classification.responsibleArea}
                    </p>
                  </div>
                ) : null}

                {tab === "mapa" ? (
                  map ? (
                    <FulfillmentMapView map={map} />
                  ) : (
                    <EmptyState message="Mapa de atendimento indisponível com os dados atuais." />
                  )
                ) : null}

                {tab === "pedido" ? (
                  <div className="space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <MiniStat label="Código" value={order.orderCode ?? "—"} />
                      <MiniStat label="Status origem" value={order.status ?? UNAVAILABLE} />
                      <MiniStat label="Empresa" value={order.companyName ?? UNAVAILABLE} />
                      <MiniStat
                        label="Valor oficial"
                        value={formatFinanceCurrency(order.orderValue)}
                      />
                    </div>
                    {map?.orderItemsCoverage?.length ? (
                      <PortfolioFulfillmentItemsGrid
                        rows={
                          map.orderItemsCoverage as Parameters<
                            typeof PortfolioFulfillmentItemsGrid
                          >[0]["rows"]
                        }
                      />
                    ) : (
                      <EmptyState message="Informação não disponível." />
                    )}
                  </div>
                ) : null}

                {tab === "documento" ? (
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-[14px] font-bold text-[#101828]">Documentos de saída</h4>
                      {(detail.documents ?? []).length === 0 ? (
                        <div className="mt-2">
                          <EmptyState message="Nenhum documento encontrado." />
                        </div>
                      ) : (
                        <ul className="mt-2 space-y-2">
                          {detail.documents.map((d, i) => (
                            <li
                              key={`${d.stockDocumentExternalId}-${i}`}
                              className="rounded-lg border border-[#EAECF0] px-3 py-2 text-[13px]"
                            >
                              Doc {d.stockDocumentExternalId ?? "—"} · NF{" "}
                              {d.nfeNumber ?? d.nfeExternalId ?? "—"} · {d.date ?? "—"}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div>
                      <h4 className="text-[14px] font-bold text-[#101828]">NFs</h4>
                      {(detail.nfes ?? []).length === 0 ? (
                        <div className="mt-2">
                          <EmptyState message="Nenhuma NF encontrada." />
                        </div>
                      ) : (
                        <ul className="mt-2 space-y-2">
                          {detail.nfes.map((n, i) => (
                            <li
                              key={`${n.nfeExternalId}-${i}`}
                              className="rounded-lg border border-[#EAECF0] px-3 py-2 text-[13px]"
                            >
                              NF {n.nfeNumber ?? n.nfeExternalId ?? "—"} ·{" "}
                              {n.processedAt ?? "—"} ·{" "}
                              {n.headerValue != null
                                ? formatFinanceCurrency(n.headerValue)
                                : "—"}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {map?.stockDocumentsCoverage?.length ? (
                      <PortfolioFulfillmentDocumentsGrid
                        rows={
                          map.stockDocumentsCoverage as Parameters<
                            typeof PortfolioFulfillmentDocumentsGrid
                          >[0]["rows"]
                        }
                      />
                    ) : null}
                  </div>
                ) : null}

                {tab === "cr" ? (
                  <div className="space-y-3">
                    {(detail.receivables ?? []).length === 0 ? (
                      <EmptyState message="Nenhum CR encontrado." />
                    ) : (
                      <div className="overflow-x-auto rounded-xl border border-[#EAECF0]">
                        <table className="min-w-full text-left text-[13px]">
                          <thead className="bg-[#F9FAFB] text-[11px] uppercase text-[#667085]">
                            <tr>
                              <th className="px-3 py-2">Título</th>
                              <th className="px-3 py-2">Vencimento</th>
                              <th className="px-3 py-2">Baixa</th>
                              <th className="px-3 py-2">Total</th>
                              <th className="px-3 py-2">Recebido</th>
                              <th className="px-3 py-2">Aberto</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.receivables.map((r, i) => (
                              <tr key={`${r.receivableId}-${i}`} className="border-t border-[#EAECF0]">
                                <td className="px-3 py-2">{r.receivableId ?? "—"}</td>
                                <td className="px-3 py-2">{r.dueDate ?? "—"}</td>
                                <td className="px-3 py-2">{r.settlementDate ?? "—"}</td>
                                <td className="px-3 py-2">
                                  {formatFinanceCurrency(r.totalValue)}
                                </td>
                                <td className="px-3 py-2">
                                  {formatFinanceCurrency(r.receivedValue)}
                                </td>
                                <td className="px-3 py-2">
                                  {formatFinanceCurrency(r.openValue)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : null}

                {tab === "timeline" ? <ChainTimeline detail={detail} /> : null}

                {tab === "obs" ? (
                  <div className="space-y-3" data-testid="otc-drawer-observations">
                    <div className="rounded-xl border border-[#FEDF89] bg-[#FFFAEB] px-4 py-3 text-[13px] text-[#B54708]">
                      {OP_UNAVAILABLE}
                    </div>
                    {(detail.warnings ?? []).length ? (
                      <ul className="space-y-2">
                        {detail.warnings.map((w, i) => (
                          <li
                            key={i}
                            className="rounded-lg border border-[#EAECF0] bg-[#F9FAFB] px-3 py-2 text-[13px] text-[#475467]"
                          >
                            {w}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <EmptyState message="Informação não disponível." />
                    )}
                    {detail.freshness?.laymanNotice ? (
                      <p className="text-[12px] text-[#667085]">{detail.freshness.laymanNotice}</p>
                    ) : null}
                    {detail.executiveConclusion ? (
                      <p className="rounded-xl border border-[#B2DDFF] bg-[#EFF8FF] px-4 py-3 text-[13px] text-[#175CD3]">
                        {detail.executiveConclusion}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}
