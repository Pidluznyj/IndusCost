import React from "react";
import { cn } from "@/src/lib/utils";

/** Altura máxima padrão de tabelas operacionais (scroll interno). */
export const FINANCE_AP_TABLE_MAX_HEIGHT = "max-h-[min(70vh,640px)]";

export function FinanceApScrollableTable({
  children,
  className,
  tableClassName,
}: {
  children: React.ReactNode;
  className?: string;
  tableClassName?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-auto rounded-xl border border-border bg-card/60",
        FINANCE_AP_TABLE_MAX_HEIGHT,
        className
      )}
    >
      <table className={cn("w-full text-sm", tableClassName)}>{children}</table>
    </div>
  );
}

export function FinanceApStickyTableHead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm shadow-[0_1px_0_0_hsl(var(--border))]">
      {children}
    </thead>
  );
}

export function FinanceApErrorBanner({
  message,
  onRetry,
  onDismiss,
}: {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div
      className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex flex-wrap items-start justify-between gap-3"
      role="alert"
    >
      <span>{message}</span>
      <div className="flex flex-wrap items-center gap-3 shrink-0">
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="text-xs font-semibold underline underline-offset-2"
          >
            Tentar novamente
          </button>
        ) : null}
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs font-semibold underline underline-offset-2"
          >
            Fechar
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function FinanceApSuccessBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900 flex flex-wrap items-start justify-between gap-3">
      <span>{message}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs font-semibold underline underline-offset-2 shrink-0"
        >
          Fechar
        </button>
      ) : null}
    </div>
  );
}

export function FinanceApTabNav({
  tabs,
  activeId,
  onChange,
}: {
  tabs: ReadonlyArray<{ id: string; label: string }>;
  activeId: string;
  onChange: (id: string) => void;
}) {
  return (
    <nav
      className="flex gap-2 border-b border-border pb-2 overflow-x-auto overscroll-x-contain -mx-1 px-1"
      aria-label="Abas de Contas a Pagar"
    >
      {tabs.map((tab) => {
        const active = activeId === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              "rounded-lg px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}

export function FinanceApLoadingBlock({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/20 py-12 text-center text-sm text-muted-foreground">
      Carregando {label}…
    </div>
  );
}
