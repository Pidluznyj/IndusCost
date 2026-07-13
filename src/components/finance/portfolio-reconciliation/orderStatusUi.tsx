import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HelpCircle, X } from "lucide-react";
import type { PortfolioOrderStatusConsolidated } from "@/src/lib/finance/portfolioOrderStatusService";
import { cn } from "@/src/lib/utils";

/** Tons suaves — status consolidado (tabela + drawer). */
export const ORDER_STATUS_BADGE_CLASS: Record<
  PortfolioOrderStatusConsolidated,
  string
> = {
  COMPLETO_RECEBIDO: "border-[#ABEFC6] bg-[#ECFDF3] text-[#067647]",
  COMPLETO_CR_ABERTO: "border-[#B2DDFF] bg-[#EFF8FF] text-[#175CD3]",
  COMPLETO_SEM_CR: "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]",
  COMPLETO_COM_CANCELAMENTO: "border-[#D0D5DD] bg-[#F9FAFB] text-[#344054]",
  RECEBIDO_COM_CANCELAMENTO: "border-[#ABEFC6] bg-[#ECFDF3]/80 text-[#067647]",
  PARCIAL_RECEBIDO: "border-[#ABEFC6] bg-[#ECFDF3]/80 text-[#067647]",
  PARCIAL_CR_ABERTO: "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]",
  PARCIAL_SEM_CR: "border-[#FDBA74] bg-[#FFF6ED] text-[#C2410C]",
  PARCIAL_COM_CANCELAMENTO: "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]",
  SEM_ATENDIMENTO_FUTURO: "border-[#D0D5DD] bg-[#F9FAFB] text-[#475467]",
  SEM_ATENDIMENTO_ATRASADO: "border-[#D0D5DD] bg-[#F2F4F7] text-[#344054]",
  NF_SEM_CR: "border-[#FDBA74] bg-[#FFF6ED] text-[#C2410C]",
  BLOQUEADO_REVISAO: "border-[#FECDCA] bg-[#FEF3F2] text-[#B42318]",
  CANCELADO: "border-[#D0D5DD] bg-[#F2F4F7] text-[#667085]",
};

export const ORDER_STATUS_TEMP_BADGE_CLASS: Record<string, string> = {
  QUENTE: "border-[#FECDCA] bg-[#FEF3F2] text-[#B42318]",
  MORNO: "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]",
  FRIO: "border-[#B2DDFF] bg-[#EFF8FF] text-[#175CD3]",
  CONGELADO: "border-[#D0D5DD] bg-[#F2F4F7] text-[#475467]",
};

export type OrderStatusAlertSeverity = "critical" | "warning" | "info";

const CRITICAL_ALERTS = new Set([
  "CR_VENCIDO",
  "PEDIDO_ANTIGO_SEM_EVOLUCAO",
  "NF_CABECALHO_MAIOR_PEDIDO",
  "PRODUTO_FORA_DO_PEDIDO",
  "DOCUMENTO_COM_EXCEDENTE",
  "DIVERGENCIA_PRECO",
]);

const INFO_ALERTS = new Set([
  "SEM_VENDEDOR_NOMUS",
  "SEM_RESPONSAVEL_COMERCIAL",
  "SEM_CONDICAO_PAGAMENTO",
]);

export function orderStatusAlertSeverity(
  alert: string
): OrderStatusAlertSeverity {
  if (CRITICAL_ALERTS.has(alert)) return "critical";
  if (INFO_ALERTS.has(alert)) return "info";
  return "warning";
}

export const ORDER_STATUS_ALERT_SEVERITY_CLASS: Record<
  OrderStatusAlertSeverity,
  string
> = {
  critical: "border-[#FECDCA] bg-[#FEF3F2] text-[#B42318]",
  warning: "border-[#FDBA74] bg-[#FFF6ED] text-[#C2410C]",
  info: "border-[#D0D5DD] bg-[#F9FAFB] text-[#475467]",
};

export const ORDER_STATUS_ALERT_SEVERITY_LABEL: Record<
  OrderStatusAlertSeverity,
  string
> = {
  critical: "Crítico",
  warning: "Atenção",
  info: "Informativo",
};

export function orderStatusDash(value: string | null | undefined): string {
  const s = value?.trim();
  return s ? s : "—";
}

/**
 * Rótulo de "Responsável Comercial" — pessoa responsável pela carteira do
 * cliente no CRM Comercial. Nunca setor / responsibleArea.
 */
export function orderStatusCommercialResponsibleLabel(
  value: string | null | undefined
): string {
  const s = value?.trim();
  return s ? s : "Sem responsável comercial";
}

/**
 * Rótulo de "Vendedor do Pedido" — vendedor do Pedido de Venda no Nomus.
 * Fonte oficial de comissão.
 */
export function orderStatusOrderSellerLabel(
  value: string | null | undefined
): string {
  const s = value?.trim();
  return s ? s : "Sem vendedor informado";
}

/** Tooltip discreto com texto curto (não JSON / sem termos técnicos). */
export function OrderStatusHintTooltip({
  hint,
  title,
}: {
  hint: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const place = () => {
      const rect = buttonRef.current!.getBoundingClientRect();
      const width = Math.min(window.innerWidth - 16, 300);
      let left = rect.right - width;
      if (left < 8) left = 8;
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - width - 8);
      }
      let top = rect.bottom + 8;
      if (top + 160 > window.innerHeight - 8) {
        top = Math.max(8, rect.top - 160 - 8);
      }
      setPos({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Ajuda: ${title}`}
        aria-expanded={open}
        aria-controls={open ? tooltipId : undefined}
        className={cn(
          "inline-flex shrink-0 cursor-help border-0 bg-transparent p-0 text-[#98A2B3] hover:text-[#667085]",
          "rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/35"
        )}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={panelRef}
              id={tooltipId}
              role="dialog"
              aria-label={title}
              className="fixed z-[90] w-[min(300px,calc(100vw-16px))] rounded-[12px] border border-[#E5E7EB] bg-white p-3 shadow-lg"
              style={{ top: pos.top, left: pos.left }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-1.5 flex items-start justify-between gap-2">
                <p className="text-[12px] font-semibold text-[#101828]">{title}</p>
                <button
                  type="button"
                  className="rounded-md p-0.5 text-[#98A2B3] hover:bg-[#F2F4F7] hover:text-[#667085]"
                  aria-label="Fechar ajuda"
                  onClick={() => setOpen(false)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-[12px] leading-relaxed text-[#475467]">{hint}</p>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
