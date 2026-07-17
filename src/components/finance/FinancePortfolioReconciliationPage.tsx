import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { usePermissions } from "@/src/hooks/usePermissions";
import { useAuthorizedTabs } from "@/src/hooks/useAuthorizedTabs";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import { FINANCE_HEADER_ACTION_REFRESH } from "@/src/lib/financeModuleUiStandards";
import {
  isPortfolioReconciliationVisibleTabId,
  PERMISSION_DENIED_TAB_MESSAGE,
  PERMISSION_EMPTY_TABS_MESSAGE,
  PORTFOLIO_RECONCILIATION_UI_TABS,
  ResourceKeys,
  type PortfolioReconciliationVisibleTabId,
} from "@/src/lib/permissionsClient";
import { PermissionDenied } from "@/src/components/security/PermissionDenied";
import { PermissionGate } from "@/src/components/security/PermissionGate";
import { ProtectedTab } from "@/src/components/security/ProtectedTab";
import {
  PORTFOLIO_RECONCILIATION_PARALLEL_NOTICE,
  type PortfolioReconciliationRunDto,
  type PortfolioReconciliationRunsPayload,
} from "@/src/lib/financePortfolioReconciliationClient";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { FinanceModuleErrorBanner } from "@/src/components/finance/shared/FinanceModuleStates";
import { OrderToCashAuditTab } from "@/src/components/finance/portfolio-reconciliation/OrderToCashAuditTab";
import { OrderStatusTab } from "@/src/components/finance/portfolio-reconciliation/OrderStatusTab";
import { cn } from "@/src/lib/utils";

const PORTFOLIO_VISIBLE_TAB_CATALOG = PORTFOLIO_RECONCILIATION_UI_TABS.filter((t) =>
  isPortfolioReconciliationVisibleTabId(t.id)
);

/** Preferências: último SUCCESS; senão o mais recente da lista. */
function pickDisplayRun(
  runs: PortfolioReconciliationRunDto[]
): PortfolioReconciliationRunDto | null {
  if (!runs.length) return null;
  const success = runs.find((r) => String(r.status).toUpperCase() === "SUCCESS");
  return success ?? runs[0] ?? null;
}

/**
 * Financeiro > Conciliação de Carteira — auditoria paralela (read-only).
 * Não altera Fluxo de Caixa, Contas a Receber, Faturamento nem Comissões.
 *
 * Filtros globais legados foram removidos da UI (2026-07): cada aba
 * (Status Pedidos / Auditoria Pedido → Caixa) mantém seus próprios filtros.
 * Backend/list/runs permanecem disponíveis para as abas e Auditoria 360º.
 */
export function FinancePortfolioReconciliationPage() {
  const permissions = usePermissions();
  /** P12: módulo e abas via DTO (mesmo contrato da sidebar/rotas). */
  const canView = permissions.canViewModule("portfolio-reconciliation");
  const abortRef = useRef<AbortController | null>(null);

  const [runs, setRuns] = useState<PortfolioReconciliationRunsPayload["runs"]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * Aba ativa. useAuthorizedTabs corrige URL/estado legado não autorizado.
   */
  const [activeView, setActiveView] = useState<PortfolioReconciliationVisibleTabId>(
    "order-status-pedidos"
  );
  const {
    visibleTabs: authorizedTabDefs,
    activeId,
    isEmpty: noAuthorizedTabs,
  } = useAuthorizedTabs({
    tabs: PORTFOLIO_VISIBLE_TAB_CATALOG,
    requestedId: activeView,
  });
  const visibleTabs = useMemo(
    () =>
      authorizedTabDefs.map((t) => t.id as PortfolioReconciliationVisibleTabId),
    [authorizedTabDefs]
  );

  useEffect(() => {
    if (activeId && activeId !== activeView) {
      setActiveView(activeId as PortfolioReconciliationVisibleTabId);
    }
  }, [activeId, activeView]);

  const loadRuns = useCallback(async () => {
    if (!canView) {
      setLoadingRuns(false);
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoadingRuns(true);
    setError(null);
    try {
      const data = await fetchJsonOk<PortfolioReconciliationRunsPayload>(
        "/api/finance/portfolio-reconciliation/runs",
        { signal: ac.signal, credentials: "include" }
      );
      setRuns(data.runs ?? []);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setRuns([]);
      setError(
        buildFinanceTabLoadError("Não foi possível carregar a última run de conciliação.", e)
      );
    } finally {
      if (!ac.signal.aborted) setLoadingRuns(false);
    }
  }, [canView]);

  useEffect(() => {
    void loadRuns();
    return () => abortRef.current?.abort();
  }, [loadRuns]);

  const displayRun = useMemo(() => pickDisplayRun(runs), [runs]);
  const updatedAt = displayRun?.finishedAt ?? displayRun?.createdAt ?? null;

  if (!canView) {
    return (
      <PermissionDenied
        title="Sem permissão para Conciliação de Carteira"
        message="Solicite acesso ao módulo ou às abas desta auditoria paralela."
        testId="portfolio-reconciliation-no-module-permission"
      />
    );
  }

  if (noAuthorizedTabs) {
    return (
      <PermissionDenied
        title="Nenhuma aba disponível"
        message={PERMISSION_EMPTY_TABS_MESSAGE}
        testId="portfolio-reconciliation-empty-permission"
      />
    );
  }

  return (
    <div data-testid="finance-portfolio-reconciliation-page">
      <FinanceBiDashboardShell>
        <FinanceExecutivePageHeader
          compact
          title="Conciliação de Carteira"
          subtitle="Acompanhe pedidos, faturamento e cobrança em um só lugar. Somente leitura — não altera o fluxo de caixa."
          updatedAt={updatedAt}
          updatedAtLabel="Atualizado em"
          actions={[
            {
              id: "refresh",
              label: FINANCE_HEADER_ACTION_REFRESH,
              onClick: () => void loadRuns(),
              icon: <RefreshCw className={cn("h-4 w-4", loadingRuns && "animate-spin")} />,
            },
          ]}
        />

        {/* Aviso contratual discreto (testes + leitores de tela); sem banner azul. */}
        <p className="sr-only" data-testid="portfolio-reconciliation-parallel-notice">
          {PORTFOLIO_RECONCILIATION_PARALLEL_NOTICE}
        </p>
        {displayRun ? (
          <span
            className="sr-only"
            data-testid="portfolio-reconciliation-run-meta"
            data-run-id={displayRun.id}
            data-run-status={displayRun.status}
          >
            Run {displayRun.id} · {displayRun.status}
            {displayRun.mode ? ` · ${displayRun.mode}` : ""}
          </span>
        ) : null}

        {error ? (
          <FinanceModuleErrorBanner
            message={error}
            onRetry={() => void loadRuns()}
            onDismiss={() => setError(null)}
          />
        ) : null}

        <div
          className="mb-5 flex flex-wrap gap-1 rounded-lg border border-border bg-muted/30 p-1"
          role="tablist"
          aria-label="Visões da conciliação"
          data-testid="portfolio-reconciliation-view-tabs"
        >
          {visibleTabs.map((tabId) => {
            const tab = PORTFOLIO_RECONCILIATION_UI_TABS.find((t) => t.id === tabId);
            if (!tab) return null;
            const testId =
              tab.id === "order-status-pedidos"
                ? "portfolio-tab-order-status-pedidos"
                : "portfolio-tab-order-to-cash-audit";
            return (
              <PermissionGate key={tab.id} resourceKey={tab.resourceKey} mode="hide">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeView === tab.id}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                    activeView === tab.id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => setActiveView(tab.id)}
                  data-testid={testId}
                >
                  {tab.label}
                </button>
              </PermissionGate>
            );
          })}
        </div>

        <ProtectedTab
          resourceKey={ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_STATUS_PEDIDOS}
          active={activeView === "order-status-pedidos"}
          deniedMessage={PERMISSION_DENIED_TAB_MESSAGE}
        >
          <div className="mb-6 min-w-0 max-w-full">
            <OrderStatusTab />
          </div>
        </ProtectedTab>

        <ProtectedTab
          resourceKey={ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_AUDITORIA_PEDIDO_CAIXA}
          active={activeView === "order-to-cash-audit"}
          deniedMessage={PERMISSION_DENIED_TAB_MESSAGE}
        >
          <div className="mb-6 min-w-0 max-w-full">
            <OrderToCashAuditTab />
          </div>
        </ProtectedTab>
      </FinanceBiDashboardShell>
    </div>
  );
}
