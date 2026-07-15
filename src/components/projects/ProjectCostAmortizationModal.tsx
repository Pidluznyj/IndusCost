import React, { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { ProjectModalShell } from "@/src/components/projects/ProjectModalShell";
import {
  amortizationApplicationModeLabel,
  amortizationStatusLabel,
  calculateAmortizationAllocation,
  calculatePassThroughAmounts,
  computeAmortizationConfig,
  type ProjectAmortizationApplicationMode,
  type ProjectAmortizationTarget,
  type ProjectCostAmortizationSourceType,
} from "@/src/lib/projectsCostAmortization";
import { formatProjectsNumberInput, parseProjectsNumberInput } from "@/src/lib/projectsUiUtils";

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
    amortizationApplicationMode: ProjectAmortizationApplicationMode;
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
  applicationMode: ProjectAmortizationApplicationMode;
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
    applicationMode?: ProjectAmortizationApplicationMode;
    amortizationApplicationMode?: ProjectAmortizationApplicationMode;
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
  const [passThroughPercent, setPassThroughPercent] = useState(
    formatProjectsNumberInput(initialPassThroughPercent) || "0"
  );
  const [rows, setRows] = useState<AllocationDraft[]>([]);

  useEffect(() => {
    if (!open) return;
    setPassThroughPercent(formatProjectsNumberInput(initialPassThroughPercent) || "0");
    const byTarget = new Map((initialAllocations ?? []).map((a) => [a.targetItemId, a]));
    setRows(
      targets.map((target) => {
        const saved = byTarget.get(target.targetItemId);
        const mode =
          saved?.amortizationApplicationMode ?? saved?.applicationMode ?? ("COST" as const);
        return {
          targetItemId: target.targetItemId,
          targetItemType: target.targetItemType,
          targetSnapshotRootProductId: target.snapshotRootProductId ?? null,
          displayName: target.displayName,
          baseUnitCost: target.baseUnitCost,
          allocationPercent: saved
            ? formatProjectsNumberInput(saved.allocationPercent) || "0"
            : "0",
          amortizationQuantity: saved
            ? formatProjectsNumberInput(saved.amortizationQuantity) || "0"
            : formatProjectsNumberInput(target.suggestedQuantity) || "1",
          applicationMode: mode,
        };
      })
    );
    // Só reinicializa ao abrir o modal — evita resetar edições de qtde/% enquanto digita.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open-only hydrate
  }, [open]);

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
      applicationMode: row.applicationMode,
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

  const allocatedToCost = useMemo(
    () =>
      computed.allocations
        .filter((a) => a.applicationMode === "COST")
        .reduce((acc, a) => acc + a.allocatedAmount, 0),
    [computed.allocations]
  );
  const allocatedToFinalPrice = useMemo(
    () =>
      computed.allocations
        .filter((a) => a.applicationMode === "FINAL_PRICE")
        .reduce((acc, a) => acc + a.allocatedAmount, 0),
    [computed.allocations]
  );

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
        amortizationApplicationMode: row.applicationMode,
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
      size="full"
      footer={
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>Soma distribuída: {formatPercent(distributionTotal)}</span>
            <span>Valor distribuído no custo: {formatMoney(allocatedToCost)}</span>
            <span>Valor distribuído no preço final: {formatMoney(allocatedToFinalPrice)}</span>
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
      <div className="space-y-6">
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

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
            <p className="text-muted-foreground">Valor repassado via custo</p>
            <p className="mt-1 text-lg font-semibold">{formatMoney(allocatedToCost)}</p>
          </div>
          <div className="text-sm">
            <p className="text-muted-foreground">Valor repassado via preço final</p>
            <p className="mt-1 text-lg font-semibold">{formatMoney(allocatedToFinalPrice)}</p>
          </div>
          <div className="text-sm">
            <p className="text-muted-foreground">Valor absorvido internamente</p>
            <p className="mt-1 text-lg font-semibold">{formatMoney(absorbedAmount)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Total a distribuir: {formatMoney(passThroughAmount)}
            </p>
          </div>
        </div>

        {targets.length === 0 ? (
          <p className="text-sm text-amber-700">
            Este projeto não possui itens elegíveis para receber amortização.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[1480px] border-collapse text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  <th className="whitespace-nowrap px-3 py-2">Item do projeto</th>
                  <th className="whitespace-nowrap px-3 py-2">Custo base unit.</th>
                  <th className="whitespace-nowrap px-3 py-2">% amort.</th>
                  <th className="whitespace-nowrap px-3 py-2">Valor alocado</th>
                  <th className="whitespace-nowrap px-3 py-2">Qtd. base</th>
                  <th className="whitespace-nowrap px-3 py-2">Aplicar em</th>
                  <th className="whitespace-nowrap px-3 py-2">Amort. unitária</th>
                  <th className="whitespace-nowrap px-3 py-2">No custo</th>
                  <th className="whitespace-nowrap px-3 py-2">No preço</th>
                  <th className="whitespace-nowrap px-3 py-2">Custo final unit.</th>
                  <th className="whitespace-nowrap px-3 py-2">Status</th>
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
                    row.baseUnitCost,
                    row.applicationMode
                  );
                  const rowStatus =
                    pct > 0 && qty <= 0
                      ? "Qtd. pendente"
                      : pct > 0
                        ? "OK"
                        : "—";
                  return (
                    <tr key={row.targetItemId} className="border-b border-border/60">
                      <td className="whitespace-nowrap px-3 py-2 font-medium">{row.displayName}</td>
                      <td className="whitespace-nowrap px-3 py-2">{formatMoney(row.baseUnitCost)}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={readOnly}
                          value={row.allocationPercent}
                          onChange={(e) =>
                            updateRow(row.targetItemId, { allocationPercent: e.target.value })
                          }
                          className="w-16 rounded border border-border bg-background px-2 py-1"
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">{formatMoney(alloc.allocatedAmount)}</td>
                      <td className="whitespace-nowrap px-3 py-2">
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
                      <td className="whitespace-nowrap px-3 py-2">
                        <select
                          disabled={readOnly}
                          value={row.applicationMode}
                          title={
                            row.applicationMode === "FINAL_PRICE"
                              ? "A amortização é somada ao preço final como repasse de investimento, sem compor a margem do produto."
                              : "A amortização compõe o custo e pode receber margem na formação de preço."
                          }
                          onChange={(e) =>
                            updateRow(row.targetItemId, {
                              applicationMode: e.target.value as ProjectAmortizationApplicationMode,
                            })
                          }
                          className="rounded border border-border bg-background px-2 py-1"
                        >
                          <option value="COST">Custo do item</option>
                          <option value="FINAL_PRICE">Preço final</option>
                        </select>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">{formatMoney(alloc.unitAmortizedCost)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{formatMoney(alloc.costComponentUnit)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{formatMoney(alloc.priceAddOnUnit)}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {formatMoney(alloc.finalUnitCost)}
                        {row.applicationMode === "FINAL_PRICE" && alloc.priceAddOnUnit > 0 ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (+ {formatMoney(alloc.priceAddOnUnit)} no preço)
                          </span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">{rowStatus}</td>
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

        <p className="text-xs text-muted-foreground">
          {amortizationApplicationModeLabel("COST")}: amortização compõe o custo e pode receber
          margem. {amortizationApplicationModeLabel("FINAL_PRICE")}: amortização é repasse no preço
          final, sem compor margem do produto.
        </p>
      </div>
    </ProjectModalShell>
  );
}
