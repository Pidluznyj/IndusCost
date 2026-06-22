import React, { useCallback, useEffect, useState } from "react";
import { Eye, Plus, RefreshCw, Trash2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { FinanceCostCenterDto } from "@/src/lib/financeCostCenters";
import type {
  SupplierCostCenterRuleDto,
  SupplierCostCenterRulePreviewPayload,
} from "@/src/lib/financeSupplierCostCenterRules";
import { formatFinanceInteger } from "@/src/lib/financeAccountsReceivableFormat";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";

type Props = {
  canManage: boolean;
};

export function FinanceSupplierRulesTab({ canManage }: Props) {
  const [rules, setRules] = useState<SupplierCostCenterRuleDto[]>([]);
  const [centers, setCenters] = useState<FinanceCostCenterDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SupplierCostCenterRulePreviewPayload | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState([{ costCenterId: "", percentage: "100" }]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rulesPayload, centersPayload] = await Promise.all([
        fetchJsonOk<{ items: SupplierCostCenterRuleDto[] }>(
          "/api/finance/supplier-cost-center-rules",
          { credentials: "include" }
        ),
        fetchJsonOk<{ items: FinanceCostCenterDto[] }>("/api/finance/cost-centers", {
          credentials: "include",
        }),
      ]);
      setRules(rulesPayload.items);
      setCenters(centersPayload.items.filter((row) => row.status === "ACTIVE"));
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível carregar regras de classificação.", e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const centerName = (id: string) =>
    centers.find((row) => row.id === id)?.code ?? id.slice(0, 8);

  const runPreview = async () => {
    if (!supplierId.trim()) return;
    try {
      const payload = await fetchJsonOk<SupplierCostCenterRulePreviewPayload>(
        "/api/finance/supplier-cost-center-rules/preview",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            supplierId: supplierId.trim(),
            rules: lines.map((line) => ({
              costCenterId: line.costCenterId,
              percentage: Number(line.percentage),
            })),
          }),
        }
      );
      setPreview(payload);
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível gerar o preview da regra.", e));
    }
  };

  const saveRules = async () => {
    if (!canManage) return;
    setSaving(true);
    try {
      await fetchJsonOk("/api/finance/supplier-cost-center-rules", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: supplierId.trim(),
          replaceExisting: true,
          rules: lines.map((line) => ({
            costCenterId: line.costCenterId,
            percentage: Number(line.percentage),
          })),
        }),
      });
      setFormOpen(false);
      setPreview(null);
      await load();
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível salvar a regra.", e));
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (id: string) => {
    if (!canManage) return;
    try {
      await fetchJsonOk(`/api/finance/supplier-cost-center-rules/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      await load();
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível desativar a regra.", e));
    }
  };

  return (
    <div className="space-y-4" data-testid="finance-cost-centers-rules-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Defina regras de 100% ou rateio por fornecedor. O preview mostra o impacto antes de salvar.
        </p>
        <div className="flex gap-2">
          <button type="button" className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
          {canManage ? (
            <button
              type="button"
              data-testid="finance-rules-create-button"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
              onClick={() => setFormOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Nova regra
            </button>
          ) : null}
        </div>
      </div>

      {error ? <FinanceModuleErrorBanner message={error} onRetry={() => void load()} onDismiss={() => setError(null)} /> : null}
      {loading ? <FinanceModuleLoadingBlock label="Carregando regras…" /> : null}

      {!loading && rules.length === 0 ? (
        <FinanceModuleEmptyState
          title="Nenhuma regra cadastrada"
          description="Crie uma regra 100% ou um rateio para classificar títulos automaticamente por fornecedor."
        />
      ) : null}

      {!loading && rules.length > 0 ? (
        <div className={cn(financeBiCardClass, "overflow-x-auto")}>
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] font-bold uppercase text-muted-foreground">
                <th className="px-3 py-2">Fornecedor</th>
                <th className="px-3 py-2">Centro</th>
                <th className="px-3 py-2">%</th>
                <th className="px-3 py-2">Auto</th>
                <th className="px-3 py-2">Status</th>
                {canManage ? <th className="px-3 py-2">Ações</th> : null}
              </tr>
            </thead>
            <tbody>
              {rules.map((row) => (
                <tr key={row.id} className="border-b border-border/60">
                  <td className="px-3 py-2 font-mono text-xs">{row.supplierId.slice(0, 8)}…</td>
                  <td className="px-3 py-2">{centerName(row.costCenterId)}</td>
                  <td className="px-3 py-2">{row.percentage}%</td>
                  <td className="px-3 py-2">{row.autoApply ? "Sim" : "Não"}</td>
                  <td className="px-3 py-2">{row.isActive ? "Ativa" : "Inativa"}</td>
                  {canManage && row.isActive ? (
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        data-testid="finance-rules-deactivate-button"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700"
                        onClick={() => void deactivate(row.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                        Desativar
                      </button>
                    </td>
                  ) : canManage ? (
                    <td className="px-3 py-2">—</td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className={cn(financeBiCardClass, "w-full max-w-lg space-y-4")}>
            <h3 className="text-lg font-semibold">Nova regra de classificação</h3>
            <label className="block space-y-1 text-sm">
              <span className="font-semibold">ID do fornecedor</span>
              <input
                className="w-full rounded-lg border px-3 py-2 font-mono text-xs"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                placeholder="UUID do fornecedor financeiro"
              />
            </label>
            {lines.map((line, index) => (
              <div key={index} className="grid grid-cols-2 gap-2">
                <select
                  className="rounded-lg border px-3 py-2 text-sm"
                  value={line.costCenterId}
                  onChange={(e) =>
                    setLines((prev) =>
                      prev.map((row, i) =>
                        i === index ? { ...row, costCenterId: e.target.value } : row
                      )
                    )
                  }
                >
                  <option value="">Centro de custo</option>
                  {centers.map((cc) => (
                    <option key={cc.id} value={cc.id}>
                      {cc.code} — {cc.name}
                    </option>
                  ))}
                </select>
                <input
                  className="rounded-lg border px-3 py-2 text-sm"
                  type="number"
                  min={0}
                  max={100}
                  value={line.percentage}
                  onChange={(e) =>
                    setLines((prev) =>
                      prev.map((row, i) =>
                        i === index ? { ...row, percentage: e.target.value } : row
                      )
                    )
                  }
                  placeholder="%"
                />
              </div>
            ))}
            <button
              type="button"
              className="text-xs font-semibold text-primary"
              onClick={() => setLines((prev) => [...prev, { costCenterId: "", percentage: "0" }])}
            >
              + Adicionar linha de rateio
            </button>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="finance-rules-preview-button"
                className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-semibold"
                onClick={() => void runPreview()}
              >
                <Eye className="h-4 w-4" />
                Preview de impacto
              </button>
            </div>
            {preview ? (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <p>
                  Títulos em aberto: {formatFinanceInteger(preview.openTitlesCount)} · Bloqueados
                  manual: {formatFinanceInteger(preview.manualLockedTitlesCount)}
                </p>
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={() => setFormOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                disabled={saving || !supplierId.trim()}
                onClick={() => void saveRules()}
              >
                {saving ? "Salvando…" : "Salvar regra"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
