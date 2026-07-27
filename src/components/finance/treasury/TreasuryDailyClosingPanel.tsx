/**
 * Painel — fechamento diário da Tesouraria (presentacional).
 */

import React from "react";
import type {
  TreasuryDailyClosingDto,
  TreasuryDailyClosingGateItemDto,
  TreasuryDailyClosingPendencyItemDto,
  TreasuryDailyClosingPreviewDto,
} from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_DAILY_CLOSING_STATUS_LABELS,
  buildTreasuryDailyClosingChecklist,
  compareTreasuryDailyClosingVersions,
  formatTreasuryDailyClosingCivilDate,
  formatTreasuryDailyClosingMoney,
  isTreasuryDailyClosingChecklistReady,
  type TreasuryDailyClosingVersionDiffRow,
  type TreasuryDailyClosingViewKind,
} from "@/src/lib/treasury/treasuryDailyClosingUi.js";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";

function GateList(props: {
  title: string;
  testId: string;
  items: TreasuryDailyClosingGateItemDto[];
  emptyLabel: string;
}) {
  return (
    <section className="space-y-2" data-testid={props.testId}>
      <h3 className="text-sm font-semibold text-foreground">{props.title}</h3>
      {props.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{props.emptyLabel}</p>
      ) : (
        <ul className="space-y-2">
          {props.items.map((item, idx) => (
            <li
              key={`${item.code}-${idx}`}
              className="rounded-lg border border-border px-3 py-2 text-sm"
              data-testid={`${props.testId}-item`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{item.title}</span>
                <span className="text-xs uppercase text-muted-foreground">
                  {item.severity}
                  {item.blocksClose ? " · bloqueia" : ""}
                  {item.requiresCaveat ? " · ressalva" : ""}
                </span>
              </div>
              <p className="mt-1 text-muted-foreground">{item.description}</p>
              {item.amount != null ? (
                <p className="mt-1 font-mono text-xs">
                  {formatTreasuryDailyClosingMoney(item.amount)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PendencyTable(props: {
  title: string;
  testId: string;
  items: TreasuryDailyClosingPendencyItemDto[];
}) {
  return (
    <section className="space-y-2" data-testid={props.testId}>
      <h3 className="text-sm font-semibold text-foreground">{props.title}</h3>
      {props.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma pendência.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Contraparte</th>
                <th className="px-3 py-2">Valor aberto</th>
                <th className="px-3 py-2">Vencimento</th>
                <th className="px-3 py-2">Esperado</th>
                <th className="px-3 py-2">Ressalva</th>
              </tr>
            </thead>
            <tbody>
              {props.items.map((row) => (
                <tr
                  key={`${row.side}-${row.officialTitleId}`}
                  className="border-t border-border"
                  data-testid={`${props.testId}-row`}
                >
                  <td className="px-3 py-2">
                    {row.counterpartyName ?? row.officialTitleId}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {formatTreasuryDailyClosingMoney(row.openAmount)}
                  </td>
                  <td className="px-3 py-2">
                    {formatTreasuryDailyClosingCivilDate(row.dueDate)}
                  </td>
                  <td className="px-3 py-2">
                    {formatTreasuryDailyClosingCivilDate(row.expectedDate)}
                  </td>
                  <td className="px-3 py-2">
                    {row.dueOrExpectedOnOrBeforeCivilDate ? "Sim" : "Não"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function TreasuryDailyClosingPanel(props: {
  viewKind: TreasuryDailyClosingViewKind;
  deniedMessage: string;
  error: string | null;
  conflictMessage: string | null;
  successMessage: string | null;
  civilDate: string;
  companyCode: string;
  notes: string;
  preview: TreasuryDailyClosingPreviewDto | null;
  history: TreasuryDailyClosingDto[];
  caveatDrafts: Record<string, string>;
  canClose: boolean;
  canReopen: boolean;
  busy: boolean;
  confirming: boolean;
  compareLeftId: string;
  compareRightId: string;
  compareLeft: TreasuryDailyClosingDto | null;
  compareRight: TreasuryDailyClosingDto | null;
  onCivilDateChange: (value: string) => void;
  onCompanyCodeChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onCaveatDraftChange: (code: string, message: string) => void;
  onRefreshPreview: () => void;
  onRequestConfirm: () => void;
  onCancelConfirm: () => void;
  onConfirmClose: () => void;
  onReopen: (row: TreasuryDailyClosingDto) => void;
  onCompareLeftIdChange: (id: string) => void;
  onCompareRightIdChange: (id: string) => void;
}) {
  const {
    viewKind,
    deniedMessage,
    error,
    conflictMessage,
    successMessage,
    civilDate,
    companyCode,
    notes,
    preview,
    history,
    caveatDrafts,
    canClose,
    canReopen,
    busy,
    confirming,
    compareLeftId,
    compareRightId,
    compareLeft,
    compareRight,
    onCivilDateChange,
    onCompanyCodeChange,
    onNotesChange,
    onCaveatDraftChange,
    onRefreshPreview,
    onRequestConfirm,
    onCancelConfirm,
    onConfirmClose,
    onReopen,
    onCompareLeftIdChange,
    onCompareRightIdChange,
  } = props;

  if (viewKind === "denied") {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="treasury-daily-closing-denied"
      >
        {deniedMessage}
      </p>
    );
  }

  const checklist = buildTreasuryDailyClosingChecklist(preview, caveatDrafts);
  const checklistReady = isTreasuryDailyClosingChecklistReady(checklist);
  const diffs: TreasuryDailyClosingVersionDiffRow[] =
    compareTreasuryDailyClosingVersions(compareLeft, compareRight);
  const summary = preview?.summary;

  return (
    <div className="space-y-6" data-testid="treasury-daily-closing-panel">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className={financeModuleFilterLabelClass()}>Data civil</span>
          <input
            type="date"
            className={financeModuleFilterFieldClass()}
            value={civilDate}
            onChange={(e) => onCivilDateChange(e.target.value)}
            data-testid="treasury-daily-closing-date"
          />
        </label>
        <label className="space-y-1">
          <span className={financeModuleFilterLabelClass()}>Empresa</span>
          <input
            className={financeModuleFilterFieldClass()}
            value={companyCode}
            onChange={(e) => onCompanyCodeChange(e.target.value)}
            placeholder="companyCode"
            data-testid="treasury-daily-closing-company"
          />
        </label>
        <button
          type="button"
          className="inline-flex items-center rounded-lg bg-secondary px-3 py-2 text-sm font-semibold text-secondary-foreground"
          onClick={onRefreshPreview}
          disabled={busy}
          data-testid="treasury-daily-closing-refresh"
        >
          Atualizar preview
        </button>
      </div>

      {viewKind === "loading" ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="treasury-daily-closing-loading"
        >
          Carregando preview do fechamento…
        </p>
      ) : null}

      {error ? (
        <p
          className="text-sm text-destructive"
          data-testid="treasury-daily-closing-error"
        >
          {error}
        </p>
      ) : null}

      {conflictMessage ? (
        <p
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground"
          data-testid="treasury-daily-closing-conflict"
          role="alert"
        >
          {conflictMessage}
        </p>
      ) : null}

      {successMessage ? (
        <p
          className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm"
          data-testid="treasury-daily-closing-success"
        >
          {successMessage}
        </p>
      ) : null}

      {preview && summary ? (
        <>
          <section
            className="space-y-3"
            data-testid="treasury-daily-closing-summary"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">Resumo</h3>
              <p className="font-mono text-xs text-muted-foreground">
                hash {preview.sourceHash.slice(0, 12)}…
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Saldo inicial", summary.openingBalance],
                ["Entradas", summary.realizedInflows],
                ["Saídas", summary.realizedOutflows],
                ["Pendências", summary.pendenciesAmount],
                ["Saldo final", summary.closingBalance],
                ["Observado", summary.observedBalance],
                ["Conciliado", summary.reconciledBalance],
                ["Diferença", summary.differenceAmount],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-lg border border-border px-3 py-2"
                >
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="font-mono text-sm font-semibold">
                    {formatTreasuryDailyClosingMoney(
                      value as string | null | undefined
                    )}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Contas: {summary.accountCount} · Bloqueios:{" "}
              {summary.absoluteBlockCount} · Avisos: {summary.warningCount} ·
              Ressalvas exigidas: {summary.caveatRequiredCount}
            </p>
          </section>

          <section
            className="space-y-2"
            data-testid="treasury-daily-closing-accounts"
          >
            <h3 className="text-sm font-semibold">Posição por conta</h3>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Conta</th>
                    <th className="px-3 py-2">Abertura</th>
                    <th className="px-3 py-2">Entradas</th>
                    <th className="px-3 py-2">Saídas</th>
                    <th className="px-3 py-2">Fechamento</th>
                    <th className="px-3 py-2">Observado</th>
                    <th className="px-3 py-2">Diferença</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.accounts.map((acc) => (
                    <tr
                      key={acc.accountId}
                      className="border-t border-border"
                      data-testid="treasury-daily-closing-account-row"
                    >
                      <td className="px-3 py-2">
                        {acc.code} · {acc.name}
                        {acc.balanceStale ? (
                          <span className="ml-2 text-xs text-amber-700">
                            stale
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {formatTreasuryDailyClosingMoney(acc.openingBalance)}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {formatTreasuryDailyClosingMoney(acc.realizedInflows)}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {formatTreasuryDailyClosingMoney(acc.realizedOutflows)}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {formatTreasuryDailyClosingMoney(acc.closingBalance)}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {formatTreasuryDailyClosingMoney(acc.observedBalance)}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {formatTreasuryDailyClosingMoney(acc.differenceAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section
            className="space-y-2"
            data-testid="treasury-daily-closing-checklist"
          >
            <h3 className="text-sm font-semibold">Checklist</h3>
            <ul className="space-y-1">
              {checklist.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-2 text-sm"
                  data-testid={`treasury-daily-closing-check-${item.id}`}
                >
                  <span
                    className={
                      item.ok ? "text-emerald-600" : "text-destructive"
                    }
                  >
                    {item.ok ? "✓" : "✗"}
                  </span>
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
          </section>

          <GateList
            title="Bloqueios absolutos"
            testId="treasury-daily-closing-blocks"
            items={preview.absoluteBlocks}
            emptyLabel="Nenhum bloqueio absoluto."
          />

          <GateList
            title="Avisos"
            testId="treasury-daily-closing-warnings"
            items={[
              ...preview.warnings,
              ...preview.staleBalances,
              ...preview.unreconciledMovements,
              ...preview.expiredPromises,
              ...preview.transfersInTransit,
            ]}
            emptyLabel="Nenhum aviso."
          />

          <PendencyTable
            title="Pendências a receber"
            testId="treasury-daily-closing-pendencies-ar"
            items={preview.pendingReceivables}
          />
          <PendencyTable
            title="Pendências a pagar"
            testId="treasury-daily-closing-pendencies-ap"
            items={preview.pendingPayables}
          />

          <section
            className="space-y-2"
            data-testid="treasury-daily-closing-differences"
          >
            <h3 className="text-sm font-semibold">Diferenças</h3>
            <p className="text-sm">
              Diferença consolidada:{" "}
              <span className="font-mono font-semibold">
                {formatTreasuryDailyClosingMoney(summary.differenceAmount)}
              </span>
            </p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {preview.accounts
                .filter(
                  (a) =>
                    a.differenceAmount != null &&
                    a.differenceAmount !== "0" &&
                    a.differenceAmount !== "0.00"
                )
                .map((a) => (
                  <li key={a.accountId}>
                    {a.code}:{" "}
                    {formatTreasuryDailyClosingMoney(a.differenceAmount)}
                  </li>
                ))}
            </ul>
          </section>

          <section
            className="space-y-3"
            data-testid="treasury-daily-closing-caveats"
          >
            <h3 className="text-sm font-semibold">Ressalvas</h3>
            <label className="block space-y-1">
              <span className={financeModuleFilterLabelClass()}>
                Observações gerais (opcional)
              </span>
              <textarea
                className={`${financeModuleFilterFieldClass()} min-h-[72px] w-full max-w-xl`}
                value={notes}
                onChange={(e) => onNotesChange(e.target.value)}
                data-testid="treasury-daily-closing-notes"
              />
            </label>
            {preview.requiredCaveatCodes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma ressalva obrigatória para este preview.
              </p>
            ) : (
              preview.requiredCaveatCodes.map((code) => (
                <label key={code} className="block space-y-1">
                  <span className={financeModuleFilterLabelClass()}>
                    Ressalva obrigatória · {code}
                  </span>
                  <textarea
                    className={`${financeModuleFilterFieldClass()} min-h-[64px] w-full max-w-xl`}
                    value={caveatDrafts[code] ?? ""}
                    onChange={(e) =>
                      onCaveatDraftChange(code, e.target.value)
                    }
                    data-testid={`treasury-daily-closing-caveat-${code}`}
                  />
                </label>
              ))
            )}
          </section>

          <section
            className="space-y-3"
            data-testid="treasury-daily-closing-confirm"
          >
            <h3 className="text-sm font-semibold">Confirmação</h3>
            {!confirming ? (
              <button
                type="button"
                className="inline-flex items-center rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                disabled={
                  busy ||
                  !canClose ||
                  !checklistReady ||
                  !companyCode.trim()
                }
                onClick={onRequestConfirm}
                data-testid="treasury-daily-closing-request-confirm"
              >
                Preparar fechamento (atualiza preview)
              </button>
            ) : (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <p className="text-sm">
                  Preview atualizado. Confirme o fechamento de{" "}
                  <strong>
                    {formatTreasuryDailyClosingCivilDate(preview.civilDate)}
                  </strong>{" "}
                  para <strong>{companyCode.trim()}</strong>.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                    disabled={busy || !canClose}
                    onClick={onConfirmClose}
                    data-testid="treasury-daily-closing-confirm-submit"
                  >
                    Confirmar fechamento
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center rounded-lg bg-secondary px-3 py-2 text-sm font-semibold"
                    disabled={busy}
                    onClick={onCancelConfirm}
                    data-testid="treasury-daily-closing-confirm-cancel"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
            {!canClose ? (
              <p className="text-xs text-muted-foreground">
                Sem permissão para fechar o dia.
              </p>
            ) : null}
          </section>
        </>
      ) : null}

      <section
        className="space-y-2"
        data-testid="treasury-daily-closing-history"
      >
        <h3 className="text-sm font-semibold">Histórico de fechamentos</h3>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum fechamento registrado para os filtros.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Versão</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Saldo final</th>
                  <th className="px-3 py-2">Hash</th>
                  <th className="px-3 py-2">Ações</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-border"
                    data-testid="treasury-daily-closing-history-row"
                  >
                    <td className="px-3 py-2">v{row.version}</td>
                    <td className="px-3 py-2">
                      {TREASURY_DAILY_CLOSING_STATUS_LABELS[row.status] ??
                        row.status}
                    </td>
                    <td className="px-3 py-2">
                      {formatTreasuryDailyClosingCivilDate(row.civilDate)}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {formatTreasuryDailyClosingMoney(row.closingBalance)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {row.sourceHash.slice(0, 10)}…
                    </td>
                    <td className="px-3 py-2">
                      {row.status === "CLOSED" && canReopen ? (
                        <button
                          type="button"
                          className="text-sm font-semibold text-primary underline-offset-2 hover:underline disabled:opacity-50"
                          disabled={busy}
                          onClick={() => onReopen(row)}
                          data-testid="treasury-daily-closing-reopen"
                        >
                          Reabrir
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section
        className="space-y-3"
        data-testid="treasury-daily-closing-compare"
      >
        <h3 className="text-sm font-semibold">Comparação entre versões</h3>
        <div className="flex flex-wrap gap-3">
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass()}>Versão A</span>
            <select
              className={financeModuleFilterFieldClass()}
              value={compareLeftId}
              onChange={(e) => onCompareLeftIdChange(e.target.value)}
              data-testid="treasury-daily-closing-compare-left"
            >
              <option value="">Selecione</option>
              {history.map((h) => (
                <option key={h.id} value={h.id}>
                  v{h.version} · {h.status}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass()}>Versão B</span>
            <select
              className={financeModuleFilterFieldClass()}
              value={compareRightId}
              onChange={(e) => onCompareRightIdChange(e.target.value)}
              data-testid="treasury-daily-closing-compare-right"
            >
              <option value="">Selecione</option>
              {history.map((h) => (
                <option key={h.id} value={h.id}>
                  v{h.version} · {h.status}
                </option>
              ))}
            </select>
          </label>
        </div>
        {diffs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Selecione duas versões para comparar.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Campo</th>
                  <th className="px-3 py-2">Versão A</th>
                  <th className="px-3 py-2">Versão B</th>
                </tr>
              </thead>
              <tbody>
                {diffs.map((row) => (
                  <tr
                    key={row.field}
                    className={
                      row.changed
                        ? "border-t border-border bg-amber-500/10"
                        : "border-t border-border"
                    }
                    data-testid="treasury-daily-closing-diff-row"
                  >
                    <td className="px-3 py-2">{row.label}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.left}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.right}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
