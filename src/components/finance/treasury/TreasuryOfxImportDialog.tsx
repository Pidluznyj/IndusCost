/**
 * Assistente OFX — upload → preview → confirmação.
 */

import React, { useMemo, useState } from "react";
import type { TreasuryFinancialAccountDto } from "@/src/lib/treasury/contracts/index.js";
import {
  applyTreasuryOfxImport,
  previewTreasuryOfxImport,
  type TreasuryOfxApplyResponse,
  type TreasuryOfxPreviewResponse,
} from "@/src/lib/treasury/treasuryBankImportOfxApi.js";
import {
  TREASURY_OFX_PREVIEW_STATUS_LABELS,
  formatTreasuryBankMoney,
  resolveTreasuryOfxImportWizardMessage,
  validateTreasuryOfxUploadForm,
  type TreasuryOfxImportWizardStep,
} from "@/src/lib/treasury/treasuryBankMovementsUi.js";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";

export function TreasuryOfxImportDialog(props: {
  open: boolean;
  accounts: TreasuryFinancialAccountDto[];
  onClose: () => void;
  onApplied: (result: TreasuryOfxApplyResponse) => void;
}) {
  const { open, accounts, onClose, onApplied } = props;
  const [step, setStep] = useState<TreasuryOfxImportWizardStep>("upload");
  const [accountId, setAccountId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<TreasuryOfxPreviewResponse | null>(
    null
  );
  const [applyResult, setApplyResult] =
    useState<TreasuryOfxApplyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const message = useMemo(
    () => resolveTreasuryOfxImportWizardMessage(step),
    [step]
  );

  if (!open) return null;

  function resetAndClose() {
    setStep("upload");
    setAccountId("");
    setFile(null);
    setPreview(null);
    setApplyResult(null);
    setError(null);
    setBusy(false);
    onClose();
  }

  async function runPreview() {
    const validation = validateTreasuryOfxUploadForm({ accountId, file });
    if (validation) {
      setError(validation);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await previewTreasuryOfxImport({
        accountId,
        file: file!,
      });
      setPreview(result);
      setStep("preview");
    } catch (err) {
      setError(buildFinanceTabLoadError(err, "Falha ao pré-visualizar OFX."));
    } finally {
      setBusy(false);
    }
  }

  async function runApply() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    setStep("confirming");
    try {
      const result = await applyTreasuryOfxImport({
        previewToken: preview.previewToken,
        notes: null,
      });
      setApplyResult(result);
      setStep("done");
      onApplied(result);
    } catch (err) {
      setError(buildFinanceTabLoadError(err, "Falha ao confirmar importação."));
      setStep("preview");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      data-testid="treasury-ofx-import-dialog"
    >
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Importar OFX
            </h2>
            <p className="text-sm text-muted-foreground">{message}</p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-border px-2 py-1 text-sm"
            onClick={resetAndClose}
            disabled={busy && step === "confirming"}
          >
            Fechar
          </button>
        </div>

        {error ? (
          <p className="mb-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {step === "upload" ? (
          <div className="space-y-3" data-testid="treasury-ofx-step-upload">
            <label className="block space-y-1">
              <span className={financeModuleFilterLabelClass}>Conta</span>
              <select
                className={financeModuleFilterFieldClass}
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                data-testid="treasury-ofx-account"
              >
                <option value="">Selecione…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className={financeModuleFilterLabelClass}>Arquivo OFX</span>
              <input
                type="file"
                accept=".ofx,.qfx,application/x-ofx,application/ofx,text/xml"
                className={financeModuleFilterFieldClass}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                data-testid="treasury-ofx-file"
              />
            </label>
            <button
              type="button"
              className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              onClick={() => void runPreview()}
              disabled={busy}
              data-testid="treasury-ofx-preview-btn"
            >
              {busy ? "Processando…" : "Pré-visualizar"}
            </button>
          </div>
        ) : null}

        {step === "preview" && preview ? (
          <div className="space-y-3" data-testid="treasury-ofx-step-preview">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <p>
                Período:{" "}
                <strong>
                  {preview.period.startCivilDate ?? "—"} →{" "}
                  {preview.period.endCivilDate ?? "—"}
                </strong>
              </p>
              <p>
                Totais: crédito{" "}
                <strong>
                  {formatTreasuryBankMoney(preview.totals.creditAmount)}
                </strong>{" "}
                / débito{" "}
                <strong>
                  {formatTreasuryBankMoney(preview.totals.debitAmount)}
                </strong>
              </p>
              <p>
                Novos: <strong>{preview.totals.newCount}</strong> · Duplicados:{" "}
                <strong>{preview.totals.duplicateCount}</strong> · Inválidos:{" "}
                <strong>{preview.totals.invalidCount}</strong>
              </p>
              {preview.fileAlreadyImported ? (
                <p className="text-amber-700 dark:text-amber-400">
                  Este arquivo já foi importado nesta conta (reaplicação será
                  idempotente).
                </p>
              ) : null}
            </div>
            <div className="max-h-64 overflow-auto rounded-lg border border-border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-2 py-1">Status</th>
                    <th className="px-2 py-1">Data</th>
                    <th className="px-2 py-1">Descrição</th>
                    <th className="px-2 py-1">Contraparte</th>
                    <th className="px-2 py-1">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.movements.map((m) => (
                    <tr
                      key={`${m.sortOrder}-${m.fingerprint ?? m.fitId ?? "x"}`}
                      className="border-t border-border"
                    >
                      <td className="px-2 py-1">
                        {TREASURY_OFX_PREVIEW_STATUS_LABELS[m.status] ??
                          m.status}
                      </td>
                      <td className="px-2 py-1">
                        {m.postedCivilDate ?? "—"}
                      </td>
                      <td className="px-2 py-1">
                        {m.description ?? m.invalidReason ?? "—"}
                      </td>
                      <td className="px-2 py-1">
                        {m.counterpartyName ?? "—"}
                      </td>
                      <td className="px-2 py-1">
                        {m.amount
                          ? `${m.direction === "DEBIT" ? "−" : "+"}${formatTreasuryBankMoney(m.amount, m.currency ?? "BRL")}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
                onClick={() => {
                  setStep("upload");
                  setPreview(null);
                }}
                disabled={busy}
              >
                Voltar
              </button>
              <button
                type="button"
                className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                onClick={() => void runApply()}
                disabled={
                  busy ||
                  (preview.totals.newCount === 0 &&
                    !preview.fileAlreadyImported)
                }
                data-testid="treasury-ofx-confirm-btn"
              >
                Confirmar importação
              </button>
              {preview.totals.newCount === 0 && !preview.fileAlreadyImported ? (
                <p className="text-sm text-muted-foreground">
                  Não há movimentos novos para gravar.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {step === "confirming" ? (
          <p className="text-sm text-muted-foreground" data-testid="treasury-ofx-step-confirming">
            Gravando lote e movimentos…
          </p>
        ) : null}

        {step === "done" && applyResult ? (
          <div className="space-y-2 text-sm" data-testid="treasury-ofx-step-done">
            <p className="font-semibold text-foreground">
              {applyResult.idempotent
                ? "Importação idempotente — nenhum movimento novo."
                : "Importação confirmada."}
            </p>
            <p>
              Criados: <strong>{applyResult.created.count}</strong> · Ignorados:{" "}
              <strong>{applyResult.ignored.count}</strong> · Inválidos:{" "}
              <strong>{applyResult.invalid.count}</strong>
            </p>
            {applyResult.errors.length > 0 ? (
              <ul className="list-disc pl-5 text-destructive">
                {applyResult.errors.map((e, i) => (
                  <li key={`${e.code}-${i}`}>{e.message}</li>
                ))}
              </ul>
            ) : null}
            <button
              type="button"
              className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
              onClick={resetAndClose}
            >
              Concluir
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
