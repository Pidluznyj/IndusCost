import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, BarChart3, Loader2, Play, Sparkles } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { buildCustomerIntelligencePath } from "@/src/lib/customerIntelligenceNavigation";
import {
  describeCrmReportsError,
  downloadCrmCustomReportExport,
  fetchCrmCustomReport,
  isCrmReportsAbortError,
  type CrmReportsExportFormatChoice,
} from "@/src/lib/commercial/crmReportsClient";
import {
  formatCrmReportsAverageDays,
  formatCrmReportsDate,
  formatCrmReportsDateTime,
  formatCrmReportsDays,
  formatCrmReportsInteger,
  formatCrmReportsMoney,
} from "@/src/lib/commercial/crmReportsFormat";
import { formatCrmOverdueDaysMetric } from "@/src/lib/commercial/crmReportsLabels";
import {
  CRM_REPORT_BUILDER_CUSTOMER_STATUS_OPTIONS,
  CRM_REPORT_BUILDER_DIMENSIONS,
  CRM_REPORT_PERIOD_PRESETS,
  CRM_REPORT_PERIOD_PRESET_LABELS,
  buildCrmCustomReportRequestBody,
  createEmptyCrmReportBuilderState,
  crmCustomReportSpecKey,
  crmReportMetricAvailability,
  describeCrmReportBuilderIssues,
  normalizeCrmReportBuilder,
  resolveCrmReportPeriod,
  toggleCrmReportDimension,
  toggleCrmReportMetric,
  type CrmReportBuilderState,
  type CrmReportPeriodPreset,
  type CrmReportsUiState,
} from "@/src/lib/commercial/crmReportsUiState";
import { CRM_REPORT_TEMPLATES, applyCrmReportTemplate } from "@/src/lib/commercial/crmReportsTemplates";
import {
  CRM_CUSTOM_REPORT_CUSTOMER_STATUS_LABELS,
  CRM_CUSTOM_REPORT_DIMENSION_LABELS,
  CRM_CUSTOM_REPORT_MAX_DIMENSIONS,
  CRM_CUSTOM_REPORT_METRIC_LABELS,
  CRM_CUSTOM_REPORT_METRICS,
  CRM_CUSTOM_REPORT_PAGE_DEFAULT_LIMIT,
  type CrmCustomReportCustomerStatus,
  type CrmCustomReportMetric,
  type CrmCustomReportMetricValues,
  type CrmCustomReportRequest,
  type CrmCustomReportResponse,
  type CrmCustomReportSortKey,
  type CrmReportsWindows,
} from "@/src/lib/commercial/crmReportsTypes";
import { CrmReportsExportButtons } from "./CrmReportsShared";

export const CRM_REPORT_BUILDER_EMPTY_MESSAGE = "Selecione os filtros e clique em Gerar relatório.";

export type CrmReportBuilderProps = {
  /** Filtros globais da aba — os MESMOS do universo das listas. */
  ui: Pick<CrmReportsUiState, "filters" | "selection">;
  /** Janelas do backend (dia de referência) — sem conta de data no navegador. */
  windows: CrmReportsWindows | null;
  filtersActive: boolean;
  canOpenCustomer360: boolean;
  /** Injeção para testes. */
  fetchReport?: typeof fetchCrmCustomReport;
  downloadReport?: typeof downloadCrmCustomReportExport;
};

type Result = { request: CrmCustomReportRequest; response: CrmCustomReportResponse };

function formatMetric(metric: CrmCustomReportMetric, value: CrmCustomReportMetricValues[CrmCustomReportMetric]): string {
  const n = typeof value === "number" ? value : null;
  switch (metric) {
    case "soldValue":
    case "averageTicket":
      return formatCrmReportsMoney(n);
    case "orders":
    case "customers":
      return formatCrmReportsInteger(n);
    case "lastPurchaseDate":
      return formatCrmReportsDate(typeof value === "string" ? value : null);
    case "daysSinceLastPurchase":
      return formatCrmReportsDays(n);
    case "averageRepurchaseDays":
      return formatCrmReportsAverageDays(n);
    case "overdueDays":
      return formatCrmOverdueDaysMetric(n);
  }
}

const FIELD_LABEL = "block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
const SELECT_CLASS =
  "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

/**
 * Relatório personalizado (V1). Executa SOMENTE no clique em "Gerar
 * relatório" (e na paginação/exportação do resultado já gerado, que reusam o
 * spec gerado). Nenhuma consulta na montagem.
 */
export function CrmReportBuilder({
  ui,
  windows,
  filtersActive,
  canOpenCustomer360,
  fetchReport = fetchCrmCustomReport,
  downloadReport = downloadCrmCustomReportExport,
}: CrmReportBuilderProps) {
  const [builder, setBuilder] = useState<CrmReportBuilderState>(createEmptyCrmReportBuilderState);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<CrmReportsExportFormatChoice | null>(null);
  const [exportNotice, setExportNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Só limpeza: nada é buscado na montagem.
  useEffect(() => () => abortRef.current?.abort(), []);

  const update = (next: CrmReportBuilderState) => {
    setFormError(null);
    setBuilder(next);
  };

  const execute = (request: CrmCustomReportRequest) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setExportNotice(null);
    fetchReport(request, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setResult({ request, response });
        setLoading(false);
      })
      .catch((err) => {
        if (isCrmReportsAbortError(err) || controller.signal.aborted) return;
        setError(describeCrmReportsError(err, "Não foi possível gerar o relatório."));
        setLoading(false);
      });
  };

  const issues = describeCrmReportBuilderIssues(builder);
  const period = resolveCrmReportPeriod(builder, windows);

  const handleGenerate = () => {
    if (issues.length > 0) {
      setFormError(issues.join(" "));
      return;
    }
    if (period.ok === false) {
      setFormError(period.error);
      return;
    }
    execute(
      buildCrmCustomReportRequestBody({
        builder,
        ui,
        period: period.period,
        offset: 0,
        limit: CRM_CUSTOM_REPORT_PAGE_DEFAULT_LIMIT,
      })
    );
  };

  const goToOffset = (offset: number) => {
    if (!result) return;
    execute({ ...result.request, pagination: { ...result.request.pagination, offset } });
  };

  const handleExport = (format: CrmReportsExportFormatChoice) => {
    if (!result) return;
    setExporting(format);
    setExportNotice(null);
    downloadReport(result.request, format)
      .then((file) =>
        setExportNotice({
          tone: "ok",
          text: `Arquivo ${file.filename} gerado${file.rowCount != null ? ` (${formatCrmReportsInteger(file.rowCount)} linhas)` : ""}.`,
        })
      )
      .catch((err) =>
        setExportNotice({ tone: "error", text: describeCrmReportsError(err, "Não foi possível exportar o relatório.") })
      )
      .finally(() => setExporting(null));
  };

  // Resultado desatualizado: o spec atual difere do gerado (nada é reexecutado sozinho).
  const currentKey =
    issues.length === 0 && period.ok
      ? crmCustomReportSpecKey(buildCrmCustomReportRequestBody({ builder, ui, period: period.period }))
      : null;
  const stale = result != null && currentKey !== crmCustomReportSpecKey(result.request);

  const sortOptions: CrmCustomReportSortKey[] = [...builder.dimensions, ...builder.metrics];

  return (
    <section
      className="rounded-2xl border border-border bg-card shadow-sm"
      aria-label="Relatório personalizado"
      data-testid="crm-report-builder"
    >
      <div className="flex flex-col gap-1 border-b border-border/60 px-4 pb-3 pt-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Relatório personalizado</p>
        <div className="flex flex-wrap items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" aria-hidden />
          <h3 className="text-base font-bold text-foreground">Construtor de relatórios</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Usa os mesmos filtros globais e clientes ocultados das listas. Só roda quando você clica em “Gerar relatório”.
          Fonte: Pedidos de Venda (emissão, dia civil); situação de recompra vem do motor de recompra.
        </p>
      </div>

      <div className="space-y-4 px-4 py-4">
        <div>
          <p className={cn(FIELD_LABEL, "mb-2 flex items-center gap-1")}>
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Relatórios prontos
          </p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Relatórios prontos">
            {CRM_REPORT_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                title={template.description}
                aria-pressed={builder.templateId === template.id}
                onClick={() => update(applyCrmReportTemplate(builder, template))}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                  builder.templateId === template.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:bg-accent"
                )}
              >
                {template.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Um modelo só preenche o construtor — revise e clique em Gerar relatório.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-[1.2fr_1fr_1.4fr_0.8fr_1fr]">
          <fieldset className="space-y-2 rounded-xl border border-border/70 p-3">
            <legend className={cn(FIELD_LABEL, "px-1")}>Filtros</legend>
            <p className="text-xs text-muted-foreground">
              {filtersActive ? "Filtros globais ativos (ver painel acima)." : "Sem filtros globais: universo inteiro permitido."}
            </p>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-foreground">Período (emissão do pedido)</span>
              <select
                className={SELECT_CLASS}
                value={builder.periodPreset}
                onChange={(e) => update({ ...builder, templateId: null, periodPreset: e.target.value as CrmReportPeriodPreset })}
              >
                {CRM_REPORT_PERIOD_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {CRM_REPORT_PERIOD_PRESET_LABELS[preset]}
                  </option>
                ))}
              </select>
            </label>
            {builder.periodPreset === "CUSTOM" ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1">
                  <span className="text-[11px] text-muted-foreground">De</span>
                  <input
                    type="date"
                    className={SELECT_CLASS}
                    value={builder.customFrom}
                    onChange={(e) => update({ ...builder, customFrom: e.target.value })}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] text-muted-foreground">Até</span>
                  <input
                    type="date"
                    className={SELECT_CLASS}
                    value={builder.customTo}
                    onChange={(e) => update({ ...builder, customTo: e.target.value })}
                  />
                </label>
              </div>
            ) : period.ok && period.period ? (
              <p className="text-[11px] tabular-nums text-muted-foreground">
                {formatCrmReportsDate(period.period.from)} a {formatCrmReportsDate(period.period.to)}
              </p>
            ) : null}
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-foreground">Situação do cliente</span>
              <select
                className={SELECT_CLASS}
                value={builder.customerStatus}
                onChange={(e) =>
                  update({ ...builder, templateId: null, customerStatus: e.target.value as CrmCustomReportCustomerStatus })
                }
              >
                {CRM_REPORT_BUILDER_CUSTOMER_STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {CRM_CUSTOM_REPORT_CUSTOMER_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          <fieldset className="space-y-1.5 rounded-xl border border-border/70 p-3">
            <legend className={cn(FIELD_LABEL, "px-1")}>Dimensões (até {CRM_CUSTOM_REPORT_MAX_DIMENSIONS})</legend>
            {CRM_REPORT_BUILDER_DIMENSIONS.map((dimension) => {
              const position = builder.dimensions.indexOf(dimension);
              const checked = position >= 0;
              const full = !checked && builder.dimensions.length >= CRM_CUSTOM_REPORT_MAX_DIMENSIONS;
              return (
                <label
                  key={dimension}
                  className={cn("flex items-center gap-2 text-sm", full ? "text-muted-foreground" : "text-foreground")}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border accent-primary"
                    checked={checked}
                    disabled={full}
                    onChange={() => update(toggleCrmReportDimension(builder, dimension))}
                  />
                  <span>{CRM_CUSTOM_REPORT_DIMENSION_LABELS[dimension]}</span>
                  {checked ? (
                    <span className="ml-auto rounded-full bg-primary/10 px-1.5 text-[10px] font-bold text-primary">
                      {position + 1}ª
                    </span>
                  ) : null}
                </label>
              );
            })}
          </fieldset>

          <fieldset className="space-y-1.5 rounded-xl border border-border/70 p-3">
            <legend className={cn(FIELD_LABEL, "px-1")}>Métricas</legend>
            {CRM_CUSTOM_REPORT_METRICS.map((metric) => {
              const availability = crmReportMetricAvailability(metric, builder.dimensions);
              const checked = builder.metrics.includes(metric);
              return (
                <label
                  key={metric}
                  className={cn(
                    "flex items-start gap-2 text-sm",
                    availability.available ? "text-foreground" : "text-muted-foreground"
                  )}
                  title={availability.reason ?? undefined}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
                    checked={checked}
                    disabled={!availability.available}
                    onChange={() => update(toggleCrmReportMetric(builder, metric))}
                  />
                  <span>
                    {CRM_CUSTOM_REPORT_METRIC_LABELS[metric]}
                    {!availability.available ? (
                      <span className="block text-[11px] leading-snug">{availability.reason}</span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </fieldset>

          <fieldset className="space-y-2 rounded-xl border border-border/70 p-3">
            <legend className={cn(FIELD_LABEL, "px-1")}>Agrupar por</legend>
            <select
              className={SELECT_CLASS}
              value={builder.groupBy ?? ""}
              disabled={builder.dimensions.length < 2}
              onChange={(e) =>
                update(
                  normalizeCrmReportBuilder({
                    ...builder,
                    templateId: null,
                    groupBy: (e.target.value || null) as CrmReportBuilderState["groupBy"],
                  })
                )
              }
            >
              <option value="">Sem agrupamento</option>
              {builder.dimensions.map((dimension) => (
                <option key={dimension} value={dimension}>
                  {CRM_CUSTOM_REPORT_DIMENSION_LABELS[dimension]}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">Subtotal por grupo; exige 2 dimensões ou mais.</p>
          </fieldset>

          <fieldset className="space-y-2 rounded-xl border border-border/70 p-3">
            <legend className={cn(FIELD_LABEL, "px-1")}>Ordenação</legend>
            <select
              className={SELECT_CLASS}
              value={builder.sortBy ?? ""}
              onChange={(e) =>
                update({
                  ...builder,
                  templateId: null,
                  sortBy: (e.target.value || null) as CrmCustomReportSortKey | null,
                })
              }
            >
              <option value="">Padrão (1ª métrica, maior primeiro)</option>
              {sortOptions.map((key) => (
                <option key={key} value={key}>
                  {(CRM_CUSTOM_REPORT_METRIC_LABELS as Record<string, string>)[key] ??
                    (CRM_CUSTOM_REPORT_DIMENSION_LABELS as Record<string, string>)[key]}
                </option>
              ))}
            </select>
            <div className="inline-flex rounded-xl border border-border bg-muted/40 p-1" role="radiogroup" aria-label="Direção">
              {(["desc", "asc"] as const).map((direction) => (
                <button
                  key={direction}
                  type="button"
                  role="radio"
                  aria-checked={builder.sortDirection === direction}
                  disabled={builder.sortBy == null}
                  onClick={() => update({ ...builder, templateId: null, sortDirection: direction })}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-40",
                    builder.sortDirection === direction ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                  )}
                >
                  {direction === "desc" ? (
                    <ArrowDownWideNarrow className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <ArrowUpNarrowWide className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {direction === "desc" ? "Maior primeiro" : "Menor primeiro"}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-60"
            data-testid="crm-report-builder-generate"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
            Gerar relatório
          </button>
          {formError ? (
            <p className="text-xs font-semibold text-red-700" role="alert">
              {formError}
            </p>
          ) : issues.length > 0 ? (
            <p className="text-xs text-muted-foreground">{issues.join(" ")}</p>
          ) : null}
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            {error}
          </div>
        ) : null}

        {!result ? (
          loading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
              Gerando relatório…
            </div>
          ) : (
            <div
              className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground"
              data-testid="crm-report-builder-empty"
            >
              {CRM_REPORT_BUILDER_EMPTY_MESSAGE}
            </div>
          )
        ) : (
          <CrmCustomReportResult
            result={result}
            loading={loading}
            stale={stale}
            canOpenCustomer360={canOpenCustomer360}
            exporting={exporting}
            exportNotice={exportNotice}
            onExport={handleExport}
            onPage={goToOffset}
          />
        )}
      </div>
    </section>
  );
}

function CrmCustomReportResult({
  result,
  loading,
  stale,
  canOpenCustomer360,
  exporting,
  exportNotice,
  onExport,
  onPage,
}: {
  result: Result;
  loading: boolean;
  stale: boolean;
  canOpenCustomer360: boolean;
  exporting: CrmReportsExportFormatChoice | null;
  exportNotice: { tone: "ok" | "error"; text: string } | null;
  onExport: (format: CrmReportsExportFormatChoice) => void;
  onPage: (offset: number) => void;
}) {
  const { response } = result;
  const { spec } = response;
  const dimensionColumns = response.columns.filter((c) => c.kind === "dimension");
  const metricColumns = response.columns.filter((c) => c.kind === "metric");
  const groupBy = spec.groupBy;
  const groupsByKey = new Map((response.groups ?? []).map((g) => [g.key, g]));
  let lastGroupKey: string | null = null;

  return (
    <div className="space-y-3" data-testid="crm-report-builder-result">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground tabular-nums">{formatCrmReportsInteger(response.total)}</strong> linha(s) ·{" "}
          {formatCrmReportsInteger(response.universe.analyzedCustomers)} cliente(s) analisado(s) ·{" "}
          {spec.period
            ? `emissão de ${formatCrmReportsDate(spec.period.from)} a ${formatCrmReportsDate(spec.period.to)}`
            : "histórico inteiro"}{" "}
          · {CRM_CUSTOM_REPORT_CUSTOMER_STATUS_LABELS[spec.customerStatus]} · gerado em{" "}
          {formatCrmReportsDateTime(response.asOf)}
        </p>
        <CrmReportsExportButtons busy={exporting} disabled={response.total === 0 || loading} onExport={onExport} />
      </div>
      {stale ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
          Filtros ou opções mudaram desde a geração — clique em Gerar relatório para atualizar. A tabela abaixo
          corresponde ao relatório gerado.
        </p>
      ) : null}
      {exportNotice ? (
        <p
          className={cn(
            "rounded-lg border px-3 py-2 text-xs",
            exportNotice.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-800"
          )}
          role="status"
        >
          {exportNotice.text}
        </p>
      ) : null}

      <div className={cn("overflow-x-auto rounded-xl border border-border", loading && "opacity-60")}>
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-muted/20">
              {response.columns.map((column) => (
                <th
                  key={column.key}
                  className={cn(
                    "whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
                    column.kind === "metric" ? "text-right" : "text-left"
                  )}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {response.returned === 0 ? (
              <tr>
                <td colSpan={response.columns.length} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Nenhuma linha para esse recorte.
                </td>
              </tr>
            ) : (
              response.rows.flatMap((row) => {
                const out: React.ReactNode[] = [];
                const groupKey = groupBy ? row.dimensions[groupBy]?.key ?? null : null;
                if (groupBy && groupKey !== lastGroupKey) {
                  lastGroupKey = groupKey;
                  const group = groupKey ? groupsByKey.get(groupKey) : undefined;
                  if (group) {
                    out.push(
                      <tr key={`group:${group.key}`} className="border-b border-border/60 bg-primary/5 font-semibold">
                        <td colSpan={dimensionColumns.length} className="px-3 py-2 text-foreground">
                          {group.label}
                          <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                            subtotal · {formatCrmReportsInteger(group.rowCount)} linha(s)
                          </span>
                        </td>
                        {metricColumns.map((column) => (
                          <td key={column.key} className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-foreground">
                            {formatMetric(column.key as CrmCustomReportMetric, group.metrics[column.key as CrmCustomReportMetric])}
                          </td>
                        ))}
                      </tr>
                    );
                  }
                }
                out.push(
                  <tr key={row.key} className="border-b border-border/40 last:border-0">
                    {dimensionColumns.map((column) => {
                      const cell = row.dimensions[column.key as keyof typeof row.dimensions];
                      const isCustomer = column.key === "customer" && row.customerId && canOpenCustomer360;
                      return (
                        <td key={column.key} className="px-3 py-2 align-top">
                          {isCustomer ? (
                            <Link
                              to={buildCustomerIntelligencePath(row.customerId!)}
                              className="font-medium text-foreground hover:text-primary hover:underline"
                              title="Abrir Cliente 360"
                            >
                              {cell?.label ?? "—"}
                            </Link>
                          ) : (
                            <span className="text-foreground">{cell?.label ?? "—"}</span>
                          )}
                          {cell?.sublabel ? (
                            <span className="block text-[11px] tabular-nums text-muted-foreground">{cell.sublabel}</span>
                          ) : null}
                        </td>
                      );
                    })}
                    {metricColumns.map((column) => (
                      <td key={column.key} className="whitespace-nowrap px-3 py-2 text-right align-top tabular-nums">
                        {formatMetric(column.key as CrmCustomReportMetric, row.metrics[column.key as CrmCustomReportMetric])}
                      </td>
                    ))}
                  </tr>
                );
                return out;
              })
            )}
          </tbody>
          {response.total > 0 ? (
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/30 font-bold">
                <td colSpan={dimensionColumns.length} className="px-3 py-2.5 text-foreground">
                  Total geral
                  <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                    todas as {formatCrmReportsInteger(response.total)} linha(s)
                  </span>
                </td>
                {metricColumns.map((column) => (
                  <td key={column.key} className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-foreground">
                    {formatMetric(column.key as CrmCustomReportMetric, response.totals[column.key as CrmCustomReportMetric])}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {response.total > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">
            Linhas {formatCrmReportsInteger(response.offset + 1)}–{formatCrmReportsInteger(response.offset + response.returned)} de{" "}
            <strong className="text-foreground">{formatCrmReportsInteger(response.total)}</strong>
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={loading || response.offset === 0}
              onClick={() => onPage(Math.max(0, response.offset - response.limit))}
              className="rounded-lg border border-border bg-background px-2.5 py-1 font-semibold text-foreground hover:bg-accent disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={loading || !response.hasMore}
              onClick={() => onPage(response.offset + response.limit)}
              className="rounded-lg border border-border bg-background px-2.5 py-1 font-semibold text-foreground hover:bg-accent disabled:opacity-40"
            >
              Próxima
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
