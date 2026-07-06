import React, { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { ProjectModalShell } from "@/src/components/projects/ProjectModalShell";
import {
  amortizationStatusLabel,
  calculateAmortizationAllocation,
  calculatePassThroughAmounts,
  computeAmortizationConfig,
  type ProjectAmortizationTarget,
  type ProjectCostAmortizationSourceType,
} from "@/src/lib/projectsCostAmortization";
import { parseProjectsNumberInput } from "@/src/lib/projectsUiUtils";

export type AmortizationModalSubmitPayload = {
  sourceType: ProjectCostAmortizationSourceType;
  sourceId: string;
  passThroughPercent: number;
  allocations: Array<{
    targetItemType: string;
    targetItemId: string;
    targetSnapshotRootProductId?: string | null;
    allocationPercent: number;
    amortizationQuantity: number;
  }>;
};

type AllocationDraft = {
  targetItemId: string;
  targetItemType: string;
  targetSnapshotRootProductId?: string | null;
  displayName: string;
  baseUnitCost: number;
  allocationPercent: string;
  amortizationQuantity: string;
};

type Props = {
  open: boolean;
  sourceType: ProjectCostAmortizationSourceType;
  sourceId: string;
  description: string;
  totalCost: number;
  initialPassThroughPercent?: number;
  initialAllocations?: Array<{
    targetItemId: string;
    targetItemType: string;
    targetSnapshotRootProductId?: string | null;
    allocationPercent: number;
    amortizationQuantity: number;
  }>;
  targets: ProjectAmortizationTarget[];
  saving?: boolean;
  error?: string | null;
  readOnly?: boolean;
  onClose: () => void;
  onSubmit: (payload: AmortizationModalSubmitPayload) => Promise<void>;
};

function formatMoney(value: number) {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}%`;
}

export function ProjectCostAmortizationModal({
  open,
  sourceType,
  sourceId,
  description,
  totalCost,
  initialPassThroughPercent = 100,
  initialAllocations,
  targets,
  saving,
  error,
  readOnly,
  onClose,
  onSubmit,
}: Props) {
  const [passThroughPercent, setPassThroughPercent] = useState(String(initialPassThroughPercent));
  const [rows, setRows] = useState<AllocationDraft[]>([]);

  useEffect(() => {
    if (!open) return;
    setPassThroughPercent(String(initialPassThroughPercent));
    const byTarget = new Map(
      (initialAllocations ?? []).map((a) => [a.targetItemId, a])
    );
    setRows(
      targets.map((target) => {
        const saved = byTarget.get(target.targetItemId);
        return {
          targetItemId: target.targetItemId,
          targetItemType: target.targetItemType,
          targetSnapshotRootProductId: target.snapshotRootProductId ?? null,
          displayName: target.displayName,
          baseUnitCost: target.baseUnitCost,
          allocationPercent: saved ? String(saved.allocationPercent) : "0",
          amortizationQuantity: saved
            ? String(saved.amortizationQuantity)
            : String(target.suggestedQuantity),
        };
      })
    );
  }, [open, initialPassThroughPercent, initialAllocations, targets]);

  const passThroughPct = parseProjectsNumberInput(passThroughPercent) ?? 0;
  const { passThroughAmount, absorbedAmount } = calculatePassThroughAmounts(
    totalCost,
    passThroughPct
  );

  const computed = useMemo(() => {
    const allocations = rows.map((row) => ({
      targetItemId: row.targetItemId,
      targetItemType: row.targetItemType as AllocationDraft["targetItemType"],
      targetSnapshotRootProductId: row.targetSnapshotRootProductId,
      targetDescriptionSnapshot: row.displayName,
      targetBaseUnitCostSnapshot: row.baseUnitCost,
      allocationPercent: parseProjectsNumberInput(row.allocationPercent) ?? 0,
      amortizationQuantity: parseProjectsNumberInput(row.amortizationQuantity) ?? 0,
    }));
    return computeAmortizationConfig(
      {
        sourceType,
        sourceId,
        sourceDescriptionSnapshot: description,
        sourceTotalCostSnapshot: totalCost,
        passThroughPercent: passThroughPct,
        allocations,
      },
      targets
    );
  }, [rows, passThroughPct, sourceType, sourceId, description, totalCost, targets]);

  const distributionTotal = computed.distributionPercentTotal;
  const canSave =
    !readOnly &&
    distributionTotal <= 100.0001 &&
    passThroughPct >= 0 &&
    passThroughPct <= 100;

  const updateRow = (targetItemId: string, patch: Partial<AllocationDraft>) => {
    setRows((prev) =>
      prev.map((row) => (row.targetItemId === targetItemId ? { ...row, ...patch } : row))
    );
  };

  const handleSubmit = async () => {
    const allocations = rows
      .map((row) => ({
        targetItemType: row.targetItemType,
        targetItemId: row.targetItemId,
        targetSnapshotRootProductId: row.targetSnapshotRootProductId,
        allocationPercent: parseProjectsNumberInput(row.allocationPercent) ?? 0,
        amortizationQuantity: parseProjectsNumberInput(row.amortizationQuantity) ?? 0,
      }))
      .filter((row) => row.allocationPercent > 0);

    await onSubmit({
      sourceType,
      sourceId,
      passThroughPercent: passThroughPct,
      allocations,
    });
  };

  if (!open) return null;

  return (
    <ProjectModalShell
      onClose={onClose}
      title={`Configurar amortização — ${description}`}
      size="xl"
      footer={
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            <span className="mr-4">Soma distribuída: {formatPercent(distributionTotal)}</span>
            <span className="mr-4">
              Saldo pendente: {formatPercent(computed.distributionBalancePercent)}
            </span>
            <span className="mr-4">Valor distribuído: {formatMoney(computed.allocatedAmountTotal)}</span>
            <span>Valor não distribuído: {formatMoney(computed.unallocatedAmount)}</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              Cancelar
            </button>
            {!readOnly ? (
              <button
                type="button"
                disabled={!canSave || saving}
                onClick={() => void handleSubmit()}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Salvar amortização
              </button>
            ) : null}
          </div>
        </div>
      }
    >
      <div className="min-w-[1000px] space-y-6">
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
          <p>
            <span className="text-muted-foreground">Custo total:</span>{" "}
            <strong>{formatMoney(totalCost)}</strong>
          </p>
          <p className="mt-1">
            <span className="text-muted-foreground">Status:</span>{" "}
            <strong>{amortizationStatusLabel(computed.status)}</strong>
          </p>
        </div>

        {error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-3">
          <label className="block text-sm">
            <span className="text-muted-foreground">Percentual repassado ao cliente (%)</span>
            <input
              type="text"
              inputMode="decimal"
              disabled={readOnly}
              value={passThroughPercent}
              onChange={(e) => setPassThroughPercent(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
            />
          </label>
          <div className="text-sm">
            <p className="text-muted-foreground">Valor repassado ao cliente</p>
            <p className="mt-1 text-lg font-semibold">{formatMoney(passThroughAmount)}</p>
          </div>
          <div className="text-sm">
            <p className="text-muted-foreground">Valor absorvido internamente</p>
            <p className="mt-1 text-lg font-semibold">{formatMoney(absorbedAmount)}</p>
          </div>
        </div>

        {targets.length === 0 ? (
          <p className="text-sm text-amber-700">
            Este projeto não possui itens elegíveis para receber amortização.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2">Item do projeto</th>
                  <th className="px-3 py-2">Custo base unitário</th>
                  <th className="px-3 py-2">% da amortização</th>
                  <th className="px-3 py-2">Valor alocado</th>
                  <th className="px-3 py-2">Qtd. base amortização</th>
                  <th className="px-3 py-2">Custo unit. amortizado</th>
                  <th className="px-3 py-2">Custo final unitário</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const pct = parseProjectsNumberInput(row.allocationPercent) ?? 0;
                  const qty = parseProjectsNumberInput(row.amortizationQuantity) ?? 0;
                  const alloc = calculateAmortizationAllocation(
                    passThroughAmount,
                    pct,
                    qty,
                    row.baseUnitCost
                  );
                  const rowStatus =
                    pct > 0 && qty <= 0
                      ? "Quantidade pendente"
                      : pct > 0
                        ? "OK"
                        : "—";
                  return (
                    <tr key={row.targetItemId} className="border-b border-border/60">
                      <td className="px-3 py-2">{row.displayName}</td>
                      <td className="px-3 py-2">{formatMoney(row.baseUnitCost)}</td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={readOnly}
                          value={row.allocationPercent}
                          onChange={(e) =>
                            updateRow(row.targetItemId, { allocationPercent: e.target.value })
                          }
                          className="w-20 rounded border border-border bg-background px-2 py-1"
                        />
                      </td>
                      <td className="px-3 py-2">{formatMoney(alloc.allocatedAmount)}</td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={readOnly}
                          value={row.amortizationQuantity}
                          onChange={(e) =>
                            updateRow(row.targetItemId, { amortizationQuantity: e.target.value })
                          }
                          className="w-24 rounded border border-border bg-background px-2 py-1"
                        />
                      </td>
                      <td className="px-3 py-2">{formatMoney(alloc.unitAmortizedCost)}</td>
                      <td className="px-3 py-2">{formatMoney(alloc.finalUnitCost)}</td>
                      <td className="px-3 py-2">{rowStatus}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {distributionTotal > 100.0001 ? (
          <p className="text-sm text-destructive">Distribuição excede 100% — ajuste antes de salvar.</p>
        ) : null}
      </div>
    </ProjectModalShell>
  );
}
