import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";

export type CrmCustomerAccountModalProps = {
  /** Nome do cliente, para o título acessível do diálogo. */
  customerName: string;
  onClose: () => void;
  children: React.ReactNode;
};

/**
 * Modal do cliente da Carteira: identidade, resumo comercial, relacionamento,
 * agenda, histórico, próximas ações e linha do tempo. Abre por cima do grid —
 * a lista e os filtros continuam como estavam ao fechar.
 *
 * Os modais de "Registrar contato", "Perfil" e o detalhe do pedido abrem por
 * cima deste (vêm depois no DOM ou são portalizados); por isso o Esc só fecha
 * este quando nenhum deles está aberto.
 */
export const CrmCustomerAccountModal: React.FC<CrmCustomerAccountModalProps> = ({ customerName, onClose, children }) => {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Outro diálogo aberto por cima trata o próprio Esc.
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs.length > 1) return;
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 p-0 sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      data-testid="crm-customer-account-modal"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Cliente ${customerName}`}
        tabIndex={-1}
        className="flex w-full max-w-[1500px] flex-col overflow-hidden bg-background shadow-2xl outline-none sm:rounded-2xl sm:border sm:border-border"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-5 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Cliente da carteira</p>
            <p className="truncate text-base font-bold text-foreground">{customerName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-accent"
          >
            <X className="h-4 w-4" />
            Fechar
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
};
