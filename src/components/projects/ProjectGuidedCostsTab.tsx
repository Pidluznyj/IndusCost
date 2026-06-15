import React, { useMemo, useState } from "react";
import { AlertTriangle, Settings2 } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { ProjectCostAmortizationModal } from "@/src/components/projects/ProjectCostAmortizationModal";
import { ProjectExecutiveReportButton } from "@/src/components/projects/ProjectExecutiveReportButton";
import { ProjectPricingSection } from "@/src/components/projects/ProjectPricingSection";
import { buildProjectStructureSnapshotGroups } from "@/src/lib/projectsStructureSnapshotGroups";
import { computeProjectGuidedCosts } from "@/src/lib/projectsGuidedFlow";
import {
  amortizationStatusLabel,
  buildProjectAmortizationTargets,
  buildProjectCostAmortizationSummary,
  listAmortizableCostSources,
  type ProjectCostAmortizationRow,
  type ProjectCostAmortizationSourceType,
} from "@/src/lib/projectsCostAmortization";
import type { ProjectDetail } from "@/src/types/projects";

function formatMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

type AmortizationModalState = {
  sourceType: ProjectCostAmortizationSourceType;
  sourceId: string;
  sourceBatchId?: string | null;
  description: string;
  totalCost: number;
  passThroughPercent: number;
  allocations: Array<{
    targetItemId: string;
    targetItemType: string;
    targetSnapshotRootProductId?: string | null;
    allocationPercent: number;
    amortizationQuantity: number;
  }>;
};

type Props = {
  detail: ProjectDetail;
  projectId: string;
  canManage?: boolean;
  onDetailRefresh: (detail: ProjectDetail) => void;
};

async function fetchJsonOk<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "Falha na requisição.");
  }
  return data as T;
}

export function ProjectGuidedCostsTab({
  detail,
  projectId,
  canManage = false,
  onDetailRefresh,
}: Props) {
  const guided = computeProjectGuidedCosts(detail);
  const cost = detail.costBreakdown;
  const { snapshotGroups } = buildProjectStructureSnapshotGroups(detail.structureLines, {
    simulatedProducts: detail.simulatedProducts,
  });

  const summary =
    detail.costAmortizationSummary ??
    buildProjectCostAmortizationSummary(
      detail,
      (detail.costAmortizations ?? []) as ProjectCostAmortizationRow[]
    );
  const sources = listAmortizableCostSources(detail);
  const targets = useMemo(() => buildProjectAmortizationTargets(detail), [detail]);

  const [modal, setModal] = useState<AmortizationModalState | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const savedBySource = useMemo(() => {
    const map = new Map<string, (typeof summary.amortizations)[number]>();
    for (const row of summary.amortizations) {
      map.set(`${row.sourceType}:${row.sourceId}`, row);
    }
    return map;
  }, [summary.amortizations]);

  const openConfigure = (sourceType: ProjectCostAmortizationSourceType, sourceId: string) => {
    const source = sources.find((s) => s.sourceType === sourceType && s.sourceId === sourceId);
    if (!source) return;
    const saved = savedBySource.get(`${sourceType}:${sourceId}`);
    const savedRow = detail.costAmortizations?.find(
      (a) => a.sourceType === sourceType && a.sourceId === sourceId
    );
    setModalError(null);
    setModal({
      sourceType,
      sourceId,
      sourceBatchId: source.sourceBatchId ?? null,
      description: source.description,
      totalCost: source.totalCost,
      passThroughPercent: saved?.passThroughPercent ?? savedRow?.passThroughPercent ?? 100,
      allocations:
        savedRow?.allocations.map((a) => ({
          targetItemId: a.targetItemId,
          targetItemType: a.targetItemType,
          targetSnapshotRootProductId: a.targetSnapshotRootProductId,
          allocationPercent: a.allocationPercent,
          amortizationQuantity: a.amortizationQuantity,
        })) ?? [],
    });
  };

  const handleSaveAmortization = async (payload: {
    sourceType: ProjectCostAmortizationSourceType;
    sourceId: string;
    sourceBatchId?: string | null;
    passThroughPercent: number;
    allocations: AmortizationModalState["allocations"];
  }) => {
    setSaving(true);
    setModalError(null);
    try {
      const result = await fetchJsonOk<{ project: ProjectDetail }>(
        `/api/projects/${projectId}/cost-amortizations`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            sourceBatchId: payload.sourceBatchId ?? modal?.sourceBatchId ?? null,
          }),
        }
      );
      onDetailRefresh(result.project);
      setModal(null);
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : "Erro ao salvar amortização.");
    } finally {
      setSaving(false);
    }
  };

  const allAlerts = [...summary.alerts, ...detail.alerts.map((a) => a.message)];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="text-lg font-semibold">Custos do Projeto</h4>
          <p className="mt-1 text-sm text-muted-foreground">
            Resumo financeiro, investimentos em moldes/outros custos e amortização repassada aos itens.
          </p>
        </div>
        <ProjectExecutiveReportButton projectId={projectId} />
      </div>

      <div>
        <h5 className="mb-3 font-medium">Resumo executivo</h5>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard
            label="Custo base dos itens"
            value={formatMoney(summary.baseItemsUnitCost)}
            hint="Soma unitária antes da amortização"
          />
          <StatCard label="Total de moldes" value={formatMoney(summary.totalMoldsCost)} />
          <StatCard label="Total de outros custos" value={formatMoney(summary.totalOtherCosts)} />
          <StatCard
            label="Valor repassado via amortização"
            value={formatMoney(summary.totalPassThroughAmount)}
          />
          <StatCard
            label="Valor absorvido internamente"
            value={formatMoney(summary.totalAbsorbedAmount)}
          />
          <StatCard
            label="Custo final dos itens"
            value={formatMoney(summary.finalItemsUnitCostWithAmortization)}
            hint="Base + amortização unitária alocada"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Custo unitário estimado (legado)"
          value={formatMoney(guided.estimatedUnitCost)}
          hint="Visão anterior do fluxo guiado"
        />
        <StatCard label="Investimento inicial" value={formatMoney(guided.initialInvestment)} />
        <StatCard label="Outros custos do projeto" value={formatMoney(guided.otherProjectCosts)} />
        <StatCard label="Custo total do projeto" value={formatMoney(guided.totalProjectCost)} />
      </div>

      <div>
        <h5 className="mb-3 font-medium">Custos amortizáveis</h5>
        {sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Cadastre moldes ou outros custos nos itens do projeto para configurar amortização.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Descrição</th>
                  <th className="px-3 py-2">Custo total</th>
                  <th className="px-3 py-2">% repassado</th>
                  <th className="px-3 py-2">Valor repassado</th>
                  <th className="px-3 py-2">Valor absorvido</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Ações</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((source) => {
                  const amort = savedBySource.get(`${source.sourceType}:${source.sourceId}`);
                  return (
                    <tr key={`${source.sourceType}-${source.sourceId}`} className="border-b border-border/60">
                      <td className="px-3 py-2">
                        {source.sourceType === "MOLD" ? "Molde" : "Outro custo"}
                      </td>
                      <td className="px-3 py-2">{source.description}</td>
                      <td className="px-3 py-2">{formatMoney(source.totalCost)}</td>
                      <td className="px-3 py-2">{formatPercent(amort?.passThroughPercent ?? 100)}</td>
                      <td className="px-3 py-2">{formatMoney(amort?.passThroughAmount ?? source.totalCost)}</td>
                      <td className="px-3 py-2">{formatMoney(amort?.absorbedAmount ?? 0)}</td>
                      <td className="px-3 py-2">
                        {amortizationStatusLabel(
                          (amort?.status ?? "NOT_CONFIGURED") as Parameters<
                            typeof amortizationStatusLabel
                          >[0]
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => openConfigure(source.sourceType, source.sourceId)}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                        >
                          <Settings2 className="h-3.5 w-3.5" />
                          {canManage ? "Configurar amortização" : "Ver amortização"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {summary.itemRollups.some((r) => r.unitAmortizedCost > 0) ? (
        <div>
          <h5 className="mb-3 font-medium">Distribuição por item</h5>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Custo base unitário</th>
                  <th className="px-3 py-2">Amortização unitária</th>
                  <th className="px-3 py-2">Custo final unitário</th>
                  <th className="px-3 py-2">Total alocado</th>
                  <th className="px-3 py-2">Fontes</th>
                </tr>
              </thead>
              <tbody>
                {summary.itemRollups
                  .filter((r) => r.unitAmortizedCost > 0 || r.totalAllocated > 0)
                  .map((row) => (
                    <tr key={row.targetItemId} className="border-b border-border/60">
                      <td className="px-3 py-2">{row.displayName}</td>
                      <td className="px-3 py-2">{formatMoney(row.baseUnitCost)}</td>
                      <td className="px-3 py-2">{formatMoney(row.unitAmortizedCost)}</td>
                      <td className="px-3 py-2">{formatMoney(row.finalUnitCost)}</td>
                      <td className="px-3 py-2">{formatMoney(row.totalAllocated)}</td>
                      <td className="px-3 py-2">{row.sourceLabels.join(", ") || "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <ProjectPricingSection
        detail={detail}
        projectId={projectId}
        canManage={canManage}
        onDetailRefresh={onDetailRefresh}
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Custo MP (unitário)" value={formatMoney(cost.rawMaterialCost)} />
        <StatCard label="Custo componentes" value={formatMoney(cost.componentCost)} />
        <StatCard label="Custo processo / roteiro" value={formatMoney(cost.serviceCost)} />
        <StatCard label="Margem alvo" value={formatPercent(cost.targetMarginPercent)} />
        <StatCard label="Preço sugerido" value={formatMoney(cost.suggestedPrice)} />
        <StatCard label="Itens pendentes de custo" value={String(guided.pendingCount)} />
      </div>

      {snapshotGroups.length > 0 ? (
        <div className="space-y-3">
          <h5 className="font-medium">Comparativo — itens clonados</h5>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Custo original</th>
                  <th className="px-3 py-2">Custo simulado</th>
                  <th className="px-3 py-2">Diferença R$</th>
                  <th className="px-3 py-2">Variação %</th>
                </tr>
              </thead>
              <tbody>
                {snapshotGroups.map((g) => (
                  <tr key={g.groupKey} className="border-b border-border/60">
                    <td className="px-3 py-2">
                      {g.rootCode} — {g.rootDescription}
                    </td>
                    <td className="px-3 py-2">{formatMoney(g.officialCost)}</td>
                    <td className="px-3 py-2">{formatMoney(g.simulatedCost)}</td>
                    <td className="px-3 py-2">{formatMoney(g.differenceAmount)}</td>
                    <td className="px-3 py-2">{formatPercent(g.differencePercent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {allAlerts.length > 0 ? (
        <div className="space-y-2">
          <h5 className="font-medium">Alertas</h5>
          {allAlerts.map((message, index) => (
            <div
              key={`${message}-${index}`}
              className={cn(
                "flex items-start gap-2 rounded-lg px-3 py-2 text-sm",
                "bg-amber-50 text-amber-900"
              )}
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {message}
            </div>
          ))}
        </div>
      ) : null}

      {modal ? (
        <ProjectCostAmortizationModal
          open
          sourceType={modal.sourceType}
          sourceId={modal.sourceId}
          description={modal.description}
          totalCost={modal.totalCost}
          initialPassThroughPercent={modal.passThroughPercent}
          initialAllocations={modal.allocations}
          targets={targets}
          saving={saving}
          error={modalError}
          readOnly={!canManage}
          onClose={() => setModal(null)}
          onSubmit={handleSaveAmortization}
        />
      ) : null}
    </div>
  );
}
