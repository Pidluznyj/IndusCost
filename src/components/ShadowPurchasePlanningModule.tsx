/**
 * UI — Planejamento de compra em modo sombra (OP-25).
 * Somente sugestão; rascunho de SC exige ação humana explícita.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ClipboardList,
  Loader2,
  Package,
  ShoppingCart,
  Sparkles,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess";
import { fetchSupplyChainFeatureStatus } from "@/src/lib/supply-chain/supplyChainClient";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";

type ShadowMaterial = {
  materialId: string;
  materialCode: string;
  materialDescription: string;
  unit: string;
  futureDemand: number;
  safetyStock: number;
  availableStock: number;
  onTimeConfirmedQty: number;
  netNeed: number;
  suggestedOrderQty: number;
  formula: {
    expression: string;
    futureDemand: number;
    safetyStock: number;
    availableStock: number;
    onTimeConfirmedPurchases: number;
    netNeed: number;
  };
  explainability: {
    demandSources: Array<{
      productionOrderId: string;
      productionOrderExternalId: number | null;
      productSku: string | null;
      productQty: number;
      bomQtyPerProduct: number;
      materialDemand: number;
    }>;
    onTimeConfirmedPurchases: Array<{
      purchaseOrderCode: string;
      status: string;
      expectedDeliveryDate: string | null;
      quantityRemaining: number;
    }>;
    excludedInbound: Array<{
      purchaseOrderCode: string;
      status: string;
      expectedDeliveryDate: string | null;
      quantityRemaining: number;
      exclusionReason: string;
    }>;
    notes: string[];
  };
};

type PlanPayload = {
  horizon: { from: string; to: string };
  materials: ShadowMaterial[];
  totals: {
    materialsWithNeed: number;
    totalNetNeedLines: number;
    openProductionOrdersConsidered: number;
    excludedInboundCount: number;
  };
  meta: {
    readOnly: boolean;
    createsPurchaseRequestAutomatically: boolean;
  };
};

type CostCenterRow = { id: string; code: string; name: string; isActive: boolean };

function qty(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

export function ShadowPurchasePlanningModule() {
  const auth = useAuth();
  const permissions = usePermissions();
  const canView =
    auth.hasPermission("purchases.view") ||
    permissions.canViewResource(OPERATIONS_RESOURCE_KEYS.purchases);
  const canCreate =
    auth.hasPermission("purchases.create") ||
    permissions.canPerformAction(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.create);

  const [flagEnabled, setFlagEnabled] = useState<boolean | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanPayload | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [draftMaterial, setDraftMaterial] = useState<ShadowMaterial | null>(null);
  const [costCenters, setCostCenters] = useState<CostCenterRow[]>([]);
  const [draftForm, setDraftForm] = useState({
    requester: "",
    department: "",
    justification: "",
    defaultCostCenterId: "",
    quantity: "",
  });
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftMsg, setDraftMsg] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchSupplyChainFeatureStatus(controller.signal)
      .then((s) => {
        if (!controller.signal.aborted) setFlagEnabled(s.enabled.shadowPlanning === true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFlagEnabled(false);
      });
    return () => controller.abort();
  }, []);

  const loadPlan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (from.trim()) qs.set("from", from.trim());
      if (to.trim()) qs.set("to", to.trim());
      const q = qs.toString();
      const data = await fetchJsonOk<PlanPayload>(
        `/api/shadow-purchase-planning${q ? `?${q}` : ""}`
      );
      setPlan(data);
      if (!from && data.horizon.from) setFrom(data.horizon.from);
      if (!to && data.horizon.to) setTo(data.horizon.to);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar planejamento sombra.");
      setPlan(null);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    if (flagEnabled !== true || !canView) return;
    void loadPlan();
    // carga inicial uma vez quando flag/view ok
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flagEnabled, canView]);

  const openDraft = async (row: ShadowMaterial) => {
    setDraftMsg(null);
    setDraftMaterial(row);
    setDraftForm({
      requester: auth.authUser?.name ?? auth.authUser?.email ?? "",
      department: "",
      justification: `Sugestão do planejamento sombra para ${row.materialCode} (necessidade líquida ${qty(row.netNeed)} ${row.unit}).`,
      defaultCostCenterId: "",
      quantity: String(row.suggestedOrderQty),
    });
    try {
      const data = await fetchJsonOk<{ rows: CostCenterRow[] }>(
        "/api/purchase-requests/official-refs/cost-centers"
      );
      setCostCenters((data.rows ?? []).filter((c) => c.isActive));
    } catch {
      setCostCenters([]);
    }
  };

  const submitDraft = async () => {
    if (!draftMaterial) return;
    if (
      !window.confirm(
        "Confirma criar um RASCUNHO de solicitação de compra a partir desta sugestão? Nenhuma compra será enviada automaticamente."
      )
    ) {
      return;
    }
    setDraftBusy(true);
    setDraftMsg(null);
    try {
      const result = await fetchJsonOk<{
        purchaseRequest: { id: string; number: number };
      }>("/api/shadow-purchase-planning/create-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmHumanAction: true,
          materialId: draftMaterial.materialId,
          quantity: Number(draftForm.quantity),
          unit: draftMaterial.unit,
          description: `${draftMaterial.materialCode} — ${draftMaterial.materialDescription}`,
          requester: draftForm.requester,
          department: draftForm.department,
          justification: draftForm.justification,
          defaultCostCenterId: draftForm.defaultCostCenterId,
        }),
      });
      setDraftMsg(
        `Rascunho SC #${result.purchaseRequest.number} criado. Status: RASCUNHO.`
      );
      setDraftMaterial(null);
    } catch (e) {
      setDraftMsg(e instanceof Error ? e.message : "Falha ao criar rascunho.");
    } finally {
      setDraftBusy(false);
    }
  };

  if (permissions.authLoading || flagEnabled === null) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Carregando planejamento sombra…
      </div>
    );
  }

  if (!flagEnabled) {
    return (
      <div
        className="rounded-lg border border-amber-200 bg-amber-50 p-6 space-y-2"
        data-testid="shadow-planning-disabled"
      >
        <h2 className="text-lg font-semibold text-amber-950">Planejamento sombra</h2>
        <p className="text-sm text-amber-900">
          Feature flag <code>SUPPLY_CHAIN_SHADOW_PLANNING_ENABLED</code> está desligada (padrão).
        </p>
        <Link className="text-sm font-medium underline text-amber-950" to="/purchases/workstation">
          Voltar à estação de compras
        </Link>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-6">
        <p className="text-sm text-rose-900">Sem permissão para visualizar compras.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="shadow-purchase-planning">
      <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 space-y-2">
        <div className="flex items-start gap-2">
          <Sparkles className="h-5 w-5 text-sky-700 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-sky-950">Modo sombra — somente sugestão</h3>
            <p className="text-sm text-sky-900 mt-1">
              Lê BOM, produtos, OPs, estoque disponível, estoque de segurança e pedidos confirmados no
              prazo. Não altera BOM, não cria OP, não atualiza custo e não cria solicitação
              automaticamente. Compras atrasadas ou sem confirmação/data não reduzem a necessidade.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm space-y-1">
          <span className="text-muted-foreground">De</span>
          <input
            type="date"
            className="block rounded-md border border-border px-2 py-1.5 text-sm"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-sm space-y-1">
          <span className="text-muted-foreground">Até</span>
          <input
            type="date"
            className="block rounded-md border border-border px-2 py-1.5 text-sm"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm disabled:opacity-50"
          onClick={() => void loadPlan()}
          disabled={loading}
        >
          {loading ? "Calculando…" : "Recalcular"}
        </button>
        <Link
          to="/purchases/workstation"
          className="text-sm px-3 py-2 rounded-lg border border-border hover:bg-accent"
        >
          Estação de compras
        </Link>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 flex gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          {error}
        </div>
      ) : null}

      {draftMsg ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {draftMsg}{" "}
          <Link className="underline font-medium" to="/purchases">
            Abrir solicitações
          </Link>
        </div>
      ) : null}

      <SummaryKpiGrid minColumnWidth={140} className={SYSTEM_TOTALIZER_GRID_CLASS}>
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="shadow-kpi-need"
          label="Materiais com necessidade"
          amount={plan?.totals.materialsWithNeed}
          amountFormat="number"
          tone="warning"
          icon={Package}
          loading={loading}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="shadow-kpi-ops"
          label="OPs consideradas"
          amount={plan?.totals.openProductionOrdersConsidered}
          amountFormat="number"
          tone="info"
          icon={ClipboardList}
          loading={loading}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="shadow-kpi-excluded"
          label="Compras excluídas (não seguras)"
          amount={plan?.totals.excludedInboundCount}
          amountFormat="number"
          tone="neutral"
          icon={ShoppingCart}
          loading={loading}
        />
      </SummaryKpiGrid>

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Material</th>
              <th className="px-3 py-2 font-medium text-right">Demanda</th>
              <th className="px-3 py-2 font-medium text-right">Segurança</th>
              <th className="px-3 py-2 font-medium text-right">Disponível</th>
              <th className="px-3 py-2 font-medium text-right">PC no prazo</th>
              <th className="px-3 py-2 font-medium text-right">Necessidade</th>
              <th className="px-3 py-2 font-medium">Ação</th>
            </tr>
          </thead>
          <tbody>
            {loading && !plan ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
                  Calculando sugestões…
                </td>
              </tr>
            ) : null}
            {(plan?.materials ?? []).map((row) => (
              <React.Fragment key={row.materialId}>
                <tr className="border-t border-border">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="text-left hover:underline"
                      onClick={() =>
                        setExpandedId((id) => (id === row.materialId ? null : row.materialId))
                      }
                    >
                      <div className="font-medium">{row.materialCode}</div>
                      <div className="text-xs text-muted-foreground">{row.materialDescription}</div>
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(row.futureDemand)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(row.safetyStock)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(row.availableStock)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(row.onTimeConfirmedQty)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">
                    {qty(row.netNeed)} {row.unit}
                  </td>
                  <td className="px-3 py-2">
                    {canCreate && row.netNeed > 0 ? (
                      <button
                        type="button"
                        className="text-xs px-2 py-1 rounded border border-border hover:bg-accent"
                        onClick={() => void openDraft(row)}
                      >
                        Criar rascunho SC
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
                {expandedId === row.materialId ? (
                  <tr className="bg-muted/30 border-t border-border">
                    <td colSpan={7} className="px-3 py-3 text-xs space-y-2">
                      <p>
                        <span className="font-medium">Fórmula:</span> {row.formula.expression}
                      </p>
                      <p className="tabular-nums">
                        max(0, {qty(row.formula.futureDemand)} + {qty(row.formula.safetyStock)} −{" "}
                        {qty(row.formula.availableStock)} −{" "}
                        {qty(row.formula.onTimeConfirmedPurchases)}) = {qty(row.formula.netNeed)}
                      </p>
                      {row.explainability.notes.map((n) => (
                        <p key={n} className="text-muted-foreground">
                          • {n}
                        </p>
                      ))}
                      {row.explainability.excludedInbound.length > 0 ? (
                        <div>
                          <p className="font-medium">Excluídas da disponibilidade segura:</p>
                          <ul className="list-disc pl-4">
                            {row.explainability.excludedInbound.map((ex) => (
                              <li key={ex.purchaseOrderCode + ex.exclusionReason}>
                                {ex.purchaseOrderCode} ({ex.status}, prev.{" "}
                                {ex.expectedDeliveryDate ?? "sem data"}): {ex.exclusionReason}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {row.explainability.demandSources.length > 0 ? (
                        <div>
                          <p className="font-medium">Fontes de demanda (OP × BOM):</p>
                          <ul className="list-disc pl-4">
                            {row.explainability.demandSources.slice(0, 12).map((d) => (
                              <li key={`${d.productionOrderId}-${d.materialDemand}`}>
                                OP {d.productionOrderExternalId ?? d.productionOrderId.slice(0, 8)} ·
                                SKU {d.productSku ?? "—"} · {qty(d.productQty)} ×{" "}
                                {qty(d.bomQtyPerProduct)} = {qty(d.materialDemand)}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            ))}
            {plan && plan.materials.length === 0 && !loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhuma demanda material no horizonte.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {draftMaterial ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          data-testid="shadow-draft-dialog"
        >
          <div className="w-full max-w-lg rounded-lg border border-border bg-white p-5 space-y-3 shadow-lg">
            <h3 className="text-base font-semibold">Criar rascunho de solicitação</h3>
            <p className="text-sm text-muted-foreground">
              Ação humana explícita. O planejamento não cria solicitação sozinho. Status inicial:
              RASCUNHO.
            </p>
            <p className="text-sm">
              <span className="font-medium">{draftMaterial.materialCode}</span> —{" "}
              {draftMaterial.materialDescription}
            </p>
            <label className="block text-sm space-y-1">
              <span>Quantidade</span>
              <input
                className="w-full rounded-md border border-border px-2 py-1.5"
                value={draftForm.quantity}
                onChange={(e) => setDraftForm((f) => ({ ...f, quantity: e.target.value }))}
              />
            </label>
            <label className="block text-sm space-y-1">
              <span>Solicitante</span>
              <input
                className="w-full rounded-md border border-border px-2 py-1.5"
                value={draftForm.requester}
                onChange={(e) => setDraftForm((f) => ({ ...f, requester: e.target.value }))}
              />
            </label>
            <label className="block text-sm space-y-1">
              <span>Departamento</span>
              <input
                className="w-full rounded-md border border-border px-2 py-1.5"
                value={draftForm.department}
                onChange={(e) => setDraftForm((f) => ({ ...f, department: e.target.value }))}
              />
            </label>
            <label className="block text-sm space-y-1">
              <span>Justificativa</span>
              <textarea
                className="w-full rounded-md border border-border px-2 py-1.5 min-h-[72px]"
                value={draftForm.justification}
                onChange={(e) => setDraftForm((f) => ({ ...f, justification: e.target.value }))}
              />
            </label>
            <label className="block text-sm space-y-1">
              <span>Centro de custo</span>
              <select
                className="w-full rounded-md border border-border px-2 py-1.5"
                value={draftForm.defaultCostCenterId}
                onChange={(e) =>
                  setDraftForm((f) => ({ ...f, defaultCostCenterId: e.target.value }))
                }
              >
                <option value="">Selecione…</option>
                {costCenters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="rounded-lg border border-border px-3 py-2 text-sm"
                onClick={() => setDraftMaterial(null)}
                disabled={draftBusy}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm disabled:opacity-50"
                onClick={() => void submitDraft()}
                disabled={
                  draftBusy ||
                  !draftForm.requester.trim() ||
                  !draftForm.department.trim() ||
                  !draftForm.justification.trim() ||
                  !draftForm.defaultCostCenterId
                }
              >
                {draftBusy ? "Criando…" : "Confirmar rascunho"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
