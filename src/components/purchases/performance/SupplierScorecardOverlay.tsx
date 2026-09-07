/**
 * Scorecard 360º do fornecedor — Overlay do design system (size xl, abas).
 * Carrega o detalhe sob demanda; todos os números vêm prontos do backend.
 */
import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Overlay,
  OverlayBadge,
  OverlayBody,
  OverlayHeader,
  OverlayKpiCard,
  OverlayKpiCardGrid,
  OverlaySection,
  OverlayTable,
  OverlayTabs,
} from "@/src/components/ui/overlay";
import { SUPPLIER_EVALUATION_CRITERIA } from "@/src/lib/purchasing/supplierPerformance";
import {
  SINGLE_SOURCE_OBSERVED_LABEL,
  SINGLE_SOURCE_OBSERVED_TOOLTIP,
  type DashboardSupplierDetail,
  type DashboardSupplierMaterialRow,
  type SupplierPerformanceDashboardFilters,
} from "@/src/lib/purchasing/supplierPerformanceDashboard";
import { fetchSupplierPerformanceSupplierDetail } from "@/src/lib/purchasing/supplierPerformanceDashboardClient";
import {
  formatDashboardDate,
  formatDashboardDateTime,
  formatDashboardInteger,
  formatDashboardMoney,
  formatDashboardMonth,
  formatDashboardPercent,
  formatDashboardPeriodLabel,
  formatDashboardPrice,
  formatDashboardQuantity,
  formatDashboardScore,
} from "@/src/lib/purchasing/supplierPerformanceDashboardUi";
import { PurchaseTrendChart } from "./SupplierPerformanceCharts";
import { AdvancedMetricsTable, DashboardNotice, EmptyRows, MaterialLinkButton } from "./SupplierPerformanceSections";

type TabId = "resumo" | "materiais" | "avaliacao" | "concentracao" | "historico" | "avancados";

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "resumo", label: "Resumo" },
  { id: "materiais", label: "Matérias-primas" },
  { id: "avaliacao", label: "Avaliação" },
  { id: "concentracao", label: "Concentração" },
  { id: "historico", label: "Histórico" },
  { id: "avancados", label: "Indicadores avançados" },
];

function MaterialsTable({
  rows,
  currency,
  onSelectMaterial,
  emptyMessage,
}: {
  rows: DashboardSupplierMaterialRow[];
  currency: string;
  onSelectMaterial?: (key: string) => void;
  emptyMessage: string;
}) {
  return (
    <OverlayTable stickyHeader>
      <OverlayTable.Head>
        <OverlayTable.Row>
          <OverlayTable.HeadCell>Matéria-prima</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Spend</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">% das compras do fornecedor</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">% da MP</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Pedidos</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Linhas</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Quantidade</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Preço médio</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Último preço</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Última compra</OverlayTable.HeadCell>
        </OverlayTable.Row>
      </OverlayTable.Head>
      <OverlayTable.Body>
        {rows.length === 0 ? (
          <EmptyRows colSpan={10} message={emptyMessage} />
        ) : (
          rows.map((row) => (
            <OverlayTable.Row key={row.materialKey}>
              <OverlayTable.Cell>
                <MaterialLinkButton materialKey={row.materialKey} code={row.productCode} description={row.description} onSelect={onSelectMaterial} />
                {row.singleSourceObserved ? <OverlayBadge tone="amber" className="mt-1" title={SINGLE_SOURCE_OBSERVED_TOOLTIP}>{SINGLE_SOURCE_OBSERVED_LABEL}</OverlayBadge> : null}
              </OverlayTable.Cell>
              <OverlayTable.Cell align="right" mono>{formatDashboardMoney(row.spend, currency)}</OverlayTable.Cell>
              <OverlayTable.Cell align="right" mono>{formatDashboardPercent(row.shareOfSupplier)}</OverlayTable.Cell>
              <OverlayTable.Cell align="right" mono>{formatDashboardPercent(row.shareOfMaterial)}</OverlayTable.Cell>
              <OverlayTable.Cell align="right" mono>{formatDashboardInteger(row.orderCount)}</OverlayTable.Cell>
              <OverlayTable.Cell align="right" mono>{formatDashboardInteger(row.lineCount)}</OverlayTable.Cell>
              <OverlayTable.Cell align="right" mono>{row.unit ? formatDashboardQuantity(row.quantity, row.unit) : `${row.unitsObserved.length} un. distintas`}</OverlayTable.Cell>
              <OverlayTable.Cell align="right" mono>{formatDashboardPrice(row.weightedAveragePrice, currency, row.unit)}</OverlayTable.Cell>
              <OverlayTable.Cell align="right" mono title={row.lastPriceDate ? `Preço da compra de ${formatDashboardDate(row.lastPriceDate)}` : undefined}>{formatDashboardPrice(row.lastPrice, currency, row.unit)}</OverlayTable.Cell>
              <OverlayTable.Cell align="right" mono>{formatDashboardDate(row.lastPurchaseDate)}</OverlayTable.Cell>
            </OverlayTable.Row>
          ))
        )}
      </OverlayTable.Body>
    </OverlayTable>
  );
}

export function SupplierScorecardContent({
  detail,
  onSelectMaterial,
}: {
  detail: DashboardSupplierDetail;
  onSelectMaterial?: (key: string) => void;
}) {
  const [tab, setTab] = useState<TabId>("resumo");
  const currency = detail.currency;
  const supplier = detail.supplier;
  const ev = supplier.evaluation;
  const scaleMax = ev?.scaleMax ?? null;

  return (
    <>
      <OverlayTabs tabs={TABS} active={tab} onChange={setTab} variant="underline" testId="supplier-scorecard-tabs" />
      <OverlayBody>
        {tab === "resumo" ? (
          <div className="space-y-4" data-testid="supplier-scorecard-summary">
            <OverlaySection title="Identificação">
              <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Nome</dt><dd className="font-medium">{supplier.name}</dd></div>
                <div><dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Documento</dt><dd className="font-mono text-xs">{supplier.document ?? "—"}</dd></div>
                <div><dt className="text-[10px] uppercase tracking-wide text-muted-foreground">ID Nomus (autoridade)</dt><dd className="font-mono text-xs">#{supplier.supplierExternalId}</dd></div>
                <div><dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Cadastro financeiro</dt><dd className="text-xs">{supplier.financialSupplierId ? `${supplier.matchConfidence} · ${supplier.registryStatus ?? "status n/d"}` : `Não vinculado (${supplier.matchConfidence})`}</dd></div>
              </dl>
            </OverlaySection>
            <OverlaySection title="Compras no período" description={`${formatDashboardPeriodLabel(detail.period)} · ${currency} · base ${detail.spendBasis === "line" ? "linhas filtradas" : "cabeçalho do pedido"}`}>
              <OverlayKpiCardGrid columns={4}>
                <OverlayKpiCard label="Spend" value={formatDashboardMoney(detail.purchases.spend, currency)} hint={`Share do total: ${formatDashboardPercent(detail.purchases.share)}`} tone="info" />
                <OverlayKpiCard label="Pedidos" value={formatDashboardInteger(detail.purchases.orderCount)} hint={`${formatDashboardInteger(detail.purchases.lineCount)} linhas`} />
                <OverlayKpiCard label="Ticket médio" value={formatDashboardMoney(detail.purchases.averageTicket, currency)} />
                <OverlayKpiCard label="Mix de MPs" value={formatDashboardInteger(detail.purchases.mixCount)} hint={`${formatDashboardInteger(detail.purchases.exclusiveMaterialCount)} MPs exclusivas observadas`} />
                <OverlayKpiCard label="Primeira compra" value={formatDashboardDate(detail.purchases.firstPurchaseDate)} size="sm" />
                <OverlayKpiCard label="Última compra" value={formatDashboardDate(detail.purchases.lastPurchaseDate)} size="sm" />
                <OverlayKpiCard label="Nota atual" value={ev ? formatDashboardScore(ev.summary.overallScore, scaleMax) : "—"} hint={ev ? `${ev.methodologyId} · ${formatDashboardInteger(ev.evaluationCount)} avaliações` : "Sem avaliação"} size="sm" />
                <OverlayKpiCard label="Cobertura de avaliação" value={ev ? formatDashboardPercent(ev.summary.coverage) : "—"} size="sm" />
              </OverlayKpiCardGrid>
              {detail.purchases.paymentTerms.length > 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Condições de pagamento declaradas: {detail.purchases.paymentTerms.slice(0, 3).map((t) => `${t.label} (${t.count})`).join(" · ")}
                </p>
              ) : null}
            </OverlaySection>
            <OverlaySection title="Compras mensais">
              <PurchaseTrendChart points={detail.monthly} currency={currency} showSuppliers={false} />
            </OverlaySection>
          </div>
        ) : null}

        {tab === "materiais" ? (
          <OverlaySection title="Principais matérias-primas deste fornecedor" description="Ordenado por spend (valor oficial das linhas). Quantidade só dentro da mesma unidade." padded={false} testId="supplier-scorecard-materials">
            <MaterialsTable rows={detail.materials} currency={currency} onSelectMaterial={onSelectMaterial} emptyMessage="Nenhuma linha com material identificado para este fornecedor no período." />
          </OverlaySection>
        ) : null}

        {tab === "avaliacao" ? (
          <div className="space-y-4" data-testid="supplier-scorecard-evaluation">
            {detail.evaluation.available === false ? (
              <DashboardNotice tone="warning" title="Avaliação indisponível">{detail.evaluation.reason}</DashboardNotice>
            ) : (
              <>
                <OverlaySection title="Nota atual — pedidos do período" description={ev ? `Metodologia ${ev.methodologyId} (escala ${ev.scaleMin}–${ev.scaleMax}) · ${ev.v2Count} avaliações V2 · ${ev.v1Count} V1` : "Sem avaliações no período."}>
                  <OverlayKpiCardGrid columns={6}>
                    <OverlayKpiCard label="Nota geral" value={formatDashboardScore(ev?.summary.overallScore, scaleMax)} tone="info" />
                    {SUPPLIER_EVALUATION_CRITERIA.map((criterion) => (
                      <React.Fragment key={criterion.key}>
                        <OverlayKpiCard label={`${criterion.shortLabel} (${criterion.weightPercent}%)`} value={formatDashboardScore(ev?.summary[criterion.field] ?? null, scaleMax)} size="sm" />
                      </React.Fragment>
                    ))}
                    <OverlayKpiCard label="Cobertura" value={ev ? formatDashboardPercent(ev.summary.coverage) : "—"} hint={ev ? `${ev.summary.evaluatedOrders} de ${ev.summary.eligibleOrders} pedidos` : undefined} size="sm" />
                  </OverlayKpiCardGrid>
                  {ev && ev.v1Count > 0 && ev.methodologyVersion === 2 ? (
                    <p className="mt-2 text-xs text-muted-foreground">Existem {ev.v1Count} avaliações legadas V1 (0–10) deste fornecedor no período; elas não entram na nota V2 acima.</p>
                  ) : null}
                </OverlaySection>
                {detail.evaluation.monthlyV2.length > 0 ? (
                  <OverlaySection title="Evolução da nota V2 por mês do pedido" description="Média das avaliações V2 dos pedidos emitidos em cada mês (eixo = data operacional do pedido).">
                    <div className="flex flex-wrap gap-2">
                      {detail.evaluation.monthlyV2.map((point) => (
                        <div key={point.month} className="rounded-md border border-border px-2 py-1 text-xs">
                          <span className="block text-muted-foreground">{formatDashboardMonth(point.month)}</span>
                          <span className="font-mono">{formatDashboardScore(point.averageOverall, 5)}</span>
                          <span className="ml-1 text-muted-foreground">({point.count})</span>
                        </div>
                      ))}
                    </div>
                  </OverlaySection>
                ) : null}
                {detail.evaluation.monthlyV1.length > 0 ? (
                  <OverlaySection title="Avaliações legadas V1 por mês (escala 0–10)" description="Histórico segmentado — nunca misturado com V2.">
                    <div className="flex flex-wrap gap-2">
                      {detail.evaluation.monthlyV1.map((point) => (
                        <div key={point.month} className="rounded-md border border-border px-2 py-1 text-xs">
                          <span className="block text-muted-foreground">{formatDashboardMonth(point.month)}</span>
                          <span className="font-mono">{formatDashboardScore(point.averageOverall, 10)}</span>
                          <span className="ml-1 text-muted-foreground">({point.count})</span>
                        </div>
                      ))}
                    </div>
                  </OverlaySection>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {tab === "concentracao" ? (
          <div className="space-y-4" data-testid="supplier-scorecard-concentration">
            <OverlayKpiCardGrid columns={3}>
              <OverlayKpiCard label="MPs em que é fornecedor único observado" value={formatDashboardInteger(detail.concentration.singleSourceMaterials.length)} hint={SINGLE_SOURCE_OBSERVED_TOOLTIP} tone="warning" />
              <OverlayKpiCard label="MPs em que tem share dominante" value={formatDashboardInteger(detail.concentration.dominantMaterials.length)} />
              <OverlayKpiCard label="Maior share em uma MP" value={formatDashboardPercent(detail.concentration.maxMaterialShare)} />
            </OverlayKpiCardGrid>
            <OverlaySection title="MPs com fornecedor único observado" padded={false}>
              <MaterialsTable rows={detail.concentration.singleSourceMaterials} currency={currency} onSelectMaterial={onSelectMaterial} emptyMessage="Nenhuma MP com este fornecedor como único observado no período." />
            </OverlaySection>
            <OverlaySection title="MPs com share dominante" padded={false}>
              <MaterialsTable rows={detail.concentration.dominantMaterials} currency={currency} onSelectMaterial={onSelectMaterial} emptyMessage="Nenhuma MP em que este fornecedor tenha o maior share no período." />
            </OverlaySection>
          </div>
        ) : null}

        {tab === "historico" ? (
          <div className="space-y-4" data-testid="supplier-scorecard-history">
            <OverlaySection title="Compras mensais" padded={false}>
              <OverlayTable>
                <OverlayTable.Head>
                  <OverlayTable.Row>
                    <OverlayTable.HeadCell>Mês</OverlayTable.HeadCell>
                    <OverlayTable.HeadCell align="right">Spend</OverlayTable.HeadCell>
                    <OverlayTable.HeadCell align="right">Pedidos</OverlayTable.HeadCell>
                    <OverlayTable.HeadCell align="right">MPs distintas</OverlayTable.HeadCell>
                  </OverlayTable.Row>
                </OverlayTable.Head>
                <OverlayTable.Body>
                  {detail.monthly.map((point) => (
                    <OverlayTable.Row key={point.month}>
                      <OverlayTable.Cell mono>{formatDashboardMonth(point.month)}</OverlayTable.Cell>
                      <OverlayTable.Cell align="right" mono>{formatDashboardMoney(point.spend, currency)}</OverlayTable.Cell>
                      <OverlayTable.Cell align="right" mono>{formatDashboardInteger(point.orderCount)}</OverlayTable.Cell>
                      <OverlayTable.Cell align="right" mono>{formatDashboardInteger(point.materialCount)}</OverlayTable.Cell>
                    </OverlayTable.Row>
                  ))}
                </OverlayTable.Body>
              </OverlayTable>
            </OverlaySection>
            <OverlaySection title="Avaliações anteriores" description="Uma por pedido Nomus; V1 e V2 identificadas pela escala." padded={false}>
              {detail.evaluation.available === false ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">{detail.evaluation.reason}</p>
              ) : (
                <OverlayTable>
                  <OverlayTable.Head>
                    <OverlayTable.Row>
                      <OverlayTable.HeadCell>Pedido</OverlayTable.HeadCell>
                      <OverlayTable.HeadCell>Data do pedido</OverlayTable.HeadCell>
                      <OverlayTable.HeadCell>Metodologia</OverlayTable.HeadCell>
                      <OverlayTable.HeadCell align="right">Q</OverlayTable.HeadCell>
                      <OverlayTable.HeadCell align="right">P</OverlayTable.HeadCell>
                      <OverlayTable.HeadCell align="right">C</OverlayTable.HeadCell>
                      <OverlayTable.HeadCell align="right">A</OverlayTable.HeadCell>
                      <OverlayTable.HeadCell align="right">Nota</OverlayTable.HeadCell>
                      <OverlayTable.HeadCell>Revisão · atualizado</OverlayTable.HeadCell>
                    </OverlayTable.Row>
                  </OverlayTable.Head>
                  <OverlayTable.Body>
                    {detail.evaluation.history.length === 0 ? (
                      <EmptyRows colSpan={9} message="Nenhuma avaliação finalizada para os pedidos deste fornecedor no período." />
                    ) : (
                      detail.evaluation.history.map((row) => (
                        <OverlayTable.Row key={row.nomusPurchaseOrderId}>
                          <OverlayTable.Cell mono>{row.orderNumber ?? `Nomus #${row.externalId}`}</OverlayTable.Cell>
                          <OverlayTable.Cell mono>{formatDashboardDate(row.performanceDate)}</OverlayTable.Cell>
                          <OverlayTable.Cell><OverlayBadge tone={row.methodologyVersion === 2 ? "sky" : "slate"}>V{row.methodologyVersion} · 1–{row.scaleMax}</OverlayBadge></OverlayTable.Cell>
                          <OverlayTable.Cell align="right" mono>{formatDashboardScore(row.scores.quality, row.scaleMax)}</OverlayTable.Cell>
                          <OverlayTable.Cell align="right" mono>{formatDashboardScore(row.scores.delivery, row.scaleMax)}</OverlayTable.Cell>
                          <OverlayTable.Cell align="right" mono>{formatDashboardScore(row.scores.conformity, row.scaleMax)}</OverlayTable.Cell>
                          <OverlayTable.Cell align="right" mono>{formatDashboardScore(row.scores.service, row.scaleMax)}</OverlayTable.Cell>
                          <OverlayTable.Cell align="right" mono>{formatDashboardScore(row.scores.overall, row.scaleMax)}</OverlayTable.Cell>
                          <OverlayTable.Cell className="text-xs text-muted-foreground">rev. {row.revision} · {formatDashboardDateTime(row.updatedAt)}{row.updatedByUserName ? ` · ${row.updatedByUserName}` : ""}</OverlayTable.Cell>
                        </OverlayTable.Row>
                      ))
                    )}
                  </OverlayTable.Body>
                </OverlayTable>
              )}
            </OverlaySection>
          </div>
        ) : null}

        {tab === "avancados" ? (
          <div data-testid="supplier-scorecard-advanced">
            <AdvancedMetricsTable entries={detail.advancedMetrics} />
          </div>
        ) : null}
      </OverlayBody>
    </>
  );
}

export function SupplierScorecardOverlay({
  supplierExternalId,
  filters,
  onClose,
  onSelectMaterial,
}: {
  supplierExternalId: number | null;
  filters: SupplierPerformanceDashboardFilters;
  onClose: () => void;
  onSelectMaterial?: (key: string) => void;
}) {
  const [detail, setDetail] = useState<DashboardSupplierDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = supplierExternalId != null;

  useEffect(() => {
    if (supplierExternalId == null) {
      setDetail(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setDetail(null);
    fetchSupplierPerformanceSupplierDetail(supplierExternalId, filters, controller.signal)
      .then((payload) => {
        if (!controller.signal.aborted) setDetail(payload);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Falha ao carregar o fornecedor.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierExternalId, JSON.stringify(filters)]);

  const titleId = "supplier-scorecard-title";
  return (
    <Overlay open={open} onClose={onClose} size="full" ariaLabelledBy={titleId} testId="supplier-scorecard-overlay">
      <OverlayHeader
        titleId={titleId}
        variant="solid"
        density="prominent"
        eyebrow="Compras · Performance"
        title={detail ? `Performance do fornecedor — ${detail.supplier.name}` : "Performance do fornecedor"}
        subtitle={detail ? `ID Nomus #${detail.supplier.supplierExternalId} · ${formatDashboardPeriodLabel(detail.period)} · Nota atual — pedidos do período selecionado` : undefined}
        onClose={onClose}
      />
      {loading || (!detail && !error) ? (
        <OverlayBody>
          <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando scorecard…</p>
        </OverlayBody>
      ) : error ? (
        <OverlayBody>
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        </OverlayBody>
      ) : detail ? (
        <SupplierScorecardContent detail={detail} onSelectMaterial={onSelectMaterial} />
      ) : null}
    </Overlay>
  );
}
