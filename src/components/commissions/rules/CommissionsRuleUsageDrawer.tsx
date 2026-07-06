import React from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import {
  CommissionsErrorBanner,
  CommissionsLoading,
} from "@/src/components/commissions/commissionsUi";
import { buildRuleUsageDashboardLink } from "@/src/components/commissions/rules/commissionsRulesFilters";
import {
  buildCommissionRuleSummary,
  formatCommissionRuleBase,
  formatCommissionRuleRelease,
} from "@/src/components/commissions/rules/commissionsRulesLabels";
import { useCommissionRuleUsage } from "@/src/components/commissions/rules/useCommissionsRulesData";

type Props = {
  ruleId: string | null;
  onClose: () => void;
};

export function CommissionsRuleUsageDrawer({ ruleId, onClose }: Props) {
  const { data, loading, error, reload } = useCommissionRuleUsage(ruleId);

  if (!ruleId) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="flex h-full w-full max-w-md flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-4 py-3">
          <h3 className="text-base font-bold text-[#111827]">Uso da regra</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[#6B7280] hover:bg-[#F3F4F6]"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? <CommissionsLoading label="Carregando uso…" /> : null}
          {error ? (
            <CommissionsErrorBanner message={error} onRetry={() => void reload()} />
          ) : null}

          {!loading && !error && data ? (
            <>
              <div>
                <p className="text-sm font-semibold text-[#111827]">{data.rule.name}</p>
                <p className="mt-2 text-sm text-[#374151]">
                  {buildCommissionRuleSummary(data.rule)}
                </p>
              </div>

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-[#F9FAFB] p-3">
                  <dt className="text-xs text-[#6B7280]">Comissões calculadas</dt>
                  <dd className="text-lg font-bold text-[#111827]">{data.usageCount}</dd>
                </div>
                <div className="rounded-lg bg-[#F9FAFB] p-3">
                  <dt className="text-xs text-[#6B7280]">Últimos 90 dias</dt>
                  <dd className="text-lg font-bold text-[#111827]">{data.recentUsageCount}</dd>
                </div>
              </dl>

              <div className="space-y-1 text-xs text-[#6B7280]">
                <p>Base: {formatCommissionRuleBase(data.rule.baseType)}</p>
                <p>Liberação: {formatCommissionRuleRelease(data.rule.releaseRule)}</p>
                <p>Prioridade: {data.rule.priority}</p>
                <p>Condições: {data.rule.conditionsCount ?? data.rule.conditions.length}</p>
              </div>

              <Link
                to={buildRuleUsageDashboardLink(data.rule.id)}
                className="inline-flex text-sm font-medium text-[#2563EB] hover:underline"
              >
                Ver no dashboard de comissões
              </Link>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
