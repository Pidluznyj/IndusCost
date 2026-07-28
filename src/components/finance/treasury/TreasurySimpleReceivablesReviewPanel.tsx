/**
 * Painel — revisão simples de recebimentos do dia.
 */

import React from "react";
import type {
  TreasuryFinancialAccountDto,
  TreasuryReceivableListItemDto,
} from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_SIMPLE_RECEIVABLE_REVIEW_CATEGORIES,
  TREASURY_SIMPLE_REVIEW_BUCKETS,
  type TreasurySimpleReceivableReviewCategory,
} from "@/src/lib/treasury/domain/treasurySimpleTitleReviewRules.js";
import { PermissionDenied } from "@/src/components/security/PermissionDenied";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import {
  TREASURY_SIMPLE_RECEIVABLE_CATEGORY_LABELS,
  TREASURY_SIMPLE_RECEIVABLES_REVIEW_TITLE,
  TREASURY_SIMPLE_REVIEW_BUCKET_LABELS,
  TREASURY_SIMPLE_REVIEW_DENIED,
  TREASURY_SIMPLE_REVIEW_EMPTY_DESCRIPTION,
  TREASURY_SIMPLE_REVIEW_EMPTY_TITLE,
  formatTreasurySimpleReviewDate,
  formatTreasurySimpleReviewMoney,
  officialStatusLabel,
  parcelLabel,
  receivableCategoryLabel,
  resolveTreasurySimpleReceivableAccountLabel,
  type TreasurySimpleReviewFilterState,
  type TreasurySimpleReviewViewKind,
} from "@/src/lib/treasury/treasurySimpleTitleReviewUi.js";

export type TreasurySimpleReceivablesReviewRow = {
  row: TreasuryReceivableListItemDto;
  category: TreasurySimpleReceivableReviewCategory;
};

export type TreasurySimpleReceivablesReviewPanelProps = {
  viewKind: TreasurySimpleReviewViewKind;
  rows: TreasurySimpleReceivablesReviewRow[];
  accounts: TreasuryFinancialAccountDto[];
  filters: TreasurySimpleReviewFilterState;
  error: string | null;
  page: number;
  totalPages: number;
  canManage: boolean;
  canPromise: boolean;
  canCollect: boolean;
  onFiltersChange: (next: TreasurySimpleReviewFilterState) => void;
  onRefresh: () => void;
  onPageChange: (page: number) => void;
  onOpenDetails: (row: TreasuryReceivableListItemDto) => void;
  onDismissError?: () => void;
};

function categoryTone(category: TreasurySimpleReceivableReviewCategory): string {
  if (category === "RECEIVED") return "border-emerald-200 bg-emerald-50/70";
  if (category === "PARTIALLY_RECEIVED" || category === "PLANNED_TODAY") {
    return "border-amber-200 bg-amber-50/70";
  }
  if (category === "OVERDUE" || category === "UNLINKED_ACCOUNT") {
    return "border-rose-200 bg-rose-50/70";
  }
  return "border-border bg-card";
}

export function TreasurySimpleReceivablesReviewPanel(
  props: TreasurySimpleReceivablesReviewPanelProps
) {
  const {
    viewKind,
    rows,
    accounts,
    filters,
    error,
    page,
    totalPages,
    canManage,
    canPromise,
    canCollect,
    onFiltersChange,
    onRefresh,
    onPageChange,
    onOpenDetails,
    onDismissError,
  } = props;

  if (viewKind === "denied") {
    return (
      <PermissionDenied
        message={TREASURY_SIMPLE_REVIEW_DENIED}
        testId="treasury-simple-receivables-denied"
      />
    );
  }

  if (viewKind === "loading") {
    return (
      <div data-testid="treasury-simple-receivables-loading">
        <FinanceModuleLoadingBlock label="Carregando recebimentos…" />
      </div>
    );
  }

  if (viewKind === "error") {
    return (
      <div data-testid="treasury-simple-receivables-error">
        <FinanceModuleErrorBanner
          message={error ?? "Não foi possível carregar os recebimentos."}
          onRetry={onRefresh}
          onDismiss={onDismissError}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="treasury-simple-receivables-ready">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">
          {TREASURY_SIMPLE_RECEIVABLES_REVIEW_TITLE}
        </h2>
        <p className="text-sm text-muted-foreground">
          Use ações locais para expectativa, promessa, cobrança ou contestação.
          O título oficial no Nomus não é alterado.
        </p>
      </div>

      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
        data-testid="treasury-simple-receivables-filters"
      >
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted-foreground">Data</span>
          <input
            type="date"
            className="w-full rounded-lg border border-border bg-background px-3 py-2"
            value={filters.date}
            onChange={(e) =>
              onFiltersChange({ ...filters, date: e.target.value })
            }
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted-foreground">Conta</span>
          <select
            className="w-full rounded-lg border border-border bg-background px-3 py-2"
            value={filters.accountId}
            onChange={(e) =>
              onFiltersChange({ ...filters, accountId: e.target.value })
            }
          >
            <option value="">Todas</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted-foreground">
            Situação
          </span>
          <select
            className="w-full rounded-lg border border-border bg-background px-3 py-2"
            value={filters.category}
            onChange={(e) =>
              onFiltersChange({ ...filters, category: e.target.value })
            }
          >
            <option value="ALL">Todas</option>
            {TREASURY_SIMPLE_RECEIVABLE_REVIEW_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {TREASURY_SIMPLE_RECEIVABLE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted-foreground">
            Visão
          </span>
          <select
            className="w-full rounded-lg border border-border bg-background px-3 py-2"
            value={filters.bucket}
            onChange={(e) =>
              onFiltersChange({
                ...filters,
                bucket: e.target.value as TreasurySimpleReviewFilterState["bucket"],
              })
            }
          >
            {TREASURY_SIMPLE_REVIEW_BUCKETS.map((b) => (
              <option key={b} value={b}>
                {TREASURY_SIMPLE_REVIEW_BUCKET_LABELS[b]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {viewKind === "empty" ? (
        <div data-testid="treasury-simple-receivables-empty">
          <FinanceModuleEmptyState
            title={TREASURY_SIMPLE_REVIEW_EMPTY_TITLE}
            description={TREASURY_SIMPLE_REVIEW_EMPTY_DESCRIPTION}
          />
        </div>
      ) : (
        <ul className="space-y-3" data-testid="treasury-simple-receivables-list">
          {rows.map(({ row, category }) => (
            <li
              key={row.titleId}
              className={`rounded-xl border p-4 shadow-sm ${categoryTone(category)}`}
              data-testid={`treasury-simple-receivable-${row.titleId}`}
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    {row.official.counterparty.name ?? "Cliente"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {parcelLabel({
                      installmentLabel: row.official.installmentLabel,
                      installmentNumber: row.official.installmentNumber,
                      documentNumber: row.official.documentNumber,
                      description: row.official.description,
                      externalId: row.externalId,
                    })}
                  </p>
                  <p
                    className="text-xs font-medium text-foreground"
                    data-testid={`treasury-simple-receivable-${row.titleId}-category`}
                  >
                    Situação: {receivableCategoryLabel(category)}
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
                  onClick={() => onOpenDetails(row)}
                  data-testid={`treasury-simple-receivable-${row.titleId}-details`}
                >
                  Abrir detalhes
                </button>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 xl:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">Vencimento oficial</dt>
                  <dd className="font-semibold">
                    {formatTreasurySimpleReviewDate(row.official.dueDate)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Valor previsto</dt>
                  <dd className="font-semibold tabular-nums">
                    {formatTreasurySimpleReviewMoney(
                      row.complement?.expectedAmount ??
                        row.openAmount ??
                        row.official.openBalance
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Valor recebido</dt>
                  <dd className="font-semibold tabular-nums">
                    {formatTreasurySimpleReviewMoney(
                      row.receivedAmount ??
                        row.official.settlements.settledAmount
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Conta de recebimento</dt>
                  <dd className="font-semibold">
                    {resolveTreasurySimpleReceivableAccountLabel(row, accounts)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Status oficial</dt>
                  <dd className="font-semibold">
                    {officialStatusLabel(row.official.officialStatus)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Data da baixa</dt>
                  <dd className="font-semibold">
                    {formatTreasurySimpleReviewDate(
                      row.official.settlements.settledAt
                    )}
                  </dd>
                </div>
                <div className="col-span-2 sm:col-span-3 xl:col-span-2">
                  <dt className="text-muted-foreground">Expectativa local</dt>
                  <dd className="font-semibold">
                    {row.complement?.expectedDate
                      ? formatTreasurySimpleReviewDate(row.complement.expectedDate)
                      : "—"}
                  </dd>
                </div>
              </dl>

              <p className="mt-3 text-[11px] text-muted-foreground">
                Ações locais
                {canManage ? ": nova expectativa" : ""}
                {canPromise ? ", promessa" : ""}
                {canCollect ? ", cobrança e contestação" : ""}
                {" — pelo botão Abrir detalhes."}
              </p>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Anterior
          </button>
          <p className="text-xs text-muted-foreground">
            Página {page} de {totalPages}
          </p>
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Próxima
          </button>
        </div>
      ) : null}
    </div>
  );
}
