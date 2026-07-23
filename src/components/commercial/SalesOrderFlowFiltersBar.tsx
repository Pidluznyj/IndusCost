import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import {
  CustomerAutocompleteFilter,
  fetchCustomerByIdForAutocomplete,
} from "@/src/components/common/CustomerAutocompleteFilter";
import type { EntityAutocompleteSelection } from "@/src/lib/customerSearch";
import type { SalesOrderSellerFilterOption } from "@/src/lib/salesOrderNomusSellerDisplay";
import {
  buildSalesOrderYearOptions,
  isSalesOrderFlowDateRangeInvalid,
  patchSalesOrderFlowYearMonth,
  SALES_ORDER_FLOW_COMPANY_OPTIONS,
  SALES_ORDER_FLOW_PRIORITY_OPTIONS,
  SALES_ORDER_FLOW_STAGE_FILTER_OPTIONS,
  SALES_ORDER_MONTH_OPTIONS,
  type SalesOrderFlowUiFilters,
  type SalesOrderFlowUiPriority,
} from "@/src/lib/salesOrderFlowUi";
import { cn } from "@/src/lib/utils";
import type { SalesOrderFlowStage } from "@/src/lib/sales/salesOrderFlowCatalog";

/** Controles no padrão executivo Comercial (Pedidos de venda). */
const FILTER_CONTROL_CLASS =
  "h-9 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-muted/40 disabled:text-muted-foreground";

const LABEL_CLASS =
  "text-[10px] font-bold uppercase tracking-wider text-muted-foreground";

const ACTION_BUTTON_CLASS =
  "inline-flex h-8 items-center gap-1.5 rounded-md border border-transparent px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50";

export function SalesOrderFlowFiltersBar({
  draftFilters,
  sellerOptions,
  sellerOptionsLoading,
  hasPendingFilterChanges,
  draftDateRangesInvalid,
  filtersActive,
  draftFiltersActive,
  loading,
  onPatchDraft,
  onApply,
  onClear,
}: {
  draftFilters: SalesOrderFlowUiFilters;
  sellerOptions: SalesOrderSellerFilterOption[];
  sellerOptionsLoading: boolean;
  hasPendingFilterChanges: boolean;
  draftDateRangesInvalid: boolean;
  filtersActive: boolean;
  draftFiltersActive: boolean;
  loading: boolean;
  onPatchDraft: (patch: Partial<SalesOrderFlowUiFilters>) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  const [customerSelection, setCustomerSelection] =
    useState<EntityAutocompleteSelection | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(() =>
    Boolean(
      draftFilters.product.trim() ||
        draftFilters.sector.trim() ||
        draftFilters.promisedFrom ||
        draftFilters.promisedTo ||
        (!draftFilters.year &&
          (draftFilters.issueFrom || draftFilters.issueTo))
    )
  );

  const yearOptions = useMemo(
    () => buildSalesOrderYearOptions(new Date().getFullYear(), 5),
    []
  );

  const stageSelectValue =
    draftFilters.stages.length === 1 ? draftFilters.stages[0]! : "";

  // Hidrata label do cliente quando já existe customerId (URL / estado).
  useEffect(() => {
    const id = draftFilters.customerId.trim();
    if (!id) {
      setCustomerSelection(null);
      return;
    }
    if (customerSelection?.id === id) return;
    const controller = new AbortController();
    void fetchCustomerByIdForAutocomplete(id, controller.signal)
      .then((selection) => {
        if (!controller.signal.aborted) setCustomerSelection(selection);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setCustomerSelection({
            id,
            name: "Cliente",
            source: "induscost",
          });
        }
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só reage a customerId
  }, [draftFilters.customerId]);

  const patchYearMonth = (patch: { year?: string; month?: string }) => {
    const next = patchSalesOrderFlowYearMonth(draftFilters, patch);
    onPatchDraft({
      year: next.year,
      month: next.month,
      issueFrom: next.issueFrom,
      issueTo: next.issueTo,
    });
  };

  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card/60 p-3 shadow-sm"
      data-testid="sales-order-flow-filters"
      aria-label="Filtros do Fluxo de Pedidos"
    >
      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-6 sm:col-span-3 lg:col-span-2">
          <FilterField label="Ano" htmlFor="sales-order-flow-filter-year">
            <select
              id="sales-order-flow-filter-year"
              className={FILTER_CONTROL_CLASS}
              data-testid="sales-order-flow-filter-year"
              aria-label="Filtrar por ano de emissão"
              value={draftFilters.year || "all"}
              onChange={(event) => {
                const value = event.target.value;
                patchYearMonth({
                  year: value === "all" ? "" : value,
                });
              }}
            >
              <option value="all">Todos os anos</option>
              {yearOptions.map((year) => (
                <option key={year} value={String(year)}>
                  {year}
                </option>
              ))}
              {draftFilters.year &&
              !yearOptions.includes(Number(draftFilters.year)) ? (
                <option value={draftFilters.year}>{draftFilters.year}</option>
              ) : null}
            </select>
          </FilterField>
        </div>

        <div className="col-span-6 sm:col-span-3 lg:col-span-2">
          <FilterField label="Mês" htmlFor="sales-order-flow-filter-month">
            <select
              id="sales-order-flow-filter-month"
              className={FILTER_CONTROL_CLASS}
              data-testid="sales-order-flow-filter-month"
              aria-label="Filtrar por mês de emissão"
              value={draftFilters.month}
              disabled={!draftFilters.year}
              onChange={(event) =>
                patchYearMonth({ month: event.target.value })
              }
            >
              <option value="">Todos</option>
              {SALES_ORDER_MONTH_OPTIONS.map((month) => (
                <option key={month.value} value={String(month.value)}>
                  {month.label}
                </option>
              ))}
            </select>
          </FilterField>
        </div>

        <div className="col-span-12 sm:col-span-6 lg:col-span-4">
          <FilterField label="Busca geral" htmlFor="sales-order-flow-filter-q">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="sales-order-flow-filter-q"
                className={cn(FILTER_CONTROL_CLASS, "pl-8")}
                data-testid="sales-order-flow-filter-q"
                placeholder="Pedido, cliente…"
                value={draftFilters.q}
                onChange={(event) => onPatchDraft({ q: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onApply();
                  }
                }}
              />
            </div>
          </FilterField>
        </div>

        <div
          className="col-span-12 sm:col-span-6 lg:col-span-4 min-w-0"
          data-testid="sales-order-flow-filter-customer"
        >
          <CustomerAutocompleteFilter
            label="Cliente"
            value={customerSelection}
            customerId={draftFilters.customerId || undefined}
            placeholder="Todos os clientes"
            onChange={(selection) => {
              setCustomerSelection(selection);
              onPatchDraft({
                customerId: selection?.id?.trim() ?? "",
              });
            }}
            onClear={() => {
              setCustomerSelection(null);
              onPatchDraft({ customerId: "" });
            }}
          />
        </div>

        <div className="col-span-12 sm:col-span-6 lg:col-span-3">
          <FilterField label="Vendedor" htmlFor="sales-order-flow-filter-seller">
            <select
              id="sales-order-flow-filter-seller"
              className={FILTER_CONTROL_CLASS}
              data-testid="sales-order-flow-filter-seller"
              value={draftFilters.sellerKey}
              disabled={sellerOptionsLoading}
              onChange={(event) =>
                onPatchDraft({ sellerKey: event.target.value })
              }
            >
              <option value="">Todos</option>
              {sellerOptions.map((option) => (
                <option key={option.sellerKey} value={option.sellerKey}>
                  {option.label}
                </option>
              ))}
            </select>
          </FilterField>
        </div>

        <div className="col-span-6 sm:col-span-3 lg:col-span-3">
          <FilterField label="Empresa" htmlFor="sales-order-flow-filter-company">
            <select
              id="sales-order-flow-filter-company"
              className={FILTER_CONTROL_CLASS}
              data-testid="sales-order-flow-filter-company"
              value={draftFilters.company}
              onChange={(event) => onPatchDraft({ company: event.target.value })}
            >
              <option value="">Todas</option>
              {SALES_ORDER_FLOW_COMPANY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              {draftFilters.company &&
              !SALES_ORDER_FLOW_COMPANY_OPTIONS.some(
                (option) => option.value === draftFilters.company
              ) ? (
                <option value={draftFilters.company}>
                  {draftFilters.company}
                </option>
              ) : null}
            </select>
          </FilterField>
        </div>

        <div className="col-span-6 sm:col-span-3 lg:col-span-3">
          <FilterField label="Etapa" htmlFor="sales-order-flow-filter-stage">
            <select
              id="sales-order-flow-filter-stage"
              className={FILTER_CONTROL_CLASS}
              data-testid="sales-order-flow-filter-stage"
              value={stageSelectValue}
              onChange={(event) => {
                const value = event.target.value;
                onPatchDraft({
                  stages: value ? [value as SalesOrderFlowStage] : [],
                });
              }}
            >
              <option value="">Todas</option>
              {SALES_ORDER_FLOW_STAGE_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FilterField>
        </div>

        <div className="col-span-12 sm:col-span-6 lg:col-span-3">
          <FilterField
            label="Prioridade"
            htmlFor="sales-order-flow-filter-priority"
          >
            <select
              id="sales-order-flow-filter-priority"
              className={FILTER_CONTROL_CLASS}
              data-testid="sales-order-flow-filter-priority"
              value={draftFilters.priority ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                onPatchDraft({
                  priority: value ? (value as SalesOrderFlowUiPriority) : null,
                });
              }}
            >
              <option value="">Todas</option>
              {SALES_ORDER_FLOW_PRIORITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FilterField>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={ACTION_BUTTON_CLASS}
          data-testid="sales-order-flow-advanced-filters-toggle"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          {advancedOpen ? (
            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Filtros avançados
        </button>
      </div>

      {advancedOpen ? (
        <div
          className="grid grid-cols-12 gap-2 border-t border-border pt-3"
          data-testid="sales-order-flow-advanced-filters"
        >
          <div className="col-span-12 sm:col-span-6 lg:col-span-3">
            <FilterField
              label="Produto"
              htmlFor="sales-order-flow-filter-product"
            >
              <input
                id="sales-order-flow-filter-product"
                className={FILTER_CONTROL_CLASS}
                data-testid="sales-order-flow-filter-product"
                placeholder="Código ou descrição"
                value={draftFilters.product}
                onChange={(event) =>
                  onPatchDraft({ product: event.target.value })
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onApply();
                  }
                }}
              />
            </FilterField>
          </div>

          <div className="col-span-12 sm:col-span-6 lg:col-span-3">
            <FilterField label="Setor" htmlFor="sales-order-flow-filter-sector">
              <input
                id="sales-order-flow-filter-sector"
                className={FILTER_CONTROL_CLASS}
                data-testid="sales-order-flow-filter-sector"
                placeholder="Setor"
                value={draftFilters.sector}
                onChange={(event) => onPatchDraft({ sector: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onApply();
                  }
                }}
              />
            </FilterField>
          </div>

          <div className="col-span-6 lg:col-span-3">
            <FilterField
              label="Emissão de"
              htmlFor="sales-order-flow-filter-issue-from"
            >
              <input
                id="sales-order-flow-filter-issue-from"
                type="date"
                className={FILTER_CONTROL_CLASS}
                data-testid="sales-order-flow-filter-issue-from"
                aria-invalid={isSalesOrderFlowDateRangeInvalid(
                  draftFilters.issueFrom,
                  draftFilters.issueTo
                )}
                value={draftFilters.issueFrom}
                onChange={(event) =>
                  onPatchDraft({
                    year: "",
                    month: "",
                    issueFrom: event.target.value,
                  })
                }
              />
            </FilterField>
          </div>

          <div className="col-span-6 lg:col-span-3">
            <FilterField
              label="Emissão até"
              htmlFor="sales-order-flow-filter-issue-to"
            >
              <input
                id="sales-order-flow-filter-issue-to"
                type="date"
                className={FILTER_CONTROL_CLASS}
                data-testid="sales-order-flow-filter-issue-to"
                aria-invalid={isSalesOrderFlowDateRangeInvalid(
                  draftFilters.issueFrom,
                  draftFilters.issueTo
                )}
                value={draftFilters.issueTo}
                onChange={(event) =>
                  onPatchDraft({
                    year: "",
                    month: "",
                    issueTo: event.target.value,
                  })
                }
              />
            </FilterField>
          </div>

          <div className="col-span-6 lg:col-span-3">
            <FilterField
              label="Entrega prometida de"
              htmlFor="sales-order-flow-filter-promised-from"
            >
              <input
                id="sales-order-flow-filter-promised-from"
                type="date"
                className={FILTER_CONTROL_CLASS}
                data-testid="sales-order-flow-filter-promised-from"
                aria-invalid={isSalesOrderFlowDateRangeInvalid(
                  draftFilters.promisedFrom,
                  draftFilters.promisedTo
                )}
                value={draftFilters.promisedFrom}
                onChange={(event) =>
                  onPatchDraft({ promisedFrom: event.target.value })
                }
              />
            </FilterField>
          </div>

          <div className="col-span-6 lg:col-span-3">
            <FilterField
              label="Entrega prometida até"
              htmlFor="sales-order-flow-filter-promised-to"
            >
              <input
                id="sales-order-flow-filter-promised-to"
                type="date"
                className={FILTER_CONTROL_CLASS}
                data-testid="sales-order-flow-filter-promised-to"
                aria-invalid={isSalesOrderFlowDateRangeInvalid(
                  draftFilters.promisedFrom,
                  draftFilters.promisedTo
                )}
                value={draftFilters.promisedTo}
                onChange={(event) =>
                  onPatchDraft({ promisedTo: event.target.value })
                }
              />
            </FilterField>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/70 pt-3">
        <BooleanFilter
          testId="sales-order-flow-filter-overdue"
          label="Atrasados"
          checked={draftFilters.overdue === true}
          onChange={(checked) =>
            onPatchDraft({ overdue: checked ? true : null })
          }
        />
        <BooleanFilter
          testId="sales-order-flow-filter-blocked"
          label="Bloqueados"
          checked={draftFilters.blocked === true}
          onChange={(checked) =>
            onPatchDraft({ blocked: checked ? true : null })
          }
        />
        <BooleanFilter
          testId="sales-order-flow-filter-inconsistent"
          label="Inconsistentes"
          checked={draftFilters.inconsistent === true}
          onChange={(checked) =>
            onPatchDraft({ inconsistent: checked ? true : null })
          }
        />
        <BooleanFilter
          testId="sales-order-flow-filter-partially-shipped"
          label="Parcialmente enviados"
          checked={draftFilters.partiallyShipped === true}
          onChange={(checked) =>
            onPatchDraft({ partiallyShipped: checked ? true : null })
          }
        />
        <BooleanFilter
          testId="sales-order-flow-filter-with-cut"
          label="Com corte"
          checked={draftFilters.withCut === true}
          onChange={(checked) =>
            onPatchDraft({ withCut: checked ? true : null })
          }
        />
        <BooleanFilter
          testId="sales-order-flow-filter-with-active-residual"
          label="Com saldo ativo"
          checked={draftFilters.withActiveResidual === true}
          onChange={(checked) =>
            onPatchDraft({ withActiveResidual: checked ? true : null })
          }
        />
        <BooleanFilter
          testId="sales-order-flow-filter-unrecognized-ds"
          label="DS não reconhecido"
          checked={draftFilters.unrecognizedDs === true}
          onChange={(checked) =>
            onPatchDraft({ unrecognizedDs: checked ? true : null })
          }
        />
        <BooleanFilter
          testId="sales-order-flow-filter-nfe-unlinked"
          label="NF sem vínculo"
          checked={draftFilters.nfeUnlinked === true}
          onChange={(checked) =>
            onPatchDraft({ nfeUnlinked: checked ? true : null })
          }
        />
        <BooleanFilter
          testId="sales-order-flow-filter-op-unlinked"
          label="OP sem vínculo"
          checked={draftFilters.opUnlinked === true}
          onChange={(checked) =>
            onPatchDraft({ opUnlinked: checked ? true : null })
          }
        />
        <BooleanFilter
          testId="sales-order-flow-filter-partial-coverage"
          label="Cobertura parcial"
          checked={draftFilters.partialCoverage === true}
          onChange={(checked) =>
            onPatchDraft({ partialCoverage: checked ? true : null })
          }
        />
        <BooleanFilter
          testId="sales-order-flow-filter-ambiguous-link"
          label="Vínculo ambíguo"
          checked={draftFilters.ambiguousLink === true}
          onChange={(checked) =>
            onPatchDraft({ ambiguousLink: checked ? true : null })
          }
        />
        <BooleanFilter
          testId="sales-order-flow-filter-snapshot-divergent"
          label="Snapshot divergente"
          checked={draftFilters.snapshotDivergent === true}
          onChange={(checked) =>
            onPatchDraft({ snapshotDivergent: checked ? true : null })
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/30 bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          data-testid="sales-order-flow-apply-filters"
          disabled={
            draftDateRangesInvalid || !hasPendingFilterChanges || loading
          }
          onClick={onApply}
        >
          <Search className="h-3.5 w-3.5" aria-hidden="true" />
          Pesquisar
        </button>
        <button
          type="button"
          className={ACTION_BUTTON_CLASS}
          data-testid="sales-order-flow-clear-filters"
          disabled={!filtersActive && !draftFiltersActive}
          onClick={onClear}
        >
          Limpar filtros
        </button>
        {hasPendingFilterChanges ? (
          <span
            className="text-xs text-amber-700"
            data-testid="sales-order-flow-filters-pending"
          >
            Há alterações pendentes — clique em Pesquisar para aplicar.
          </span>
        ) : null}
      </div>

      {draftDateRangesInvalid ? (
        <p
          className="text-sm text-amber-700"
          role="alert"
          data-testid="sales-order-flow-date-range-invalid"
        >
          Intervalo de datas inválido: a data inicial não pode ser maior que a
          final.
        </p>
      ) : null}
    </section>
  );
}

function FilterField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className={cn("flex min-w-0 flex-col gap-1", LABEL_CLASS)}>
      {label}
      {children}
    </label>
  );
}

function BooleanFilter({
  testId,
  label,
  checked,
  onChange,
}: {
  testId: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-foreground">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-border"
        data-testid={testId}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}
