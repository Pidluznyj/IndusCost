import React, { useMemo } from "react";
import { FinanceBiFilterPanel } from "@/src/components/finance/bi/FinanceBiFilterPanel";
import { PortfolioIntelligenceHelpPopover } from "./PortfolioIntelligenceHelpPopover";
import {
  applyPeriodPresetToFilters,
  buildPortfolioIntelligenceFilterChips,
  countActivePortfolioIntelligenceFilters,
  createDefaultPortfolioIntelligenceUiFilters,
  dateAxisLabel,
  PORTFOLIO_INTELLIGENCE_CONFIDENCE_OPTIONS,
  PORTFOLIO_INTELLIGENCE_DATE_AXIS_HELP,
  PORTFOLIO_INTELLIGENCE_DATE_AXIS_OPTIONS,
  PORTFOLIO_INTELLIGENCE_PERIOD_PRESETS,
  PORTFOLIO_INTELLIGENCE_STATUS_OPTIONS,
  PORTFOLIO_INTELLIGENCE_TAG_OPTIONS,
  type PortfolioIntelligencePeriodPreset,
  type PortfolioIntelligenceUiFilters,
} from "@/src/lib/finance/portfolioIntelligenceFilters";
import { resolveFinanceBiFilterStatus } from "@/src/lib/financeBiFilterState";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards";
import { cn } from "@/src/lib/utils";

type Props = {
  draft: PortfolioIntelligenceUiFilters;
  applied: PortfolioIntelligenceUiFilters;
  expanded: boolean;
  onToggle: () => void;
  onDraftChange: (next: PortfolioIntelligenceUiFilters) => void;
  onApply: () => void;
  onClear: () => void;
  /** Aplica imediatamente um conjunto (ex.: remoção de chip). */
  onApplyFilters: (next: PortfolioIntelligenceUiFilters) => void;
  customers?: Array<{ customerExternalId: number; customerName: string | null }>;
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className={financeModuleFilterLabelClass()}>{children}</label>;
}

function QuickToggle({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId: string;
}) {
  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium",
        checked
          ? "border-sky-300 bg-sky-50 text-sky-950"
          : "border-border bg-background text-muted-foreground hover:bg-muted/40"
      )}
      data-testid={testId}
    >
      <input
        type="checkbox"
        className="h-3 w-3"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

/**
 * Barra de filtros da Inteligência — compacta, com eixo de data explícito.
 */
export function PortfolioIntelligenceFiltersBar({
  draft,
  applied,
  expanded,
  onToggle,
  onDraftChange,
  onApply,
  onClear,
  onApplyFilters,
  customers = [],
}: Props) {
  const filterStatus = resolveFinanceBiFilterStatus(
    JSON.stringify(draft),
    JSON.stringify(applied)
  );

  const chips = useMemo(
    () =>
      buildPortfolioIntelligenceFilterChips(applied, (field) => {
        const defaults = createDefaultPortfolioIntelligenceUiFilters();
        const next: PortfolioIntelligenceUiFilters = {
          ...applied,
          [field]: defaults[field],
        };
        if (field === "periodPreset") {
          next.periodPreset = "";
          next.from = "";
          next.to = "";
        }
        if (field === "dateAxis") {
          next.dateAxis = "FORECAST_DATE";
        }
        if (field === "from" || field === "to") {
          if (field === "from") next.from = "";
          if (field === "to") next.to = "";
          next.periodPreset = next.from || next.to ? "custom" : "";
        }
        onApplyFilters(next);
      }),
    [applied, onApplyFilters]
  );

  const activeCount = countActivePortfolioIntelligenceFilters(applied);
  const axisMeta = PORTFOLIO_INTELLIGENCE_DATE_AXIS_OPTIONS.find(
    (o) => o.value === draft.dateAxis
  );

  const set = <K extends keyof PortfolioIntelligenceUiFilters>(
    key: K,
    value: PortfolioIntelligenceUiFilters[K]
  ) => onDraftChange({ ...draft, [key]: value });

  const selectedTags = new Set(
    draft.tagsAlerta
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
  );

  return (
    <div data-testid="portfolio-intelligence-filters">
      <FinanceBiFilterPanel
        compact
        title="Filtros da inteligência"
        advancedLabel={`Filtros avançados${activeCount > 0 ? ` (${activeCount})` : ""}`}
        expanded={expanded}
        onToggle={onToggle}
        filterStatus={filterStatus}
        chips={chips}
        onApply={onApply}
        onClear={onClear}
        filterScopeNote={`Eixo de data ativo: ${dateAxisLabel(applied.dateAxis)}. Pedidos por emissão ≠ Contas a Receber por vencimento.`}
        alwaysVisible={
          <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[200px] flex-1">
                <div className="mb-1 flex items-center gap-1">
                  <FieldLabel>Eixo de data</FieldLabel>
                  <PortfolioIntelligenceHelpPopover
                    title="Eixo de data do período"
                    explanation={PORTFOLIO_INTELLIGENCE_DATE_AXIS_HELP}
                  />
                </div>
                <select
                  className={financeModuleFilterFieldClass()}
                  value={draft.dateAxis}
                  onChange={(e) =>
                    set(
                      "dateAxis",
                      e.target.value as PortfolioIntelligenceUiFilters["dateAxis"]
                    )
                  }
                  data-testid="portfolio-intelligence-date-axis"
                >
                  {PORTFOLIO_INTELLIGENCE_DATE_AXIS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-[140px]">
                <FieldLabel>Cliente (ID Nomus)</FieldLabel>
                {customers.length > 0 ? (
                  <select
                    className={financeModuleFilterFieldClass()}
                    value={draft.customerExternalId}
                    onChange={(e) => set("customerExternalId", e.target.value)}
                    data-testid="portfolio-intelligence-customer"
                  >
                    <option value="">Todos</option>
                    {customers.map((c) => (
                      <option
                        key={c.customerExternalId}
                        value={String(c.customerExternalId)}
                      >
                        {c.customerName
                          ? `${c.customerName} (${c.customerExternalId})`
                          : `Cliente ${c.customerExternalId}`}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={financeModuleFilterFieldClass()}
                    value={draft.customerExternalId}
                    onChange={(e) => set("customerExternalId", e.target.value)}
                    placeholder="Ex.: 200"
                    data-testid="portfolio-intelligence-customer"
                  />
                )}
              </div>
              <div className="min-w-[140px]">
                <FieldLabel>Status principal</FieldLabel>
                <select
                  className={financeModuleFilterFieldClass()}
                  value={draft.statusPrincipal}
                  onChange={(e) => set("statusPrincipal", e.target.value)}
                  data-testid="portfolio-intelligence-status"
                >
                  {PORTFOLIO_INTELLIGENCE_STATUS_OPTIONS.map((o) => (
                    <option key={o.value || "all"} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p
              className="text-[11px] text-muted-foreground"
              data-testid="portfolio-intelligence-axis-hint"
            >
              {axisMeta?.hint ??
                "Escolha o eixo antes de comparar períodos — emissão de pedido não é vencimento de CR."}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {PORTFOLIO_INTELLIGENCE_PERIOD_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={cn(
                    "rounded-md border px-2 py-1 text-[11px] font-medium",
                    draft.periodPreset === p.value
                      ? "border-sky-300 bg-sky-50 text-sky-950"
                      : "border-border bg-background text-muted-foreground hover:bg-muted/40"
                  )}
                  onClick={() =>
                    onDraftChange(
                      applyPeriodPresetToFilters(
                        draft,
                        p.value as PortfolioIntelligencePeriodPreset
                      )
                    )
                  }
                  data-testid={`portfolio-intelligence-period-${p.value}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <FieldLabel>Vendedor (nome)</FieldLabel>
            <input
              className={financeModuleFilterFieldClass()}
              value={draft.sellerName}
              onChange={(e) => set("sellerName", e.target.value)}
              placeholder="Nome parcial"
              data-testid="portfolio-intelligence-seller-name"
            />
          </div>
          <div>
            <FieldLabel>Vendedor (ID Nomus)</FieldLabel>
            <input
              className={financeModuleFilterFieldClass()}
              value={draft.sellerExternalId}
              onChange={(e) => set("sellerExternalId", e.target.value)}
              placeholder="ID numérico"
              data-testid="portfolio-intelligence-seller-id"
            />
          </div>
          <div>
            <FieldLabel>Empresa (ID)</FieldLabel>
            <input
              className={financeModuleFilterFieldClass()}
              value={draft.companyId}
              onChange={(e) => set("companyId", e.target.value)}
              placeholder="companyId"
              data-testid="portfolio-intelligence-company"
            />
          </div>
          <div>
            <FieldLabel>Confiança</FieldLabel>
            <select
              className={financeModuleFilterFieldClass()}
              value={draft.confidenceLabel}
              onChange={(e) => set("confidenceLabel", e.target.value)}
              data-testid="portfolio-intelligence-confidence"
            >
              {PORTFOLIO_INTELLIGENCE_CONFIDENCE_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>Número do pedido</FieldLabel>
            <input
              className={financeModuleFilterFieldClass()}
              value={draft.orderCode}
              onChange={(e) => set("orderCode", e.target.value)}
              placeholder="PD 02159"
              data-testid="portfolio-intelligence-order-code"
            />
          </div>
          <div>
            <FieldLabel>Produto (ID Nomus)</FieldLabel>
            <input
              className={financeModuleFilterFieldClass()}
              value={draft.productExternalId}
              onChange={(e) => set("productExternalId", e.target.value)}
              placeholder="ID numérico"
              data-testid="portfolio-intelligence-product"
            />
          </div>
          <div>
            <FieldLabel>Valor mínimo</FieldLabel>
            <input
              type="number"
              min={0}
              step="0.01"
              className={financeModuleFilterFieldClass()}
              value={draft.minValue}
              onChange={(e) => set("minValue", e.target.value)}
              data-testid="portfolio-intelligence-min-value"
            />
          </div>
          <div>
            <FieldLabel>Valor máximo</FieldLabel>
            <input
              type="number"
              min={0}
              step="0.01"
              className={financeModuleFilterFieldClass()}
              value={draft.maxValue}
              onChange={(e) => set("maxValue", e.target.value)}
              data-testid="portfolio-intelligence-max-value"
            />
          </div>
          <div>
            <FieldLabel>De (YYYY-MM-DD)</FieldLabel>
            <input
              type="date"
              className={financeModuleFilterFieldClass()}
              value={draft.from}
              onChange={(e) =>
                onDraftChange({
                  ...draft,
                  from: e.target.value,
                  periodPreset: "custom",
                })
              }
              data-testid="portfolio-intelligence-from"
            />
          </div>
          <div>
            <FieldLabel>Até (YYYY-MM-DD)</FieldLabel>
            <input
              type="date"
              className={financeModuleFilterFieldClass()}
              value={draft.to}
              onChange={(e) =>
                onDraftChange({
                  ...draft,
                  to: e.target.value,
                  periodPreset: "custom",
                })
              }
              data-testid="portfolio-intelligence-to"
            />
          </div>
        </div>

        <div>
          <FieldLabel>Tags de alerta</FieldLabel>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {PORTFOLIO_INTELLIGENCE_TAG_OPTIONS.map((tag) => {
              const on = selectedTags.has(tag.value);
              return (
                <button
                  key={tag.value}
                  type="button"
                  className={cn(
                    "rounded-md border px-2 py-1 text-[11px] font-medium",
                    on
                      ? "border-orange-300 bg-orange-50 text-orange-950"
                      : "border-border bg-background text-muted-foreground"
                  )}
                  onClick={() => {
                    const next = new Set(selectedTags);
                    if (on) next.delete(tag.value);
                    else next.add(tag.value);
                    set("tagsAlerta", [...next].join(","));
                  }}
                  data-testid={`portfolio-intelligence-tag-${tag.value}`}
                >
                  {tag.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <FieldLabel>Filtros analíticos rápidos</FieldLabel>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <QuickToggle
              label="Sem NF"
              checked={draft.onlyWithoutNfe}
              onChange={(v) => set("onlyWithoutNfe", v)}
              testId="portfolio-intelligence-quick-no-nfe"
            />
            <QuickToggle
              label="Sem documento de saída"
              checked={draft.onlyWithoutStockDocument}
              onChange={(v) => set("onlyWithoutStockDocument", v)}
              testId="portfolio-intelligence-quick-no-stock"
            />
            <QuickToggle
              label="Sem CR"
              checked={draft.onlyWithoutReceivable}
              onChange={(v) => set("onlyWithoutReceivable", v)}
              testId="portfolio-intelligence-quick-no-cr"
            />
            <QuickToggle
              label="Somente vencidos (status)"
              checked={draft.onlyOverdueStatus}
              onChange={(v) => set("onlyOverdueStatus", v)}
              testId="portfolio-intelligence-quick-overdue-status"
            />
            <QuickToggle
              label="Divergência técnica"
              checked={draft.onlyTechnicalDivergence}
              onChange={(v) => set("onlyTechnicalDivergence", v)}
              testId="portfolio-intelligence-quick-divergence"
            />
            <QuickToggle
              label="Confiança muito baixa"
              checked={draft.onlyVeryLowConfidence}
              onChange={(v) => set("onlyVeryLowConfidence", v)}
              testId="portfolio-intelligence-quick-low-confidence"
            />
            <QuickToggle
              label="Carteira futura"
              checked={draft.onlyFuturePortfolio}
              onChange={(v) => set("onlyFuturePortfolio", v)}
              testId="portfolio-intelligence-quick-future"
            />
            <QuickToggle
              label="Carteira bloqueada"
              checked={draft.onlyBlockedPortfolio}
              onChange={(v) => set("onlyBlockedPortfolio", v)}
              testId="portfolio-intelligence-quick-blocked"
            />
            <QuickToggle
              label="Acima do valor mínimo"
              checked={draft.onlyAboveMinValue}
              onChange={(v) => set("onlyAboveMinValue", v)}
              testId="portfolio-intelligence-quick-min-value"
            />
          </div>
        </div>
      </FinanceBiFilterPanel>
    </div>
  );
}
