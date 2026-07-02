import React, { useState } from "react";
import { Loader2, TrendingUp } from "lucide-react";
import { cn, formatCurrency } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { AppAlert } from "@/src/components/shared/AppAlert";
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
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums text-right">
        <span className="text-muted-foreground">{formatProductCiu(official)}</span>
        <span className="mx-1.5 text-muted-foreground/60">→</span>
        <span className="font-medium">{formatProductCiu(draft)}</span>
      </span>
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
      <AppAlert
        variant="warning"
        role="status"
        showIcon={false}
        className={cn("space-y-4", compact && "p-3")}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <TrendingUp className="h-4 w-4 text-amber-700 dark:text-amber-400 shrink-0" />
              <h4 className="text-sm font-bold text-foreground">Custo pendente para publicação</h4>
              <span className="inline-flex rounded-full bg-amber-200/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-950 dark:bg-amber-900/50 dark:text-amber-100">
                DRAFT
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-3xl">
              O snapshot da engenharia foi atualizado, mas o custo oficial publicado ainda não mudou.
              Publique este DRAFT para que o novo custo passe a valer nas margens conforme a vigência.
              Atualizar snapshot recalcula o custo. Publicar novo custo oficial altera a tabela usada nas
              margens.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-1 shrink-0">
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
                "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
                "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Publicar novo custo oficial
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="space-y-2 rounded-lg border border-border/60 bg-background/60 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Resumo
            </p>
            <dl className="space-y-1.5 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Produto / SKU</dt>
                <dd className="font-mono font-medium">{sku}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Custo oficial atual</dt>
                <dd className="tabular-nums font-medium">
                  {officialCost ? formatProductCiu(officialUnit) : "Sem vigente"}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Novo custo calculado</dt>
                <dd className="tabular-nums font-bold text-foreground">
                  {formatProductCiu(draftUnit)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Diferença</dt>
                <dd className="tabular-nums font-medium">
                  {formatCurrency(difference?.amount ?? 0)} ({delta.percentLabel})
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Vigência do DRAFT</dt>
                <dd className="font-medium">
                  {pendingDraft.effectiveDate}
                  {pendingDraft.versionCode ? ` · ${pendingDraft.versionCode}` : ""}
                  {pendingDraft.revision != null ? ` v${pendingDraft.revision}` : ""}
                </dd>
              </div>
            </dl>
          </div>

          {!compact ? (
            <div className="space-y-2 rounded-lg border border-border/60 bg-background/60 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Quebra do custo (oficial → DRAFT)
              </p>
              <div className="space-y-1.5">
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
            </div>
          ) : null}
        </div>
      </AppAlert>

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
