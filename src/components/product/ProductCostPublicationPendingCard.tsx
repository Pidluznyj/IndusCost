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
import {
  ExecutiveAlert,
  ExecutiveAlertPanel,
} from "@/src/components/ui/ExecutiveAlert";
import {
  EXECUTIVE_ALERT_LABEL_CLASS,
  executiveAlertValueClass,
} from "@/src/lib/executiveAlertStyles";

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
      <span className={EXECUTIVE_ALERT_LABEL_CLASS}>{label}</span>
      <span className={cn("tabular-nums text-right", executiveAlertValueClass("default"))}>
        <span className={EXECUTIVE_ALERT_LABEL_CLASS}>{formatProductCiu(official)}</span>
        <span className="mx-2 text-amber-300" aria-hidden>
          →
        </span>
        <span className="font-semibold">{formatProductCiu(draft)}</span>
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
  const diffAmount = difference?.amount ?? 0;
  const diffIsPositive = diffAmount > 0;
  const diffIsNegative = diffAmount < 0;

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
      <ExecutiveAlert
        variant="attention"
        density={compact ? "compact" : "default"}
        testId="engineering-pending-cost-alert"
        title="Custo pendente para publicação"
        badge="DRAFT"
        icon={<AlertCircle className="h-4 w-4" aria-hidden />}
        description={
          <>
            O snapshot da engenharia foi atualizado, mas o custo oficial publicado ainda não mudou.
            Publique este DRAFT para que o novo custo passe a valer nas margens conforme a vigência.
            Atualizar snapshot recalcula o custo. Publicar novo custo oficial altera a tabela usada nas
            margens.
          </>
        }
        actions={
          <button
            type="button"
            disabled={!canPublish || publishing}
            title={
              canPublish ? undefined : "Você não tem permissão para publicar custos oficiais."
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
        }
      >
        <div className={cn("grid grid-cols-1 gap-4", !compact && "mt-5 md:grid-cols-2")}>
          <ExecutiveAlertPanel title="Resumo">
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className={EXECUTIVE_ALERT_LABEL_CLASS}>Produto / SKU</dt>
                <dd className={cn("font-mono font-medium", executiveAlertValueClass("default"))}>
                  {sku}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className={EXECUTIVE_ALERT_LABEL_CLASS}>Custo oficial atual</dt>
                <dd className={cn("tabular-nums font-medium", executiveAlertValueClass("default"))}>
                  {officialCost ? formatProductCiu(officialUnit) : "Sem vigente"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className={EXECUTIVE_ALERT_LABEL_CLASS}>Novo custo calculado</dt>
                <dd className={cn("tabular-nums font-bold", executiveAlertValueClass("default"))}>
                  {formatProductCiu(draftUnit)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className={EXECUTIVE_ALERT_LABEL_CLASS}>Diferença</dt>
                <dd
                  className={cn(
                    "tabular-nums font-semibold",
                    diffIsPositive && executiveAlertValueClass("positive"),
                    diffIsNegative && executiveAlertValueClass("negative"),
                    !diffIsPositive && !diffIsNegative && executiveAlertValueClass("default")
                  )}
                >
                  {formatCurrency(diffAmount)} ({delta.percentLabel})
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className={EXECUTIVE_ALERT_LABEL_CLASS}>Vigência do DRAFT</dt>
                <dd className={cn("text-right font-medium", executiveAlertValueClass("default"))}>
                  {pendingDraft.effectiveDate}
                  {pendingDraft.versionCode ? ` · ${pendingDraft.versionCode}` : ""}
                  {pendingDraft.revision != null ? ` v${pendingDraft.revision}` : ""}
                </dd>
              </div>
            </dl>
          </ExecutiveAlertPanel>

          {!compact ? (
            <ExecutiveAlertPanel title="Quebra do custo (oficial → DRAFT)">
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
            </ExecutiveAlertPanel>
          ) : null}
        </div>
      </ExecutiveAlert>

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
            <ExecutiveAlert variant="danger" density="inline" description={publishError} />
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
