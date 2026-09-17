/**
 * Seções da aba Performance. Componentes de apresentação: recebem o read model
 * pronto e só formatam. Nenhuma métrica é recalculada aqui.
 */
import React, { useMemo, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { OverlayBadge, OverlaySection, OverlayTable } from "@/src/components/ui/overlay";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";
import { cn } from "@/src/lib/utils";
import { SUPPLIER_EVALUATION_CRITERIA, type SupplierEvaluationCriterionKey } from "@/src/lib/purchasing/supplierPerformance";
import {
  ADVANCED_METRIC_GROUP_LABELS,
  ADVANCED_METRIC_UNAVAILABLE_LABEL,
  SINGLE_SOURCE_OBSERVED_TOOLTIP,
  type AdvancedMetricEntry,
  type AdvancedMetricGroup,
  type DashboardMaterialConcentrationRow,
  type DashboardPriceChangeRow,
  type DashboardPriceDispersionRow,
  type DashboardRankedSupplierRow,
  type SupplierPerformanceDashboardReadModel,
} from "@/src/lib/purchasing/supplierPerformanceDashboard";
import {
  ADVANCED_METRIC_STATUS_LABELS,
  ADVANCED_METRIC_STATUS_TONES,
  describeAdvancedMetricValue,
  describeDashboardKpi,
  findDashboardKpiDefinition,
  formatDashboardCoverageContext,
  formatDashboardDateTime,
  formatDashboardDecimal,
  formatDashboardInteger,
  formatDashboardMoney,
  formatDashboardMonth,
  formatDashboardPercent,
  formatDashboardPeriodLabel,
  formatDashboardPrice,
  formatDashboardScore,
  FINANCIAL_DATA_STATUS_LABELS,
} from "@/src/lib/purchasing/supplierPerformanceDashboardUi";
import { SupplierPerformanceKpiCard } from "./SupplierPerformanceKpiCard";
import {
  EvaluationDistributionChart,
  ScoreVsSpendChart,
  SupplierConcentrationChart,
} from "./SupplierPerformanceCharts";

type ReadModel = SupplierPerformanceDashboardReadModel;

/* ------------------------------------------------------------------ */

export function DashboardNotice({
  tone = "info",
  title,
  children,
  testId,
}: {
  tone?: "info" | "warning";
  title?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  const Icon = tone === "warning" ? AlertTriangle : Info;
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
        tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-sky-200 bg-sky-50 text-sky-900"
      )}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function DashboardSection({
  title,
  eyebrow,
  description,
  actions,
  children,
  testId,
  className,
}: {
  title: string;
  eyebrow?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <section data-testid={testId} className={cn("space-y-4", className)} aria-label={title}>
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          {eyebrow ? <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{eyebrow}</p> : null}
          <h2 className="text-base font-bold tracking-tight text-foreground">{title}</h2>
          {description ? <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function EmptyRows({ message, colSpan }: { message: string; colSpan: number }) {
  return (
    <OverlayTable.Row>
      <OverlayTable.Cell colSpan={colSpan} className="py-6 text-center text-muted-foreground">
        {message}
      </OverlayTable.Cell>
    </OverlayTable.Row>
  );
}

export function SupplierLinkButton({
  supplierExternalId,
  name,
  onSelect,
  className,
}: {
  supplierExternalId: number | null;
  name: string;
  onSelect?: (supplierExternalId: number) => void;
  className?: string;
}) {
  if (supplierExternalId == null || !onSelect) return <span className={className}>{name}</span>;
  return (
    <button
      type="button"
      onClick={() => onSelect(supplierExternalId)}
      className={cn("text-left font-medium text-primary hover:underline", className)}
      data-testid={`supplier-link-${supplierExternalId}`}
    >
      {name}
    </button>
  );
}

export function MaterialLinkButton({
  materialKey,
  code,
  description,
  onSelect,
}: {
  materialKey: string;
  code: string | null;
  description: string | null;
  onSelect?: (materialKey: string) => void;
}) {
  const label = code ?? description ?? materialKey;
  const inner = (
    <>
      <span className="block font-medium">{label}</span>
      {code && description ? <span className="block truncate text-[11px] text-muted-foreground" title={description}>{description}</span> : null}
    </>
  );
  if (!onSelect) return <div className="max-w-[18rem]">{inner}</div>;
  return (
    <button type="button" onClick={() => onSelect(materialKey)} className="max-w-[18rem] text-left text-primary hover:underline">
      {inner}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Seção 1 — Visão executiva
 * ------------------------------------------------------------------ */

export function DataQualityBar({ data }: { data: ReadModel }) {
  const p = data.metadata.population;
  const financial = p.financialDataStatus;
  const evaluationHint =
    data.evaluation.available === false
      ? data.evaluation.reason
      : `${formatDashboardInteger(data.kpis.evaluatedOrders)} de ${formatDashboardInteger(data.kpis.eligibleOrders)} pedidos avaliados · cobertura ${formatDashboardPercent(data.kpis.evaluationCoverage)}`;
  const financialHint =
    financial === "PARTIAL"
      ? `Atenção: ${formatDashboardInteger(p.ordersWithFinancialValue)} de ${formatDashboardInteger(p.orderCount)} pedidos possuem valor financeiro`
      : FINANCIAL_DATA_STATUS_LABELS[financial];
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-xs",
        financial === "UNAVAILABLE"
          ? "border-amber-200 bg-amber-50 text-amber-950"
          : financial === "PARTIAL"
            ? "border-amber-200 bg-amber-50 text-amber-950"
            : "border-border bg-muted/30 text-muted-foreground"
      )}
      data-testid="performance-data-quality"
    >
      <p>
        {formatDashboardInteger(p.orderCount)} pedidos · {formatDashboardInteger(p.lineCount)} linhas ·{" "}
        {formatDashboardInteger(p.supplierCount)} fornecedores · {formatDashboardInteger(p.materialCount)} matérias-primas
      </p>
      <p className="mt-0.5">{evaluationHint}</p>
      <p className="mt-0.5">{financialHint}</p>
      <p className="mt-0.5">
        Última sincronização Nomus: {formatDashboardDateTime(data.metadata.lastSyncedAt)}
        <span className="mx-1">·</span>
        Empresa: idEmpresa existe no payload Nomus, sem cadastro de empresas para filtro.
      </p>
    </div>
  );
}

export function ExecutiveKpisSection({
  data,
}: {
  data: ReadModel;
  onSelectSupplier?: (supplierExternalId: number) => void;
}) {
  const currency = data.metadata.currency.selected;
  const defs = data.metadata.kpiDefinitions;
  const tip = (key: string) => describeDashboardKpi(findDashboardKpiDefinition(defs, key));
  const evaluationUnavailable = data.evaluation.available === false ? data.evaluation.reason : null;
  const financialUnavailable =
    data.metadata.population.financialDataStatus === "UNAVAILABLE"
      ? "Valores financeiros indisponíveis para esta população"
      : null;
  const ticketHint =
    financialUnavailable
      ? undefined
      : `Ticket médio: ${formatDashboardMoney(data.kpis.averageTicket, currency)}`;
  return (
    <DashboardSection
      title="Quanto estamos comprando?"
      description={`Compras de ${formatDashboardPeriodLabel(data.metadata.period)} · moeda ${currency}`}
      testId="performance-executive-section"
    >
      <SummaryKpiGrid minColumnWidth={220} className={SYSTEM_TOTALIZER_GRID_CLASS} testId="performance-executive-kpis">
        <SupplierPerformanceKpiCard testId="kpi-total-spend" label="Total comprado" value={formatDashboardMoney(data.kpis.totalSpend, currency)} tone="money" tooltip={tip("PURCHASE_SPEND")} hint={ticketHint} unavailableReason={financialUnavailable} />
        <SupplierPerformanceKpiCard testId="kpi-order-count" label="Pedidos" value={formatDashboardInteger(data.kpis.purchaseOrderCount)} tooltip={tip("PURCHASE_ORDER_COUNT")} hint={`${formatDashboardInteger(data.kpis.purchaseLineCount)} linhas`} />
        <SupplierPerformanceKpiCard testId="kpi-active-suppliers" label="Fornecedores ativos" value={formatDashboardInteger(data.kpis.activeSuppliers)} tooltip={tip("ACTIVE_SUPPLIERS")} />
        <SupplierPerformanceKpiCard testId="kpi-material-mix" label="Matérias-primas" value={formatDashboardInteger(data.kpis.materialMixCount)} tooltip={tip("MATERIAL_MIX_COUNT")} />
        <SupplierPerformanceKpiCard testId="kpi-evaluation-coverage" label="Cobertura de avaliação" value={data.kpis.evaluationCoverage == null && data.evaluation.available ? "Sem pedidos elegíveis no período" : formatDashboardPercent(data.kpis.evaluationCoverage)} tooltip={tip("SUPPLIER_EVALUATION_COVERAGE")} unavailableReason={evaluationUnavailable} hint={data.evaluation.available ? `${formatDashboardInteger(data.kpis.evaluatedOrders)} de ${formatDashboardInteger(data.kpis.eligibleOrders)} pedidos` : undefined} />
        <SupplierPerformanceKpiCard testId="kpi-top5" label="Concentração Top 5" value={formatDashboardPercent(data.kpis.top5Concentration)} tooltip={tip("TOP5_CONCENTRATION")} unavailableReason={financialUnavailable} hint={financialUnavailable ? undefined : `Top 1: ${formatDashboardPercent(data.kpis.top1Concentration)}`} />
      </SummaryKpiGrid>
    </DashboardSection>
  );
}

/* ------------------------------------------------------------------ *
 * Seção 2 — Concentração e risco de abastecimento
 * ------------------------------------------------------------------ */

function supplyObservationLabel(row: DashboardMaterialConcentrationRow): string {
  if (row.supplierCountObserved <= 0) return "Sem fornecedor identificado";
  if (row.singleSourceObserved) return "100% das compras do período concentradas em 1 fornecedor";
  return `${row.supplierCountObserved} fornecedores observados no período`;
}

function MaterialRiskTable({
  rows,
  currency,
  financialStatus,
  onSelectSupplier,
  onSelectMaterial,
}: {
  rows: DashboardMaterialConcentrationRow[];
  currency: string;
  financialStatus: SupplierPerformanceDashboardReadModel["metadata"]["population"]["financialDataStatus"];
  onSelectSupplier?: (id: number) => void;
  onSelectMaterial?: (key: string) => void;
}) {
  const financialUnavailable = financialStatus === "UNAVAILABLE";
  return (
    <OverlayTable stickyHeader>
      <OverlayTable.Head>
        <OverlayTable.Row>
          <OverlayTable.HeadCell>Matéria-prima</OverlayTable.HeadCell>
          <OverlayTable.HeadCell>Descrição</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Valor comprado</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Nº fornecedores observados</OverlayTable.HeadCell>
          <OverlayTable.HeadCell>Fornecedor principal</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Participação</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Pedidos</OverlayTable.HeadCell>
          <OverlayTable.HeadCell>Observação</OverlayTable.HeadCell>
        </OverlayTable.Row>
      </OverlayTable.Head>
      <OverlayTable.Body>
        {rows.length === 0 ? (
          <EmptyRows colSpan={8} message="Nenhuma matéria-prima com fornecedor identificado na população filtrada." />
        ) : (
          rows.map((row) => (
            <OverlayTable.Row key={row.materialKey}>
              <OverlayTable.Cell className="max-w-[14rem]">
                <MaterialLinkButton materialKey={row.materialKey} code={row.productCode} description={null} onSelect={onSelectMaterial} />
              </OverlayTable.Cell>
              <OverlayTable.Cell className="max-w-[18rem] truncate text-muted-foreground" title={row.description ?? undefined}>
                {row.description ?? "—"}
              </OverlayTable.Cell>
              <OverlayTable.Cell align="right" mono>
                {financialUnavailable ? "Indisponível" : formatDashboardMoney(row.dominantBasis === "financial" || row.spend > 0 ? row.spend : null, currency)}
              </OverlayTable.Cell>
              <OverlayTable.Cell align="right" mono>{formatDashboardInteger(row.supplierCountObserved)}</OverlayTable.Cell>
              <OverlayTable.Cell className="max-w-[16rem]">
                {row.dominant ? (
                  <div className="min-w-0">
                    <SupplierLinkButton supplierExternalId={row.dominant.supplierExternalId} name={row.dominant.name} onSelect={onSelectSupplier} className="block truncate" />
                    {row.dominantBasis === "orders" ? (
                      <span className="block text-[11px] text-muted-foreground" title="Sem valor de linha provado: fornecedor mais frequente por nº de pedidos, não principal financeiro.">
                        Mais frequente no período
                      </span>
                    ) : null}
                  </div>
                ) : (
                  "—"
                )}
              </OverlayTable.Cell>
              <OverlayTable.Cell align="right" mono>
                {financialUnavailable ? "Indisponível" : formatDashboardPercent(row.dominant?.share)}
              </OverlayTable.Cell>
              <OverlayTable.Cell align="right" mono>{formatDashboardInteger(row.orderCount)}</OverlayTable.Cell>
              <OverlayTable.Cell className="max-w-[16rem] text-xs text-muted-foreground" title={SINGLE_SOURCE_OBSERVED_TOOLTIP}>
                {supplyObservationLabel(row)}
              </OverlayTable.Cell>
            </OverlayTable.Row>
          ))
        )}
      </OverlayTable.Body>
    </OverlayTable>
  );
}

export function ConcentrationSection({
  data,
  onSelectSupplier,
  onSelectMaterial,
}: {
  data: ReadModel;
  onSelectSupplier?: (id: number) => void;
  onSelectMaterial?: (key: string) => void;
}) {
  const currency = data.metadata.currency.selected;
  const financialStatus = data.metadata.population.financialDataStatus;
  const riskRows = data.concentration.dominantSupplierByMaterial;
  return (
    <DashboardSection
      title="Onde estamos concentrados?"
      description="Compras por fornecedor e concentração observada por matéria-prima no período. Número de fornecedores observados não prova homologação única nem ausência de alternativas."
      testId="performance-concentration-section"
    >
      <OverlaySection title="Compras por fornecedor" description="Barras em largura total. Alterne valor comprado, Pareto ou número de pedidos." testId="performance-supplier-spend">
        <SupplierConcentrationChart
          rows={data.concentration.pareto}
          currency={currency}
          financialStatus={financialStatus}
          onSelectSupplier={onSelectSupplier}
        />
      </OverlaySection>
      <OverlaySection
        title="Risco de abastecimento por matéria-prima"
        description="Uma linha por matéria-prima comprada no período. '1 fornecedor observado' descreve só as compras filtradas — não afirma que não existam outros fornecedores homologados."
        padded={false}
        testId="performance-material-risk"
      >
        <MaterialRiskTable
          rows={riskRows}
          currency={currency}
          financialStatus={financialStatus}
          onSelectSupplier={onSelectSupplier}
          onSelectMaterial={onSelectMaterial}
        />
      </OverlaySection>
    </DashboardSection>
  );
}

/* ------------------------------------------------------------------ *
 * Seção 3 — Rankings de fornecedores
 * ------------------------------------------------------------------ */

type RankingTabId = "bestEvaluated" | "topSpend" | "topOrderCount" | "topMix" | "lowestEvaluated" | "legacyEvaluated";

const RANKING_TABS: Array<{ id: RankingTabId; label: string; description: string }> = [
  { id: "bestEvaluated", label: "Melhores avaliados", description: "Fornecedores com metodologia V2 (1–5), nota consolidada DESC. Empate: nome/ID." },
  { id: "topSpend", label: "Maior valor comprado", description: "Maiores fornecedores por valor comprado no período." },
  { id: "topOrderCount", label: "Mais pedidos", description: "Mais compras realizadas — COUNT DISTINCT de pedidos (não soma quantidade física)." },
  { id: "topMix", label: "Maior mix", description: "Maior número de matérias-primas distintas compradas." },
  { id: "lowestEvaluated", label: "Menores avaliações", description: "Fornecedores V2 com menor nota consolidada (bloco de atenção, sem score inventado)." },
  { id: "legacyEvaluated", label: "Avaliações legadas", description: "Fornecedores apenas com avaliações V1 (escala 0–10). Nunca misturadas com V2." },
];

function RankingTable({
  rows,
  currency,
  financialStatus,
  onSelectSupplier,
}: {
  rows: DashboardRankedSupplierRow[];
  currency: string;
  financialStatus: SupplierPerformanceDashboardReadModel["metadata"]["population"]["financialDataStatus"];
  onSelectSupplier?: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const financialUnavailable = financialStatus === "UNAVAILABLE";
  return (
    <OverlayTable stickyHeader>
      <OverlayTable.Head>
        <OverlayTable.Row>
          <OverlayTable.HeadCell align="right">#</OverlayTable.HeadCell>
          <OverlayTable.HeadCell>Fornecedor</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Nota</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Avaliações</OverlayTable.HeadCell>
          {SUPPLIER_EVALUATION_CRITERIA.map((c) => (
            <OverlayTable.HeadCell key={c.key} align="right">{c.shortLabel}</OverlayTable.HeadCell>
          ))}
          <OverlayTable.HeadCell align="right">Valor comprado</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Pedidos</OverlayTable.HeadCell>
        </OverlayTable.Row>
      </OverlayTable.Head>
      <OverlayTable.Body>
        {rows.length === 0 ? (
          <EmptyRows colSpan={10} message="Nenhum fornecedor na população filtrada." />
        ) : (
          rows.map((row) => {
            const ev = row.evaluation;
            const coverage = formatDashboardCoverageContext(ev?.summary.coverage, ev?.evaluationCount, row.orderCount);
            const open = expanded === row.supplierExternalId;
            return (
              <React.Fragment key={row.supplierExternalId}>
                <OverlayTable.Row data-testid={`ranking-row-${row.supplierExternalId}`}>
                  <OverlayTable.Cell align="right" mono>{row.position}</OverlayTable.Cell>
                  <OverlayTable.Cell className="min-w-[14rem] max-w-[22rem]">
                    <SupplierLinkButton supplierExternalId={row.supplierExternalId} name={row.name} onSelect={onSelectSupplier} className="block truncate" />
                    <button
                      type="button"
                      className="mt-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                      onClick={() => setExpanded(open ? null : row.supplierExternalId)}
                      data-testid={`ranking-expand-${row.supplierExternalId}`}
                    >
                      {open ? "Ocultar detalhes" : "Ver detalhes"}
                    </button>
                  </OverlayTable.Cell>
                  <OverlayTable.Cell align="right" mono title={ev?.methodologyVersion === 1 ? "Escala 0–10 (V1)" : "Escala 1–5"}>
                    {formatDashboardScore(ev?.summary.overallScore, ev?.scaleMax)}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell align="right" className="whitespace-nowrap">
                    <span className="font-mono text-xs tabular-nums">{formatDashboardInteger(ev?.evaluationCount ?? 0)}</span>
                    {coverage.context ? (
                      <span className="block text-[11px] text-muted-foreground">{coverage.percent} · {coverage.context}</span>
                    ) : null}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell align="right" mono>{formatDashboardScore(ev?.summary.qualityScore, ev?.scaleMax)}</OverlayTable.Cell>
                  <OverlayTable.Cell align="right" mono>{formatDashboardScore(ev?.summary.deliveryScore, ev?.scaleMax)}</OverlayTable.Cell>
                  <OverlayTable.Cell align="right" mono>{formatDashboardScore(ev?.summary.conformityScore, ev?.scaleMax)}</OverlayTable.Cell>
                  <OverlayTable.Cell align="right" mono>{formatDashboardScore(ev?.summary.serviceScore, ev?.scaleMax)}</OverlayTable.Cell>
                  <OverlayTable.Cell align="right" mono>
                    {financialUnavailable || !row.hasFinancialValue
                      ? "Indisponível"
                      : formatDashboardMoney(row.spend, currency)}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell align="right" mono>{formatDashboardInteger(row.orderCount)}</OverlayTable.Cell>
                </OverlayTable.Row>
                {open ? (
                  <OverlayTable.Row>
                    <OverlayTable.Cell colSpan={10} className="bg-muted/30 text-xs text-muted-foreground">
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        <div>CNPJ: <span className="text-foreground">{row.document ?? "—"}</span></div>
                        <div>Participação: <span className="text-foreground">{financialUnavailable || !row.hasFinancialValue ? "Indisponível" : formatDashboardPercent(row.share)}</span></div>
                        <div>Ticket médio: <span className="text-foreground">{financialUnavailable || !row.hasFinancialValue ? "Indisponível" : formatDashboardMoney(row.averageTicket, currency)}</span></div>
                        <div>Mix: <span className="text-foreground">{formatDashboardInteger(row.mixCount)} matérias-primas</span></div>
                      </div>
                    </OverlayTable.Cell>
                  </OverlayTable.Row>
                ) : null}
              </React.Fragment>
            );
          })
        )}
      </OverlayTable.Body>
    </OverlayTable>
  );
}

export function SupplierRankingsSection({
  data,
  onSelectSupplier,
}: {
  data: ReadModel;
  onSelectSupplier?: (id: number) => void;
}) {
  const [tab, setTab] = useState<RankingTabId>("bestEvaluated");
  const [criterion, setCriterion] = useState<SupplierEvaluationCriterionKey | null>(null);
  const currency = data.metadata.currency.selected;
  const rows = useMemo(() => {
    if (tab === "bestEvaluated" && criterion) return data.rankings.byCriterion[criterion];
    return data.rankings[tab];
  }, [data, tab, criterion]);
  const active = RANKING_TABS.find((t) => t.id === tab)!;
  const evaluationOff = !data.evaluation.available;
  return (
    <DashboardSection
      title="Como os fornecedores estão performando?"
      description={`Top ${data.rankings.limit}. Ordenação determinística. Notas na escala 1–5 (V2) ou 0–10 (V1), sem repetir a escala em cada célula.`}
      testId="performance-rankings-section"
    >
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-muted/40 p-1" role="tablist" aria-label="Rankings">
        {RANKING_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
              if (t.id !== "bestEvaluated") setCriterion(null);
            }}
            className={
              tab === t.id
                ? "rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-foreground shadow-sm ring-1 ring-border"
                : "rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-white/70 hover:text-foreground"
            }
            data-testid={`ranking-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "bestEvaluated" ? (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="text-muted-foreground">Ordenar por:</span>
          <button type="button" onClick={() => setCriterion(null)} className={cn("rounded-md px-2 py-0.5", criterion == null ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:text-foreground")}>Nota geral</button>
          {SUPPLIER_EVALUATION_CRITERIA.map((c) => (
            <button key={c.key} type="button" onClick={() => setCriterion(c.key)} className={cn("rounded-md px-2 py-0.5", criterion === c.key ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:text-foreground")} data-testid={`ranking-criterion-${c.key}`}>
              Melhor {c.shortLabel.toLowerCase()}
            </button>
          ))}
        </div>
      ) : null}
      <OverlaySection title={active.label} description={active.description} padded={false} testId={`performance-ranking-${tab}`}>
        {evaluationOff && (tab === "bestEvaluated" || tab === "lowestEvaluated" || tab === "legacyEvaluated") ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">{data.evaluation.available === false ? data.evaluation.reason : null}</div>
        ) : (
          <RankingTable rows={rows} currency={currency} financialStatus={data.metadata.population.financialDataStatus} onSelectSupplier={onSelectSupplier} />
        )}
      </OverlaySection>
    </DashboardSection>
  );
}

/* ------------------------------------------------------------------ *
 * Seção 6 — Preços
 * ------------------------------------------------------------------ */

function DispersionTable({ rows, onSelectSupplier, onSelectMaterial }: { rows: DashboardPriceDispersionRow[]; onSelectSupplier?: (id: number) => void; onSelectMaterial?: (key: string) => void }) {
  return (
    <OverlayTable stickyHeader>
      <OverlayTable.Head>
        <OverlayTable.Row>
          <OverlayTable.HeadCell>Matéria-prima</OverlayTable.HeadCell>
          <OverlayTable.HeadCell>Un.</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Fornecedores</OverlayTable.HeadCell>
          <OverlayTable.HeadCell>Menor preço médio</OverlayTable.HeadCell>
          <OverlayTable.HeadCell>Maior preço médio</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Diferença</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Diferença %</OverlayTable.HeadCell>
        </OverlayTable.Row>
      </OverlayTable.Head>
      <OverlayTable.Body>
        {rows.length === 0 ? (
          <EmptyRows colSpan={7} message="Nenhuma MP com dois ou mais fornecedores na mesma unidade e moeda com preço médio calculável." />
        ) : (
          rows.map((row) => (
            <OverlayTable.Row key={`${row.materialKey}::${row.unit ?? ""}`}>
              <OverlayTable.Cell><MaterialLinkButton materialKey={row.materialKey} code={row.productCode} description={row.description} onSelect={onSelectMaterial} /></OverlayTable.Cell>
              <OverlayTable.Cell mono>{row.unit ?? "—"}</OverlayTable.Cell>
              <OverlayTable.Cell align="right" mono>{row.supplierCount}</OverlayTable.Cell>
              <OverlayTable.Cell>
                <span className="font-mono text-xs tabular-nums">{formatDashboardPrice(row.minAveragePrice, row.currency, row.unit)}</span>
                <span className="block text-[11px] text-muted-foreground"><SupplierLinkButton supplierExternalId={row.minSupplier.supplierExternalId} name={row.minSupplier.name} onSelect={onSelectSupplier} className="text-[11px]" /></span>
              </OverlayTable.Cell>
              <OverlayTable.Cell>
                <span className="font-mono text-xs tabular-nums">{formatDashboardPrice(row.maxAveragePrice, row.currency, row.unit)}</span>
                <span className="block text-[11px] text-muted-foreground"><SupplierLinkButton supplierExternalId={row.maxSupplier.supplierExternalId} name={row.maxSupplier.name} onSelect={onSelectSupplier} className="text-[11px]" /></span>
              </OverlayTable.Cell>
              <OverlayTable.Cell align="right" mono>{formatDashboardPrice(row.spread, row.currency, row.unit)}</OverlayTable.Cell>
              <OverlayTable.Cell align="right" mono>{formatDashboardPercent(row.spreadPct)}</OverlayTable.Cell>
            </OverlayTable.Row>
          ))
        )}
      </OverlayTable.Body>
    </OverlayTable>
  );
}

function PriceIncreaseTable({ rows, onSelectSupplier, onSelectMaterial }: { rows: DashboardPriceChangeRow[]; onSelectSupplier?: (id: number) => void; onSelectMaterial?: (key: string) => void }) {
  return (
    <OverlayTable stickyHeader>
      <OverlayTable.Head>
        <OverlayTable.Row>
          <OverlayTable.HeadCell>Matéria-prima</OverlayTable.HeadCell>
          <OverlayTable.HeadCell>Fornecedor</OverlayTable.HeadCell>
          <OverlayTable.HeadCell>Un.</OverlayTable.HeadCell>
          <OverlayTable.HeadCell>Primeiro mês</OverlayTable.HeadCell>
          <OverlayTable.HeadCell>Último mês</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Variação</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Variação %</OverlayTable.HeadCell>
        </OverlayTable.Row>
      </OverlayTable.Head>
      <OverlayTable.Body>
        {rows.length === 0 ? (
          <EmptyRows colSpan={7} message="Nenhum aumento de preço médio observado entre meses no período (mesma MP, fornecedor e unidade)." />
        ) : (
          rows.map((row) => (
            <OverlayTable.Row key={`${row.materialKey}::${row.supplierExternalId ?? ""}::${row.unit ?? ""}`}>
              <OverlayTable.Cell><MaterialLinkButton materialKey={row.materialKey} code={row.productCode} description={row.description} onSelect={onSelectMaterial} /></OverlayTable.Cell>
              <OverlayTable.Cell><SupplierLinkButton supplierExternalId={row.supplierExternalId} name={row.supplierName} onSelect={onSelectSupplier} /></OverlayTable.Cell>
              <OverlayTable.Cell mono>{row.unit ?? "—"}</OverlayTable.Cell>
              <OverlayTable.Cell mono>{formatDashboardMonth(row.firstMonth)} · {formatDashboardPrice(row.firstAveragePrice, row.currency, row.unit)}</OverlayTable.Cell>
              <OverlayTable.Cell mono>{formatDashboardMonth(row.lastMonth)} · {formatDashboardPrice(row.lastAveragePrice, row.currency, row.unit)}</OverlayTable.Cell>
              <OverlayTable.Cell align="right" mono>{formatDashboardPrice(row.changeAbsolute, row.currency, row.unit)}</OverlayTable.Cell>
              <OverlayTable.Cell align="right" mono>{formatDashboardPercent(row.changePct)}</OverlayTable.Cell>
            </OverlayTable.Row>
          ))
        )}
      </OverlayTable.Body>
    </OverlayTable>
  );
}

export function PricingSection({
  data,
  onSelectSupplier,
  onSelectMaterial,
}: {
  data: ReadModel;
  onSelectSupplier?: (id: number) => void;
  onSelectMaterial?: (key: string) => void;
}) {
  const defs = data.metadata.kpiDefinitions;
  return (
    <DashboardSection
      title="Preços"
      eyebrow="Seção 6"
      description="Preço médio ponderado = SUM(valor da linha) ÷ SUM(quantidade) por MP + fornecedor + unidade + moeda. Unidades e moedas diferentes nunca se misturam. Dispersão não é 'saving potencial'. Clique numa MP para ver preço médio, último preço e evolução por fornecedor."
      testId="performance-pricing-section"
    >
      <SummaryKpiGrid minColumnWidth={180} className={SYSTEM_TOTALIZER_GRID_CLASS}>
        <SupplierPerformanceKpiCard testId="kpi-comparable-prices" label="MPs com preço comparável" value={formatDashboardInteger(data.pricing.materialsWithComparablePrices)} tooltip={describeDashboardKpi(findDashboardKpiDefinition(defs, "PRICE_SPREAD"))} hint="≥ 2 fornecedores na mesma unidade/moeda" />
        <SupplierPerformanceKpiCard testId="kpi-mixed-units" label="MPs com unidades mistas" value={formatDashboardInteger(data.pricing.materialsWithMixedUnits)} hint="Quantidade/preço não agregáveis sem conversão oficial" tooltip="Materiais comprados em mais de uma unidade de medida no período. Nunca somamos kg + unidade + litro; as análises de preço ficam por unidade." />
        <SupplierPerformanceKpiCard testId="kpi-price-increases" label="Aumentos observados" value={formatDashboardInteger(data.pricing.increases.length)} hint="Pares MP × fornecedor × unidade com preço médio maior no último mês vs. o primeiro" tooltip="Comparação entre o preço médio ponderado do primeiro e do último mês com compra valorada no período, por MP + fornecedor + unidade. Não é reajuste contratual." />
      </SummaryKpiGrid>
      <div className="space-y-4">
        <OverlaySection title="Dispersão de preço observada" description="Menor vs. maior preço médio ponderado entre fornecedores da mesma MP, unidade e moeda." padded={false} testId="performance-price-dispersion">
          <DispersionTable rows={data.pricing.dispersion} onSelectSupplier={onSelectSupplier} onSelectMaterial={onSelectMaterial} />
        </OverlaySection>
        <OverlaySection title="Maiores aumentos de preço observados" description="Primeiro mês vs. último mês com compra valorada, por MP + fornecedor + unidade." padded={false} testId="performance-price-increases">
          <PriceIncreaseTable rows={data.pricing.increases} onSelectSupplier={onSelectSupplier} onSelectMaterial={onSelectMaterial} />
        </OverlaySection>
      </div>
    </DashboardSection>
  );
}

/* ------------------------------------------------------------------ *
 * Seção 7 — Avaliação
 * ------------------------------------------------------------------ */

export function EvaluationSection({ data, onSelectSupplier }: { data: ReadModel; onSelectSupplier?: (id: number) => void }) {
  const currency = data.metadata.currency.selected;
  const defs = data.metadata.kpiDefinitions;
  const evaluation = data.evaluation;
  return (
    <DashboardSection
      title="Avaliação de fornecedores"
      eyebrow="Seção 7"
      description="Metodologia vigente V2: quatro critérios de 1 a 5 com peso 25% cada; nota do fornecedor = média das avaliações finalizadas dos pedidos do período, sem ponderar valor. Avaliações V1 (0–10) ficam separadas e nunca são convertidas."
      testId="performance-evaluation-section"
    >
      {evaluation.available === false ? (
        <DashboardNotice tone="warning" title="Avaliação indisponível" testId="performance-evaluation-unavailable">
          {evaluation.reason}
        </DashboardNotice>
      ) : (
        <>
      <SummaryKpiGrid minColumnWidth={220} className={SYSTEM_TOTALIZER_GRID_CLASS} testId="performance-evaluation-kpis">
            <SupplierPerformanceKpiCard testId="kpi-eval-overall" label="Nota média (pedidos)" value={formatDashboardScore(evaluation.summary.overallScore, evaluation.scaleMax)} tooltip={describeDashboardKpi(findDashboardKpiDefinition(defs, "SUPPLIER_EVALUATION_SCORE"))} hint={`${formatDashboardInteger(evaluation.summary.evaluatedOrders)} avaliações · metodologia ${evaluation.methodologyId}`} />
            {evaluation.criteria.map((criterion) => (
              <React.Fragment key={criterion.key}>
                <SupplierPerformanceKpiCard testId={`kpi-eval-${criterion.key}`} label={`${criterion.shortLabel} (${criterion.weightPercent}%)`} value={formatDashboardScore(criterion.average, evaluation.scaleMax)} tooltip={`${criterion.label}: média das notas de 1 a 5 deste critério nas avaliações finalizadas dos pedidos do período. Peso ${criterion.weightPercent}% na nota do pedido (motor OP-26).`} />
              </React.Fragment>
            ))}
            <SupplierPerformanceKpiCard testId="kpi-eval-coverage" label="Cobertura" value={evaluation.summary.coverage == null ? "Sem pedidos elegíveis no período" : formatDashboardPercent(evaluation.summary.coverage)} tooltip={describeDashboardKpi(findDashboardKpiDefinition(defs, "SUPPLIER_EVALUATION_COVERAGE"))} hint={`${formatDashboardInteger(evaluation.summary.evaluatedOrders)} de ${formatDashboardInteger(evaluation.summary.eligibleOrders)} pedidos · ${formatDashboardInteger(evaluation.summary.pendingOrders)} pendentes`} />
            <SupplierPerformanceKpiCard testId="kpi-eval-suppliers" label="Fornecedores avaliados (V2)" value={formatDashboardInteger(evaluation.evaluatedSuppliers)} hint={`${formatDashboardInteger(evaluation.suppliersWithoutEvaluation)} sem avaliação · ${formatDashboardInteger(evaluation.v1OnlySuppliers)} só V1`} tooltip="Fornecedores ativos no período com ao menos uma avaliação V2 finalizada. Fornecedores apenas com V1 aparecem no bloco 'Avaliações legadas'." />
          </SummaryKpiGrid>
          <div className="grid gap-4 xl:grid-cols-2">
            <OverlaySection title="Distribuição das avaliações (V2)" description="Faixas de nota geral: avaliações por pedido e fornecedores pela média consolidada." testId="performance-evaluation-distribution">
              <EvaluationDistributionChart bands={evaluation.distribution} />
            </OverlaySection>
            <OverlaySection title="Nota × valor comprado" description="Cada ponto é um fornecedor V2; tamanho = nº de pedidos. Sem classificação automática." testId="performance-score-vs-spend">
              <ScoreVsSpendChart points={evaluation.scoreVsSpend} currency={currency} scaleMax={evaluation.scaleMax} onSelectSupplier={onSelectSupplier} />
            </OverlaySection>
          </div>
        </>
      )}
    </DashboardSection>
  );
}

/* ------------------------------------------------------------------ *
 * Seção 8 — Indicadores operacionais avançados
 * ------------------------------------------------------------------ */

const ADVANCED_GROUP_ORDER: AdvancedMetricGroup[] = ["DELIVERY", "QUALITY", "RESPONSIVENESS", "COMPLIANCE", "COMMERCIAL", "RISK"];

export function AdvancedMetricsTable({ entries, testId }: { entries: AdvancedMetricEntry[]; testId?: string }) {
  const grouped = useMemo(() => {
    const map = new Map<AdvancedMetricGroup, AdvancedMetricEntry[]>();
    for (const entry of entries) {
      const list = map.get(entry.group) ?? [];
      list.push(entry);
      map.set(entry.group, list);
    }
    return ADVANCED_GROUP_ORDER.filter((group) => map.has(group)).map((group) => ({ group, entries: map.get(group)! }));
  }, [entries]);
  const counts = useMemo(() => {
    const result = { available: 0, partial: 0, unavailable: 0 };
    for (const entry of entries) result[entry.status] += 1;
    return result;
  }, [entries]);
  return (
    <div className="space-y-3" data-testid={testId}>
      <div className="flex flex-wrap gap-2 text-xs">
        <OverlayBadge tone="emerald">Disponíveis: {counts.available}</OverlayBadge>
        <OverlayBadge tone="amber">Parciais: {counts.partial}</OverlayBadge>
        <OverlayBadge tone="slate">Indisponíveis: {counts.unavailable}</OverlayBadge>
      </div>
      {grouped.map(({ group, entries: list }) => (
        <React.Fragment key={group}>
        <OverlaySection title={ADVANCED_METRIC_GROUP_LABELS[group]} padded={false} testId={`advanced-group-`}>
          <OverlayTable>
            <OverlayTable.Head>
              <OverlayTable.Row>
                <OverlayTable.HeadCell>Indicador</OverlayTable.HeadCell>
                <OverlayTable.HeadCell>Status</OverlayTable.HeadCell>
                <OverlayTable.HeadCell>Valor</OverlayTable.HeadCell>
                <OverlayTable.HeadCell>Fonte / motivo</OverlayTable.HeadCell>
              </OverlayTable.Row>
            </OverlayTable.Head>
            <OverlayTable.Body>
              {list.map((entry) => (
                <OverlayTable.Row key={entry.key} data-testid={`advanced-metric-${entry.key}`} data-status={entry.status}>
                  <OverlayTable.Cell>
                    <span className="font-medium">{entry.label}</span>
                    {entry.formula ? <span className="block text-[11px] text-muted-foreground">{entry.formula}</span> : null}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell>
                    <OverlayBadge tone={ADVANCED_METRIC_STATUS_TONES[entry.status]}>{ADVANCED_METRIC_STATUS_LABELS[entry.status]}</OverlayBadge>
                  </OverlayTable.Cell>
                  <OverlayTable.Cell className={entry.status === "unavailable" ? "text-muted-foreground" : undefined}>
                    {entry.status === "unavailable" ? ADVANCED_METRIC_UNAVAILABLE_LABEL : describeAdvancedMetricValue(entry)}
                  </OverlayTable.Cell>
                  <OverlayTable.Cell className="max-w-[28rem] text-xs text-muted-foreground">
                    {entry.source ? <span className="block text-foreground">{entry.source}</span> : null}
                    {entry.reason ? <span className="block">{entry.reason}</span> : null}
                  </OverlayTable.Cell>
                </OverlayTable.Row>
              ))}
            </OverlayTable.Body>
          </OverlayTable>
        </OverlaySection>
        </React.Fragment>
      ))}
    </div>
  );
}

export function AdvancedMetricsSection({ data }: { data: ReadModel }) {
  return (
    <DashboardSection
      title="Indicadores operacionais avançados"
      eyebrow="Seção 8"
      description="Catálogo de mercado (OTD, OTIF, lead time, fill rate, PPM, NCR, SCAR, compliance, PPV…). Cada indicador declara disponibilidade e fonte. Indisponível significa 'sem fonte oficial' — nunca zero."
      testId="performance-advanced-section"
    >
      <AdvancedMetricsTable entries={data.advancedMetrics} testId="performance-advanced-metrics" />
    </DashboardSection>
  );
}

/* ------------------------------------------------------------------ *
 * Dados e regras (auditabilidade)
 * ------------------------------------------------------------------ */

export function DataRulesPanel({ data }: { data: ReadModel }) {
  const p = data.metadata.population;
  const currency = data.metadata.currency.selected;
  return (
    <details className="rounded-lg border border-border bg-white" data-testid="performance-data-rules">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-foreground">Dados e regras (auditoria)</summary>
      <div className="grid gap-4 border-t border-border px-3 py-3 text-xs md:grid-cols-2">
        <div>
          <p className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">População</p>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
            <dt>Gerado em</dt><dd className="text-right font-mono">{formatDashboardDateTime(data.metadata.generatedAt)}</dd>
            <dt>Última sincronização Nomus</dt><dd className="text-right font-mono">{formatDashboardDateTime(data.metadata.lastSyncedAt)}</dd>
            <dt>Período</dt><dd className="text-right font-mono">{formatDashboardPeriodLabel(data.metadata.period)}</dd>
            <dt>Base de spend</dt><dd className="text-right font-mono">{data.metadata.spendBasis === "line" ? "linha (filtro de MP/grupo)" : "cabeçalho do pedido"}</dd>
            <dt>Pedidos · linhas</dt><dd className="text-right font-mono">{formatDashboardInteger(p.orderCount)} · {formatDashboardInteger(p.lineCount)}</dd>
            <dt>Fornecedores · MPs</dt><dd className="text-right font-mono">{formatDashboardInteger(p.supplierCount)} · {formatDashboardInteger(p.materialCount)}</dd>
            <dt>Cancelados excluídos</dt><dd className="text-right font-mono">{formatDashboardInteger(p.canceledExcluded)}</dd>
            <dt>Outras moedas excluídas</dt><dd className="text-right font-mono">{formatDashboardInteger(p.otherCurrencyExcluded)}</dd>
            <dt>Pedidos sem fornecedor identificado</dt><dd className="text-right font-mono">{formatDashboardInteger(p.unresolvedSupplierOrders)} ({formatDashboardMoney(p.unresolvedSupplierSpend, currency)})</dd>
            <dt>Linhas sem material identificado</dt><dd className="text-right font-mono">{formatDashboardInteger(p.unresolvedMaterialLines)}</dd>
            <dt>Linhas sem valor · pedidos sem valor</dt><dd className="text-right font-mono">{formatDashboardInteger(p.linesWithoutValue)} · {formatDashboardInteger(p.ordersWithoutValue)}</dd>
            <dt>Total cabeçalho · total linhas</dt><dd className="text-right font-mono">{formatDashboardMoney(p.headerSpendTotal, currency)} · {formatDashboardMoney(p.lineSpendTotal, currency)}</dd>
          </dl>
          <p className="mt-2 text-muted-foreground">
            Cabeçalho e linhas podem diferir por frete, desconto ou linhas sem valor — nenhum rateio é inventado.
          </p>
        </div>
        <div>
          <p className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">Autoridades</p>
          <dl className="space-y-0.5">
            {Object.entries(data.metadata.authorities).map(([key, value]) => (
              <div key={key} className="grid grid-cols-[minmax(0,12rem)_1fr] gap-2">
                <dt className="font-mono text-[10px] text-muted-foreground">{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">
            <span className="font-semibold">{data.metadata.eligibilityRule.status}:</span> {data.metadata.eligibilityRule.note}
          </p>
        </div>
      </div>
    </details>
  );
}
