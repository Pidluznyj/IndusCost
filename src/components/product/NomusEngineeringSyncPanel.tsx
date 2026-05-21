import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  RotateCw,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { useNomusMaintenanceWorkspaceSync } from "@/src/hooks/useNomusMaintenanceWorkspaceSync";
import type { NomusMaintenanceWorkspaceProps } from "@/src/lib/nomusMaintenanceWorkspaceTypes";
import type {
  EngineeringBomActionPlan,
  EngineeringSyncPlan,
} from "@/src/lib/nomusEngineeringReconciliationTypes";

const BOM_ACTION_LABEL: Record<EngineeringBomActionPlan["actionType"], string> = {
  CREATE_PRODUCT_BOM_LINE: "Criar linha",
  UPDATE_PRODUCT_BOM_LINE_QUANTITY: "Atualizar quantidade",
  UPDATE_PRODUCT_BOM_LINE_LOSS: "Atualizar perda",
  UPDATE_PRODUCT_BOM_LINE_COMPONENT: "Atualizar vínculo",
  REMOVE_PRODUCT_BOM_LINE_NOT_IN_NOMUS: "Remover (sem equivalente Nomus)",
  KEEP_PRODUCT_BOM_LINE: "Manter (igual ao Nomus)",
  KEEP_LOCAL_EXCEPTION: "Manter (exceção local)",
  BLOCK_AMBIGUOUS_COMPONENT: "Bloqueado (ambiguidade)",
  BLOCK_MISSING_COMPONENT: "Bloqueado (componente sem cadastro)",
  BLOCK_OPTIONAL_SELECTION_REQUIRED: "Bloqueado (opcional pendente)",
};

const BOM_ACTION_TONE: Record<EngineeringBomActionPlan["actionType"], string> = {
  CREATE_PRODUCT_BOM_LINE: "text-emerald-700 bg-emerald-50 border-emerald-200",
  UPDATE_PRODUCT_BOM_LINE_QUANTITY: "text-sky-700 bg-sky-50 border-sky-200",
  UPDATE_PRODUCT_BOM_LINE_LOSS: "text-sky-700 bg-sky-50 border-sky-200",
  UPDATE_PRODUCT_BOM_LINE_COMPONENT: "text-sky-700 bg-sky-50 border-sky-200",
  REMOVE_PRODUCT_BOM_LINE_NOT_IN_NOMUS: "text-amber-800 bg-amber-50 border-amber-200",
  KEEP_PRODUCT_BOM_LINE: "text-muted-foreground bg-muted/30 border-border",
  KEEP_LOCAL_EXCEPTION: "text-violet-800 bg-violet-50 border-violet-200",
  BLOCK_AMBIGUOUS_COMPONENT: "text-red-800 bg-red-50 border-red-200",
  BLOCK_MISSING_COMPONENT: "text-red-800 bg-red-50 border-red-200",
  BLOCK_OPTIONAL_SELECTION_REQUIRED: "text-red-800 bg-red-50 border-red-200",
};

type Props = NomusMaintenanceWorkspaceProps & {
  disabled?: boolean;
  onOpenProduct?: (productId: string, options?: { tab?: "cost" | "info" | "bom" }) => void;
  onApplySuccess?: () => void;
};

export const NomusEngineeringSyncPanel: React.FC<Props> = ({
  disabled = false,
  onOpenProduct,
  onApplySuccess,
  selectedParentCode,
  selectedParentDescription,
  selectedIndusProductId,
  onWorkspaceParentChange,
  refreshToken = 0,
}) => {
  const [parentCode, setParentCode] = useState(selectedParentCode ?? "");
  const [recursive, setRecursive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<EngineeringSyncPlan | null>(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [applyResult, setApplyResult] = useState<{
    runId: string;
    productsCreated: number;
    productsUpdated: number;
    bomLinesCreated: number;
    bomLinesUpdated: number;
    bomLinesRemoved: number;
    warnings: string[];
  } | null>(null);

  useNomusMaintenanceWorkspaceSync({
    selectedParentCode,
    selectedParentDescription,
    selectedIndusProductId,
    onWorkspaceParentChange,
    setLocalCode: setParentCode,
  });

  const workspaceFocused = Boolean(selectedParentCode?.trim());

  const loadPlan = useCallback(async () => {
    const code = parentCode.trim();
    if (!code) return;
    setLoading(true);
    setError(null);
    setApplyResult(null);
    try {
      const params = new URLSearchParams({
        scope: "ONE_PRODUCT",
        parentCode: code,
        recursive: recursive ? "true" : "false",
        maxDepth: "10",
      });
      const data = await fetchJsonOk<EngineeringSyncPlan>(
        `/api/nomus/engineering-sync/preview?${params.toString()}`
      );
      setPlan(data);
      setConfirmationText("");
    } catch (e) {
      setPlan(null);
      setError(e instanceof Error ? e.message : "Erro ao gerar plano.");
    } finally {
      setLoading(false);
    }
  }, [parentCode, recursive]);

  useEffect(() => {
    if (!workspaceFocused || !selectedParentCode?.trim()) return;
    void loadPlan();
  }, [workspaceFocused, selectedParentCode, refreshToken, loadPlan]);

  const handleApply = async () => {
    if (!plan?.canApply || !plan.planHash) return;
    setApplying(true);
    setError(null);
    try {
      const result = await fetchJsonOk<{
        runId: string;
        productsCreated: number;
        productsUpdated: number;
        bomLinesCreated: number;
        bomLinesUpdated: number;
        bomLinesRemoved: number;
        warnings: string[];
      }>("/api/nomus/engineering-sync/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: plan.scope,
          parentCode: plan.parentCodes[0],
          recursive,
          maxDepth: plan.maxDepth,
          planHash: plan.planHash,
          confirmationText,
          approvedBy: approvedBy.trim() || undefined,
        }),
      });
      setApplyResult(result);
      onApplySuccess?.();
      await loadPlan();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao aplicar sincronização.");
    } finally {
      setApplying(false);
    }
  };

  const groupedBom = useMemo(() => {
    if (!plan) return new Map<string, EngineeringBomActionPlan[]>();
    const map = new Map<string, EngineeringBomActionPlan[]>();
    for (const a of plan.bomActions) {
      const list = map.get(a.actionType) ?? [];
      list.push(a);
      map.set(a.actionType, list);
    }
    return map;
  }, [plan]);

  const indusProductId =
    plan?.productActions.find((p) => p.indusProductId)?.indusProductId ?? null;

  return (
    <div className="space-y-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[180px]">
          <label className="text-[10px] uppercase font-bold text-muted-foreground">
            Produto principal (parentCode)
          </label>
          <input
            type="text"
            value={parentCode}
            onChange={(e) => setParentCode(e.target.value)}
            placeholder="Ex.: 611.48AA"
            className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs"
            disabled={disabled}
          />
        </div>
        <label className="inline-flex items-center gap-2 text-xs h-9">
          <input
            type="checkbox"
            checked={recursive}
            onChange={(e) => setRecursive(e.target.checked)}
            className="rounded"
            disabled={disabled}
          />
          Recursivo
        </label>
        <button
          type="button"
          disabled={disabled || loading || !parentCode.trim()}
          onClick={() => void loadPlan()}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Gerar plano de sincronização
        </button>
      </div>

      {error ? (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      ) : null}

      {applyResult ? (
        <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-[12px] text-green-950">
          <p className="font-bold inline-flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" /> Engenharia atualizada com sucesso.
          </p>
          <p className="mt-1">
            {applyResult.productsCreated} produto(s) criado(s), {applyResult.productsUpdated}{" "}
            atualizado(s); {applyResult.bomLinesCreated} linha(s) BOM criada(s),{" "}
            {applyResult.bomLinesUpdated} atualizada(s), {applyResult.bomLinesRemoved} removida(s).
          </p>
          {indusProductId ? (
            <p className="mt-1">
              <button
                type="button"
                className="underline text-green-900 font-semibold"
                onClick={() => onOpenProduct?.(indusProductId, { tab: "cost" })}
              >
                Abrir Análise de Custo
              </button>
            </p>
          ) : null}
        </div>
      ) : null}

      {plan ? (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6 text-xs">
            <StatCard label="Criar produtos" value={plan.summary.productsToCreate} />
            <StatCard label="Atualizar produtos" value={plan.summary.productsToUpdate} />
            <StatCard label="BOM criar" value={plan.summary.bomLinesToCreate} />
            <StatCard label="BOM atualizar" value={plan.summary.bomLinesToUpdate} />
            <StatCard
              label="BOM remover"
              value={plan.summary.bomLinesToRemove}
              tone={plan.summary.bomLinesToRemove > 0 ? "warn" : "neutral"}
            />
            <StatCard
              label="Bloqueios"
              value={plan.summary.blockedItems}
              tone={plan.summary.blockedItems > 0 ? "danger" : "neutral"}
            />
          </div>

          {plan.blockingReasons.length > 0 ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-950">
              <p className="font-bold inline-flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> Aplicação bloqueada
              </p>
              <ul className="mt-1 list-disc list-inside">
                {plan.blockingReasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {plan.warnings.length > 0 ? (
            <ul className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 list-disc list-inside">
              {plan.warnings.slice(0, 10).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}

          {plan.productActions.length > 0 ? (
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs font-bold mb-2">Produto principal</p>
              {plan.productActions.map((p) => (
                <div key={p.parentCode} className="text-xs space-y-1">
                  <p>
                    <span className="font-semibold">{p.parentCode}</span> —{" "}
                    {p.parentDescription ?? "(sem descrição)"}
                  </p>
                  <p className="text-muted-foreground">
                    Ação: <span className="font-semibold">{p.actionType}</span> — {p.reason}
                  </p>
                  {p.fieldChanges.length > 0 ? (
                    <table className="w-full text-[11px] mt-1">
                      <thead className="text-muted-foreground">
                        <tr>
                          <th className="text-left">Campo</th>
                          <th className="text-left">Antes</th>
                          <th className="text-left">Depois</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.fieldChanges.map((f, i) => (
                          <tr key={i} className="border-t border-border/60">
                            <td className="py-0.5">{f.field}</td>
                            <td className="py-0.5 text-muted-foreground">{f.oldValue ?? "—"}</td>
                            <td className="py-0.5 font-medium">{f.newValue ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {plan.bomActions.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-bold">Plano de BOM ({plan.bomActions.length} entradas)</p>
              <div className="overflow-x-auto rounded-lg border border-border max-h-72">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-[10px] uppercase">
                    <tr>
                      <th className="text-left px-2 py-1">Ação</th>
                      <th className="text-left px-2 py-1">Componente</th>
                      <th className="text-right px-2 py-1">Qtd antes</th>
                      <th className="text-right px-2 py-1">Qtd depois</th>
                      <th className="text-left px-2 py-1">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.bomActions.map((b, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="px-2 py-1">
                          <span
                            className={cn(
                              "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                              BOM_ACTION_TONE[b.actionType]
                            )}
                          >
                            {BOM_ACTION_LABEL[b.actionType]}
                          </span>
                          {b.resolvedByRule ? (
                            <span className="ml-1 inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-900">
                              regra Material
                            </span>
                          ) : null}
                        </td>
                        <td className="px-2 py-1 font-medium">
                          {b.componentCode}
                          {b.componentDescription ? (
                            <span className="text-muted-foreground"> — {b.componentDescription}</span>
                          ) : null}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                          {b.oldQuantity ?? "—"}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums font-medium">
                          {b.newQuantity ?? "—"}
                        </td>
                        <td className="px-2 py-1 text-muted-foreground">{b.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {plan.pendingCostItems.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-950">
              <p className="font-bold">Pendências de custo ({plan.pendingCostItems.length})</p>
              <ul className="mt-1 list-disc list-inside">
                {plan.pendingCostItems.slice(0, 10).map((m, i) => (
                  <li key={i}>
                    {m.componentCode} — {m.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {plan.pendingRoutingItems.length > 0 ? (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11px]">
              <p className="font-bold">Pendências de roteiro/processo</p>
              <ul className="mt-1 list-disc list-inside text-muted-foreground">
                {plan.pendingRoutingItems.map((m, i) => (
                  <li key={i}>
                    {m.componentCode} — {m.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {plan.canApply ? (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
              <p className="text-xs font-bold inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" /> Confirmação para aplicar
              </p>
              <p className="text-[11px] text-muted-foreground">
                Digite exatamente:{" "}
                <span className="font-mono font-bold">{plan.confirmationRequiredText}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={confirmationText}
                  onChange={(e) => setConfirmationText(e.target.value)}
                  className="h-9 flex-1 min-w-[200px] rounded-lg border border-border bg-background px-3 text-xs font-mono"
                  placeholder={plan.confirmationRequiredText}
                />
                <input
                  type="text"
                  value={approvedBy}
                  onChange={(e) => setApprovedBy(e.target.value)}
                  className="h-9 w-44 rounded-lg border border-border bg-background px-3 text-xs"
                  placeholder="Aprovado por (opcional)"
                />
                <button
                  type="button"
                  disabled={
                    applying ||
                    !plan.canApply ||
                    confirmationText.trim() !== plan.confirmationRequiredText
                  }
                  onClick={() => void handleApply()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {applying ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCw className="h-3.5 w-3.5" />
                  )}
                  Aplicar atualização
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                A aplicação cria/atualiza Product e ProductBOM e marca como controlado pelo Nomus.
                Nenhum preço oficial é publicado. Propostas/pedidos não são alterados.
              </p>
            </div>
          ) : null}
        </div>
      ) : !loading ? (
        <p className="text-xs text-muted-foreground">
          Informe um parentCode e clique em "Gerar plano de sincronização".
        </p>
      ) : null}
    </div>
  );
};

const StatCard: React.FC<{
  label: string;
  value: number;
  tone?: "neutral" | "warn" | "danger";
}> = ({ label, value, tone = "neutral" }) => (
  <div
    className={cn(
      "rounded-lg border p-3",
      tone === "warn" && "border-amber-300 bg-amber-50",
      tone === "danger" && "border-red-300 bg-red-50",
      tone === "neutral" && "border-border"
    )}
  >
    <p className="text-[10px] uppercase text-muted-foreground font-semibold">{label}</p>
    <p
      className={cn(
        "font-bold mt-1 text-base tabular-nums",
        tone === "warn" && "text-amber-800",
        tone === "danger" && "text-red-800"
      )}
    >
      {value}
    </p>
  </div>
);
