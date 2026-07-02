import React, { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { cn, formatCurrency } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { ProjectModalShell } from "@/src/components/projects/ProjectModalShell";
import { formatProductCiu } from "@/src/lib/productCostDisplay";
import {
  formatProductionCostPublicationDelta,
  type ProductProductionCostPublicationStatus,
} from "@/src/lib/productProductionCostPublicationStatus";

type Props = {
  status: ProductProductionCostPublicationStatus;
  canPublish: boolean;
  compact?: boolean;
  onPublished: () => Promise<void> | void;
};

function CostBreakdownRow({
  label,
  official,
  draft,
}: {
  label: string;
  official: number;
  draft: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="tabular-nums text-right text-slate-900 dark:text-slate-100">
        <span className="text-slate-500 dark:text-slate-400">{formatProductCiu(official)}</span>
        <span className="mx-2 text-slate-300 dark:text-slate-600" aria-hidden>
          →
        </span>
        <span className="font-semibold">{formatProductCiu(draft)}</span>
      </span>
    </div>
  );
}

function InnerPanel({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/40",
        className
      )}
    >
      <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {title}
      </p>
      {children}
    </div>
  );
}

export function ProductCostPublicationPendingCard({
  status,
  canPublish,
  compact = false,
  onPublished,
}: Props) {
  const { pendingDraft, officialCost, difference, sku } = status;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  if (!pendingDraft) return null;

  const delta = formatProductionCostPublicationDelta(difference);
  const officialUnit = officialCost?.unitProductionCost ?? 0;
  const draftUnit = pendingDraft.unitProductionCost;
  const diffAmount = difference?.amount ?? 0;
  const diffIsPositive = diffAmount > 0;

  const handleConfirmPublish = async () => {
    if (!canPublish || publishing) return;
    setPublishing(true);
    setPublishError(null);
    try {
      await fetchJsonOk(`/api/production-cost-table-versions/${pendingDraft.versionId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setConfirmOpen(false);
      await onPublished();
    } catch (error) {
      setPublishError(
        error instanceof Error
          ? error.message
          : "Não foi possível publicar o custo. Verifique permissões ou se o DRAFT ainda existe."
      );
    } finally {
      setPublishing(false);
    }
  };

  return (
    <>
      <section
        role="status"
        className={cn(
          "rounded-2xl border border-amber-200 bg-amber-50/40 p-5 shadow-sm",
          "dark:border-amber-800/50 dark:bg-amber-950/20",
          compact && "p-4"
        )}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300">
                <AlertCircle className="h-4 w-4" aria-hidden />
              </span>
              <h4 className="text-base font-semibold text-slate-900 dark:text-slate-50">
                Custo pendente para publicação
              </h4>
              <span className="inline-flex rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:border-amber-700 dark:bg-amber-900/50 dark:text-amber-200">
                DRAFT
              </span>
            </div>
            <p className="max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              O snapshot da engenharia foi atualizado, mas o custo oficial publicado ainda não mudou.
              Publique este DRAFT para que o novo custo passe a valer nas margens conforme a vigência.
              Atualizar snapshot recalcula o custo. Publicar novo custo oficial altera a tabela usada nas
              margens.
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-stretch gap-1 lg:items-end lg:pt-1">
            <button
              type="button"
              disabled={!canPublish || publishing}
              title={
                canPublish
                  ? undefined
                  : "Você não tem permissão para publicar custos oficiais."
              }
              onClick={() => {
                setPublishError(null);
                setConfirmOpen(true);
              }}
              className={cn(
                "inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors",
                "bg-primary text-primary-foreground hover:bg-primary/90",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2",
                "disabled:cursor-not-allowed disabled:opacity-50 lg:w-auto"
              )}
            >
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Publicar novo custo oficial
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          <InnerPanel title="Resumo">
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500 dark:text-slate-400">Produto / SKU</dt>
                <dd className="font-mono font-medium text-slate-900 dark:text-slate-100">{sku}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500 dark:text-slate-400">Custo oficial atual</dt>
                <dd className="tabular-nums font-medium text-slate-900 dark:text-slate-100">
                  {officialCost ? formatProductCiu(officialUnit) : "Sem vigente"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500 dark:text-slate-400">Novo custo calculado</dt>
                <dd className="tabular-nums font-bold text-blue-700 dark:text-blue-300">
                  {formatProductCiu(draftUnit)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500 dark:text-slate-400">Diferença</dt>
                <dd
                  className={cn(
                    "tabular-nums font-semibold",
                    diffIsPositive
                      ? "text-amber-700 dark:text-amber-300"
                      : "text-slate-900 dark:text-slate-100"
                  )}
                >
                  {formatCurrency(diffAmount)} ({delta.percentLabel})
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500 dark:text-slate-400">Vigência do DRAFT</dt>
                <dd className="text-right font-medium text-slate-900 dark:text-slate-100">
                  {pendingDraft.effectiveDate}
                  {pendingDraft.versionCode ? ` · ${pendingDraft.versionCode}` : ""}
                  {pendingDraft.revision != null ? ` v${pendingDraft.revision}` : ""}
                </dd>
              </div>
            </dl>
          </InnerPanel>

          {!compact ? (
            <InnerPanel title="Quebra do custo (oficial → DRAFT)">
              <div className="space-y-2">
                <CostBreakdownRow
                  label="Material"
                  official={officialCost?.materialCost ?? 0}
                  draft={pendingDraft.materialCost}
                />
                <CostBreakdownRow
                  label="Mão de obra"
                  official={officialCost?.laborCost ?? 0}
                  draft={pendingDraft.laborCost}
                />
                <CostBreakdownRow
                  label="Máquina"
                  official={officialCost?.machineCost ?? 0}
                  draft={pendingDraft.machineCost}
                />
                <CostBreakdownRow
                  label="Indiretos / overhead"
                  official={officialCost?.overheadCost ?? 0}
                  draft={pendingDraft.overheadCost}
                />
                {(officialCost?.otherCost ?? 0) > 0 || pendingDraft.otherCost > 0 ? (
                  <CostBreakdownRow
                    label="Outros"
                    official={officialCost?.otherCost ?? 0}
                    draft={pendingDraft.otherCost}
                  />
                ) : null}
              </div>
            </InnerPanel>
          ) : null}
        </div>
      </section>

      {confirmOpen ? (
        <ProjectModalShell
          title="Publicar novo custo oficial?"
          onClose={() => {
            if (!publishing) setConfirmOpen(false);
          }}
          footer={
            <>
              <button
                type="button"
                className="rounded-lg border border-border px-4 py-2 text-sm"
                onClick={() => setConfirmOpen(false)}
                disabled={publishing}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={publishing || !canPublish}
                onClick={() => void handleConfirmPublish()}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
              >
                {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Confirmar publicação
              </button>
            </>
          }
        >
          {publishError ? (
            <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {publishError}
            </div>
          ) : null}
          <p className="text-sm text-muted-foreground mb-4">
            Após publicar, esta versão passa a ser oficial para cálculo de margem conforme a vigência.
            Versões publicadas são imutáveis.
          </p>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Produto / SKU</dt>
              <dd className="font-mono font-medium">{sku}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Custo oficial atual</dt>
              <dd className="tabular-nums font-medium">
                {officialCost ? formatProductCiu(officialUnit) : "Sem vigente"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Novo custo</dt>
              <dd className="tabular-nums font-bold">{formatProductCiu(draftUnit)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Variação</dt>
              <dd className="tabular-nums">
                {formatCurrency(difference?.amount ?? 0)} ({delta.percentLabel})
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Vigência</dt>
              <dd>
                {pendingDraft.effectiveDate}
                {pendingDraft.versionCode ? ` · ${pendingDraft.versionCode}` : ""}
              </dd>
            </div>
          </dl>
        </ProjectModalShell>
      ) : null}
    </>
  );
}
