import React, { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { FinanceApTitleClassificationDetail } from "@/src/lib/financeAccountsPayableCostCenterTypes";
import {
  formatFinanceCurrency,
  formatFinanceDateTime,
} from "@/src/lib/financeAccountsPayableFormat";
import { cn } from "@/src/lib/utils";

type Props = {
  externalId: number | null;
  canEdit: boolean;
  onClose: () => void;
};

export function FinanceApTitleClassificationSheet({ externalId, canEdit, onClose }: Props) {
  const [detail, setDetail] = useState<FinanceApTitleClassificationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (externalId == null) return;
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<FinanceApTitleClassificationDetail>(
        `/api/finance/accounts-payable/titles/${externalId}/classification`,
        { credentials: "include" }
      );
      setDetail(payload);
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível carregar a classificação.", e));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [externalId]);

  useEffect(() => {
    if (externalId != null) void load();
    else setDetail(null);
  }, [externalId, load]);

  if (externalId == null) return null;

  const enrichment = detail?.enrichment;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/30"
        aria-label="Fechar detalhe"
        onClick={onClose}
      />
      <aside
        className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-border bg-background shadow-xl"
        data-testid="finance-ap-title-classification-sheet"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Título AP</p>
            <h2 className="text-sm font-bold font-mono">#{externalId}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-muted"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando classificação…
            </div>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {enrichment ? (
            <>
              <section className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Classificação financeira
                </h3>
                <dl className="grid grid-cols-1 gap-2 text-sm">
                  <div>
                    <dt className="text-[10px] font-bold uppercase text-muted-foreground">
                      Fornecedor consolidado
                    </dt>
                    <dd className="font-medium">{enrichment.consolidatedSupplierName}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase text-muted-foreground">
                      Centro de custo
                    </dt>
                    <dd>{enrichment.costCenterLabel}</dd>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <dt className="text-[10px] font-bold uppercase text-muted-foreground">
                        Percentual
                      </dt>
                      <dd className="tabular-nums">
                        {enrichment.isClassified
                          ? `${enrichment.allocatedPercentage.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}%`
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-bold uppercase text-muted-foreground">Valor</dt>
                      <dd className="tabular-nums font-semibold">
                        {enrichment.isClassified
                          ? formatFinanceCurrency(enrichment.allocatedAmount)
                          : "—"}
                      </dd>
                    </div>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase text-muted-foreground">Origem</dt>
                    <dd>{enrichment.classificationOriginLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase text-muted-foreground">Status</dt>
                    <dd>
                      <span
                        className={cn(
                          "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold",
                          enrichment.isClassified
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                        )}
                      >
                        {enrichment.classificationStatusLabel}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase text-muted-foreground">
                      Bloqueado manualmente
                    </dt>
                    <dd>{enrichment.isManualLocked ? "Sim" : "Não"}</dd>
                  </div>
                </dl>
              </section>

              {enrichment.lines.length > 0 ? (
                <section className="space-y-2">
                  <h4 className="text-[10px] font-bold uppercase text-muted-foreground">
                    Linhas de alocação
                  </h4>
                  <ul className="space-y-2">
                    {enrichment.lines.map((line) => (
                      <li
                        key={line.allocationId}
                        className="rounded-lg border border-border/70 p-2.5 text-xs space-y-1"
                      >
                        <p className="font-semibold">
                          {line.costCenterCode} — {line.costCenterName}
                        </p>
                        <p className="text-muted-foreground">
                          {line.percentage.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}% ·{" "}
                          {formatFinanceCurrency(line.amount)}
                        </p>
                        <p className="text-muted-foreground">
                          Origem: {line.sourceLabel}
                          {line.ruleLabel ? ` · ${line.ruleLabel}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {detail.auditHistory.length > 0 ? (
                <section className="space-y-2">
                  <h4 className="text-[10px] font-bold uppercase text-muted-foreground">
                    Histórico de auditoria
                  </h4>
                  <ul className="space-y-2 max-h-48 overflow-y-auto">
                    {detail.auditHistory.map((entry) => (
                      <li
                        key={entry.id}
                        className="rounded-lg border border-border/60 px-2.5 py-2 text-[11px]"
                      >
                        <p className="font-semibold">{entry.summary}</p>
                        <p className="text-muted-foreground">
                          {entry.userName ?? "Sistema"} · {formatFinanceDateTime(entry.createdAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {canEdit ? (
                <a
                  href="/finance/cost-centers?tab=unclassified"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-accent"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Editar classificação
                </a>
              ) : null}
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
