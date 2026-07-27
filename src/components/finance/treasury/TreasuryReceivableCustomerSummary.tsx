import React, { useEffect, useState } from "react";
import type { TreasuryCustomerFinancialSummaryDto } from "@/src/lib/treasury/contracts/index.js";
import { fetchTreasuryCustomerFinancialSummary } from "@/src/lib/treasury/treasuryReceivablesApi.js";
import {
  TREASURY_COLLECTION_ACTION_TYPE_LABELS,
  formatTreasuryReceivableDate,
  formatTreasuryReceivableDateTime,
  formatTreasuryReceivableMoney,
  formatTreasuryPromiseFulfillmentRate,
} from "@/src/lib/treasury/treasuryReceivablesUi.js";

type Props = {
  titleId: string;
};

function Metric({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId?: string;
}) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className="mt-0.5 text-sm font-semibold tabular-nums text-foreground"
        data-testid={testId}
      >
        {value}
      </p>
    </div>
  );
}

export function TreasuryReceivableCustomerSummary({ titleId }: Props) {
  const [summary, setSummary] =
    useState<TreasuryCustomerFinancialSummaryDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    void fetchTreasuryCustomerFinancialSummary(titleId, ac.signal)
      .then((row) => {
        setSummary(row);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setError(
          err instanceof Error
            ? err.message
            : "Falha ao carregar resumo do cliente."
        );
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [titleId]);

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">Carregando resumo…</p>
    );
  }
  if (error) {
    return (
      <div
        className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        role="alert"
      >
        {error}
      </div>
    );
  }
  if (!summary) return null;

  return (
    <div
      className="space-y-4"
      data-testid="treasury-receivable-customer-summary"
    >
      <p className="text-xs text-muted-foreground">
        Resumo do cliente (personId {summary.personId ?? "—"}) com base nos
        títulos oficiais e complementos locais. Vendedor do pedido ≠ responsável
        comercial ≠ responsável pela cobrança.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric
          label="Total em aberto"
          value={formatTreasuryReceivableMoney(summary.openAmountTotal)}
          testId="customer-summary-open-total"
        />
        <Metric
          label="Total vencido"
          value={formatTreasuryReceivableMoney(summary.overdueAmountTotal)}
          testId="customer-summary-overdue-total"
        />
        <Metric
          label="A vencer"
          value={formatTreasuryReceivableMoney(summary.upcomingAmountTotal)}
          testId="customer-summary-upcoming-total"
        />
        <Metric
          label="Atraso médio (dias)"
          value={
            summary.averageDaysOverdue == null
              ? "—"
              : String(summary.averageDaysOverdue)
          }
        />
        <Metric
          label="Maior atraso (dias)"
          value={String(summary.maxDaysOverdue)}
        />
        <Metric
          label="Promessas ativas"
          value={String(summary.activePromiseCount)}
        />
        <Metric
          label="Promessas vencidas"
          value={String(summary.expiredPromiseCount)}
        />
        <Metric
          label="Índice cumprimento"
          value={formatTreasuryPromiseFulfillmentRate(
            summary.promiseFulfillmentRate
          )}
          testId="customer-summary-fulfillment-rate"
        />
        <Metric
          label="Títulos abertos"
          value={String(summary.openTitleCount)}
        />
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-sm">
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Vendedor do pedido
          </dt>
          <dd className="mt-0.5 font-medium" data-testid="customer-summary-seller">
            {summary.sellerName?.trim() || "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Responsável comercial
          </dt>
          <dd
            className="mt-0.5 font-medium"
            data-testid="customer-summary-commercial"
          >
            {summary.commercialOwnerName?.trim() || "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Responsável pela cobrança
          </dt>
          <dd
            className="mt-0.5 font-medium"
            data-testid="customer-summary-collection-owner"
          >
            {summary.collectionOwnerUserId?.trim() || "—"}
          </dd>
        </div>
      </dl>

      <div>
        <p className="mb-2 text-sm font-semibold">Recebimentos recentes</p>
        {summary.recentReceipts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum recebimento.</p>
        ) : (
          <ul className="space-y-1.5" data-testid="customer-summary-receipts">
            {summary.recentReceipts.map((r) => (
              <li
                key={`${r.titleId}-${r.settledAt}`}
                className="rounded border border-border px-2 py-1.5 text-sm"
              >
                <span className="font-medium">
                  {formatTreasuryReceivableMoney(r.settledAmount)}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  · {formatTreasuryReceivableDate(r.settledAt)} ·{" "}
                  {r.documentLabel ?? `#${r.externalId}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold">Histórico de cobrança</p>
        {summary.collectionHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma ação de cobrança.
          </p>
        ) : (
          <ul className="space-y-1.5" data-testid="customer-summary-collection">
            {summary.collectionHistory.map((a) => (
              <li
                key={a.actionId}
                className="rounded border border-border px-2 py-1.5 text-sm"
              >
                <p className="font-medium">
                  {TREASURY_COLLECTION_ACTION_TYPE_LABELS[a.actionType] ??
                    a.actionType}
                  {a.result ? ` · ${a.result}` : ""}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {formatTreasuryReceivableDateTime(a.performedAt)}
                  {a.contactPerson ? ` · ${a.contactPerson}` : ""}
                  {a.nextAction ? ` · próxima: ${a.nextAction}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
