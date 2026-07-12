import React from "react";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards";
import {
  ORDER_TO_CASH_AUDIT_SELECT_FILTER_MESSAGE,
  resolveExternalCustomerIdFromSelection,
  yearOptionsForOrderToCashAudit,
  type OrderToCashAuditUiFilters,
} from "@/src/lib/finance/orderToCashAuditClient";
import type { OrderToCashAuditAvailableFilters } from "@/src/lib/finance/orderToCashAuditApi";
import {
  CustomerAutocompleteFilter,
  type EntityAutocompleteSelection,
} from "@/src/components/common/CustomerAutocompleteFilter";
import { cn } from "@/src/lib/utils";

type Props = {
  draft: OrderToCashAuditUiFilters;
  onDraftChange: (next: OrderToCashAuditUiFilters) => void;
  customerSelection: EntityAutocompleteSelection | null;
  onCustomerChange: (sel: EntityAutocompleteSelection | null) => void;
  onSearch: () => void;
  onClear: () => void;
  canSearch: boolean;
  searched: boolean;
  advancedOpen: boolean;
  onToggleAdvanced: () => void;
  availableFilters: OrderToCashAuditAvailableFilters | null;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className={financeModuleFilterLabelClass()}>{label}</span>
      {children}
    </label>
  );
}

export function OrderToCashAuditFilters({
  draft,
  onDraftChange,
  customerSelection,
  onCustomerChange,
  onSearch,
  onClear,
  canSearch,
  searched,
  advancedOpen,
  onToggleAdvanced,
  availableFilters,
}: Props) {
  const patch = (partial: Partial<OrderToCashAuditUiFilters>) =>
    onDraftChange({ ...draft, ...partial });

  const sellers = availableFilters?.sellers ?? [];
  const stages = availableFilters?.stages ?? [];
  const paymentStatuses = availableFilters?.paymentStatuses ?? [];

  return (
    <div className="mb-4 space-y-3" data-testid="order-to-cash-audit-filters">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="sm:col-span-2 lg:col-span-2" data-testid="order-to-cash-audit-customer">
            <CustomerAutocompleteFilter
              label="Cliente"
              value={customerSelection}
              placeholder="Buscar por nome…"
              allowFreeText
              onChange={(sel) => {
                onCustomerChange(sel);
                const external = resolveExternalCustomerIdFromSelection(sel);
                patch({
                  customerId: sel?.id ?? "",
                  customerExternalId: external || draft.customerExternalId,
                  customerName: sel?.name?.trim() ?? "",
                });
              }}
              onClear={() => {
                onCustomerChange(null);
                patch({ customerId: "", customerName: "" });
              }}
            />
          </div>

          <Field label="Código Nomus">
            <input
              className={financeModuleFilterFieldClass()}
              value={draft.customerExternalId}
              onChange={(e) => {
                const raw = e.target.value.trim();
                patch({
                  customerExternalId: raw.replace(/[^\d]/g, ""),
                });
              }}
              placeholder="Ex.: 200"
              inputMode="numeric"
              data-testid="order-to-cash-audit-external-id"
            />
          </Field>

          <Field label="Ano *">
            <select
              className={financeModuleFilterFieldClass()}
              value={draft.year}
              onChange={(e) => patch({ year: e.target.value })}
              data-testid="order-to-cash-audit-year"
            >
              <option value="">Selecione</option>
              {yearOptionsForOrderToCashAudit().map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </Field>

          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-2">
            <button
              type="button"
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
                canSearch
                  ? "bg-[#101828] text-white hover:bg-[#1d2939]"
                  : "cursor-not-allowed bg-muted text-muted-foreground"
              )}
              disabled={!canSearch}
              onClick={onSearch}
              data-testid="order-to-cash-audit-search"
            >
              Pesquisar
            </button>
            <button
              type="button"
              className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted/50"
              onClick={onClear}
              data-testid="order-to-cash-audit-clear"
            >
              Limpar
            </button>
          </div>
        </div>

        {!canSearch ? (
          <p
            className="mt-3 text-sm text-[#B54708]"
            data-testid="order-to-cash-audit-required-hint"
          >
            {ORDER_TO_CASH_AUDIT_SELECT_FILTER_MESSAGE}
          </p>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            Sem cliente: usa a run geral. Com código Nomus (ex. 200 Britânia): filtra facts /
            run específica quando existir.
          </p>
        )}
      </div>

      {searched ? (
        <div className="rounded-xl border border-border bg-card">
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-[#101828]"
            onClick={onToggleAdvanced}
            data-testid="order-to-cash-audit-advanced-toggle"
            aria-expanded={advancedOpen}
          >
            <span>Filtros avançados</span>
            <span className="text-xs font-medium text-muted-foreground">
              {advancedOpen ? "Recolher" : "Expandir"}
            </span>
          </button>

          {advancedOpen ? (
            <div
              className="grid grid-cols-1 gap-3 border-t border-border px-4 py-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              data-testid="order-to-cash-audit-advanced-filters"
            >
              <Field label="Pedido">
                <input
                  className={financeModuleFilterFieldClass()}
                  value={draft.orderCode}
                  onChange={(e) => patch({ orderCode: e.target.value })}
                  placeholder="Ex.: PD 02339"
                  data-testid="order-to-cash-audit-filter-order"
                />
              </Field>
              <Field label="Vendedor">
                <input
                  className={financeModuleFilterFieldClass()}
                  value={draft.sellerName}
                  onChange={(e) => patch({ sellerName: e.target.value })}
                  list="order-to-cash-audit-sellers"
                  data-testid="order-to-cash-audit-filter-seller"
                />
                <datalist id="order-to-cash-audit-sellers">
                  {sellers.map((s) => (
                    <option key={s.sellerName} value={s.sellerName} />
                  ))}
                </datalist>
              </Field>
              <Field label="Produto">
                <input
                  className={financeModuleFilterFieldClass()}
                  value={draft.productCode}
                  onChange={(e) => patch({ productCode: e.target.value })}
                  placeholder="Código"
                  data-testid="order-to-cash-audit-filter-product"
                />
              </Field>
              <Field label="SKU">
                <input
                  className={financeModuleFilterFieldClass()}
                  value={draft.sku}
                  onChange={(e) => patch({ sku: e.target.value })}
                  data-testid="order-to-cash-audit-filter-sku"
                />
              </Field>
              <Field label="NF">
                <input
                  className={financeModuleFilterFieldClass()}
                  value={draft.nfeNumber}
                  onChange={(e) => patch({ nfeNumber: e.target.value })}
                  data-testid="order-to-cash-audit-filter-nfe"
                />
              </Field>
              <Field label="Documento de saída">
                <input
                  className={financeModuleFilterFieldClass()}
                  value={draft.stockDocumentExternalId}
                  onChange={(e) => patch({ stockDocumentExternalId: e.target.value })}
                  placeholder="ID externo"
                  data-testid="order-to-cash-audit-filter-doc"
                />
              </Field>
              <Field label="Status Pedido → Caixa">
                <select
                  className={financeModuleFilterFieldClass()}
                  value={draft.orderToCashStage}
                  onChange={(e) => patch({ orderToCashStage: e.target.value })}
                  data-testid="order-to-cash-audit-filter-o2c-stage"
                >
                  <option value="">Todos</option>
                  {stages.map((s) => (
                    <option key={s.stage} value={s.stage}>
                      {s.stage} ({s.count})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Status operacional">
                <input
                  className={financeModuleFilterFieldClass()}
                  value={draft.operationalStage}
                  onChange={(e) => patch({ operationalStage: e.target.value })}
                  data-testid="order-to-cash-audit-filter-operational"
                />
              </Field>
              <Field label="Status financeiro">
                <input
                  className={financeModuleFilterFieldClass()}
                  value={draft.financialStage}
                  onChange={(e) => patch({ financialStage: e.target.value })}
                  data-testid="order-to-cash-audit-filter-financial"
                />
              </Field>
              <Field label="Status pagamento">
                <select
                  className={financeModuleFilterFieldClass()}
                  value={draft.paymentStatus}
                  onChange={(e) => patch({ paymentStatus: e.target.value })}
                  data-testid="order-to-cash-audit-filter-payment"
                >
                  <option value="">Todos</option>
                  {paymentStatuses.map((p) => (
                    <option key={p.paymentStatus} value={p.paymentStatus}>
                      {p.paymentStatus} ({p.count})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Temperatura">
                <input
                  className={financeModuleFilterFieldClass()}
                  value={draft.temperature}
                  onChange={(e) => patch({ temperature: e.target.value })}
                  data-testid="order-to-cash-audit-filter-temperature"
                />
              </Field>
              <Field label="Confiança">
                <input
                  className={financeModuleFilterFieldClass()}
                  value={draft.confidenceLabel}
                  onChange={(e) => patch({ confidenceLabel: e.target.value })}
                  data-testid="order-to-cash-audit-filter-confidence"
                />
              </Field>

              {(
                [
                  ["hasAlerts", "Somente com alertas"],
                  ["onlyWithExcess", "Somente com excesso"],
                  ["onlyWithProductOutsideOrder", "Somente com produto fora do pedido"],
                  ["onlyWithoutDocument", "Somente sem documento"],
                  ["onlyWithoutReceivable", "Somente sem CR"],
                  ["onlyOverdue", "Somente vencidos"],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center gap-2 self-end pb-2 text-sm text-foreground"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border"
                    checked={Boolean(draft[key])}
                    onChange={(e) => patch({ [key]: e.target.checked })}
                    data-testid={`order-to-cash-audit-filter-${key}`}
                  />
                  <span>{label}</span>
                </label>
              ))}

              <div className="sm:col-span-2 lg:col-span-3 xl:col-span-4">
                <button
                  type="button"
                  className="rounded-lg bg-[#101828] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1d2939]"
                  onClick={onSearch}
                  data-testid="order-to-cash-audit-apply-advanced"
                >
                  Aplicar filtros
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
