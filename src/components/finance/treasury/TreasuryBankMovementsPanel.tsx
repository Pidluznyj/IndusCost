/**
 * Painel — filtros, lotes, movimentos e detalhe.
 */

import React from "react";
import type {
  TreasuryBankImportBatchDto,
  TreasuryBankMovementDto,
  TreasuryFinancialAccountDto,
  TreasuryReconciliationMatchDto,
} from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_BANK_MOVEMENT_BUCKET_LABELS,
  TREASURY_BANK_MOVEMENT_STATUS_LABELS,
  formatTreasuryBankMoney,
  type TreasuryBankMovementsFilterState,
} from "@/src/lib/treasury/treasuryBankMovementsUi.js";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";

function accountLabel(
  accounts: TreasuryFinancialAccountDto[],
  id: string,
  code?: string | null,
  name?: string | null
): string {
  if (code || name) return `${code ?? "—"} — ${name ?? id.slice(0, 8)}`;
  const acc = accounts.find((a) => a.id === id);
  return acc ? `${acc.code} — ${acc.name}` : id.slice(0, 8);
}

export function TreasuryBankMovementsPanel(props: {
  filters: TreasuryBankMovementsFilterState;
  accounts: TreasuryFinancialAccountDto[];
  batches: TreasuryBankImportBatchDto[];
  movements: TreasuryBankMovementDto[];
  selected: TreasuryBankMovementDto | null;
  activeMatches?: TreasuryReconciliationMatchDto[];
  canManage: boolean;
  canReverse?: boolean;
  duplicatesMessage: string | null;
  onFiltersChange: (next: TreasuryBankMovementsFilterState) => void;
  onImport: () => void;
  onSelectMovement: (row: TreasuryBankMovementDto) => void;
  onClearSelection: () => void;
  onSelectBatch: (batchId: string) => void;
  onReverseMatch?: (match: TreasuryReconciliationMatchDto) => void;
}) {
  const {
    filters,
    accounts,
    batches,
    movements,
    selected,
    activeMatches = [],
    canManage,
    canReverse = false,
    duplicatesMessage,
    onFiltersChange,
    onImport,
    onSelectMovement,
    onClearSelection,
    onSelectBatch,
    onReverseMatch,
  } = props;

  return (
    <div className="space-y-6" data-testid="treasury-bank-movements-panel">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className={financeModuleFilterLabelClass()}>Situação</span>
          <select
            className={financeModuleFilterFieldClass()}
            value={filters.bucket}
            onChange={(e) =>
              onFiltersChange({ ...filters, bucket: e.target.value })
            }
            data-testid="treasury-bank-movements-bucket"
          >
            <option value="">Todos</option>
            {Object.entries(TREASURY_BANK_MOVEMENT_BUCKET_LABELS).map(
              ([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              )
            )}
          </select>
        </label>
        <label className="space-y-1">
          <span className={financeModuleFilterLabelClass()}>Conta</span>
          <select
            className={financeModuleFilterFieldClass()}
            value={filters.accountId}
            onChange={(e) =>
              onFiltersChange({ ...filters, accountId: e.target.value })
            }
          >
            <option value="">Todas</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className={financeModuleFilterLabelClass()}>Empresa</span>
          <input
            className={financeModuleFilterFieldClass()}
            value={filters.companyCode}
            onChange={(e) =>
              onFiltersChange({ ...filters, companyCode: e.target.value })
            }
            placeholder="companyCode"
          />
        </label>
        <label className="space-y-1">
          <span className={financeModuleFilterLabelClass()}>Busca</span>
          <input
            className={financeModuleFilterFieldClass()}
            value={filters.search}
            onChange={(e) =>
              onFiltersChange({ ...filters, search: e.target.value })
            }
            placeholder="descrição, contraparte…"
          />
        </label>
        <label className="space-y-1">
          <span className={financeModuleFilterLabelClass()}>De</span>
          <input
            type="date"
            className={financeModuleFilterFieldClass()}
            value={filters.from}
            onChange={(e) =>
              onFiltersChange({ ...filters, from: e.target.value })
            }
          />
        </label>
        <label className="space-y-1">
          <span className={financeModuleFilterLabelClass()}>Até</span>
          <input
            type="date"
            className={financeModuleFilterFieldClass()}
            value={filters.to}
            onChange={(e) =>
              onFiltersChange({ ...filters, to: e.target.value })
            }
          />
        </label>
        {canManage ? (
          <button
            type="button"
            className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
            onClick={onImport}
            data-testid="treasury-bank-movements-import-btn"
          >
            Importar OFX
          </button>
        ) : null}
      </div>

      <section className="space-y-2" data-testid="treasury-bank-batches">
        <h3 className="text-sm font-semibold text-foreground">
          Histórico de lotes
        </h3>
        {batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum lote importado ainda.
          </p>
        ) : (
          <div className="overflow-auto rounded-lg border border-border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-2 py-1">Arquivo</th>
                  <th className="px-2 py-1">Conta</th>
                  <th className="px-2 py-1">Status</th>
                  <th className="px-2 py-1">Movimentos</th>
                  <th className="px-2 py-1">Processado</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr
                    key={b.id}
                    className="cursor-pointer border-t border-border hover:bg-accent/40"
                    data-testid={`treasury-bank-batch-${b.id}`}
                    onClick={() => onSelectBatch(b.id)}
                  >
                    <td className="px-2 py-1">{b.originalFileName}</td>
                    <td className="px-2 py-1">
                      {accountLabel(
                        accounts,
                        b.accountId,
                        b.accountCode,
                        b.accountName
                      )}
                    </td>
                    <td className="px-2 py-1">{b.status}</td>
                    <td className="px-2 py-1">{b.transactionCount}</td>
                    <td className="px-2 py-1">
                      {b.processedAt?.slice(0, 10) ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2" data-testid="treasury-bank-movements-list">
        <h3 className="text-sm font-semibold text-foreground">Movimentos</h3>
        {duplicatesMessage ? (
          <p
            className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
            data-testid="treasury-bank-duplicates-info"
          >
            {duplicatesMessage}
          </p>
        ) : null}
        {!duplicatesMessage && movements.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum movimento para os filtros atuais.
          </p>
        ) : null}
        {movements.length > 0 ? (
          <div className="overflow-auto rounded-lg border border-border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-2 py-1">Data</th>
                  <th className="px-2 py-1">Conta</th>
                  <th className="px-2 py-1">Contraparte</th>
                  <th className="px-2 py-1">Descrição</th>
                  <th className="px-2 py-1">Valor</th>
                  <th className="px-2 py-1">Conciliação</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr
                    key={m.id}
                    className="cursor-pointer border-t border-border hover:bg-accent/40"
                    data-testid={`treasury-bank-movement-${m.id}`}
                    onClick={() => onSelectMovement(m)}
                  >
                    <td className="px-2 py-1">{m.postedCivilDate}</td>
                    <td className="px-2 py-1">
                      {accountLabel(
                        accounts,
                        m.accountId,
                        m.accountCode,
                        m.accountName
                      )}
                    </td>
                    <td className="px-2 py-1">{m.counterpartyName ?? "—"}</td>
                    <td className="px-2 py-1">{m.description ?? "—"}</td>
                    <td className="px-2 py-1">
                      {m.direction === "DEBIT" ? "−" : "+"}
                      {formatTreasuryBankMoney(m.amount, m.currency)}
                    </td>
                    <td className="px-2 py-1">
                      {TREASURY_BANK_MOVEMENT_STATUS_LABELS[
                        m.reconciliationStatus
                      ] ?? m.reconciliationStatus}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {selected ? (
        <section
          className="rounded-xl border border-border bg-card p-4 shadow-sm"
          data-testid="treasury-bank-movement-detail"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Detalhes do movimento</h3>
            <button
              type="button"
              className="rounded-lg border border-border px-2 py-1 text-xs"
              onClick={onClearSelection}
            >
              Fechar
            </button>
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Conta</dt>
              <dd>
                {accountLabel(
                  accounts,
                  selected.accountId,
                  selected.accountCode,
                  selected.accountName
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Data</dt>
              <dd>{selected.postedCivilDate}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Contraparte</dt>
              <dd>{selected.counterpartyName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Descrição</dt>
              <dd>{selected.description ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Valor</dt>
              <dd>
                {selected.direction === "DEBIT" ? "Débito " : "Crédito "}
                {formatTreasuryBankMoney(selected.amount, selected.currency)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Documento</dt>
              <dd>{selected.documentNumber ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Conciliação</dt>
              <dd>
                {TREASURY_BANK_MOVEMENT_STATUS_LABELS[
                  selected.reconciliationStatus
                ] ?? selected.reconciliationStatus}{" "}
                ({formatTreasuryBankMoney(selected.reconciledAmount)} /{" "}
                {formatTreasuryBankMoney(selected.amount)})
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">FITID / fingerprint</dt>
              <dd className="break-all text-xs">
                {selected.fitId ?? "—"} / {selected.fingerprint.slice(0, 16)}…
              </dd>
            </div>
          </dl>
          {activeMatches.length > 0 ? (
            <div
              className="mt-4 space-y-2 border-t border-border pt-3"
              data-testid="treasury-bank-movement-active-matches"
            >
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Conciliações ativas
              </h4>
              <ul className="space-y-2">
                {activeMatches.map((match) => (
                  <li
                    key={match.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                    data-testid={`treasury-active-match-${match.id}`}
                  >
                    <div>
                      <div className="font-medium">
                        {formatTreasuryBankMoney(
                          match.matchedAmount,
                          match.currency
                        )}{" "}
                        · {match.matchedCivilDate}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {match.allocations.map((a) => a.kind).join(", ")}
                      </div>
                    </div>
                    {canReverse && onReverseMatch ? (
                      <button
                        type="button"
                        className="rounded-lg border border-destructive/40 px-2 py-1 text-xs text-destructive"
                        data-testid={`treasury-reverse-match-${match.id}`}
                        onClick={() => onReverseMatch(match)}
                      >
                        Reverter
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
