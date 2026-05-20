import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Download,
  ExternalLink,
  Loader2,
  PackagePlus,
  Search,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { useNomusMaintenanceWorkspaceSync } from "@/src/hooks/useNomusMaintenanceWorkspaceSync";
import { NomusMaintenanceProductBanner } from "@/src/components/product/NomusMaintenanceProductBanner";
import { NomusMaintenanceStepHeader } from "@/src/components/product/NomusMaintenanceStepHeader";
import type { NomusMaintenanceWorkspaceProps } from "@/src/lib/nomusMaintenanceWorkspaceTypes";
import type { NomusProductImportSimulationPreview } from "@/src/lib/nomusProductImportSimulationTypes";

const ACTION_LABEL: Record<string, string> = {
  CREATE_PRODUCT_FROM_NOMUS: "Criar produto (Nomus)",
  USE_EXISTING_PRODUCT: "Usar Product existente",
  USE_EXISTING_MATERIAL: "Usar Material existente",
  CREATE_COMPONENT_PRODUCT_FROM_NOMUS: "Criar componente (Nomus)",
  CREATE_PLACEHOLDER_COMPONENT_WITHOUT_COST: "Criar placeholder sem custo",
  BLOCKED_UNRESOLVED: "Bloqueado",
  OPTIONAL_SELECTION_REQUIRED: "Opcional pendente",
  AMBIGUOUS_PRODUCT_AND_MATERIAL: "Ambíguo (Product + Material)",
  BLOCKED: "Bloqueado",
};

const BOM_ACTION_LABEL: Record<string, string> = {
  CREATE_PRODUCT_BOM_LINE: "Criar linha BOM",
  SKIP_OPTIONAL_NOT_SELECTED: "Opcional não selecionado",
  BLOCKED_AMBIGUOUS_COMPONENT: "Bloqueado (ambiguidade)",
  BLOCKED_MISSING_COMPONENT: "Bloqueado (componente ausente)",
};

type NomusProductImportSimulationPanelProps = NomusMaintenanceWorkspaceProps & {
  disabled?: boolean;
  onOpenProduct?: (productId: string, options?: { tab?: "cost" | "info" | "bom" }) => void;
  onImportSuccess?: () => void;
};

export const NomusProductImportSimulationPanel: React.FC<
  NomusProductImportSimulationPanelProps
> = ({
  disabled = false,
  onOpenProduct,
  onImportSuccess,
  selectedParentCode,
  selectedParentDescription,
  selectedIndusProductId,
  onWorkspaceParentChange,
  refreshToken = 0,
}) => {
  const navigate = useNavigate();
  const workspaceFocused = Boolean(selectedParentCode?.trim());
  const [parentCode, setParentCode] = useState(selectedParentCode ?? "");
  const [recursive, setRecursive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<NomusProductImportSimulationPreview | null>(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [importResult, setImportResult] = useState<{
    productId: string | null;
    warnings: string[];
    canSimulateCost: boolean;
  } | null>(null);

  useNomusMaintenanceWorkspaceSync({
    selectedParentCode,
    selectedParentDescription,
    selectedIndusProductId,
    onWorkspaceParentChange,
    setLocalCode: setParentCode,
  });

  const loadPreview = useCallback(async () => {
    const code = parentCode.trim();
    if (!code) return;
    setLoading(true);
    setError(null);
    setImportResult(null);
    try {
      const params = new URLSearchParams({
        parentCode: code,
        recursive: recursive ? "true" : "false",
        maxDepth: "10",
      });
      const data = await fetchJsonOk<NomusProductImportSimulationPreview>(
        `/api/nomus/product-import-simulation/preview?${params.toString()}`
      );
      setPreview(data);
      setConfirmationText("");
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : "Erro ao analisar importação.");
    } finally {
      setLoading(false);
    }
  }, [parentCode, recursive]);

  useEffect(() => {
    if (!workspaceFocused || !selectedParentCode?.trim()) return;
    void loadPreview();
  }, [workspaceFocused, selectedParentCode, refreshToken, loadPreview]);

  const handleImport = async () => {
    if (!preview?.canImport || !preview.planHash) return;
    setImporting(true);
    setError(null);
    try {
      const result = await fetchJsonOk<{
        imported: boolean;
        productId: string | null;
        warnings: string[];
        canSimulateCost: boolean;
      }>("/api/nomus/product-import-simulation/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentCode: preview.parentCode,
          recursive,
          planHash: preview.planHash,
          confirmationText,
          approvedBy: approvedBy.trim() || undefined,
        }),
      });
      setImportResult({
        productId: result.productId,
        warnings: result.warnings ?? [],
        canSimulateCost: result.canSimulateCost,
      });
      onImportSuccess?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao importar produto.");
    } finally {
      setImporting(false);
    }
  };

  const creates = (preview?.componentActions ?? []).filter((a) =>
    [
      "CREATE_COMPONENT_PRODUCT_FROM_NOMUS",
      "CREATE_PLACEHOLDER_COMPONENT_WITHOUT_COST",
    ].includes(a.proposedAction)
  );

  return (
    <div className="space-y-4">
      <NomusMaintenanceStepHeader tab="product-import" />

      {workspaceFocused ? (
        <NomusMaintenanceProductBanner
          parentCode={selectedParentCode!}
          parentDescription={selectedParentDescription}
          indusProductId={selectedIndusProductId}
        />
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1">
          <label className="text-[10px] font-semibold uppercase text-muted-foreground">
            Código Nomus (parentCode)
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
          Árvore recursiva
        </label>
        <button
          type="button"
          disabled={disabled || loading || !parentCode.trim()}
          onClick={() => void loadPreview()}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Analisar importação
        </button>
      </div>

      {error ? (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      ) : null}

      {preview ? (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-xs">
            <div className="rounded-lg border border-border p-3">
              <p className="text-[10px] uppercase text-muted-foreground font-semibold">Nomus</p>
              <p className="font-bold mt-1">{preview.existsInNomus ? "Sim" : "Não"}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-[10px] uppercase text-muted-foreground font-semibold">IndusCost</p>
              <p className="font-bold mt-1">{preview.existsInIndusCost ? "Cadastrado" : "Ausente"}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-[10px] uppercase text-muted-foreground font-semibold">Pode importar</p>
              <p className={cn("font-bold mt-1", preview.canImport ? "text-green-700" : "text-amber-800")}>
                {preview.canImport ? "Sim" : "Não"}
              </p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-[10px] uppercase text-muted-foreground font-semibold">Simular custo</p>
              <p className={cn("font-bold mt-1", preview.canSimulateCost ? "text-green-700" : "text-amber-800")}>
                {preview.canSimulateCost ? "Sim" : "Incompleto"}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs">
            <p className="font-bold text-primary">Produto principal — {preview.parentCode}</p>
            {preview.parentDescription ? (
              <p className="text-muted-foreground mt-1">{preview.parentDescription}</p>
            ) : null}
            <p className="mt-2">
              <span className="font-semibold">Ação: </span>
              {ACTION_LABEL[preview.productAction.proposedAction] ?? preview.productAction.proposedAction}
            </p>
            <p className="text-muted-foreground mt-1">{preview.productAction.reason}</p>
          </div>

          {preview.blockingReasons.length > 0 ? (
            <ul className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 list-disc list-inside">
              {preview.blockingReasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          ) : null}

          {preview.warnings.length > 0 ? (
            <ul className="text-[11px] text-muted-foreground border border-border rounded-lg px-3 py-2 list-disc list-inside">
              {preview.warnings.slice(0, 8).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}

          {creates.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-bold">Componentes a criar ({creates.length})</p>
              <div className="overflow-x-auto rounded-lg border border-border max-h-48">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-[10px] uppercase">
                    <tr>
                      <th className="text-left px-2 py-1">Código</th>
                      <th className="text-left px-2 py-1">Ação</th>
                      <th className="text-left px-2 py-1">Sub-BOM Nomus</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creates.map((c) => (
                      <tr key={`${c.parentCodeContext}-${c.componentCode}`} className="border-t border-border/60">
                        <td className="px-2 py-1 font-medium">{c.componentCode}</td>
                        <td className="px-2 py-1">{ACTION_LABEL[c.proposedAction] ?? c.proposedAction}</td>
                        <td className="px-2 py-1">{c.hasNomusSubBom ? "Sim" : "Não"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {preview.ambiguousItems.length > 0 ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-950">
              <p className="font-bold">Componentes ambíguos (Product + Material)</p>
              <ul className="mt-1 list-disc list-inside">
                {preview.ambiguousItems.map((a) => (
                  <li key={a.componentCode}>
                    {a.componentCode} — {a.suggestedResolution}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.bomActions.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-bold">Plano de BOM ({preview.bomActions.length} entradas)</p>
              <div className="overflow-x-auto rounded-lg border border-border max-h-48">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-[10px] uppercase">
                    <tr>
                      <th className="text-left px-2 py-1">Ação</th>
                      <th className="text-left px-2 py-1">Componente</th>
                      <th className="text-right px-2 py-1">Qtd</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.bomActions.map((b, i) => (
                      <tr key={`${b.componentCode}-${b.bomActionType}-${i}`} className="border-t border-border/60">
                        <td className="px-2 py-1 text-muted-foreground">
                          {BOM_ACTION_LABEL[b.bomActionType] ?? b.bomActionType}
                        </td>
                        <td className="px-2 py-1 font-medium">{b.componentCode}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{b.quantity ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {preview.missingRoutingItems.length > 0 ? (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11px]">
              <p className="font-bold">Pendências de roteiro/montagem</p>
              <ul className="mt-1 list-disc list-inside text-muted-foreground">
                {preview.missingRoutingItems.map((m) => (
                  <li key={`${m.kind}-${m.componentCode}`}>
                    {m.componentCode} — {m.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.missingCostItems.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-950">
              <p className="font-bold flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" />
                Simulação de custo incompleta: faltam custos para {preview.missingCostItems.length} item(ns).
              </p>
              <ul className="mt-1 list-disc list-inside">
                {preview.missingCostItems.slice(0, 10).map((m) => (
                  <li key={m.componentCode}>
                    {m.componentCode} — {m.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.engineeringPending.length > 0 ? (
            <ul className="text-[11px] text-muted-foreground list-disc list-inside">
              {preview.engineeringPending.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          ) : null}

          {preview.canImport ? (
            <div className="rounded-lg border border-border p-3 space-y-3">
              <p className="text-xs font-bold">Confirmação obrigatória</p>
              <p className="text-[11px] text-muted-foreground">
                Digite exatamente:{" "}
                <code className="bg-accent px-1 rounded font-mono">{preview.confirmationRequiredText}</code>
              </p>
              <input
                type="text"
                value={confirmationText}
                onChange={(e) => setConfirmationText(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs font-mono"
                placeholder={preview.confirmationRequiredText}
                disabled={disabled || importing}
              />
              <input
                type="text"
                value={approvedBy}
                onChange={(e) => setApprovedBy(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs"
                placeholder="Aprovado por (opcional)"
                disabled={disabled || importing}
              />
              <button
                type="button"
                disabled={
                  disabled ||
                  importing ||
                  confirmationText.trim() !== preview.confirmationRequiredText
                }
                onClick={() => void handleImport()}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {importing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PackagePlus className="h-4 w-4" />
                )}
                Importar produto para simulação
              </button>
            </div>
          ) : null}

          {importResult ? (
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-3 space-y-2 text-xs text-green-950">
              <p className="font-bold flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4" />
                Importação concluída
              </p>
              {!importResult.canSimulateCost ? (
                <p className="flex items-start gap-1 text-amber-900">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  Simulação de custo incompleta — revise pendências antes de precificar.
                </p>
              ) : null}
              {importResult.productId && onOpenProduct ? (
                <div className="flex flex-wrap gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => onOpenProduct(importResult.productId!)}
                    className="inline-flex items-center gap-1 text-primary font-semibold hover:underline"
                  >
                    Abrir cadastro
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenProduct(importResult.productId!, { tab: "cost" })}
                    className="inline-flex items-center gap-1 text-primary font-semibold hover:underline"
                  >
                    <DollarSign className="h-3.5 w-3.5" />
                    Ver análise de custo
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate("/pricing")}
                    className="inline-flex items-center gap-1 text-primary font-semibold hover:underline"
                  >
                    <TrendingUp className="h-3.5 w-3.5" />
                    Ir para precificação
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : loading ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Analisando importação…
        </p>
      ) : (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Download className="h-4 w-4 opacity-60" />
          Informe um código Nomus e clique em &quot;Analisar importação&quot;.
        </p>
      )}
    </div>
  );
};
