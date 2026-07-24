import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { ProjectModalShell } from "@/src/components/projects/ProjectModalShell";
import { ExecutiveAlert } from "@/src/components/ui/ExecutiveAlert";
import { formatProductCiu } from "@/src/lib/productCostDisplay";
import { formatCurrency } from "@/src/lib/utils";
import type {
  ProductionCostBulkPublishPreview,
  ProductionCostBulkPublishResult,
} from "@/src/lib/productionCostBulkPublish";

type Phase = "preview" | "confirm" | "result";

type Props = {
  open: boolean;
  phase: Phase;
  preview: ProductionCostBulkPublishPreview | null;
  result: ProductionCostBulkPublishResult | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onBackToPreview?: () => void;
  onRequestConfirm: () => void;
  onConfirmPublish: () => void;
};

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatProductCiu(value);
}

export function ProductProductionCostBulkPublishDialog({
  open,
  phase,
  preview,
  result,
  loading,
  error,
  onClose,
  onBackToPreview,
  onRequestConfirm,
  onConfirmPublish,
}: Props) {
  const [ack, setAck] = useState(false);

  if (!open) return null;

  if (phase === "result" && result) {
    return (
      <ProjectModalShell
        title="Resultado da publicação em lote"
        onClose={onClose}
        footer={
          <button
            type="button"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            onClick={onClose}
            data-testid="bulk-publish-result-close"
          >
            Fechar
          </button>
        }
      >
        <div className="space-y-4" data-testid="bulk-publish-result">
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Selecionados</dt>
              <dd className="font-medium">{result.summary.selected}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Publicados</dt>
              <dd className="font-medium text-emerald-700">{result.summary.published}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Conflitos</dt>
              <dd className="font-medium">{result.summary.conflict}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Erros</dt>
              <dd className="font-medium text-red-600">{result.summary.error}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Já publicados</dt>
              <dd className="font-medium">{result.summary.alreadyPublished}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Ignorados</dt>
              <dd className="font-medium">{result.summary.skipped}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Bloqueados</dt>
              <dd className="font-medium">{result.summary.blocked}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Lote</dt>
              <dd className="truncate font-mono text-xs">{result.batchRunId}</dd>
            </div>
          </dl>
          <div className="max-h-80 overflow-auto rounded-lg border border-border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-muted/80">
                <tr>
                  <th className="px-2 py-1.5 font-medium">SKU</th>
                  <th className="px-2 py-1.5 font-medium">Status</th>
                  <th className="px-2 py-1.5 font-medium text-right">Anterior</th>
                  <th className="px-2 py-1.5 font-medium text-right">Novo</th>
                  <th className="px-2 py-1.5 font-medium">Mensagem</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.productId} className="border-t border-border">
                    <td className="px-2 py-1.5 font-mono">{row.sku}</td>
                    <td className="px-2 py-1.5">{row.status}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {money(row.previousUnitCost)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {money(row.publishedUnitCost)}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">{row.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </ProjectModalShell>
    );
  }

  if (!preview) {
    return (
      <ProjectModalShell title="Publicar custos" onClose={onClose}>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Gerando prévia read-only…
          </div>
        ) : (
          <ExecutiveAlert
            variant="danger"
            density="inline"
            description={error ?? "Não foi possível gerar a prévia."}
          />
        )}
      </ProjectModalShell>
    );
  }

  const eligible = preview.summary.eligible;

  if (phase === "confirm") {
    return (
      <ProjectModalShell
        title="Confirmar publicação de custos"
        onClose={() => {
          if (!loading) {
            setAck(false);
            onClose();
          }
        }}
        footer={
          <>
            <button
              type="button"
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium"
              disabled={loading}
              onClick={() => {
                setAck(false);
                if (onBackToPreview) onBackToPreview();
                else onClose();
              }}
            >
              Voltar
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg border border-[#FBBF24] bg-[#FDE68A] px-4 py-2 text-sm font-medium text-[#92400E] disabled:opacity-60"
              disabled={loading || !ack || eligible <= 0}
              onClick={onConfirmPublish}
              data-testid="bulk-publish-confirm"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Publicar custos
            </button>
          </>
        }
      >
        <div className="space-y-4" data-testid="bulk-publish-confirm-panel">
          {error ? (
            <ExecutiveAlert variant="danger" density="inline" description={error} />
          ) : null}
          <p className="text-sm text-foreground">
            Serão publicados <strong>{eligible}</strong> custo(s) de produção.
          </p>
          <p className="text-sm text-muted-foreground">
            A publicação substituirá o custo oficial vigente de cada produto, preservando o
            histórico anterior. Itens bloqueados ou sem DRAFT válido não serão alterados.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              data-testid="bulk-publish-ack"
            />
            <span>
              Confirmo a publicação oficial de {eligible} custo(s) de produção DRAFT elegíveis.
            </span>
          </label>
        </div>
      </ProjectModalShell>
    );
  }

  return (
    <ProjectModalShell
      title="Prévia — publicar custos (read-only)"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium"
            onClick={onClose}
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-[#FBBF24] bg-[#FDE68A] px-4 py-2 text-sm font-medium text-[#92400E] disabled:opacity-60"
            disabled={loading || eligible <= 0}
            onClick={() => {
              setAck(false);
              onRequestConfirm();
            }}
            data-testid="bulk-publish-go-confirm"
          >
            Continuar ({eligible})
          </button>
        </>
      }
    >
      <div className="space-y-4" data-testid="bulk-publish-preview">
        {error ? (
          <ExecutiveAlert variant="danger" density="inline" description={error} />
        ) : null}
        <p className="text-xs text-muted-foreground">
          Esta prévia não publica, não arquiva e não altera o custo vigente.
        </p>
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Selecionados</dt>
            <dd className="font-medium">{preview.summary.selected}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Aptos</dt>
            <dd className="font-medium text-emerald-700">{preview.summary.eligible}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Sem DRAFT</dt>
            <dd className="font-medium">{preview.summary.withoutDraft}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">DRAFT antigo</dt>
            <dd className="font-medium">{preview.summary.staleDraft}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Múltiplos DRAFTs</dt>
            <dd className="font-medium">{preview.summary.multipleDrafts}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Bloqueados</dt>
            <dd className="font-medium">{preview.summary.blocked}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Já publicados</dt>
            <dd className="font-medium">{preview.summary.alreadyPublished}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Técnico s/ impacto</dt>
            <dd className="font-medium">{preview.summary.technicalOnly}</dd>
          </div>
        </dl>
        <div className="max-h-80 overflow-auto rounded-lg border border-border">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-muted/80">
              <tr>
                <th className="px-2 py-1.5 font-medium">SKU</th>
                <th className="px-2 py-1.5 font-medium text-right">Publicado</th>
                <th className="px-2 py-1.5 font-medium text-right">DRAFT</th>
                <th className="px-2 py-1.5 font-medium text-right">Δ</th>
                <th className="px-2 py-1.5 font-medium">Origem</th>
                <th className="px-2 py-1.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <tr key={row.productId} className="border-t border-border">
                  <td className="px-2 py-1.5">
                    <div className="font-mono">{row.sku}</div>
                    <div className="text-muted-foreground">{row.name}</div>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {money(row.publishedUnitCost)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {money(row.draftUnitCost)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {row.differenceAmount != null
                      ? formatCurrency(row.differenceAmount)
                      : "—"}
                    {row.differencePercent != null
                      ? ` (${row.differencePercent.toFixed(1)}%)`
                      : ""}
                  </td>
                  <td className="px-2 py-1.5">
                    <div>{row.draftSource ?? "—"}</div>
                    <div className="text-muted-foreground">
                      {row.draftCreatedAt
                        ? new Date(row.draftCreatedAt).toLocaleString("pt-BR")
                        : "—"}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <div>{row.eligible ? "APTO" : row.status}</div>
                    <div className="text-muted-foreground">{row.message}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </ProjectModalShell>
  );
}
