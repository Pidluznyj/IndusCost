import React from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import type { CommissionsAuditItem } from "@/src/components/commissions/commissionsTypes";
import {
  buildAuditConfirmedLink,
  buildAuditPersonLink,
  buildAuditRulesLink,
} from "@/src/components/commissions/audit/commissionsAuditFilters";
import {
  auditSeverityClassName,
  auditTypeClassName,
  formatAuditMetadataEntries,
  formatAuditSeverity,
  formatAuditStatus,
  formatAuditType,
  formatEntityLabel,
} from "@/src/components/commissions/audit/commissionsAuditLabels";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return "—";
  }
}

type Props = {
  open: boolean;
  onClose: () => void;
  item: CommissionsAuditItem | null;
  onResolve: () => void;
  onReopen: () => void;
  onReprocess: () => void;
  actionLoading: boolean;
  canReprocess: boolean;
};

export function CommissionsAuditDetailDrawer({
  open,
  onClose,
  item,
  onResolve,
  onReopen,
  onReprocess,
  actionLoading,
  canReprocess,
}: Props) {
  if (!open || !item) return null;

  const metadataEntries = formatAuditMetadataEntries(item.metadataJson);
  const confirmedLink = buildAuditConfirmedLink({
    orderCode: item.orderCode,
    nfeNumber: item.nfeNumber,
    commissionPersonId: item.commissionPersonId,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Detalhe da issue de auditoria"
      data-testid="commissions-audit-detail-drawer"
    >
      <div
        className="flex h-[92vh] w-full max-w-2xl flex-col bg-white shadow-xl sm:h-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-5 py-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset ${auditSeverityClassName(item.severity)}`}
              >
                {formatAuditSeverity(item.severity)}
              </span>
              <span
                className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${auditTypeClassName(item.type)}`}
              >
                {formatAuditType(item.type)}
              </span>
              <span className="text-xs font-medium text-[#6B7280]">
                {formatAuditStatus(item.resolved)}
              </span>
            </div>
            <h4 className="text-lg font-extrabold text-[#111827]">{item.message}</h4>
            <p className="text-sm text-[#6B7280]">Criada em {formatDate(item.createdAt)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[#6B7280] hover:bg-[#F3F4F6]"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <section className="rounded-lg border border-[#E5E7EB] p-4 space-y-2">
            <h5 className="text-xs font-bold uppercase tracking-widest text-[#6B7280]">
              Contexto
            </h5>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[#6B7280]">Pedido</dt>
                <dd className="font-medium text-[#111827]">{item.orderCode ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[#6B7280]">NF-e</dt>
                <dd className="font-medium text-[#111827]">{item.nfeNumber ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[#6B7280]">Cliente</dt>
                <dd className="font-medium text-[#111827]">{item.customerName ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[#6B7280]">Pessoa comissionada</dt>
                <dd className="font-medium text-[#111827]">
                  {item.commissionPersonName ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[#6B7280]">Valor envolvido</dt>
                <dd className="font-medium text-[#111827]">
                  {item.involvedAmount != null
                    ? formatFinanceCurrency(item.involvedAmount)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[#6B7280]">Entidade relacionada</dt>
                <dd className="font-medium text-[#111827]">
                  {formatEntityLabel(item.entityType, item.entityId)}
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div>
                <h5 className="text-sm font-bold text-amber-900">Ação sugerida</h5>
                <p className="mt-1 text-sm text-amber-900/90">{item.suggestedAction}</p>
              </div>
            </div>
          </section>

          {metadataEntries.length > 0 ? (
            <section className="space-y-2">
              <h5 className="text-xs font-bold uppercase tracking-widest text-[#6B7280]">
                Metadados
              </h5>
              <dl className="rounded-lg border border-[#E5E7EB] divide-y divide-[#E5E7EB]">
                {metadataEntries.map((entry) => (
                  <div key={entry.key} className="grid gap-1 px-3 py-2 sm:grid-cols-3">
                    <dt className="text-xs font-medium text-[#6B7280]">{entry.label}</dt>
                    <dd className="sm:col-span-2 text-sm text-[#111827] whitespace-pre-wrap break-all">
                      {entry.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          <section className="space-y-2">
            <h5 className="text-xs font-bold uppercase tracking-widest text-[#6B7280]">
              Atalhos
            </h5>
            <div className="flex flex-wrap gap-2">
              {(item.orderCode || item.nfeNumber) && (
                <Link
                  to={confirmedLink}
                  className="inline-flex items-center gap-1 rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-sm font-medium text-[#2563EB] hover:bg-[#EFF6FF]"
                >
                  <ExternalLink className="h-4 w-4" />
                  Ver comissões confirmadas
                </Link>
              )}
              <Link
                to={buildAuditRulesLink(item.type)}
                className="inline-flex items-center gap-1 rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-sm font-medium text-[#2563EB] hover:bg-[#EFF6FF]"
              >
                <ExternalLink className="h-4 w-4" />
                Ir para regras
              </Link>
              {item.commissionPersonId ? (
                <Link
                  to={buildAuditPersonLink(item.commissionPersonId)}
                  className="inline-flex items-center gap-1 rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-sm font-medium text-[#2563EB] hover:bg-[#EFF6FF]"
                >
                  <ExternalLink className="h-4 w-4" />
                  Ir para pessoa comissionada
                </Link>
              ) : null}
            </div>
          </section>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-[#E5E7EB] px-5 py-4">
          {item.resolved ? (
            <button
              type="button"
              disabled={actionLoading}
              onClick={onReopen}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#E5E7EB] px-3 text-sm font-semibold text-[#111827] hover:bg-[#F9FAFB] disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              Reabrir
            </button>
          ) : (
            <button
              type="button"
              disabled={actionLoading}
              onClick={onResolve}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              Marcar como resolvida
            </button>
          )}
          {canReprocess ? (
            <button
              type="button"
              disabled={actionLoading}
              onClick={onReprocess}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#E5E7EB] px-3 text-sm font-semibold text-[#111827] hover:bg-[#F9FAFB] disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" />
              Reprocessar registro
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
