import React from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { FileText, Loader2 } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { FinanceAccountsReceivablePage } from "@/src/components/finance/FinanceAccountsReceivablePage";
import { FinanceAccountsPayablePage } from "@/src/components/finance/FinanceAccountsPayablePage";
import { FinanceBillingPage } from "@/src/components/finance/FinanceBillingPage";
import { FinanceCashFlowPage } from "@/src/components/finance/FinanceCashFlowPage";
import { FinanceExecutiveReportPage } from "@/src/components/finance/FinanceExecutiveReportPage";
import { FinanceCostCentersPage } from "@/src/components/finance/cost-centers/FinanceCostCentersPage";
import { FinanceCostCenterDetailPage } from "@/src/components/finance/cost-centers/FinanceCostCenterDetailPage";
import { FinanceSalesOrdersPage } from "@/src/components/finance/FinanceSalesOrdersPage";
import {
  getFinanceDefaultPath,
  isFinanceCanonicalPath,
  parseFinanceSectionFromPath,
  resolveFinanceCanonicalPath,
  type FinanceSectionId,
} from "@/src/lib/financeNavigation";
import { FINANCE_UI_SECTIONS } from "@/src/lib/internalSurfaceAccess";
import { useAuthorizedTabs } from "@/src/hooks/useAuthorizedTabs";
import { PermissionDenied } from "@/src/components/security/PermissionDenied";
import { PERMISSION_EMPTY_TABS_MESSAGE } from "@/src/lib/permissionsClient";

function FinanceCanonicalRedirect() {
  const location = useLocation();
  const target = resolveFinanceCanonicalPath(location.pathname);
  return <Navigate to={target} replace />;
}

function DeniedSection({ label }: { label: string }) {
  return (
    <PermissionDenied
      title="Seção sem permissão"
      message={`Você não tem permissão para ${label}.`}
      testId="finance-section-denied"
    />
  );
}

export function FinanceModule() {
  const location = useLocation();
  const requestedId = parseFinanceSectionFromPath(location.pathname);
  const { visibleTabs: visibleSections, isEmpty, activeId } = useAuthorizedTabs({
    tabs: FINANCE_UI_SECTIONS,
    requestedId,
  });
  const visibleIds = new Set(visibleSections.map((s) => s.id));
  const defaultPath =
    visibleSections.find((s) => s.id === activeId)?.path ??
    visibleSections[0]?.path ??
    getFinanceDefaultPath();

  if (!isFinanceCanonicalPath(location.pathname)) {
    return <FinanceCanonicalRedirect />;
  }

  if (isEmpty) {
    return (
      <PermissionDenied
        title="Nenhuma aba disponível"
        message={PERMISSION_EMPTY_TABS_MESSAGE}
        testId="finance-module-empty-tabs"
      />
    );
  }

  // URL de seção sem grant → redirect para primeira autorizada (não renderiza conteúdo oculto)
  const pathNorm = location.pathname.replace(/\/+$/, "") || "/";
  const onDeniedSection =
    pathNorm.startsWith("/finance/") &&
    !visibleSections.some(
      (s) => pathNorm === s.path || pathNorm.startsWith(`${s.path}/`)
    ) &&
    pathNorm !== "/finance";
  if (onDeniedSection && pathNorm !== defaultPath) {
    return <Navigate to={defaultPath} replace />;
  }

  const can = (id: FinanceSectionId) => visibleIds.has(id);

  const sectionRoutes: Record<FinanceSectionId, React.ReactNode> = {
    "cash-flow": can("cash-flow") ? (
      <FinanceCashFlowPage />
    ) : (
      <DeniedSection label="Fluxo de Caixa" />
    ),
    "accounts-receivable": can("accounts-receivable") ? (
      <FinanceAccountsReceivablePage />
    ) : (
      <DeniedSection label="Contas a Receber" />
    ),
    "accounts-payable": can("accounts-payable") ? (
      <FinanceAccountsPayablePage />
    ) : (
      <DeniedSection label="Contas a Pagar" />
    ),
    billing: can("billing") ? (
      <FinanceBillingPage />
    ) : (
      <DeniedSection label="Faturamento" />
    ),
    "sales-orders": can("sales-orders") ? (
      <FinanceSalesOrdersPage />
    ) : (
      <DeniedSection label="Pedidos de Venda" />
    ),
    "cost-centers": can("cost-centers") ? (
      <FinanceCostCentersPage />
    ) : (
      <DeniedSection label="Centros de Custo" />
    ),
    "executive-report": can("executive-report") ? (
      <FinanceExecutiveReportPage />
    ) : (
      <DeniedSection label="Relatório Presidencial" />
    ),
  };

  return (
    <div className="space-y-6" data-testid="finance-module-with-tabs">
      {can("executive-report") ? (
        <div className="finance-executive-report-print-no-print flex justify-end">
          <NavLink
            to="/finance/executive-report"
            className={({ isActive }) =>
              cn(
                "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
                isActive
                  ? "bg-[#1e3a5f] text-white"
                  : "border border-[#1e3a5f]/30 bg-[#eff6ff] text-[#1e3a5f] hover:bg-[#dbeafe]"
              )
            }
            data-testid="finance-executive-report-link"
          >
            <FileText className="h-4 w-4" />
            Relatório Presidencial
          </NavLink>
        </div>
      ) : null}

      <nav
        className="finance-module-tabs flex flex-wrap gap-2 border-b border-border pb-3"
        data-testid="finance-module-tabs"
      >
        {visibleSections.map((section) => (
          <NavLink
            key={section.id}
            to={section.path}
            end
            className={({ isActive }) =>
              cn(
                "inline-flex items-center rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )
            }
          >
            {section.label}
          </NavLink>
        ))}
      </nav>

      <Routes>
        <Route index element={<Navigate to={defaultPath} replace />} />
        <Route path="cash-flow" element={sectionRoutes["cash-flow"]} />
        <Route path="accounts-receivable" element={sectionRoutes["accounts-receivable"]} />
        <Route path="accounts-payable" element={sectionRoutes["accounts-payable"]} />
        <Route path="billing" element={sectionRoutes.billing} />
        <Route path="sales-orders" element={sectionRoutes["sales-orders"]} />
        <Route
          path="cost-centers/:costCenterId"
          element={
            can("cost-centers") ? (
              <FinanceCostCenterDetailPage />
            ) : (
              <Navigate to={defaultPath} replace />
            )
          }
        />
        <Route path="cost-centers" element={sectionRoutes["cost-centers"]} />
        <Route path="executive-report" element={sectionRoutes["executive-report"]} />
        <Route path="*" element={<FinanceCanonicalRedirect />} />
      </Routes>
    </div>
  );
}

export function FinanceModuleLoadingFallback() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Carregando Financeiro…
    </div>
  );
}
