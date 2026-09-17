/**
 * Compras → Performance → Classificação de fornecedores.
 *
 * Área de relatório institucional, adequada como evidência documental do
 * processo interno de avaliação e monitoramento de fornecedores.
 *
 * Apresentação PURA: classificação, nota, cobertura, contagens e datas vêm
 * prontas de /api/purchases/performance/classification. XLSX e PDF são gerados
 * no servidor a partir do MESMO read model — a tela não recalcula nada e não
 * monta arquivo no browser.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { OverlaySection, OverlayTable } from "@/src/components/ui/overlay";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";
import { cn } from "@/src/lib/utils";
import {
  SUPPLIER_CLASSIFICATION_BANDS,
  type SupplierClassification,
} from "@/src/lib/purchasing/supplierClassificationPolicy";
import {
  SUPPLIER_CLASSIFICATION_REPORT_DEFAULT_QUERY,
  SUPPLIER_REGISTRY_STATUS_LABELS,
  type SupplierClassificationReport,
  type SupplierClassificationReportQuery,
  type SupplierClassificationReportRow,
  type SupplierClassificationReportSort,
} from "@/src/lib/purchasing/supplierClassificationReport";
import type {
  DashboardMaterialOption,
  SupplierPerformanceDashboardFilters,
} from "@/src/lib/purchasing/supplierPerformanceDashboard";
import {
  buildSupplierClassificationExportUrl,
  fetchSupplierClassificationReport,
} from "@/src/lib/purchasing/supplierPerformanceDashboardClient";
import {
  CLASSIFICATION_BADGE_CLASSES,
  CLASSIFICATION_BADGE_TONES,
  formatDashboardDateTime,
  formatDashboardInteger,
  formatDashboardMoney,
  formatDashboardPercent,
  formatDashboardScore,
  formatDashboardScoreWithScale,
  type DashboardPeriodSelection,
  type SupplierPerformanceViewId,
} from "@/src/lib/purchasing/supplierPerformanceDashboardUi";
import { DashboardNotice, SupplierLinkButton } from "./SupplierPerformanceSections";
import { SupplierPerformanceKpiCard } from "./SupplierPerformanceKpiCard";
import {
  EMPTY_PERFORMANCE_FILTER_OPTIONS,
  SupplierPerformanceFilters,
  SupplierPerformanceShell,
  type PerformanceFilterOptions,
} from "./SupplierPerformanceShell";

const SUBTITLE =
  "Avaliação e monitoramento dos fornecedores com base nos pedidos do período.";

const CONTROL_CLASS =
  "h-9 w-full rounded-md border border-border bg-white px-2.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1";

const FIELD_LABEL_CLASS = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

/* ------------------------------------------------------------------ *
 * Badge de classificação — cor é secundária, o texto sempre aparece
 * ------------------------------------------------------------------ */

export function ClassificationBadge({
  classification,
  testId,
}: {
  classification: SupplierClassification;
  testId?: string;
}) {
  const tone = CLASSIFICATION_BADGE_TONES[classification.code];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        CLASSIFICATION_BADGE_CLASSES[tone]
      )}
      data-testid={testId}
      data-classification={classification.code}
      title={`${classification.label} · política ${classification.policyId} v${classification.policyVersion}`}
    >
      {classification.label}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Cabeçalho documental do relatório
 * ------------------------------------------------------------------ */

function HeaderField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className={FIELD_LABEL_CLASS}>{label}</dt>
      <dd className="mt-0.5 break-words text-xs text-foreground">{value}</dd>
    </div>
  );
}

export function ClassificationReportHeader({ report }: { report: SupplierClassificationReport }) {
  const m = report.metadata;
  return (
    <OverlaySection
      title="Identificação do relatório"
      description={m.purpose}
      testId="classification-report-header"
    >
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <HeaderField label="Relatório" value={m.title} />
        <HeaderField
          label="Período"
          value={`${m.period.from ?? "início"} a ${m.period.to ?? "hoje"}`}
        />
        <HeaderField label="Emitido em" value={formatDashboardDateTime(m.generatedAt)} />
        <HeaderField
          label="Metodologia vigente"
          value={`${m.methodology.id} · versão ${m.methodology.version} · escala ${m.methodology.scaleMin} a ${m.methodology.scaleMax}`}
        />
        <HeaderField
          label="Política de classificação"
          value={`${m.policy.id} · versão ${m.policy.version} · critério interno da empresa`}
        />
        <HeaderField label="Fonte dos dados" value={m.dataSource} />
        <HeaderField
          label="Última sincronização Nomus"
          value={formatDashboardDateTime(m.lastSyncedAt)}
        />
        <HeaderField
          label="Qualidade do dado financeiro"
          value={`${m.population.financialDataStatus} · ${formatDashboardInteger(
            m.population.ordersWithFinancialValue
          )} de ${formatDashboardInteger(m.population.orderCount)} pedidos com valor`}
        />
        <HeaderField
          label="Cobertura da avaliação"
          value={
            report.summary.coverage == null
              ? "Sem pedidos elegíveis no período"
              : `${formatDashboardPercent(report.summary.coverage)} · ${formatDashboardInteger(
                  report.summary.evaluatedOrders
                )} de ${formatDashboardInteger(report.summary.eligibleOrders)} pedidos`
          }
        />
        <HeaderField
          label="Filtros aplicados"
          value={m.appliedFilters.map((filter) => `${filter.label}: ${filter.value}`).join(" · ")}
        />
      </dl>
    </OverlaySection>
  );
}

/* ------------------------------------------------------------------ *
 * Resumo
 * ------------------------------------------------------------------ */

export function ClassificationSummary({ report }: { report: SupplierClassificationReport }) {
  const s = report.summary;
  return (
    <div className="space-y-3">
      <SummaryKpiGrid minColumnWidth={230} className={SYSTEM_TOTALIZER_GRID_CLASS} testId="classification-summary-population">
        <SupplierPerformanceKpiCard
          testId="classification-kpi-population"
          label="Fornecedores na população"
          value={formatDashboardInteger(s.suppliersInPopulation)}
          hint={`${formatDashboardInteger(s.suppliersEvaluated)} avaliados · ${formatDashboardInteger(
            s.suppliersWithoutEvaluation
          )} sem avaliação`}
          tooltip="Fornecedores identificados nos pedidos da população do período, após os filtros aplicados."
        />
        <SupplierPerformanceKpiCard
          testId="classification-kpi-coverage"
          label="Cobertura global"
          value={s.coverage == null ? "Sem pedidos elegíveis no período" : formatDashboardPercent(s.coverage)}
          hint={`${formatDashboardInteger(s.evaluatedOrders)} de ${formatDashboardInteger(
            s.eligibleOrders
          )} pedidos · ${formatDashboardInteger(s.pendingOrders)} pendentes`}
          tooltip="Pedidos avaliados ÷ pedidos elegíveis no período. Cobertura é informada separadamente e não altera a classificação."
        />
        <SupplierPerformanceKpiCard
          testId="classification-kpi-eligible"
          label="Pedidos elegíveis"
          value={formatDashboardInteger(s.eligibleOrders)}
          hint={`${formatDashboardInteger(s.evaluatedOrders)} avaliados`}
          tooltip="Pedidos da população do período que podem receber avaliação."
        />
      </SummaryKpiGrid>

      <SummaryKpiGrid minColumnWidth={200} className={SYSTEM_TOTALIZER_GRID_CLASS} testId="classification-summary-bands">
        <SupplierPerformanceKpiCard
          testId="classification-kpi-approved"
          label="Aprovados"
          value={formatDashboardInteger(s.approved)}
          tone="success"
          tooltip="Fornecedores com nota geral maior ou igual a 3,00 na escala vigente (1 a 5)."
        />
        <SupplierPerformanceKpiCard
          testId="classification-kpi-conditional"
          label="Condicionais"
          value={formatDashboardInteger(s.conditional)}
          tone="warning"
          tooltip="Fornecedores com nota geral maior ou igual a 2,00 e menor que 3,00."
        />
        <SupplierPerformanceKpiCard
          testId="classification-kpi-not-approved"
          label="Não aprovados"
          value={formatDashboardInteger(s.notApproved)}
          tone="danger"
          tooltip="Fornecedores com nota geral menor que 2,00."
        />
        <SupplierPerformanceKpiCard
          testId="classification-kpi-not-evaluated"
          label="Não avaliados"
          value={formatDashboardInteger(s.notEvaluated)}
          tooltip="Fornecedores sem avaliação finalizada no período. Ausência de avaliação não vira nota zero."
        />
        <SupplierPerformanceKpiCard
          testId="classification-kpi-legacy"
          label="Metodologia anterior"
          value={formatDashboardInteger(s.legacyMethodology)}
          hint="V1 (escala 0–10), sem faixa da política vigente"
          tooltip="Fornecedores cujo consolidado é formado apenas por avaliações V1 (0–10). A nota não é convertida para a escala vigente e a faixa não se aplica."
        />
      </SummaryKpiGrid>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Controles de leitura (busca, filtros e ordenação)
 * ------------------------------------------------------------------ */

const SORT_OPTIONS: Array<{ id: SupplierClassificationReportSort; label: string }> = [
  { id: "classification", label: "Classificação" },
  { id: "name", label: "Fornecedor" },
  { id: "score", label: "Nota geral" },
  { id: "coverage", label: "Cobertura" },
  { id: "spend", label: "Valor comprado" },
  { id: "orders", label: "Pedidos" },
];

export function ClassificationReadControls({
  query,
  onQueryChange,
}: {
  query: SupplierClassificationReportQuery;
  onQueryChange: (next: Partial<SupplierClassificationReportQuery>) => void;
}) {
  return (
    <div
      className="grid grid-cols-1 gap-2.5 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
      data-testid="classification-read-controls"
    >
      <label className="flex min-w-0 flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>Buscar fornecedor</span>
        <input
          value={query.search ?? ""}
          onChange={(event) => onQueryChange({ search: event.target.value || null })}
          placeholder="Nome, documento ou ID Nomus"
          className={CONTROL_CLASS}
          data-testid="classification-filter-search"
        />
      </label>

      <label className="flex min-w-0 flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>Classificação de desempenho</span>
        <select
          value={query.classification ?? ""}
          onChange={(event) =>
            onQueryChange({
              classification: (event.target.value ||
                null) as SupplierClassificationReportQuery["classification"],
            })
          }
          className={CONTROL_CLASS}
          data-testid="classification-filter-classification"
        >
          <option value="">Todas as classificações</option>
          {SUPPLIER_CLASSIFICATION_BANDS.map((band) => (
            <option key={band.code} value={band.code}>
              {band.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex min-w-0 flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>Situação cadastral</span>
        <select
          value={query.registryStatus ?? ""}
          onChange={(event) => onQueryChange({ registryStatus: event.target.value || null })}
          className={CONTROL_CLASS}
          data-testid="classification-filter-registry"
        >
          <option value="">Todas as situações</option>
          {Object.entries(SUPPLIER_REGISTRY_STATUS_LABELS).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex min-w-0 flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>Ordenar por</span>
        <div className="flex min-w-0 gap-1.5">
          <select
            value={query.sort}
            onChange={(event) =>
              onQueryChange({ sort: event.target.value as SupplierClassificationReportSort })
            }
            className={CONTROL_CLASS}
            data-testid="classification-filter-sort"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={query.direction}
            onChange={(event) =>
              onQueryChange({ direction: event.target.value as "asc" | "desc" })
            }
            className={cn(CONTROL_CLASS, "w-28 shrink-0")}
            aria-label="Direção da ordenação"
            data-testid="classification-filter-direction"
          >
            <option value="asc">Crescente</option>
            <option value="desc">Decrescente</option>
          </select>
        </div>
      </label>

      <label className="flex min-w-0 items-center gap-2 self-end pb-1 text-sm">
        <input
          type="checkbox"
          checked={query.onlyPending}
          onChange={(event) => onQueryChange({ onlyPending: event.target.checked })}
          className="h-4 w-4 rounded border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          data-testid="classification-filter-pending"
        />
        Somente com avaliações pendentes
      </label>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tabela principal
 * ------------------------------------------------------------------ */

export function ClassificationTable({
  report,
  onSelectSupplier,
}: {
  report: SupplierClassificationReport;
  onSelectSupplier?: (supplierExternalId: number) => void;
}) {
  const rows = report.rows;
  const financialUnavailable = report.metadata.population.financialDataStatus === "UNAVAILABLE";
  return (
    <OverlayTable stickyHeader>
      <OverlayTable.Head>
        <OverlayTable.Row>
          <OverlayTable.HeadCell className="min-w-[16rem]">Fornecedor</OverlayTable.HeadCell>
          <OverlayTable.HeadCell>Documento</OverlayTable.HeadCell>
          <OverlayTable.HeadCell>Situação cadastral</OverlayTable.HeadCell>
          <OverlayTable.HeadCell>Classificação de desempenho</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Nota geral</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Qualidade</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Prazo</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Conformidade</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Atendimento</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Avaliados / elegíveis</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Cobertura</OverlayTable.HeadCell>
          <OverlayTable.HeadCell>Última avaliação</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Pedidos no período</OverlayTable.HeadCell>
          <OverlayTable.HeadCell align="right">Valor comprado</OverlayTable.HeadCell>
        </OverlayTable.Row>
      </OverlayTable.Head>
      <OverlayTable.Body>
        {rows.length === 0 ? (
          <OverlayTable.Row>
            <OverlayTable.Cell colSpan={14} className="py-8 text-center text-muted-foreground">
              Nenhum fornecedor encontrado para o período e filtros aplicados.
            </OverlayTable.Cell>
          </OverlayTable.Row>
        ) : (
          rows.map((row) => {
            const scaleTitle =
              row.scaleMax == null ? undefined : `Escala ${row.scaleMax === 5 ? "1–5 (V2)" : "0–10 (V1)"}`;
            return (
              <OverlayTable.Row key={row.supplierExternalId} data-testid="classification-row">
                <OverlayTable.Cell className="min-w-[16rem] max-w-[24rem]">
                  <SupplierLinkButton
                    supplierExternalId={row.supplierExternalId}
                    name={row.name}
                    onSelect={onSelectSupplier}
                    className="block truncate"
                  />
                  <span className="block text-[11px] text-muted-foreground">
                    ID Nomus #{row.supplierExternalId}
                    {row.hasPendingEvaluations
                      ? ` · ${formatDashboardInteger(row.pendingOrders)} pendente(s)`
                      : ""}
                  </span>
                </OverlayTable.Cell>
                <OverlayTable.Cell mono>{row.document ?? "—"}</OverlayTable.Cell>
                <OverlayTable.Cell className="whitespace-nowrap text-xs text-muted-foreground">
                  {row.registryStatusLabel}
                </OverlayTable.Cell>
                <OverlayTable.Cell>
                  <ClassificationBadge
                    classification={row.classification}
                    testId={`classification-badge-${row.supplierExternalId}`}
                  />
                </OverlayTable.Cell>
                <OverlayTable.Cell align="right" mono title={scaleTitle}>
                  {formatDashboardScoreWithScale(row.overallScore, row.scaleMax)}
                </OverlayTable.Cell>
                <OverlayTable.Cell align="right" mono title={scaleTitle}>
                  {formatDashboardScore(row.qualityScore)}
                </OverlayTable.Cell>
                <OverlayTable.Cell align="right" mono title={scaleTitle}>
                  {formatDashboardScore(row.deliveryScore)}
                </OverlayTable.Cell>
                <OverlayTable.Cell align="right" mono title={scaleTitle}>
                  {formatDashboardScore(row.conformityScore)}
                </OverlayTable.Cell>
                <OverlayTable.Cell align="right" mono title={scaleTitle}>
                  {formatDashboardScore(row.serviceScore)}
                </OverlayTable.Cell>
                <OverlayTable.Cell align="right" mono>
                  {formatDashboardInteger(row.evaluatedOrders)} / {formatDashboardInteger(row.eligibleOrders)}
                </OverlayTable.Cell>
                <OverlayTable.Cell align="right" mono>
                  {row.coverage == null ? "—" : formatDashboardPercent(row.coverage)}
                </OverlayTable.Cell>
                <OverlayTable.Cell className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatDashboardDateTime(row.lastEvaluationAt)}
                </OverlayTable.Cell>
                <OverlayTable.Cell align="right" mono>
                  {formatDashboardInteger(row.orderCount)}
                </OverlayTable.Cell>
                <OverlayTable.Cell align="right" mono>
                  {financialUnavailable ? "Indisponível" : formatDashboardMoney(row.spend, row.currency)}
                </OverlayTable.Cell>
              </OverlayTable.Row>
            );
          })
        )}
      </OverlayTable.Body>
    </OverlayTable>
  );
}

/* ------------------------------------------------------------------ *
 * Legenda e metodologia declarada
 * ------------------------------------------------------------------ */

export function ClassificationLegend({ report }: { report: SupplierClassificationReport }) {
  const m = report.metadata;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <OverlaySection title="Legenda da classificação" testId="classification-legend">
        <ul className="space-y-1.5">
          {m.policy.bands.map((band) => (
            <li key={band.code} className="flex flex-wrap items-baseline gap-x-2 text-xs">
              <span
                className={cn(
                  "inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 font-medium",
                  CLASSIFICATION_BADGE_CLASSES[CLASSIFICATION_BADGE_TONES[band.code]]
                )}
              >
                {band.label}
              </span>
              <span className="min-w-0 text-muted-foreground">{band.rule}</span>
            </li>
          ))}
        </ul>
      </OverlaySection>

      <OverlaySection title="Metodologia e política declaradas" testId="classification-methodology">
        <div className="space-y-2 text-xs text-muted-foreground">
          <p className="text-foreground">
            {m.methodology.id} · versão {m.methodology.version} · escala {m.methodology.scaleMin} a{" "}
            {m.methodology.scaleMax}
          </p>
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {m.methodology.criteria.map((criterion) => (
              <li key={criterion.key}>
                {criterion.label} — {criterion.weightPercent}%
              </li>
            ))}
          </ul>
          <ul className="list-disc space-y-1 pl-4">
            {m.policy.text.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </OverlaySection>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Conteúdo completo (testável sem browser)
 * ------------------------------------------------------------------ */

export function SupplierClassificationContent({
  report,
  query,
  onQueryChange,
  onSelectSupplier,
  xlsxUrl,
  pdfUrl,
  loading = false,
}: {
  report: SupplierClassificationReport;
  query: SupplierClassificationReportQuery;
  onQueryChange: (next: Partial<SupplierClassificationReportQuery>) => void;
  onSelectSupplier?: (supplierExternalId: number) => void;
  xlsxUrl: string;
  pdfUrl: string;
  loading?: boolean;
}) {
  const pending = report.summary.pendingOrders;
  return (
    <div className="space-y-4" data-testid="supplier-classification-report">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold tracking-tight text-foreground">Classificação de fornecedores</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{SUBTITLE}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden /> : null}
          <a
            href={xlsxUrl}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-white px-3 text-xs font-semibold text-foreground hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            data-testid="classification-export-xlsx"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />
            Exportar XLSX
          </a>
          <a
            href={pdfUrl}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-white px-3 text-xs font-semibold text-foreground hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            data-testid="classification-export-pdf"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            Exportar PDF
          </a>
        </div>
      </div>

      {report.metadata.evaluation.available === false ? (
        <DashboardNotice tone="warning" title="Avaliação indisponível" testId="classification-notice-evaluation">
          {report.metadata.evaluation.reason}
        </DashboardNotice>
      ) : null}

      {pending > 0 ? (
        <DashboardNotice tone="warning" title="Avaliações pendentes" testId="classification-notice-pending">
          {formatDashboardInteger(pending)} de {formatDashboardInteger(report.summary.eligibleOrders)} pedidos
          elegíveis ainda não possuem avaliação registrada no período. Pedido sem avaliação não recebe nota zero: a
          pendência é apresentada na cobertura e não altera a classificação.
        </DashboardNotice>
      ) : null}

      <ClassificationReportHeader report={report} />
      <ClassificationSummary report={report} />
      <ClassificationReadControls query={query} onQueryChange={onQueryChange} />

      <OverlaySection
        title="Fornecedores classificados"
        description="Situação cadastral e classificação de desempenho são informações distintas: o cadastro não aprova desempenho. Clique no fornecedor para ver a evidência por pedido."
        padded={false}
        testId="classification-table-section"
      >
        <ClassificationTable report={report} onSelectSupplier={onSelectSupplier} />
      </OverlaySection>

      <ClassificationLegend report={report} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Container da sub-aba
 * ------------------------------------------------------------------ */

type ClassificationState =
  | { status: "loading"; report: SupplierClassificationReport | null }
  | { status: "error"; message: string; report: SupplierClassificationReport | null }
  | { status: "success"; report: SupplierClassificationReport };

export function SupplierClassificationPage({
  view,
  onViewChange,
  filters,
  selection,
  materialOption,
  onSelectionChange,
  onFiltersChange,
  onMaterialOptionChange,
  onSelectSupplier,
  onRefresh,
  reloadToken,
}: {
  view: SupplierPerformanceViewId;
  onViewChange: (next: SupplierPerformanceViewId) => void;
  filters: SupplierPerformanceDashboardFilters;
  selection: DashboardPeriodSelection;
  materialOption: DashboardMaterialOption | null;
  onSelectionChange: (next: DashboardPeriodSelection) => void;
  onFiltersChange: (next: Partial<SupplierPerformanceDashboardFilters>) => void;
  onMaterialOptionChange: (next: DashboardMaterialOption | null) => void;
  onSelectSupplier: (supplierExternalId: number) => void;
  onRefresh: () => void;
  reloadToken: number;
}) {
  const [query, setQuery] = useState<SupplierClassificationReportQuery>(
    SUPPLIER_CLASSIFICATION_REPORT_DEFAULT_QUERY
  );
  const [state, setState] = useState<ClassificationState>({ status: "loading", report: null });

  const requestKey = useMemo(() => JSON.stringify({ filters, query }), [filters, query]);

  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => ({ status: "loading", report: prev.report }));
    fetchSupplierClassificationReport(filters, query, controller.signal)
      .then((payload) => {
        if (!controller.signal.aborted) setState({ status: "success", report: payload });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setState((prev) => ({
          status: "error",
          message: err instanceof Error ? err.message : "Falha ao carregar a classificação de fornecedores.",
          report: prev.report,
        }));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, reloadToken]);

  const handleQueryChange = useCallback((next: Partial<SupplierClassificationReportQuery>) => {
    setQuery((prev) => ({ ...prev, ...next }));
  }, []);

  const report = state.report;
  const options: PerformanceFilterOptions = report
    ? {
        suppliers: report.metadata.filterOptions.suppliers,
        materialGroups: report.metadata.filterOptions.materialGroups,
        currencies: report.metadata.filterOptions.currencies,
        availableYears: report.metadata.availableYears,
        selectedCurrency: report.metadata.currency.selected,
      }
    : EMPTY_PERFORMANCE_FILTER_OPTIONS;

  return (
    <SupplierPerformanceShell
      view={view}
      onViewChange={onViewChange}
      title="Performance de fornecedores"
      description="Compras, concentração, risco e desempenho da base de fornecedores."
      filtersSlot={
        <SupplierPerformanceFilters
          selection={selection}
          filters={filters}
          options={options}
          materialOption={materialOption}
          onSelectionChange={onSelectionChange}
          onFiltersChange={onFiltersChange}
          onMaterialOptionChange={onMaterialOptionChange}
          onRefresh={onRefresh}
          loading={state.status === "loading"}
        />
      }
    >
      {state.status === "error" ? (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700"
          role="alert"
          data-testid="classification-error"
        >
          <p className="font-semibold">Não foi possível carregar a classificação de fornecedores.</p>
          <p>{state.message}</p>
          <button
            type="button"
            onClick={onRefresh}
            className="mt-2 rounded-md border border-rose-300 bg-white px-3 py-1 text-xs"
          >
            Tentar novamente
          </button>
        </div>
      ) : null}

      {!report && state.status === "loading" ? (
        <div
          className="flex items-center gap-2 rounded-md border border-border bg-white px-4 py-10 text-sm text-muted-foreground"
          data-testid="classification-loading"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Carregando classificação de fornecedores…
        </div>
      ) : null}

      {report ? (
        <SupplierClassificationContent
          report={report}
          query={query}
          onQueryChange={handleQueryChange}
          onSelectSupplier={onSelectSupplier}
          xlsxUrl={buildSupplierClassificationExportUrl("xlsx", filters, query)}
          pdfUrl={buildSupplierClassificationExportUrl("pdf", filters, query)}
          loading={state.status === "loading"}
        />
      ) : null}
    </SupplierPerformanceShell>
  );
}
