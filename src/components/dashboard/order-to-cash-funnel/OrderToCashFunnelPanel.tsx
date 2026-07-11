import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Loader2,
  RefreshCw,
  Thermometer,
} from "lucide-react";
import { MetricHelpTooltip } from "@/src/components/finance/portfolio-reconciliation/PortfolioIntelligenceHelpPopover";
import { OrderToCashFunnelDrawer } from "@/src/components/dashboard/order-to-cash-funnel/OrderToCashFunnelDrawer";
import { OrderToCashFunnelEntityKpis } from "@/src/components/dashboard/order-to-cash-funnel/OrderToCashFunnelEntityKpis";
import { OrderToCashFunnelFiltersBar } from "@/src/components/dashboard/order-to-cash-funnel/OrderToCashFunnelFiltersBar";
import {
  formatFinanceCurrency,
  formatFinanceCurrencyCompact,
  formatFinanceInteger,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  createDefaultOrderToCashFunnelUiFilters,
  fetchOrderToCashFunnelList,
  type OrderToCashFunnelListPayload,
  type OrderToCashFunnelListRowDto,
  type OrderToCashFunnelSummaryCardDto,
  type OrderToCashFunnelUiFilters,
} from "@/src/lib/sales/salesOrderToCashFunnelClient";
import {
  CARD_BLOCK_A_KEYS,
  CARD_BLOCK_B_KEYS,
  CARD_BLOCK_C_KEYS,
  ORDER_TO_CASH_CARD_HELP,
  ORDER_TO_CASH_FUNNEL_EMPTY,
  ORDER_TO_CASH_FUNNEL_ERROR_FALLBACK,
  ORDER_TO_CASH_FUNNEL_LOADING,
  ORDER_TO_CASH_FUNNEL_PROPOSAL_NOTICE,
  ORDER_TO_CASH_FUNNEL_SUBTITLE,
  ORDER_TO_CASH_FUNNEL_TITLE,
  ORDER_TO_CASH_RISK_LANE,
  ORDER_TO_CASH_VISUAL_FUNNEL,
  TONE_CLASSES,
  temperatureTone,
} from "@/src/lib/sales/salesOrderToCashFunnelUiCopy";
import { cn } from "@/src/lib/utils";
import { HttpError } from "@/src/lib/http";

function cardByKey(
  cards: OrderToCashFunnelSummaryCardDto[],
  key: string
): OrderToCashFunnelSummaryCardDto | null {
  return cards.find((c) => c.key === key) ?? null;
}

function synthExcessCard(payload: OrderToCashFunnelListPayload): OrderToCashFunnelSummaryCardDto {
  const value =
    Number(payload.riskSummary.valorComExcesso || 0) +
    Number(payload.riskSummary.valorComProdutoForaDoPedido || 0);
  const count = payload.riskSummary.topRisks.filter((r) =>
    /excedente|produto fora|alerta/i.test(r.reason)
  ).length;
  return {
    key: "excesso_produto_fora",
    title: "Excesso / produto fora",
    value,
    count,
    percent: null,
    group: "RISCO_REF",
    severity: "warning",
    explanation:
      payload.riskSummary.note ||
      "Referência de alertas técnicos — não soma carteira além do estágio principal.",
    doesNotSumPortfolio: true,
  };
}

function severityTone(card: OrderToCashFunnelSummaryCardDto): keyof typeof TONE_CLASSES {
  if (card.key === "recebido" || card.key === "pedido_futuro_saudavel") return "green";
  if (card.key === "cr_aberto") return "blue";
  if (card.key === "pedido_bloqueado_revisao" || card.key === "forecast_em_risco") return "red";
  if (card.key === "excesso_produto_fora" || card.key === "documento_nf_sem_cr") return "orange";
  if (card.key === "pedido_em_atencao" || card.key === "pedido_parcialmente_atendido") return "amber";
  if (card.severity === "success") return "green";
  if (card.severity === "danger") return "red";
  if (card.severity === "warning") return "amber";
  return "gray";
}

function KpiCard({ card }: { card: OrderToCashFunnelSummaryCardDto }) {
  const tone = TONE_CLASSES[severityTone(card)];
  const help = ORDER_TO_CASH_CARD_HELP[card.key];
  return (
    <div
      className={cn(
        "relative rounded-xl border border-l-4 bg-white p-4 shadow-sm",
        tone.border,
        tone.accent
      )}
      data-testid={`otc-card-${card.key}`}
    >
      <div className="absolute right-2 top-2">
        <MetricHelpTooltip
          title={card.title}
          explanation={help}
          missingExplanation={!help}
          showOperationalNotice
          corner
        />
      </div>
      <p className="pr-8 text-[12px] font-semibold uppercase tracking-wide text-[#667085]">
        {card.title}
      </p>
      <p className={cn("mt-2 text-[24px] font-bold tabular-nums leading-none", tone.text)}>
        {formatFinanceCurrencyCompact(card.value)}
      </p>
      <p className="mt-2 text-[12px] text-[#667085]">
        {formatFinanceInteger(card.count)} pedido(s)
        {card.percent != null ? ` · ${formatFinancePercent(card.percent)}` : ""}
        {card.doesNotSumPortfolio ? " · não soma carteira" : ""}
      </p>
    </div>
  );
}

function CardBlock({
  title,
  description,
  cards,
}: {
  title: string;
  description: string;
  cards: OrderToCashFunnelSummaryCardDto[];
}) {
  return (
    <section className="space-y-3" data-testid={`otc-block-${title}`}>
      <div>
        <h3 className="text-[14px] font-bold text-[#101828]">{title}</h3>
        <p className="text-[12px] text-[#475467]">{description}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <KpiCard key={c.key} card={c} />
        ))}
      </div>
    </section>
  );
}

function VisualFunnel({
  stages,
}: {
  stages: OrderToCashFunnelListPayload["funnelStages"];
}) {
  const byCode = useMemo(() => new Map(stages.map((s) => [s.stage, s])), [stages]);

  const nodes = ORDER_TO_CASH_VISUAL_FUNNEL.map((node) => {
    let count = 0;
    let value = 0;
    let pctSum = 0;
    let pctN = 0;
    for (const code of node.stages) {
      const s = byCode.get(code);
      if (!s) continue;
      count += s.count;
      value += s.value;
      if (s.percentOfTotal != null) {
        pctSum += s.percentOfTotal;
        pctN += 1;
      }
    }
    return { ...node, count, value, percent: pctN ? pctSum : null };
  });

  const risk = (() => {
    let count = 0;
    let value = 0;
    for (const code of ORDER_TO_CASH_RISK_LANE.stages) {
      const s = byCode.get(code);
      if (!s) continue;
      count += s.count;
      value += s.value;
    }
    return { ...ORDER_TO_CASH_RISK_LANE, count, value };
  })();

  return (
    <section className="space-y-4" data-testid="otc-visual-funnel">
      <div>
        <h3 className="text-[16px] font-bold text-[#101828]">Funil visual</h3>
        <p className="text-[12px] text-[#475467]">
          Sequência Pedido → Caixa. Valores vêm da API (um estágio principal por pedido).
        </p>
      </div>
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max items-stretch gap-2">
          {nodes.map((node, idx) => {
            const tone = TONE_CLASSES[node.tone];
            return (
              <React.Fragment key={node.id}>
                <div
                  className={cn(
                    "w-[160px] rounded-xl border border-l-4 bg-white p-3 shadow-sm",
                    tone.border,
                    tone.accent
                  )}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#667085]">
                    {node.label}
                  </p>
                  <p className={cn("mt-2 text-[20px] font-bold tabular-nums", tone.text)}>
                    {formatFinanceCurrencyCompact(node.value)}
                  </p>
                  <p className="mt-1 text-[12px] text-[#667085]">
                    {formatFinanceInteger(node.count)}
                    {node.percent != null ? ` · ${formatFinancePercent(node.percent)}` : ""}
                  </p>
                </div>
                {idx < nodes.length - 1 ? (
                  <div className="flex items-center text-[#98A2B3]" aria-hidden>
                    <ArrowRight className="h-5 w-5" />
                  </div>
                ) : null}
              </React.Fragment>
            );
          })}
        </div>
      </div>
      <div
        className={cn(
          "rounded-xl border border-l-4 p-4",
          TONE_CLASSES.red.border,
          TONE_CLASSES.red.bg,
          TONE_CLASSES.red.accent
        )}
        data-testid="otc-risk-lane"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Ban className={cn("h-5 w-5", TONE_CLASSES.red.text)} />
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-[#B42318]">
              Raia de risco — {risk.label}
            </p>
            <p className="text-[13px] text-[#B42318]">
              {formatFinanceCurrencyCompact(risk.value)} · {formatFinanceInteger(risk.count)}{" "}
              pedido(s)
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function OrdersGrid({
  rows,
  onSelect,
}: {
  rows: OrderToCashFunnelListRowDto[];
  onSelect: (row: OrderToCashFunnelListRowDto) => void;
}) {
  return (
    <section className="space-y-3" data-testid="otc-orders-grid">
      <h3 className="text-[16px] font-bold text-[#101828]">Pedidos do funil</h3>
      <div className="overflow-x-auto rounded-xl border border-[#EAECF0] bg-white">
        <table className="min-w-full text-left text-[13px]">
          <thead className="bg-[#F9FAFB] text-[11px] uppercase tracking-wide text-[#667085]">
            <tr>
              {[
                "Pedido",
                "Cliente",
                "Vendedor",
                "Emissão",
                "Previsão entrega",
                "Valor",
                "Estágio",
                "Temperatura",
                "Confiança",
                "Status operacional",
                "Status financeiro",
                "Alertas",
                "Ação recomendada",
              ].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2.5 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const tTone = TONE_CLASSES[temperatureTone(row.temperature)];
              return (
                <tr
                  key={row.salesOrderId}
                  className="cursor-pointer border-t border-[#EAECF0] hover:bg-[#F9FAFB]"
                  onClick={() => onSelect(row)}
                >
                  <td className="px-3 py-2.5 font-semibold text-[#175CD3]">
                    {row.orderCode ?? row.salesOrderId}
                  </td>
                  <td className="px-3 py-2.5">{row.customerName ?? "—"}</td>
                  <td className="px-3 py-2.5">{row.sellerName ?? "—"}</td>
                  <td className="px-3 py-2.5 tabular-nums">{row.issueDate ?? "—"}</td>
                  <td className="px-3 py-2.5 tabular-nums">{row.expectedDeliveryDate ?? "—"}</td>
                  <td className="px-3 py-2.5 tabular-nums font-medium">
                    {formatFinanceCurrency(row.orderValue)}
                  </td>
                  <td className="px-3 py-2.5">{row.funnelStageLabel}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                        tTone.border,
                        tTone.bg,
                        tTone.text
                      )}
                    >
                      <Thermometer className="h-3 w-3" />
                      {row.temperature}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {row.confidenceScore} ({row.confidenceLabel})
                  </td>
                  <td className="px-3 py-2.5">{row.operationalStatus ?? "—"}</td>
                  <td className="px-3 py-2.5">{row.financialStatus ?? "—"}</td>
                  <td className="max-w-[180px] truncate px-3 py-2.5" title={row.alerts.join(", ")}>
                    {row.alerts.length ? row.alerts.join(", ") : "—"}
                  </td>
                  <td
                    className="max-w-[220px] truncate px-3 py-2.5"
                    title={row.actionRecommendation}
                  >
                    {row.actionRecommendation}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Aba Funil Pedido → Caixa (Dashboard). Consome apenas API read-only. */
export function OrderToCashFunnelPanel() {
  const [draft, setDraft] = useState(createDefaultOrderToCashFunnelUiFilters);
  const [applied, setApplied] = useState(createDefaultOrderToCashFunnelUiFilters);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<OrderToCashFunnelListPayload | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const applyFilters = useCallback((next: OrderToCashFunnelUiFilters) => {
    const normalized = { ...next, page: 1 };
    setDraft(normalized);
    setApplied(normalized);
  }, []);

  const load = useCallback(async (filters: OrderToCashFunnelUiFilters) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchOrderToCashFunnelList(filters);
      setPayload(data);
    } catch (err) {
      const msg =
        err instanceof HttpError
          ? err.message
          : err instanceof Error
            ? err.message
            : ORDER_TO_CASH_FUNNEL_ERROR_FALLBACK;
      setError(msg || ORDER_TO_CASH_FUNNEL_ERROR_FALLBACK);
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(applied);
  }, [applied, load]);

  const cards = payload?.summaryCards ?? [];
  const blockA = CARD_BLOCK_A_KEYS.map((k) => cardByKey(cards, k)).filter(
    Boolean
  ) as OrderToCashFunnelSummaryCardDto[];
  const blockBBase = CARD_BLOCK_B_KEYS.filter((k) => k !== "excesso_produto_fora")
    .map((k) => cardByKey(cards, k))
    .filter(Boolean) as OrderToCashFunnelSummaryCardDto[];
  const blockB = payload ? [...blockBBase, synthExcessCard(payload)] : blockBBase;
  const blockC = CARD_BLOCK_C_KEYS.map((k) => cardByKey(cards, k)).filter(
    Boolean
  ) as OrderToCashFunnelSummaryCardDto[];

  const empty =
    !loading &&
    !error &&
    payload != null &&
    (payload.pagination.totalItems === 0 || payload.rows.length === 0);

  return (
    <div className="space-y-6" data-testid="order-to-cash-funnel-panel">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2
              className="text-[24px] font-bold leading-tight text-[#101828]"
              data-testid="otc-title"
            >
              {ORDER_TO_CASH_FUNNEL_TITLE}
            </h2>
            <p className="mt-1 text-[14px] text-[#475467]" data-testid="otc-subtitle">
              {ORDER_TO_CASH_FUNNEL_SUBTITLE}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(applied)}
            className="inline-flex items-center gap-2 rounded-lg border border-[#EAECF0] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#F9FAFB]"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Atualizar
          </button>
        </div>
        <div
          className="rounded-[12px] border border-[#FEDF89] bg-[#FFFAEB] p-4 text-[13px] text-[#B54708]"
          data-testid="otc-proposal-notice"
        >
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{ORDER_TO_CASH_FUNNEL_PROPOSAL_NOTICE}</p>
          </div>
        </div>
      </header>

      <OrderToCashFunnelFiltersBar
        draft={draft}
        applied={applied}
        expanded={filtersExpanded}
        onToggle={() => setFiltersExpanded((v) => !v)}
        onDraftChange={setDraft}
        onApply={() => applyFilters(draft)}
        onClear={() => applyFilters(createDefaultOrderToCashFunnelUiFilters())}
        onApplyFilters={applyFilters}
      />

      {loading && !payload ? (
        <div
          className="flex flex-col items-center justify-center gap-3 py-24 text-[#667085]"
          data-testid="otc-loading"
        >
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm font-medium">{ORDER_TO_CASH_FUNNEL_LOADING}</p>
        </div>
      ) : null}

      {error && !payload ? (
        <div
          className="rounded-xl border border-red-200 bg-red-50 px-6 py-10 text-center"
          data-testid="otc-error"
        >
          <h3 className="text-lg font-semibold text-[#101828]">Não foi possível carregar o funil</h3>
          <p className="mt-2 text-sm text-[#475467]">{error}</p>
          <button
            type="button"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            onClick={() => void load(applied)}
          >
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </button>
        </div>
      ) : null}

      {payload ? (
        <>
          {payload.dataFreshness?.laymanNotice ? (
            <p className="text-[12px] text-[#667085]">{payload.dataFreshness.laymanNotice}</p>
          ) : null}

          <div className="space-y-8" data-testid="otc-executive-blocks">
            <CardBlock
              title="Comercial / Pedido"
              description="Carteira de pedidos e maturidade comercial."
              cards={blockA}
            />
            <CardBlock
              title="Execução"
              description="Atendimento, documento/NF e alertas técnicos."
              cards={blockB}
            />
            <CardBlock
              title="Financeiro"
              description="CR, baixa e forecast em risco (referência)."
              cards={blockC}
            />
          </div>

          <VisualFunnel stages={payload.funnelStages} />

          <OrderToCashFunnelEntityKpis
            sellers={payload.sellerSummary ?? []}
            customers={payload.customerSummary ?? []}
            activeSellerName={applied.sellerName}
            activeSellerId={applied.sellerId}
            activeCustomerName={applied.customerName}
            activeCustomerId={applied.customerId}
            onFilterSeller={(row) =>
              applyFilters({
                ...applied,
                sellerId: row.sellerId ?? "",
                sellerName:
                  row.sellerName === "Sem vendedor informado" ||
                  (row.sellerId && row.sellerName === `Vendedor ${row.sellerId}`)
                    ? ""
                    : row.sellerName,
                customerId: "",
                customerName: "",
              })
            }
            onFilterCustomer={(row) =>
              applyFilters({
                ...applied,
                customerId: row.customerId ?? "",
                customerName:
                  row.customerName === "Cliente sem nome" ||
                  (row.customerId && row.customerName === `Cliente ${row.customerId}`)
                    ? ""
                    : row.customerName,
                sellerId: "",
                sellerName: "",
              })
            }
          />

          {empty ? (
            <div
              className="rounded-xl border border-dashed border-[#EAECF0] bg-[#F9FAFB] px-6 py-12 text-center text-sm text-[#667085]"
              data-testid="otc-empty"
            >
              {ORDER_TO_CASH_FUNNEL_EMPTY}
            </div>
          ) : (
            <>
              <OrdersGrid rows={payload.rows} onSelect={(row) => setSelectedId(row.salesOrderId)} />
              {payload.pagination.totalPages > 1 ? (
                <div className="flex items-center justify-between text-sm text-[#475467]">
                  <span>
                    Página {payload.pagination.page} de {payload.pagination.totalPages} ·{" "}
                    {formatFinanceInteger(payload.pagination.totalItems)} pedidos
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={applied.page <= 1}
                      className="rounded-lg border border-[#EAECF0] px-3 py-1.5 disabled:opacity-40"
                      onClick={() => setApplied((a) => ({ ...a, page: Math.max(1, a.page - 1) }))}
                    >
                      Anterior
                    </button>
                    <button
                      type="button"
                      disabled={applied.page >= payload.pagination.totalPages}
                      className="rounded-lg border border-[#EAECF0] px-3 py-1.5 disabled:opacity-40"
                      onClick={() =>
                        setApplied((a) => ({
                          ...a,
                          page: Math.min(payload.pagination.totalPages, a.page + 1),
                        }))
                      }
                    >
                      Próxima
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </>
      ) : null}

      {selectedId ? (
        <OrderToCashFunnelDrawer salesOrderId={selectedId} onClose={() => setSelectedId(null)} />
      ) : null}
    </div>
  );
}
