/**
 * Compras › Performance › Condições de compra — Qualidade das Condições de Compra.
 *
 * Somente apresenta o read model de /api/purchases/performance/payment-terms (PMP desde a
 * emissão, gap, oportunidade de capital de giro). Nenhum cálculo de prazo no frontend.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Save } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { usePermissions } from "@/src/hooks/usePermissions";
import { OPERATIONS_ACTIONS, OPERATIONS_RESOURCE_KEYS } from "@/src/lib/operationsAccess";
import { PAYMENT_TERMS_BUCKETS, PAYMENT_TERMS_BUCKET_LABELS, type PaymentTermsBucket } from "@/src/lib/purchasing/purchasePaymentTerms";
import {
  OPPORTUNITY_RELIABILITY_LABELS,
  type PaymentTermsAnalysis,
  type PaymentTermsOrderRow,
  type PaymentTermsPeriod,
} from "@/src/lib/purchasing/purchasePaymentTermsAnalysis";
import {
  PAYMENT_TERMS_PERIOD_PRESETS,
  formatPaymentTermsDate,
  formatPaymentTermsDays,
  formatPaymentTermsGap,
  formatPaymentTermsMoney,
  formatPaymentTermsMonth,
  formatPaymentTermsPercent,
  paymentTermsDelta,
  paymentTermsPeriodFromPreset,
  type PaymentTermsPeriodPresetId,
} from "@/src/lib/purchasing/purchasePaymentTermsUi";
import type { SupplierPerformanceViewId } from "@/src/lib/purchasing/supplierPerformanceDashboardUi";
import { Overlay, OverlayBody, OverlayHeader } from "@/src/components/ui/overlay";
import { DashboardSection } from "./SupplierPerformanceSections";
import { SupplierPerformanceKpiCard } from "./SupplierPerformanceKpiCard";
import { PERFORMANCE_CONTROL_CLASS, PERFORMANCE_FIELD_LABEL_CLASS, SupplierPerformanceShell } from "./SupplierPerformanceShell";

export const PURCHASE_PAYMENT_TERMS_API = "/api/purchases/performance/payment-terms";

type AnalysisResponse = PaymentTermsAnalysis & {
  settings: { targetPmpDays: number | null; updatedAt: string | null; updatedByUserName: string | null };
};

type SupplierDetailResponse = {
  supplier: PaymentTermsAnalysis["suppliers"][number] | null;
  monthly: PaymentTermsAnalysis["monthly"];
  orders: Array<{
    id: string;
    orderNumber: string | null;
    externalId: number;
    issuedDate: string | null;
    purchaseAmount: number;
    canceled: boolean;
    pmpDays: number | null;
    gapDays: number | null;
    belowTarget: boolean | null;
    result:
      | { status: "IDENTIFIED"; label: string; installments: Array<{ index: number; dueDate: string; amount: number; days: number }> }
      | { status: "NOT_IDENTIFIED"; reason: string };
  }>;
  baseNote: string;
};

const tableClass = "min-w-full text-xs";
const th = "px-2 py-2 text-left font-semibold uppercase tracking-wide text-[10px] text-muted-foreground";
const td = "px-2 py-1.5 align-top";

function periodQuery(period: PaymentTermsPeriod, extra: Record<string, string | null> = {}) {
  const params = new URLSearchParams({ from: period.from, to: period.to });
  for (const [k, v] of Object.entries(extra)) if (v) params.set(k, v);
  return params.toString();
}

export function PurchasePaymentTermsPage({
  view,
  onViewChange,
}: {
  view: SupplierPerformanceViewId;
  onViewChange: (next: SupplierPerformanceViewId) => void;
}) {
  const permissions = usePermissions();
  const canManage = permissions.canPerformAction(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.approve);
  const [preset, setPreset] = useState<PaymentTermsPeriodPresetId>("currentMonth");
  const [period, setPeriod] = useState<PaymentTermsPeriod>(() => paymentTermsPeriodFromPreset("currentMonth"));
  const [supplier, setSupplier] = useState("");
  const [buyer, setBuyer] = useState("");
  const [bucket, setBucket] = useState<PaymentTermsBucket | "">("");
  const [identification, setIdentification] = useState<"" | "IDENTIFIED" | "NOT_IDENTIFIED">("");
  const [targetFilter, setTargetFilter] = useState<"" | "BELOW" | "MEETS">("");
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [options, setOptions] = useState<{ suppliers: Array<{ id: number; name: string }>; buyers: number[] }>({ suppliers: [], buyers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [drillSupplier, setDrillSupplier] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchJsonOk<AnalysisResponse>(`${PURCHASE_PAYMENT_TERMS_API}?${periodQuery(period, { supplier, buyer })}`)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        if (!supplier && !buyer) {
          setOptions({
            suppliers: res.suppliers
              .filter((s) => s.supplierExternalId != null)
              .map((s) => ({ id: s.supplierExternalId as number, name: s.supplierName }))
              .sort((a, b) => a.name.localeCompare(b.name)),
            buyers: res.buyers.map((b) => b.buyerPersonId).filter((id): id is number => id != null).sort((a, b) => a - b),
          });
        }
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Erro ao carregar."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [period, supplier, buyer, reload]);

  const target = data?.settings.targetPmpDays ?? null;
  const p = data?.portfolio;
  const delta = paymentTermsDelta(p?.pmpDays ?? null, data?.previous?.pmpDays ?? null);

  const filteredOrders = useMemo(
    () =>
      (data?.orders ?? []).filter(
        (o: PaymentTermsOrderRow) =>
          (!bucket || o.bucket === bucket) &&
          (!identification || o.status === identification) &&
          (!targetFilter || (targetFilter === "BELOW" ? o.belowTarget === true : o.belowTarget === false)),
      ),
    [data, bucket, identification, targetFilter],
  );

  const filters = (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3" data-testid="payment-terms-filters">
      <label className="flex min-w-[10rem] flex-col gap-1">
        <span className={PERFORMANCE_FIELD_LABEL_CLASS}>Período (emissão)</span>
        <select
          className={PERFORMANCE_CONTROL_CLASS}
          value={preset}
          onChange={(e) => {
            const next = e.target.value as PaymentTermsPeriodPresetId;
            setPreset(next);
            if (next !== "custom") setPeriod(paymentTermsPeriodFromPreset(next));
          }}
          data-testid="payment-terms-period"
        >
          {PAYMENT_TERMS_PERIOD_PRESETS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {preset === "custom" ? (
        <>
          <label className="flex flex-col gap-1">
            <span className={PERFORMANCE_FIELD_LABEL_CLASS}>De</span>
            <input type="date" className={PERFORMANCE_CONTROL_CLASS} value={period.from} onChange={(e) => e.target.value && setPeriod((p0) => ({ ...p0, from: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={PERFORMANCE_FIELD_LABEL_CLASS}>Até</span>
            <input type="date" className={PERFORMANCE_CONTROL_CLASS} value={period.to} onChange={(e) => e.target.value && setPeriod((p0) => ({ ...p0, to: e.target.value }))} />
          </label>
        </>
      ) : null}
      <label className="flex min-w-[12rem] flex-col gap-1">
        <span className={PERFORMANCE_FIELD_LABEL_CLASS}>Fornecedor</span>
        <select className={PERFORMANCE_CONTROL_CLASS} value={supplier} onChange={(e) => setSupplier(e.target.value)} data-testid="payment-terms-supplier">
          <option value="">Todos</option>
          {options.suppliers.map((s) => (
            <option key={s.id} value={String(s.id)}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-[10rem] flex-col gap-1">
        <span className={PERFORMANCE_FIELD_LABEL_CLASS}>Comprador</span>
        <select className={PERFORMANCE_CONTROL_CLASS} value={buyer} onChange={(e) => setBuyer(e.target.value)} data-testid="payment-terms-buyer">
          <option value="">Todos</option>
          {options.buyers.map((id) => (
            <option key={id} value={String(id)}>
              Comprador #{id}
            </option>
          ))}
        </select>
      </label>
      <TargetEditor
        target={target}
        updatedAt={data?.settings.updatedAt ?? null}
        updatedBy={data?.settings.updatedByUserName ?? null}
        canManage={canManage}
        onSaved={() => setReload((n) => n + 1)}
      />
    </div>
  );

  return (
    <SupplierPerformanceShell
      view={view}
      onViewChange={onViewChange}
      title="Qualidade das Condições de Compra"
      description="Prazo médio ponderado (PMP) desde a emissão dos Pedidos de Compra Nomus, gap em relação à meta e onde negociar prazo."
      filtersSlot={filters}
    >
      <div className="space-y-6" data-testid="payment-terms-page">
        {error ? <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        {loading && !data ? (
          <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Calculando prazos…
          </p>
        ) : null}
        {data && p ? (
          <>
            <p className="rounded-md border border-border bg-white px-3 py-2 text-xs text-muted-foreground" data-testid="payment-terms-base-note">
              <strong className="text-foreground">{data.baseLabel}.</strong> {data.baseNote}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="payment-terms-kpis">
              <SupplierPerformanceKpiCard
                testId="kpi-pmp"
                label="PMP das compras"
                value={formatPaymentTermsDays(p.pmpDays)}
                hint={
                  delta == null
                    ? "Sem período anterior comparável"
                    : `${delta >= 0 ? "+" : "−"}${Math.abs(delta)} d vs. período anterior (${formatPaymentTermsDays(data.previous?.pmpDays)})`
                }
                unavailableReason={p.pmpDays == null ? "Nenhuma compra com prazo identificado no período." : null}
              />
              <SupplierPerformanceKpiCard
                testId="kpi-target"
                label="Meta de prazo"
                value={target == null ? "Não configurada" : formatPaymentTermsDays(target)}
                hint={target == null ? "Sem meta, nada é classificado como bom ou ruim." : "Referência gerencial (informativa)"}
              />
              <SupplierPerformanceKpiCard
                testId="kpi-gap"
                label="Gap médio ponderado"
                value={formatPaymentTermsGap(p.gapDays)}
                tone={p.gapDays != null && p.gapDays < 0 ? "warning" : "neutral"}
                hint="PMP da carteira − meta"
                unavailableReason={target == null ? "Configure a meta de PMP." : null}
              />
              <SupplierPerformanceKpiCard
                testId="kpi-below"
                label="Valor comprado abaixo da meta"
                value={formatPaymentTermsPercent(p.belowTargetPercent)}
                hint={p.belowTargetAmount != null ? `${formatPaymentTermsMoney(p.belowTargetAmount)} em ${p.belowTargetCount} pedido(s)` : undefined}
                unavailableReason={target == null ? "Configure a meta de PMP." : null}
              />
              <SupplierPerformanceKpiCard
                testId="kpi-identified"
                label="Valor com PMP identificado"
                value={formatPaymentTermsMoney(p.identifiedPurchaseAmount)}
                hint={`${p.identifiedCount} de ${p.orderCount} pedido(s) · total ${formatPaymentTermsMoney(p.purchaseAmount)}`}
              />
              <SupplierPerformanceKpiCard
                testId="kpi-coverage"
                label="Cobertura dos dados"
                value={formatPaymentTermsPercent(p.coveragePercentByValue)}
                hint={`por valor · ${formatPaymentTermsPercent(p.coveragePercentByCount)} por quantidade`}
              />
              <SupplierPerformanceKpiCard
                testId="kpi-potential"
                label="Capital de giro potencial (estimado)"
                value={formatPaymentTermsMoney(p.potentialWorkingCapital)}
                tooltip={data.opportunityNote}
                hint="Soma das estimativas por fornecedor"
                unavailableReason={target == null ? "Configure a meta de PMP." : null}
              />
              <SupplierPerformanceKpiCard
                testId="kpi-excluded"
                label="Fora da carteira"
                value={`${data.excluded.canceledCount} cancelado(s)`}
                hint={formatPaymentTermsMoney(data.excluded.canceledAmount)}
              />
            </div>

            {data.notIdentifiedByReason.length > 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="payment-terms-not-identified">
                Sem prazo identificado (fora da média, dentro da cobertura):{" "}
                {data.notIdentifiedByReason.map((r) => `${r.count} — ${REASON_TEXT[r.reason] ?? r.reason} (${formatPaymentTermsMoney(r.amount)})`).join("; ")}.
              </p>
            ) : null}

            <DashboardSection
              title="Fornecedores prioritários para negociação"
              description={`Ordenado pela oportunidade estimada de capital de giro. ${data.opportunityNote}`}
              testId="payment-terms-suppliers"
            >
              <div className="overflow-x-auto rounded-lg border border-border bg-white">
                <table className={tableClass}>
                  <thead className="bg-muted/40">
                    <tr>
                      <th className={th}>#</th>
                      <th className={th}>Fornecedor</th>
                      <th className={th}>Valor comprado</th>
                      <th className={th}>Pedidos</th>
                      <th className={th}>PMP</th>
                      <th className={th}>Meta</th>
                      <th className={th}>Gap</th>
                      <th className={th}>Dados completos</th>
                      <th className={th}>Compras/mês ref.</th>
                      <th className={th}>Capital potencial</th>
                      <th className={th}>Confiabilidade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.suppliers.length === 0 ? (
                      <tr>
                        <td className={td} colSpan={11}>
                          Nenhuma compra no período.
                        </td>
                      </tr>
                    ) : (
                      data.suppliers.slice(0, 30).map((s, i) => (
                        <tr key={s.key} className="border-t border-border/60">
                          <td className={`${td} tabular-nums`}>{i + 1}</td>
                          <td className={td}>
                            {s.supplierExternalId != null ? (
                              <button type="button" className="text-left text-primary hover:underline" onClick={() => setDrillSupplier(s.supplierExternalId)}>
                                {s.supplierName}
                              </button>
                            ) : (
                              s.supplierName
                            )}
                          </td>
                          <td className={`${td} tabular-nums`}>{formatPaymentTermsMoney(s.purchaseAmount)}</td>
                          <td className={`${td} tabular-nums`}>{s.orderCount}</td>
                          <td className={`${td} tabular-nums`}>{formatPaymentTermsDays(s.pmpDays)}</td>
                          <td className={`${td} tabular-nums`}>{target == null ? "—" : formatPaymentTermsDays(target)}</td>
                          <td className={`${td} tabular-nums ${s.gapDays != null && s.gapDays < 0 ? "text-amber-700" : ""}`}>{formatPaymentTermsGap(s.gapDays)}</td>
                          <td className={`${td} tabular-nums`}>{formatPaymentTermsPercent(s.coveragePercentByValue)}</td>
                          <td className={`${td} tabular-nums`}>{formatPaymentTermsMoney(s.monthlyVolume)}</td>
                          <td className={`${td} tabular-nums font-semibold`}>{formatPaymentTermsMoney(s.potentialWorkingCapital)}</td>
                          <td className={td} title={s.reliabilityReason ?? undefined}>
                            {OPPORTUNITY_RELIABILITY_LABELS[s.reliability]}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </DashboardSection>

            <div className="grid gap-6 xl:grid-cols-2">
              <DashboardSection title="Evolução mensal do PMP" description="Por mês de emissão do pedido." testId="payment-terms-monthly">
                <div className="overflow-x-auto rounded-lg border border-border bg-white">
                  <table className={tableClass}>
                    <thead className="bg-muted/40">
                      <tr>
                        <th className={th}>Mês</th>
                        <th className={th}>PMP</th>
                        <th className={th}>Gap</th>
                        <th className={th}>Valor comprado</th>
                        <th className={th}>Cobertura</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.monthly.map((m) => (
                        <tr key={m.month} className="border-t border-border/60">
                          <td className={td}>{formatPaymentTermsMonth(m.month)}</td>
                          <td className={`${td} tabular-nums`}>{formatPaymentTermsDays(m.pmpDays)}</td>
                          <td className={`${td} tabular-nums`}>{formatPaymentTermsGap(m.gapDays)}</td>
                          <td className={`${td} tabular-nums`}>{formatPaymentTermsMoney(m.purchaseAmount)}</td>
                          <td className={`${td} tabular-nums`}>{formatPaymentTermsPercent(m.coveragePercentByValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </DashboardSection>
              <DashboardSection title="Distribuição das faixas de prazo" description="Pelo PMP de cada pedido (não identificados à parte)." testId="payment-terms-buckets">
                <div className="overflow-x-auto rounded-lg border border-border bg-white">
                  <table className={tableClass}>
                    <thead className="bg-muted/40">
                      <tr>
                        <th className={th}>Faixa</th>
                        <th className={th}>Pedidos</th>
                        <th className={th}>Valor</th>
                        <th className={th}>% do valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.buckets.map((b) => (
                        <tr key={b.bucket} className="border-t border-border/60">
                          <td className={td}>{PAYMENT_TERMS_BUCKET_LABELS[b.bucket]}</td>
                          <td className={`${td} tabular-nums`}>{b.count}</td>
                          <td className={`${td} tabular-nums`}>{formatPaymentTermsMoney(b.amount)}</td>
                          <td className={`${td} tabular-nums`}>{p.purchaseAmount > 0 ? formatPaymentTermsPercent((b.amount / p.purchaseAmount) * 100) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </DashboardSection>
            </div>

            <DashboardSection
              title="PMP por comprador"
              description="Apoio à negociação, não avaliação individual: carteiras de fornecedores e materiais diferem entre compradores."
              testId="payment-terms-buyers"
            >
              <div className="overflow-x-auto rounded-lg border border-border bg-white">
                <table className={tableClass}>
                  <thead className="bg-muted/40">
                    <tr>
                      <th className={th}>Comprador</th>
                      <th className={th}>Valor negociado</th>
                      <th className={th}>Pedidos</th>
                      <th className={th}>PMP</th>
                      <th className={th}>Gap</th>
                      <th className={th}>Dados completos</th>
                      <th className={th}>Evolução mensal (PMP)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.buyers.map((b) => (
                      <tr key={b.label} className="border-t border-border/60">
                        <td className={td}>{b.label}</td>
                        <td className={`${td} tabular-nums`}>{formatPaymentTermsMoney(b.purchaseAmount)}</td>
                        <td className={`${td} tabular-nums`}>{b.orderCount}</td>
                        <td className={`${td} tabular-nums`}>{formatPaymentTermsDays(b.pmpDays)}</td>
                        <td className={`${td} tabular-nums`}>{formatPaymentTermsGap(b.gapDays)}</td>
                        <td className={`${td} tabular-nums`}>{formatPaymentTermsPercent(b.coveragePercentByValue)}</td>
                        <td className={`${td} text-muted-foreground`}>
                          {b.monthly.map((m) => `${formatPaymentTermsMonth(m.month)}: ${formatPaymentTermsDays(m.pmpDays)}`).join(" · ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DashboardSection>

            <DashboardSection
              title="Pedidos do período"
              description={data.ordersTruncated ? "Lista limitada aos 2.000 pedidos mais recentes; os indicadores usam todos." : "Rastreável até o pedido: clique no número para abrir o detalhe."}
              testId="payment-terms-orders"
              actions={
                <div className="flex flex-wrap gap-2">
                  <select className={PERFORMANCE_CONTROL_CLASS} value={bucket} onChange={(e) => setBucket(e.target.value as PaymentTermsBucket | "")} data-testid="payment-terms-filter-bucket">
                    <option value="">Todas as faixas</option>
                    {PAYMENT_TERMS_BUCKETS.map((b) => (
                      <option key={b} value={b}>
                        {PAYMENT_TERMS_BUCKET_LABELS[b]}
                      </option>
                    ))}
                  </select>
                  <select className={PERFORMANCE_CONTROL_CLASS} value={identification} onChange={(e) => setIdentification(e.target.value as typeof identification)} data-testid="payment-terms-filter-identification">
                    <option value="">Identificados e não</option>
                    <option value="IDENTIFIED">Prazo identificado</option>
                    <option value="NOT_IDENTIFIED">Não identificado</option>
                  </select>
                  {target != null ? (
                    <select className={PERFORMANCE_CONTROL_CLASS} value={targetFilter} onChange={(e) => setTargetFilter(e.target.value as typeof targetFilter)} data-testid="payment-terms-filter-target">
                      <option value="">Abaixo e acima da meta</option>
                      <option value="BELOW">Abaixo da meta</option>
                      <option value="MEETS">Na meta ou acima</option>
                    </select>
                  ) : null}
                </div>
              }
            >
              <div className="max-h-[28rem] overflow-auto rounded-lg border border-border bg-white">
                <table className={tableClass}>
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className={th}>Pedido</th>
                      <th className={th}>Emissão</th>
                      <th className={th}>Fornecedor</th>
                      <th className={th}>Comprador</th>
                      <th className={th}>Valor</th>
                      <th className={th}>Condição observada</th>
                      <th className={th}>PMP</th>
                      <th className={th}>Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.length === 0 ? (
                      <tr>
                        <td className={td} colSpan={8}>
                          Nenhum pedido para os filtros.
                        </td>
                      </tr>
                    ) : (
                      filteredOrders.map((o) => (
                        <tr key={o.id} className={`border-t border-border/60 ${o.canceled ? "text-muted-foreground line-through" : ""}`}>
                          <td className={td}>
                            <Link className="text-primary hover:underline" to={`/purchases/nomus-orders/${o.id}`}>
                              {o.orderNumber ?? `Nomus #${o.externalId}`}
                            </Link>
                          </td>
                          <td className={`${td} tabular-nums`}>{formatPaymentTermsDate(o.issuedDate)}</td>
                          <td className={td}>{o.supplierName}</td>
                          <td className={td}>{o.buyerPersonId != null ? `#${o.buyerPersonId}` : "—"}</td>
                          <td className={`${td} tabular-nums`}>{formatPaymentTermsMoney(o.purchaseAmount, true)}</td>
                          <td className={`${td} font-mono`} title={o.reasonLabel ?? undefined}>
                            {o.canceled ? "Cancelado (fora da carteira)" : o.label}
                          </td>
                          <td className={`${td} tabular-nums`}>{formatPaymentTermsDays(o.pmpDays)}</td>
                          <td className={`${td} tabular-nums`}>{formatPaymentTermsGap(o.gapDays)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </DashboardSection>
          </>
        ) : null}
      </div>
      <SupplierPaymentTermsOverlay supplierExternalId={drillSupplier} period={period} onClose={() => setDrillSupplier(null)} />
    </SupplierPerformanceShell>
  );
}

const REASON_TEXT: Record<string, string> = {
  NO_INSTALLMENTS: "sem parcelas",
  MISSING_BASE_DATE: "sem data de emissão",
  INSTALLMENT_WITHOUT_DUE_DATE: "parcela sem vencimento",
  INSTALLMENT_WITHOUT_AMOUNT: "parcela sem valor",
  NEGATIVE_AMOUNT: "parcela negativa",
  NO_POSITIVE_AMOUNT: "parcelas zeradas",
};

function TargetEditor({
  target,
  updatedAt,
  updatedBy,
  canManage,
  onSaved,
}: {
  target: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(target == null ? "" : String(target));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(target == null ? "" : String(target)), [target]);
  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await fetchJsonOk(`${PURCHASE_PAYMENT_TERMS_API}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPmpDays: draft.trim() === "" ? null : Number(draft) }),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar a meta.");
    } finally {
      setSaving(false);
    }
  }, [draft, onSaved]);
  const audit = updatedAt ? `Alterada em ${new Date(updatedAt).toLocaleString("pt-BR")}${updatedBy ? ` por ${updatedBy}` : ""}` : "Nunca configurada";
  if (!canManage) {
    return (
      <div className="flex flex-col gap-1" data-testid="payment-terms-target-readonly" title={audit}>
        <span className={PERFORMANCE_FIELD_LABEL_CLASS}>Meta de PMP</span>
        <span className="h-9 py-2 text-sm">{target == null ? "Não configurada" : `${target} dias`}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1" data-testid="payment-terms-target-editor">
      <span className={PERFORMANCE_FIELD_LABEL_CLASS}>Meta de PMP (dias)</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          max={365}
          className={`${PERFORMANCE_CONTROL_CLASS} w-24`}
          placeholder="Sem meta"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          data-testid="payment-terms-target-input"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || draft === (target == null ? "" : String(target))}
          className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-white px-2 text-sm hover:bg-accent disabled:opacity-50"
          title={audit}
          data-testid="payment-terms-target-save"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar
        </button>
      </div>
      <span className="text-[10px] text-muted-foreground">{error ?? audit}</span>
    </div>
  );
}

function SupplierPaymentTermsOverlay({
  supplierExternalId,
  period,
  onClose,
}: {
  supplierExternalId: number | null;
  period: PaymentTermsPeriod;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<SupplierDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (supplierExternalId == null) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setError(null);
    fetchJsonOk<SupplierDetailResponse>(`${PURCHASE_PAYMENT_TERMS_API}/suppliers/${supplierExternalId}?${periodQuery(period)}`)
      .then((res) => !cancelled && setDetail(res))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Erro ao carregar o fornecedor."));
    return () => {
      cancelled = true;
    };
  }, [supplierExternalId, period]);
  const s = detail?.supplier;
  return (
    <Overlay open={supplierExternalId != null} onClose={onClose} size="full" ariaLabelledBy="payment-terms-supplier-title" testId="payment-terms-supplier-overlay">
      <OverlayHeader
        titleId="payment-terms-supplier-title"
        variant="solid"
        density="prominent"
        eyebrow="Compras · Condições de compra"
        title={s ? `Prazo de pagamento — ${s.supplierName}` : "Prazo de pagamento do fornecedor"}
        subtitle={`Pedidos emitidos de ${formatPaymentTermsDate(period.from)} a ${formatPaymentTermsDate(period.to)}`}
        onClose={onClose}
      />
      <OverlayBody>
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        {!detail && !error ? (
          <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </p>
        ) : null}
        {detail ? (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">{detail.baseNote}</p>
            {s ? (
              <p className="text-sm" data-testid="payment-terms-supplier-why">
                <strong>Por que está na lista:</strong> compras de {formatPaymentTermsMoney(s.purchaseAmount)} ({s.orderCount} pedido(s)), PMP{" "}
                {formatPaymentTermsDays(s.pmpDays)}
                {s.gapDays != null ? `, gap ${formatPaymentTermsGap(s.gapDays)}` : ""}
                {s.potentialWorkingCapital != null
                  ? `; alongar ${s.extraDays} dia(s) sobre ~${formatPaymentTermsMoney(s.monthlyVolume)}/mês ≈ ${formatPaymentTermsMoney(s.potentialWorkingCapital)} de capital de giro (estimativa, ${OPPORTUNITY_RELIABILITY_LABELS[s.reliability].toLowerCase()}).`
                  : `. ${s.reliabilityReason ?? ""}`}
              </p>
            ) : null}
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className={tableClass}>
                <thead className="bg-muted/40">
                  <tr>
                    <th className={th}>Mês</th>
                    <th className={th}>PMP</th>
                    <th className={th}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.monthly.map((m) => (
                    <tr key={m.month} className="border-t border-border/60">
                      <td className={td}>{formatPaymentTermsMonth(m.month)}</td>
                      <td className={`${td} tabular-nums`}>{formatPaymentTermsDays(m.pmpDays)}</td>
                      <td className={`${td} tabular-nums`}>{formatPaymentTermsMoney(m.purchaseAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className={tableClass} data-testid="payment-terms-supplier-orders">
                <thead className="bg-muted/40">
                  <tr>
                    <th className={th}>Pedido</th>
                    <th className={th}>Emissão</th>
                    <th className={th}>Valor</th>
                    <th className={th}>Condição observada</th>
                    <th className={th}>Parcelas (vencimento · valor · dias)</th>
                    <th className={th}>PMP</th>
                    <th className={th}>Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.orders.map((o) => (
                    <tr key={o.id} className={`border-t border-border/60 ${o.belowTarget ? "bg-amber-50/60" : ""}`}>
                      <td className={td}>
                        <Link className="text-primary hover:underline" to={`/purchases/nomus-orders/${o.id}`}>
                          {o.orderNumber ?? `Nomus #${o.externalId}`}
                        </Link>
                        {o.canceled ? <span className="ml-1 text-muted-foreground">(cancelado, fora da carteira)</span> : null}
                      </td>
                      <td className={`${td} tabular-nums`}>{formatPaymentTermsDate(o.issuedDate)}</td>
                      <td className={`${td} tabular-nums`}>{formatPaymentTermsMoney(o.purchaseAmount, true)}</td>
                      <td className={`${td} font-mono`}>{o.result.status === "IDENTIFIED" ? o.result.label : `Não identificado (${REASON_TEXT[o.result.reason] ?? o.result.reason})`}</td>
                      <td className={td}>
                        {o.result.status === "IDENTIFIED"
                          ? o.result.installments
                              .map((i) => `${formatPaymentTermsDate(i.dueDate)} · ${formatPaymentTermsMoney(i.amount, true)} · ${i.days} d`)
                              .join(" | ")
                          : "—"}
                      </td>
                      <td className={`${td} tabular-nums`}>{formatPaymentTermsDays(o.pmpDays)}</td>
                      <td className={`${td} tabular-nums`}>{formatPaymentTermsGap(o.gapDays)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </OverlayBody>
    </Overlay>
  );
}
