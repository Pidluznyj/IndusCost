/**
 * Modal de relatório operacional após Igualar Bases Nomus.
 * Fase: NOMUS-EQUALIZE-USER-FEEDBACK-A.
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Copy,
  History,
  Loader2,
  RefreshCw,
  Scale,
  X,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import type { EqualizeModalViewModel } from "@/src/lib/nomusEqualizeUserMessages";
import { buildEqualizeTechnicalReport } from "@/src/lib/nomusEqualizeUserMessages";

export type NomusEqualizeResultModalProps = {
  open: boolean;
  onClose: () => void;
  viewModel: EqualizeModalViewModel | null;
  applying?: boolean;
  onRefreshPreview?: () => void;
  previewRefreshing?: boolean;
};

function variantIcon(variant: EqualizeModalViewModel["variant"]) {
  switch (variant) {
    case "success":
      return <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />;
    case "info":
      return <CircleHelp className="h-6 w-6 text-sky-600 shrink-0" />;
    case "warning":
      return <AlertTriangle className="h-6 w-6 text-amber-600 shrink-0" />;
    case "error":
      return <AlertTriangle className="h-6 w-6 text-red-600 shrink-0" />;
  }
}

function variantHeaderClass(variant: EqualizeModalViewModel["variant"]): string {
  switch (variant) {
    case "success":
      return "border-emerald-200 bg-emerald-50/80";
    case "info":
      return "border-sky-200 bg-sky-50/80";
    case "warning":
      return "border-amber-200 bg-amber-50/80";
    case "error":
      return "border-red-200 bg-red-50/80";
  }
}

const CountCard: React.FC<{ label: string; value: number; tone?: "neutral" | "warn" | "danger" }> = ({
  label,
  value,
  tone = "neutral",
}) => {
  const toneClass =
    tone === "danger"
      ? "border-red-200 bg-red-50 text-red-900"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-border bg-card text-foreground";
  return (
    <div className={cn("rounded-lg border p-2.5", toneClass)}>
      <p className="text-[10px] uppercase font-semibold opacity-80 leading-tight">{label}</p>
      <p className="text-xl font-bold tabular-nums mt-1">{value}</p>
    </div>
  );
};

export const NomusEqualizeResultModal: React.FC<NomusEqualizeResultModalProps> = ({
  open,
  onClose,
  viewModel,
  applying = false,
  onRefreshPreview,
  previewRefreshing = false,
}) => {
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [copyDone, setCopyDone] = useState(false);

  const reportText = useMemo(
    () => (viewModel ? buildEqualizeTechnicalReport(viewModel) : ""),
    [viewModel]
  );

  const onCopy = useCallback(async () => {
    if (!reportText) return;
    try {
      await navigator.clipboard.writeText(reportText);
      setCopyDone(true);
      window.setTimeout(() => setCopyDone(false), 2000);
    } catch {
      // fallback silencioso
    }
  }, [reportText]);

  if (!open) return null;

  if (applying) {
    return (
      <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 px-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-busy="true"
          className="w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-lg space-y-4"
        >
          <div className="flex items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary shrink-0" />
            <div>
              <h4 className="text-sm font-bold">Igualando bases com o Nomus…</h4>
              <p className="text-[11px] text-muted-foreground mt-1">
                O processo pode levar alguns segundos. Não feche esta janela nem clique novamente em
                Igualar bases.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!viewModel) return null;

  const changedTotal =
    viewModel.counts.createdProducts +
    viewModel.counts.createdMaterials +
    viewModel.counts.updatedProducts +
    viewModel.counts.updatedMaterials +
    viewModel.counts.deactivatedProducts +
    viewModel.counts.deactivatedMaterials;

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 px-3 py-4 sm:px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="equalize-result-title"
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl"
      >
        <div
          className={cn(
            "flex items-start gap-3 border-b px-4 py-3 sm:px-5",
            variantHeaderClass(viewModel.variant)
          )}
        >
          <Scale className="h-5 w-5 mt-0.5 text-primary shrink-0 hidden sm:block" />
          {variantIcon(viewModel.variant)}
          <div className="flex-1 min-w-0">
            <h2 id="equalize-result-title" className="text-base font-bold leading-snug">
              {viewModel.title}
            </h2>
            <p className="text-[11px] font-semibold text-muted-foreground mt-0.5">
              {viewModel.statusLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 hover:bg-black/5 shrink-0"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-5 space-y-4 text-[11px]">
          <p className="text-sm text-foreground leading-relaxed">{viewModel.userMessage}</p>
          <p className="text-muted-foreground leading-relaxed">{viewModel.executiveSummary}</p>

          {viewModel.resolutionHint ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950">
              <p className="font-bold text-[10px] uppercase tracking-wide">Ação recomendada</p>
              <p className="mt-1">{viewModel.resolutionHint}</p>
            </div>
          ) : null}

          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground mb-2">Resumo numérico</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <CountCard label="Produtos criados" value={viewModel.counts.createdProducts} />
              <CountCard label="Materiais criados" value={viewModel.counts.createdMaterials} />
              <CountCard label="Produtos atualizados" value={viewModel.counts.updatedProducts} />
              <CountCard label="Materiais atualizados" value={viewModel.counts.updatedMaterials} />
              <CountCard label="Produtos inativados" value={viewModel.counts.deactivatedProducts} />
              <CountCard label="Materiais inativados" value={viewModel.counts.deactivatedMaterials} />
              <CountCard label="Histórico criado" value={viewModel.counts.historyEntriesCreated} />
              <CountCard
                label="Ambíguos (revisão)"
                value={viewModel.counts.ambiguous}
                tone={viewModel.counts.ambiguous > 0 ? "warn" : "neutral"}
              />
              <CountCard
                label="Bloqueados"
                value={viewModel.counts.blocked}
                tone={viewModel.counts.blocked > 0 ? "warn" : "neutral"}
              />
              <CountCard
                label="Erros"
                value={viewModel.counts.errors}
                tone={viewModel.counts.errors > 0 ? "danger" : "neutral"}
              />
            </div>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1.5">
              O que foi alterado
            </p>
            {changedTotal > 0 ? (
              <ul className="list-disc list-inside space-y-0.5 text-foreground">
                {viewModel.counts.createdProducts > 0 ? (
                  <li>{viewModel.counts.createdProducts} produto(s) criado(s)</li>
                ) : null}
                {viewModel.counts.createdMaterials > 0 ? (
                  <li>{viewModel.counts.createdMaterials} material(is) criado(s)</li>
                ) : null}
                {viewModel.counts.updatedProducts > 0 ? (
                  <li>{viewModel.counts.updatedProducts} produto(s) atualizado(s) com dados do Nomus</li>
                ) : null}
                {viewModel.counts.updatedMaterials > 0 ? (
                  <li>{viewModel.counts.updatedMaterials} material(is) atualizado(s) com dados do Nomus</li>
                ) : null}
                {viewModel.counts.deactivatedProducts + viewModel.counts.deactivatedMaterials > 0 ? (
                  <li>
                    {viewModel.counts.deactivatedProducts + viewModel.counts.deactivatedMaterials}{" "}
                    item(ns) inativado(s) (sumiram do stage Nomus)
                  </li>
                ) : null}
              </ul>
            ) : (
              <p className="text-muted-foreground">Nenhum cadastro mestre foi alterado nesta execução.</p>
            )}
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1.5">
              O que não foi alterado por segurança
            </p>
            <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
              {viewModel.safetyLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>

          {viewModel.pendingLines.length > 0 ? (
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1.5">Pendências</p>
              <ul className="list-disc list-inside space-y-0.5 text-foreground">
                {viewModel.pendingLines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {viewModel.failedItems.length > 0 ? (
            <div className="rounded-lg border border-red-200 bg-red-50/60 px-3 py-2">
              <p className="font-bold text-[10px] uppercase text-red-900">Itens com falha</p>
              <ul className="mt-1 max-h-32 overflow-y-auto space-y-1 text-red-900">
                {viewModel.failedItems.slice(0, 10).map((e, i) => (
                  <li key={`${e.code}-${i}`}>
                    <strong className="font-mono">{e.sku}</strong>: {e.userMessage}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
            <button
              type="button"
              onClick={() => setTechnicalOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 text-left font-bold text-[10px] uppercase text-muted-foreground"
            >
              Detalhes técnicos
              {technicalOpen ? (
                <ChevronUp className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              )}
            </button>
            {technicalOpen ? (
              <dl className="mt-2 grid gap-1 text-[10px] font-mono text-muted-foreground">
                {viewModel.runId ? (
                  <>
                    <dt className="font-sans font-semibold text-foreground">RunId / protocolo</dt>
                    <dd className="break-all">{viewModel.runId}</dd>
                  </>
                ) : (
                  <dd>RunId: não gerado (operação bloqueada ou sem apply)</dd>
                )}
                {viewModel.planHash ? (
                  <>
                    <dt className="font-sans font-semibold text-foreground">PlanHash</dt>
                    <dd className="break-all">{viewModel.planHash}</dd>
                  </>
                ) : null}
                <dt className="font-sans font-semibold text-foreground">Data/hora</dt>
                <dd>{new Date(viewModel.generatedAt).toLocaleString("pt-BR")}</dd>
                <dt className="font-sans font-semibold text-foreground">Mensagem técnica</dt>
                <dd className="break-words font-sans">{viewModel.technicalMessage}</dd>
              </dl>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3 sm:px-5 bg-muted/20">
          {onRefreshPreview ? (
            <button
              type="button"
              onClick={onRefreshPreview}
              disabled={previewRefreshing}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50 mr-auto"
            >
              {previewRefreshing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Ver preview atualizado
            </button>
          ) : null}
          <a
            href="/products"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-accent"
            title="Abra um produto e use a aba Histórico para ver alterações por SKU"
          >
            <History className="h-3.5 w-3.5" />
            Ver histórico
          </a>
          <button
            type="button"
            onClick={() => void onCopy()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-accent"
          >
            <Copy className="h-3.5 w-3.5" />
            {copyDone ? "Copiado!" : "Copiar relatório"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground hover:bg-primary/90"
          >
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
};
