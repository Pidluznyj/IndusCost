import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import type {
  ControlledApplyAction,
  ControlledApplyBlockingCode,
  ControlledApplyPreview,
} from "@/src/lib/nomusBomControlledApplyTypes";

type NomusBomControlledApplySectionProps = {
  parentCode: string;
  refreshToken?: number;
  disabled?: boolean;
  /** Quando true, exibe apenas preview — sem POST apply (fase UX antes de liberar aplicação real). */
  previewOnly?: boolean;
  onApplied?: () => void;
};

const ACTION_LABEL: Record<ControlledApplyAction["actionType"], string> = {
  CREATE_PRODUCT_BOM_LINE: "Criar linha",
  UPDATE_PRODUCT_BOM_QUANTITY: "Atualizar qtd.",
  CONSOLIDATE_DUPLICATE_PRODUCT_BOM_LINES: "Consolidar duplicidade",
  KEEP_PRODUCT_BOM_LINE: "Manter",
  REMOVE_PRODUCT_BOM_LINE: "Remover",
  SKIP_UNRESOLVED: "Não resolvido",
  BLOCKED: "Bloqueado",
};

const BLOCKING_BADGE: Record<ControlledApplyBlockingCode, string> = {
  NO_PRODUCT: "bg-red-200 text-red-950",
  NO_NOMUS_BOM: "bg-red-200 text-red-950",
  EFFECTIVE_BOM_BLOCKED: "bg-red-200 text-red-950",
  OPTIONAL_PENDING: "bg-amber-200 text-amber-950",
  LOCAL_REVIEW_PENDING: "bg-amber-200 text-amber-950",
  NEEDS_ENGINEERING_REVIEW: "bg-amber-200 text-amber-950",
  UNRESOLVED_INCLUDED_COMPONENT: "bg-red-200 text-red-950",
  BLOCKED_ACTION: "bg-red-200 text-red-950",
  COST_UNRESOLVED: "bg-orange-200 text-orange-950",
  DRY_PLAN_BLOCKED: "bg-red-200 text-red-950",
  AMBIGUOUS_DUPLICATE_PRODUCT_BOM_LINE: "bg-orange-200 text-orange-950",
};

function actionBadgeClass(actionType: ControlledApplyAction["actionType"]): string {
  switch (actionType) {
    case "CREATE_PRODUCT_BOM_LINE":
      return "bg-blue-100 text-blue-900";
    case "UPDATE_PRODUCT_BOM_QUANTITY":
    case "CONSOLIDATE_DUPLICATE_PRODUCT_BOM_LINES":
      return "bg-amber-100 text-amber-900";
    case "REMOVE_PRODUCT_BOM_LINE":
      return "bg-red-100 text-red-900";
    case "SKIP_UNRESOLVED":
    case "BLOCKED":
      return "bg-red-200 text-red-950";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export const NomusBomControlledApplySection: React.FC<NomusBomControlledApplySectionProps> = ({
  parentCode,
  refreshToken = 0,
  disabled = false,
  previewOnly = false,
  onApplied,
}) => {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applySuccess, setApplySuccess] = useState<string | null>(null);
  const [preview, setPreview] = useState<ControlledApplyPreview | null>(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [approvedBy, setApprovedBy] = useState("");

  const loadPreview = useCallback(async () => {
    const code = parentCode.trim();
    if (!code) return;
    setLoading(true);
    setError(null);
    setApplyError(null);
    setApplySuccess(null);
    try {
      const params = new URLSearchParams({ parentCode: code });
      const result = await fetchJsonOk<ControlledApplyPreview>(
        `/api/nomus/effective-pricing-bom/apply-preview?${params.toString()}`
      );
      setPreview(result);
      setConfirmationText("");
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : "Não foi possível carregar o preview de aplicação.");
    } finally {
      setLoading(false);
    }
  }, [parentCode]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview, refreshToken]);

  const handleApply = async () => {
    if (!preview?.canApply || !preview.planHash) return;
    setApplying(true);
    setApplyError(null);
    setApplySuccess(null);
    try {
      const result = await fetchJsonOk<{
        applied: boolean;
        applyRunId: string;
      }>("/api/nomus/effective-pricing-bom/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentCode: preview.parentCode,
          planHash: preview.planHash,
          confirmationText,
          approvedBy: approvedBy.trim() || undefined,
        }),
      });
      setApplySuccess(`BOM aplicada com sucesso. Registro de auditoria: ${result.applyRunId}`);
      setConfirmationText("");
      await loadPreview();
      onApplied?.();
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Falha ao aplicar a BOM efetiva.");
    } finally {
      setApplying(false);
    }
  };

  const confirmationOk =
    preview != null && confirmationText.trim() === preview.confirmationRequiredText;

  const mutatingActions =
    preview?.actions.filter((a) =>
      [
        "CREATE_PRODUCT_BOM_LINE",
        "UPDATE_PRODUCT_BOM_QUANTITY",
        "CONSOLIDATE_DUPLICATE_PRODUCT_BOM_LINES",
        "REMOVE_PRODUCT_BOM_LINE",
      ].includes(a.actionType)
    ) ?? [];

  const duplicateActions =
    preview?.actions.filter(
      (a) => a.actionType === "CONSOLIDATE_DUPLICATE_PRODUCT_BOM_LINES"
    ) ?? [];

  const blockedDuplicateActions =
    preview?.actions.filter(
      (a) => a.actionType === "BLOCKED" && a.reason.includes("Produto e Material")
    ) ?? [];

  return (
    <div className="rounded-lg border border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20 p-4 space-y-4">
      <div className="flex items-start gap-2">
        <ShieldAlert className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
        <div>
          <h4 className="text-base font-semibold">
            {previewOnly ? "Preview de aplicação (somente leitura)" : "Aplicação controlada"}
          </h4>
          <p className="text-sm text-muted-foreground mt-1">
            {previewOnly
              ? "Simula o que seria alterado na ProductBOM. A aplicação real permanece desabilitada nesta fase de engenharia."
              : "Aplica a BOM efetiva Nomus na ProductBOM deste produto, somente após validação e confirmação explícita."}
          </p>
        </div>
      </div>

      {loading && !preview ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando preview de aplicação…
        </p>
      ) : null}

      {error ? (
        <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      ) : null}

      {preview ? (
        <div className="space-y-4">
          <div
            className={cn(
              "rounded-lg border px-3 py-2.5 text-sm flex items-start gap-2",
              preview.canApply
                ? "border-green-300 bg-green-50 text-green-950"
                : "border-red-300 bg-red-50 text-red-950"
            )}
          >
            {preview.canApply ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            )}
            <div>
              <p className="font-semibold">
                Status: {preview.canApply ? "Pronto para aplicar" : "Bloqueado"}
              </p>
              {!preview.canApply && preview.blockingReasons.length > 0 ? (
                <ul className="mt-2 list-disc list-inside space-y-1 text-xs">
                  {preview.blockingReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          {!preview.canApply && (preview.blockingDetails?.length ?? 0) > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-red-950">Bloqueios (corrija antes de aplicar)</p>
              <ul className="space-y-2">
                {preview.blockingDetails.map((detail, idx) => (
                  <li
                    key={`${detail.code}-${detail.componentCode ?? "global"}-${idx}`}
                    className="rounded-lg border border-red-200 bg-background px-3 py-2.5 text-sm space-y-1.5"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                          BLOCKING_BADGE[detail.code]
                        )}
                      >
                        {detail.code.replace(/_/g, " ")}
                      </span>
                      {detail.componentCode ? (
                        <span className="font-semibold tabular-nums">{detail.componentCode}</span>
                      ) : null}
                    </div>
                    {detail.componentDescription ? (
                      <p className="text-muted-foreground">{detail.componentDescription}</p>
                    ) : null}
                    <p>
                      <span className="font-medium">Motivo: </span>
                      {detail.reason}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Como resolver: </span>
                      {detail.suggestedFix}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {duplicateActions.length > 0 ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50/80 px-3 py-2.5 text-sm space-y-2">
              <p className="font-semibold text-amber-950">Duplicidade IndusCost detectada</p>
              {duplicateActions.map((action) => (
                <div
                  key={`dup-${action.componentCode}`}
                  className="rounded-md border border-amber-200 bg-background px-2.5 py-2 space-y-1"
                >
                  <p className="font-medium tabular-nums">
                    {action.componentCode}
                    {action.componentDescription ? ` — ${action.componentDescription}` : ""}
                  </p>
                  <p>
                    Atual no IndusCost:{" "}
                    <span className="font-semibold tabular-nums">
                      {action.currentQuantityTotal ?? action.currentQuantity ?? "—"}
                    </span>
                    {(action.duplicateBomLineIds?.length ?? 0) > 1
                      ? ` em ${action.duplicateBomLineIds?.length} linhas`
                      : ""}
                  </p>
                  <p>
                    Alvo BOM efetiva (Nomus):{" "}
                    <span className="font-semibold tabular-nums">{action.effectiveQuantity ?? "—"}</span>
                  </p>
                  <p>
                    Ação: {ACTION_LABEL[action.actionType]}
                    {action.currentQuantityTotal != null && action.effectiveQuantity != null
                      ? ` — ajustar para ${action.effectiveQuantity}`
                      : ""}
                  </p>
                  {(action.duplicateBomLineIds?.length ?? 0) > 0 ? (
                    <p className="text-xs text-muted-foreground break-all">
                      Linhas envolvidas: manter {action.keepBomLineId ?? "—"}
                      {(action.removeBomLineIds?.length ?? 0) > 0
                        ? ` · remover ${action.removeBomLineIds?.join(", ")}`
                        : ""}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {blockedDuplicateActions.length > 0 ? (
            <div className="rounded-lg border border-orange-300 bg-orange-50/80 px-3 py-2.5 text-sm space-y-2">
              <p className="font-semibold text-orange-950">Duplicidade ambígua</p>
              {blockedDuplicateActions.map((action) => (
                <div key={`ambig-${action.componentCode}`} className="space-y-1">
                  <p className="font-medium tabular-nums">
                    {action.componentCode}
                    {action.componentDescription ? ` — ${action.componentDescription}` : ""}
                  </p>
                  <p className="text-muted-foreground">{action.reason}</p>
                  {(action.duplicateBomLineIds?.length ?? 0) > 0 ? (
                    <p className="text-xs break-all">
                      Linhas: {action.duplicateBomLineIds?.join(", ")}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {preview.canApply && mutatingActions.length > 0 ? (
            <div className="rounded-lg border border-green-200 bg-green-50/60 px-3 py-2.5 text-sm space-y-1">
              <p className="font-semibold text-green-950">Ação planejada na ProductBOM</p>
              <ul className="list-disc list-inside space-y-0.5">
                {mutatingActions.map((action) => (
                  <li key={`planned-${action.componentCode}-${action.actionType}`}>
                    <span className="font-medium tabular-nums">{action.componentCode}</span>
                    {action.componentDescription ? ` — ${action.componentDescription}` : ""}:{" "}
                    {ACTION_LABEL[action.actionType]}
                    {action.actionType === "CONSOLIDATE_DUPLICATE_PRODUCT_BOM_LINES" ? (
                      <>
                        {" "}
                        (total Indus {action.currentQuantityTotal ?? "—"} → alvo{" "}
                        {action.effectiveQuantity ?? "—"})
                      </>
                    ) : action.currentQuantity != null || action.effectiveQuantity != null ? (
                      ` (${action.currentQuantity ?? "—"} → ${action.effectiveQuantity ?? "—"})`
                    ) : (
                      ""
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div className="rounded-lg border border-border bg-background px-3 py-2">
              <p className="text-xs uppercase text-muted-foreground font-semibold">Antes</p>
              <p className="font-bold tabular-nums">{preview.beforeSummary.lineCount} linhas</p>
            </div>
            <div className="rounded-lg border border-border bg-background px-3 py-2">
              <p className="text-xs uppercase text-muted-foreground font-semibold">Depois (prev.)</p>
              <p className="font-bold tabular-nums">{preview.afterSummary.lineCount} linhas</p>
            </div>
            {preview.costImpactSummary ? (
              <>
                <div className="rounded-lg border border-border bg-background px-3 py-2">
                  <p className="text-xs uppercase text-muted-foreground font-semibold">Custo atual</p>
                  <p className="font-bold tabular-nums">
                    {preview.costImpactSummary.currentTotalCost != null
                      ? preview.costImpactSummary.currentTotalCost.toFixed(2)
                      : "—"}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-background px-3 py-2">
                  <p className="text-xs uppercase text-muted-foreground font-semibold">Custo efetivo</p>
                  <p className="font-bold tabular-nums">
                    {preview.costImpactSummary.effectiveTotalCost != null
                      ? preview.costImpactSummary.effectiveTotalCost.toFixed(2)
                      : "—"}
                  </p>
                </div>
              </>
            ) : null}
          </div>

          <p className="text-xs text-muted-foreground break-all">
            <span className="font-semibold">Versão do plano (planHash): </span>
            <code className="text-[11px]">{preview.planHash.slice(0, 16)}…</code>
          </p>

          {mutatingActions.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-border bg-background">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-2 py-2">Componente</th>
                    <th className="text-left px-2 py-2">Tipo</th>
                    <th className="text-right px-2 py-2">Atual</th>
                    <th className="text-right px-2 py-2">Efetiva</th>
                    <th className="text-left px-2 py-2">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {mutatingActions.slice(0, 20).map((action) => (
                    <tr key={`${action.componentCode}-${action.actionType}`} className="border-t border-border/50">
                      <td className="px-2 py-2 font-medium">{action.componentCode}</td>
                      <td className="px-2 py-2">{action.componentKind}</td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {action.currentQuantityTotal != null
                          ? `${action.currentQuantityTotal} (${action.duplicateBomLineIds?.length ?? 1} lin.)`
                          : action.currentQuantity ?? "—"}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {action.effectiveQuantity ?? "—"}
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-xs font-bold",
                            actionBadgeClass(action.actionType)
                          )}
                        >
                          {ACTION_LABEL[action.actionType]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {mutatingActions.length > 20 ? (
                <p className="text-xs text-muted-foreground px-2 py-2">
                  +{mutatingActions.length - 20} ações adicionais no plano completo.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhuma alteração estrutural prevista — a ProductBOM já reflete a BOM efetiva.
            </p>
          )}

          {previewOnly ? (
            <p className="text-sm font-medium text-blue-950 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              Modo preview: nenhuma alteração será gravada na ProductBOM. Use as abas de análise e
              pendências antes de liberar aplicação real.
            </p>
          ) : (
            <>
              <p className="text-sm font-medium text-amber-950 bg-amber-100/80 border border-amber-300 rounded-lg px-3 py-2">
                Esta ação altera a ProductBOM deste produto. Não altera preços, propostas ou pedidos. Um
                snapshot será salvo antes da aplicação.
              </p>

              {preview.canApply ? (
                <div className="space-y-3">
                  <label className="block text-sm space-y-1">
                    <span className="font-medium">
                      Digite exatamente:{" "}
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">
                        {preview.confirmationRequiredText}
                      </code>
                    </span>
                    <input
                      type="text"
                      value={confirmationText}
                      onChange={(e) => setConfirmationText(e.target.value)}
                      disabled={disabled || applying}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      placeholder={preview.confirmationRequiredText}
                      autoComplete="off"
                    />
                  </label>
                  <label className="block text-sm space-y-1">
                    <span className="font-medium text-muted-foreground">Aprovado por (opcional)</span>
                    <input
                      type="text"
                      value={approvedBy}
                      onChange={(e) => setApprovedBy(e.target.value)}
                      disabled={disabled || applying}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      placeholder="Nome do responsável"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void handleApply()}
                    disabled={disabled || applying || !confirmationOk}
                    className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Aplicar BOM efetiva neste produto
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled
                  className="inline-flex items-center gap-2 rounded-md bg-muted text-muted-foreground px-4 py-2 text-sm font-semibold opacity-60 cursor-not-allowed"
                >
                  Aplicar BOM efetiva neste produto
                </button>
              )}

              {applyError ? (
                <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {applyError}
                </p>
              ) : null}

              {applySuccess ? (
                <p className="text-sm text-green-900 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  {applySuccess}
                  <span className="block mt-1 text-muted-foreground">
                    Sugestão: recalcule o impacto de custo na aba correspondente.
                  </span>
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
};
