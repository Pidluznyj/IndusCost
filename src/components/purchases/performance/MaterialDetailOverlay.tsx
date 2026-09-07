/**
 * Detalhe da matéria-prima — fornecedores, share, preço médio, último preço,
 * evolução e dispersão. Overlay do design system; números prontos do backend.
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
} from "@/src/components/ui/overlay";
import {
  SINGLE_SOURCE_OBSERVED_LABEL,
  SINGLE_SOURCE_OBSERVED_TOOLTIP,
  type DashboardMaterialDetail,
  type SupplierPerformanceDashboardFilters,
} from "@/src/lib/purchasing/supplierPerformanceDashboard";
import { fetchSupplierPerformanceMaterialDetail } from "@/src/lib/purchasing/supplierPerformanceDashboardClient";
import {
  formatDashboardDate,
  formatDashboardInteger,
  formatDashboardMoney,
  formatDashboardPercent,
  formatDashboardPeriodLabel,
  formatDashboardPrice,
  formatDashboardQuantity,
  formatDashboardScore,
} from "@/src/lib/purchasing/supplierPerformanceDashboardUi";
import { PriceEvolutionChart, PurchaseTrendChart } from "./SupplierPerformanceCharts";
import { EmptyRows, SupplierLinkButton } from "./SupplierPerformanceSections";

export function MaterialDetailContent({
  detail,
  onSelectSupplier,
}: {
  detail: DashboardMaterialDetail;
  onSelectSupplier?: (id: number) => void;
}) {
  const currency = detail.currency;
  return (
    <OverlayBody>
      <div className="space-y-4" data-testid="material-detail-content">
        <OverlayKpiCardGrid columns={5}>
          <OverlayKpiCard label="Spend da MP" value={formatDashboardMoney(detail.totals.spend, currency)} tone="info" />
          <OverlayKpiCard label="Pedidos · linhas" value={`${formatDashboardInteger(detail.totals.orderCount)} · ${formatDashboardInteger(detail.totals.lineCount)}`} />
          <OverlayKpiCard label="Fornecedores observados" value={formatDashboardInteger(detail.totals.supplierCountObserved)} hint={detail.totals.singleSourceObserved ? SINGLE_SOURCE_OBSERVED_LABEL : detail.totals.supplierCountObserved >= 2 ? "Dual sourcing observado" : undefined} tone={detail.totals.singleSourceObserved ? "warning" : "neutral"} />
          <OverlayKpiCard label="Quantidade" value={detail.totals.unit ? formatDashboardQuantity(detail.totals.quantity, detail.totals.unit) : "Unidades mistas"} hint={detail.totals.unit ? undefined : `Observadas: ${detail.material.unitsObserved.join(", ")}`} />
          <OverlayKpiCard label="Share do dominante" value={formatDashboardPercent(detail.concentration.dominant?.share)} hint={detail.concentration.dominant?.name} />
        </OverlayKpiCardGrid>

        <OverlaySection title="Principais fornecedores desta matéria-prima" description="Share = spend do fornecedor na MP ÷ spend total da MP. Nota = consolidado do fornecedor nos pedidos do período." padded={false} testId="material-detail-suppliers">
          <OverlayTable stickyHeader>
            <OverlayTable.Head>
              <OverlayTable.Row>
                <OverlayTable.HeadCell>Fornecedor</OverlayTable.HeadCell>
                <OverlayTable.HeadCell align="right">Spend da MP</OverlayTable.HeadCell>
                <OverlayTable.HeadCell align="right">% do spend da MP</OverlayTable.HeadCell>
                <OverlayTable.HeadCell align="right">Pedidos</OverlayTable.HeadCell>
                <OverlayTable.HeadCell align="right">Quantidade</OverlayTable.HeadCell>
                <OverlayTable.HeadCell align="right">Preço médio</OverlayTable.HeadCell>
                <OverlayTable.HeadCell align="right">Último preço</OverlayTable.HeadCell>
                <OverlayTable.HeadCell align="right">Última compra</OverlayTable.HeadCell>
                <OverlayTable.HeadCell align="right">Nota fornecedor</OverlayTable.HeadCell>
              </OverlayTable.Row>
            </OverlayTable.Head>
            <OverlayTable.Body>
              {detail.suppliers.length === 0 ? (
                <EmptyRows colSpan={9} message="Nenhum fornecedor para esta MP no período." />
              ) : (
                detail.suppliers.map((row) => (
                  <OverlayTable.Row key={row.supplierExternalId ?? "unresolved"}>
                    <OverlayTable.Cell>
                      <SupplierLinkButton supplierExternalId={row.supplierExternalId} name={row.supplierName} onSelect={onSelectSupplier} />
                      {row.singleSourceObserved ? <OverlayBadge tone="amber" className="ml-1" title={SINGLE_SOURCE_OBSERVED_TOOLTIP}>{SINGLE_SOURCE_OBSERVED_LABEL}</OverlayBadge> : null}
                    </OverlayTable.Cell>
                    <OverlayTable.Cell align="right" mono>{formatDashboardMoney(row.spend, currency)}</OverlayTable.Cell>
                    <OverlayTable.Cell align="right" mono>{formatDashboardPercent(row.shareOfMaterial)}</OverlayTable.Cell>
                    <OverlayTable.Cell align="right" mono>{formatDashboardInteger(row.orderCount)}</OverlayTable.Cell>
                    <OverlayTable.Cell align="right" mono>{row.unit ? formatDashboardQuantity(row.quantity, row.unit) : `${row.unitsObserved.length} un. distintas`}</OverlayTable.Cell>
                    <OverlayTable.Cell align="right" mono>{formatDashboardPrice(row.weightedAveragePrice, currency, row.unit)}</OverlayTable.Cell>
                    <OverlayTable.Cell align="right" mono title={row.lastPriceDate ? `Preço da compra de ${formatDashboardDate(row.lastPriceDate)}` : undefined}>{formatDashboardPrice(row.lastPrice, currency, row.unit)}</OverlayTable.Cell>
                    <OverlayTable.Cell align="right" mono>{formatDashboardDate(row.lastPurchaseDate)}</OverlayTable.Cell>
                    <OverlayTable.Cell align="right" mono>{row.evaluation ? `${formatDashboardScore(row.evaluation.summary.overallScore, row.evaluation.scaleMax)}${row.evaluation.methodologyVersion === 1 ? " (V1)" : ""}` : "—"}</OverlayTable.Cell>
                  </OverlayTable.Row>
                ))
              )}
            </OverlayTable.Body>
          </OverlayTable>
        </OverlaySection>

        <div className="grid gap-4 xl:grid-cols-2">
          <OverlaySection title="Evolução de preço por fornecedor" description="Preço médio ponderado por mês (valor da linha ÷ quantidade). Séries por fornecedor + unidade; moeda única." testId="material-detail-price-evolution">
            <PriceEvolutionChart series={detail.priceEvolution} currency={currency} />
          </OverlaySection>
          <OverlaySection title="Dispersão de preço observada" description="Entre fornecedores da mesma unidade e moeda. Não é 'saving potencial'." padded={false} testId="material-detail-dispersion">
            <OverlayTable>
              <OverlayTable.Head>
                <OverlayTable.Row>
                  <OverlayTable.HeadCell>Un.</OverlayTable.HeadCell>
                  <OverlayTable.HeadCell>Menor preço médio</OverlayTable.HeadCell>
                  <OverlayTable.HeadCell>Maior preço médio</OverlayTable.HeadCell>
                  <OverlayTable.HeadCell align="right">Diferença</OverlayTable.HeadCell>
                  <OverlayTable.HeadCell align="right">Diferença %</OverlayTable.HeadCell>
                </OverlayTable.Row>
              </OverlayTable.Head>
              <OverlayTable.Body>
                {detail.dispersion.length === 0 ? (
                  <EmptyRows colSpan={5} message="Menos de dois fornecedores com preço médio comparável nesta MP." />
                ) : (
                  detail.dispersion.map((row) => (
                    <OverlayTable.Row key={row.unit ?? "u"}>
                      <OverlayTable.Cell mono>{row.unit ?? "—"}</OverlayTable.Cell>
                      <OverlayTable.Cell><span className="font-mono text-xs">{formatDashboardPrice(row.minAveragePrice, row.currency, row.unit)}</span><span className="block text-[11px] text-muted-foreground">{row.minSupplier.name}</span></OverlayTable.Cell>
                      <OverlayTable.Cell><span className="font-mono text-xs">{formatDashboardPrice(row.maxAveragePrice, row.currency, row.unit)}</span><span className="block text-[11px] text-muted-foreground">{row.maxSupplier.name}</span></OverlayTable.Cell>
                      <OverlayTable.Cell align="right" mono>{formatDashboardPrice(row.spread, row.currency, row.unit)}</OverlayTable.Cell>
                      <OverlayTable.Cell align="right" mono>{formatDashboardPercent(row.spreadPct)}</OverlayTable.Cell>
                    </OverlayTable.Row>
                  ))
                )}
              </OverlayTable.Body>
            </OverlayTable>
          </OverlaySection>
        </div>

        <OverlaySection title="Compras mensais desta MP" testId="material-detail-monthly">
          <PurchaseTrendChart points={detail.monthly} currency={currency} showSuppliers={false} />
        </OverlaySection>
      </div>
    </OverlayBody>
  );
}

export function MaterialDetailOverlay({
  materialKey,
  filters,
  onClose,
  onSelectSupplier,
}: {
  materialKey: string | null;
  filters: SupplierPerformanceDashboardFilters;
  onClose: () => void;
  onSelectSupplier?: (id: number) => void;
}) {
  const [detail, setDetail] = useState<DashboardMaterialDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = materialKey != null;

  useEffect(() => {
    if (!materialKey) {
      setDetail(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setDetail(null);
    fetchSupplierPerformanceMaterialDetail(materialKey, filters, controller.signal)
      .then((payload) => {
        if (!controller.signal.aborted) setDetail(payload);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Falha ao carregar a matéria-prima.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialKey, JSON.stringify(filters)]);

  const titleId = "material-detail-title";
  const title = detail ? `${detail.material.productCode ?? detail.material.description ?? detail.material.materialKey}` : "Matéria-prima";
  return (
    <Overlay open={open} onClose={onClose} size="xl" ariaLabelledBy={titleId} testId="material-detail-overlay">
      <OverlayHeader
        titleId={titleId}
        eyebrow="Compras · Performance · Matéria-prima"
        title={title}
        subtitle={detail ? `${detail.material.description ?? ""}${detail.material.group ? ` · grupo ${detail.material.group}` : ""} · ${formatDashboardPeriodLabel(detail.period)} · ID Nomus ${detail.material.productExternalId ?? "—"}` : undefined}
        onClose={onClose}
      />
      {loading || (!detail && !error) ? (
        <OverlayBody>
          <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando matéria-prima…</p>
        </OverlayBody>
      ) : error ? (
        <OverlayBody>
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        </OverlayBody>
      ) : detail ? (
        <MaterialDetailContent detail={detail} onSelectSupplier={onSelectSupplier} />
      ) : null}
    </Overlay>
  );
}
