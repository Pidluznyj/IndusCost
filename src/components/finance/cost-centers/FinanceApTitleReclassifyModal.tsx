import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { CostCenterSupplierPaymentTitleRow } from "@/src/lib/financeCostCenterSupplierPaymentDrilldown.shared";
import type { FinanceApTitleClassificationDetail } from "@/src/lib/financeAccountsPayableCostCenterTypes";
import {
  formatFinanceCurrency,
  formatFinanceDate,
} from "@/src/lib/financeAccountsReceivableFormat";
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
  titleRow: CostCenterSupplierPaymentTitleRow | null;
  supplierName: string;
  onClose: () => void;
  onSaved: () => void;
};

export function FinanceApTitleReclassifyModal({
  open,
  titleRow,
  supplierName,
  onClose,
  onSaved,
}: Props) {
  const portalContainer = usePortalContainer();
  const [detail, setDetail] = useState<FinanceApTitleClassificationDetail | null>(null);
  const [costCenters, setCostCenters] = useState<CostCenterOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [costCenterId, setCostCenterId] = useState("");
  const [percentage, setPercentage] = useState("100");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    if (!titleRow) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const [detailPayload, centersPayload] = await Promise.all([
        fetchJsonOk<FinanceApTitleClassificationDetail>(
          `/api/finance/accounts-payable/titles/${titleRow.accountsPayableId}/classification`,
          { credentials: "include" }
        ),
        fetchJsonOk<{ items: CostCenterOption[] }>("/api/finance/cost-centers", {
          credentials: "include",
        }),
      ]);
      setDetail(detailPayload);
      setCostCenters(
        (centersPayload.items ?? []).filter((center) => center.status === "ACTIVE")
      );
      const currentLine = detailPayload.enrichment.lines[0];
      setCostCenterId(currentLine?.costCenterId ?? titleRow.primaryCostCenterId ?? "");
      setPercentage(
        currentLine?.percentage != null ? String(currentLine.percentage) : "100"
      );
      setReason("");
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível carregar o título para reclassificação.", e));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [titleRow]);

  useEffect(() => {
    if (!open || !titleRow) {
      setDetail(null);
      setError(null);
      setSuccess(null);
      setReason("");
      return;
    }
    void load();
  }, [open, titleRow, load]);

  const currentCostCenterLabel = useMemo(() => {
    if (!detail) return titleRow?.costCenterName ?? "—";
    return detail.enrichment.costCenterLabel;
  }, [detail, titleRow]);

  const canSave =
    Boolean(costCenterId.trim()) &&
    Boolean(reason.trim()) &&
    Number.isFinite(Number(percentage)) &&
    !saving;

  const handleSave = async () => {
    if (!titleRow || !canSave) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await fetchJsonOk(
        `/api/finance/accounts-payable/${titleRow.accountsPayableId}/cost-center-reclassification`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lines: [
              {
                costCenterId: costCenterId.trim(),
                percentage: Number(percentage),
              },
            ],
            reason: reason.trim(),
            lockedManual: true,
          }),
        }
      );
      setSuccess(
        "Título reclassificado com sucesso. A correção manual prevalece sobre regras automáticas futuras."
      );
      onSaved();
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível reclassificar o título.", e));
    } finally {
      setSaving(false);
    }
  };

  if (!open || !titleRow || !portalContainer) return null;

  return createPortal(
    <CostCenterDialog
      testId="finance-ap-title-reclassify-modal"
      title="Reclassificar título"
      subtitle="Corrija o centro de custo deste título específico. A alteração manual prevalece sobre regras automáticas."
      onClose={onClose}
      closeDisabled={saving}
      maxWidthClass="max-w-4xl"
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
            data-testid="finance-ap-title-reclassify-save-button"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            disabled={!canSave}
            onClick={() => void handleSave()}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Salvar reclassificação
          </button>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando título…
        </div>
      ) : null}

      {error ? (
        <ModalErrorBlock title="Erro" message={error} />
      ) : null}
      {success ? (
        <ModalSuccessBlock title="Reclassificação concluída" message={success} />
      ) : null}

      {!loading ? (
        <div className="space-y-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground">Fornecedor</p>
              <p className="font-semibold">{supplierName}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Documento / título</p>
              <p className="font-semibold">
                {titleRow.documentNumber ?? titleRow.accountsPayableId}
              </p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-muted-foreground">Descrição / comentário</p>
              <p className="whitespace-pre-wrap">{titleRow.descriptiveText}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Emissão</p>
              <p>{formatFinanceDate(titleRow.issueDate)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Vencimento</p>
              <p>{formatFinanceDate(titleRow.dueDate)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Pagamento</p>
              <p>{formatFinanceDate(titleRow.paymentDate)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Valor pago</p>
              <p className="font-semibold tabular-nums">
                {formatFinanceCurrency(titleRow.paidAmount)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Centro de custo atual</p>
              <p className="font-semibold">{currentCostCenterLabel}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Origem da classificação</p>
              <p>{detail?.enrichment.classificationOriginLabel ?? titleRow.classificationOriginLabel}</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 sm:col-span-2">
              <span className={financeModuleFilterLabelClass()}>Novo centro de custo</span>
              <select
                className={financeModuleFilterFieldClass()}
                value={costCenterId}
                onChange={(e) => setCostCenterId(e.target.value)}
                data-testid="finance-ap-title-reclassify-cost-center"
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
                placeholder="Ex.: Título referente a manutenção de máquina, não frete/logística."
                data-testid="finance-ap-title-reclassify-reason"
              />
            </label>
          </div>
        </div>
      ) : null}
    </CostCenterDialog>,
    portalContainer
  );
}
