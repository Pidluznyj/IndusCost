import React from "react";
import { Loader2 } from "lucide-react";
import { FinanceBiEmptyState } from "@/src/components/finance/bi/FinanceBiEmptyState";
import {
  FinanceApErrorBanner,
  FinanceApLoadingBlock,
} from "@/src/components/finance/FinanceAccountsPayableUiShared";
import {
  FINANCE_MODULE_EMPTY_FILTERED_DESCRIPTION,
  FINANCE_MODULE_EMPTY_FILTERED_TITLE,
  FINANCE_MODULE_LOADING_DEFAULT,
} from "@/src/lib/financeModuleUiStandards";

/** Banner de erro padronizado para abas do módulo Financeiro. */
export function FinanceModuleErrorBanner({
  message,
  onRetry,
  onDismiss,
}: {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <FinanceApErrorBanner
      message={message}
      onRetry={onRetry}
      onDismiss={onDismiss}
    />
  );
}

/** Bloco de carregamento padronizado. */
export function FinanceModuleLoadingBlock({
  label = FINANCE_MODULE_LOADING_DEFAULT,
}: {
  label?: string;
}) {
  return <FinanceApLoadingBlock label={label} />;
}

/** Carregamento inicial em tela cheia (sem card). */
export function FinanceModulePageLoading({
  label = FINANCE_MODULE_LOADING_DEFAULT,
}: {
  label?: string;
}) {
  return (
    <div
      className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"
      data-testid="finance-module-page-loading"
      role="status"
    >
      <Loader2 className="h-5 w-5 animate-spin" />
      {label}
    </div>
  );
}

/** Estado vazio padronizado para listas/gráficos. */
export function FinanceModuleEmptyState({
  title = FINANCE_MODULE_EMPTY_FILTERED_TITLE,
  description = FINANCE_MODULE_EMPTY_FILTERED_DESCRIPTION,
  icon,
}: {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
}) {
  return <FinanceBiEmptyState title={title} description={description} icon={icon} />;
}
