import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { CostCenterSupplierPaymentTitleRow } from "@/src/lib/financeCostCenterSupplierPaymentDrilldown.shared";
import type { BatchReclassificationResult } from "@/src/lib/financeApAllocationShared";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import {
  CostCenterDialog,
  ModalErrorBlock,
  ModalSuccessBlock,
} from "@/src/components/finance/cost-centers/financeUnclassifiedModalUi";
import { usePortalContainer } from "@/src/components/finance/shared/usePortalContainer";
import { financeModuleFilterFieldClass, financeModuleFilterLabelClass } from "@/src/lib/financeModuleUiStandards";

type CostCenterOption = {
  id: string;
  code: string;
  name: string;
  status: string;
};

type Props = {
  open: boolean;
  selectedRows: CostCenterSupplierPaymentTitleRow[];
  supplierName: string;
  onClose: () => void;
  onSaved: (result: BatchReclassificationResult) => void;
};

function resolvePredominantCostCenterLabel(rows: CostCenterSupplierPaymentTitleRow[]): string {
  if (rows.length === 0) return "—";
  const names = new Set(rows.map((row) => row.costCenterName));
  return names.size === 1 ? rows[0]!.costCenterName : "Múltiplos";
}

export function FinanceApTitleBatchReclassifyModal({
  open,
  selectedRows,
  supplierName,
  onClose,
  onSaved,
}: Props) {
  const portalContainer = usePortalContainer();
  const [costCenters, setCostCenters] = useState<CostCenterOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [costCenterId, setCostCenterId] = useState("");
  const [percentage, setPercentage] = useState("100");
  const [reason, setReason] = useState("");

  const selectedCount = selectedRows.length;
  const totalPaidAmount = useMemo(
    () => selectedRows.reduce((sum, row) => sum + row.paidAmount, 0),
    [selectedRows]
  );
  const currentCostCenterLabel = useMemo(
    () => resolvePredominantCostCenterLabel(selectedRows),
    [selectedRows]
  );

  const loadCostCenters = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const centersPayload = await fetchJsonOk<{ items: CostCenterOption[] }>(
        "/api/finance/cost-centers",
        { credentials: "include" }
      );
      setCostCenters((centersPayload.items ?? []).filter((center) => center.status === "ACTIVE"));
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível carregar centros de custo.", e));
      setCostCenters([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || selectedCount === 0) {
      setError(null);
      setSuccess(null);
      setReason("");
      setCostCenterId("");
      setPercentage("100");
      return;
    }
    void loadCostCenters();
  }, [open, selectedCount, loadCostCenters]);

  const canSave =
    Boolean(costCenterId.trim()) &&
    Boolean(reason.trim()) &&
    Number.isFinite(Number(percentage)) &&
    selectedCount > 0 &&
    !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await fetchJsonOk<BatchReclassificationResult>(
        "/api/finance/cost-centers/payables/reclassify-batch",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payableIds: selectedRows.map((row) => row.accountsPayableId),
            costCenterId: costCenterId.trim(),
            percentage: Number(percentage),
            reason: reason.trim(),
            lockedManual: true,
          }),
        }
      );
      if (result.failed > 0) {
        setError(
          `${result.updated} título(s) reclassificado(s), ${result.failed} falha(s). Revise os títulos com erro.`
        );
      } else {
        setSuccess(`${result.updated} título(s) reclassificado(s) com sucesso.`);
      }
      onSaved(result);
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível reclassificar os títulos selecionados.", e));
    } finally {
      setSaving(false);
    }
  };

  if (!open || selectedCount === 0 || !portalContainer) return null;

  return createPortal(
    <CostCenterDialog
      testId="finance-ap-title-batch-reclassify-modal"
      title="Reclassificar títulos selecionados"
      subtitle="Esta ação criará uma reclassificação manual para cada título selecionado. Não altera o AP/Nomus nem a regra do fornecedor."
      onClose={onClose}
      closeDisabled={saving}
      maxWidthClass="max-w-3xl"
      stacked
      footer={
        <>
          <button
            type="button"
            className="rounded-lg border px-4 py-2 text-sm"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            data-testid="finance-ap-title-batch-reclassify-save-button"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            disabled={!canSave}
            onClick={() => void handleSave()}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Reclassificar {selectedCount} título{selectedCount === 1 ? "" : "s"}
          </button>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando centros de custo…
        </div>
      ) : null}

      {error ? <ModalErrorBlock title="Erro" message={error} /> : null}
      {success ? <ModalSuccessBlock title="Reclassificação concluída" message={success} /> : null}

      {!loading ? (
        <div className="space-y-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground">Fornecedor</p>
              <p className="font-semibold">{supplierName}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Títulos selecionados</p>
              <p className="font-semibold">{selectedCount}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Valor total selecionado</p>
              <p className="font-semibold tabular-nums">{formatFinanceCurrency(totalPaidAmount)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Centro de custo atual</p>
              <p className="font-semibold">{currentCostCenterLabel}</p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground rounded-lg border border-border/80 bg-muted/20 px-3 py-2">
            Selecionando títulos desta página. A exceção manual prevalece sobre regras automáticas futuras
            para cada título.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 sm:col-span-2">
              <span className={financeModuleFilterLabelClass()}>Novo centro de custo</span>
              <select
                className={financeModuleFilterFieldClass()}
                value={costCenterId}
                onChange={(e) => setCostCenterId(e.target.value)}
                data-testid="finance-ap-title-batch-reclassify-cost-center"
              >
                <option value="">Selecione…</option>
                {costCenters.map((center) => (
                  <option key={center.id} value={center.id}>
                    {center.code} — {center.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={financeModuleFilterLabelClass()}>Percentual (%)</span>
              <input
                className={financeModuleFilterFieldClass()}
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={percentage}
                onChange={(e) => setPercentage(e.target.value)}
              />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className={financeModuleFilterLabelClass()}>Motivo da reclassificação</span>
              <textarea
                className={financeModuleFilterFieldClass()}
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex.: Títulos referentes a despesas administrativas, não logística."
                data-testid="finance-ap-title-batch-reclassify-reason"
              />
            </label>
          </div>
        </div>
      ) : null}
    </CostCenterDialog>,
    portalContainer
  );
}
