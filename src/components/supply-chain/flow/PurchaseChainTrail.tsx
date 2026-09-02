/**
 * Trilha de fases da Cadeia de Compras + o bloco "Aqui porque / Para sair".
 *
 * Resolve a queixa central: a tela sabia o status e mesmo assim não dizia em
 * que fase o pedido estava, o que faltava para avançar, nem por que o botão
 * esperado não aparecia.
 *
 * Duas decisões de desenho que valem registro:
 *
 *  - As fases vêm de `PURCHASING_PIPELINE_STAGES`, o mesmo vocabulário que a
 *    Estação de Compras já usa. Inventar uma lista aqui faria as duas telas
 *    contarem histórias diferentes sobre o mesmo pedido.
 *  - `CANCELADO`/`ENCERRADO` NÃO entram na trilha. São saídas do funil (os
 *    indicadores já os excluem), então aparecem como selo terminal — desenhá-los
 *    como "última etapa" sugeriria que todo pedido deveria chegar lá.
 *
 * O texto vem pronto de `resolvePurchaseOrderGuidance` (lógica pura, testada);
 * aqui só há apresentação.
 */
import React from "react";
import { AlertTriangle, ArrowRight, Check, Lock } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { OverlayBadge } from "@/src/components/ui/overlay";
import { PURCHASING_PIPELINE_STAGES } from "@/src/lib/purchasing/purchasingWorkstationEngine";
import type { PurchasingPipelineStage } from "@/src/lib/purchasing/purchasingWorkstationEngine";
import type { PurchaseChainGuidance } from "@/src/lib/purchasing/purchaseChainGuidance";

const STAGE_LABEL: Record<PurchasingPipelineStage, string> = {
  SOLICITADO: "Solicitado",
  EM_COTACAO: "Em cotação",
  NEGOCIADO: "Negociado",
  PEDIDO: "Pedido",
  CONFIRMADO: "Confirmado",
  RECEBIDO: "Recebido",
};

export type PurchaseChainTrailProps = {
  /** Fase atual no funil canônico. */
  currentStage: PurchasingPipelineStage;
  /** Selo terminal, quando o pedido saiu do funil. */
  terminalLabel?: string | null;
  guidance: PurchaseChainGuidance;
  /** Executa a ação sugerida; a tela decide como (motivo, confirmação, etc). */
  onAction?: (guidance: PurchaseChainGuidance) => void;
  busy?: boolean;
};

export function PurchaseChainTrail({
  currentStage,
  terminalLabel,
  guidance,
  onAction,
  busy = false,
}: PurchaseChainTrailProps) {
  const currentIndex = PURCHASING_PIPELINE_STAGES.indexOf(currentStage);

  return (
    <div className="space-y-3" data-testid="purchase-chain-trail">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {PURCHASING_PIPELINE_STAGES.map((stage, index) => {
          const done = !terminalLabel && index < currentIndex;
          const current = !terminalLabel && index === currentIndex;
          return (
            <li key={stage} className="flex items-center gap-1">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
                  done && "bg-emerald-50 text-emerald-800",
                  current && "bg-primary text-primary-foreground",
                  !done && !current && "bg-muted text-muted-foreground"
                )}
                aria-current={current ? "step" : undefined}
              >
                {done ? <Check className="h-3 w-3" aria-hidden /> : null}
                {STAGE_LABEL[stage]}
              </span>
              {index < PURCHASING_PIPELINE_STAGES.length - 1 ? (
                <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden />
              ) : null}
            </li>
          );
        })}
        {terminalLabel ? (
          <li className="ml-2">
            <OverlayBadge tone="slate" variant="soft">
              {terminalLabel}
            </OverlayBadge>
          </li>
        ) : null}
      </ol>

      <div
        className={cn(
          "rounded-xl border px-4 py-3",
          guidance.blocked
            ? "border-amber-200 bg-amber-50/60"
            : "border-primary/25 bg-primary/5"
        )}
        data-testid="purchase-chain-next-step"
      >
        <p className="text-sm leading-snug text-foreground">
          <span className="font-medium text-muted-foreground">Aqui porque </span>
          {guidance.stayReason}
        </p>

        {guidance.terminal ? (
          <p className="mt-1 text-sm leading-snug text-muted-foreground">
            {guidance.nextAction}
          </p>
        ) : (
          <p className="mt-1 text-sm leading-snug text-foreground">
            <span className="font-medium text-sky-800">Para sair · </span>
            {guidance.nextAction}
          </p>
        )}

        {guidance.blocked ? (
          <div className="mt-2 flex items-start gap-2 text-sm text-amber-900">
            {guidance.blocked.reason.match(/permiss/i) ? (
              <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            )}
            <div className="min-w-0">
              <p className="font-medium">{guidance.blocked.reason}</p>
              {guidance.blocked.hint ? (
                <p className="mt-0.5 text-xs text-amber-800">{guidance.blocked.hint}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {guidance.action && onAction ? (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction(guidance)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              data-testid="purchase-chain-next-action"
            >
              {guidance.action.label}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
