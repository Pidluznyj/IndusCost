import React from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { FileText, Loader2 } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { FinanceAccountsReceivablePage } from "@/src/components/finance/FinanceAccountsReceivablePage";
import { FinanceAccountsPayablePage } from "@/src/components/finance/FinanceAccountsPayablePage";
import { FinanceBillingPage } from "@/src/components/finance/FinanceBillingPage";
import { FinanceCashFlowPage } from "@/src/components/finance/FinanceCashFlowPage";
import { FinanceExecutiveReportPage } from "@/src/components/finance/FinanceExecutiveReportPage";
import { FinanceManagerialDrePage } from "@/src/components/finance/FinanceManagerialDrePage";
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
import { UnauthorizedAccessGate } from "@/src/components/UnauthorizedAccessGate";

function FinanceCanonicalRedirect() {
  const location = useLocation();
  const target = resolveFinanceCanonicalPath(location.pathname);
  return <Navigate to={target} replace />;
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
    return <UnauthorizedAccessGate forceDenied />;
  }

  // URL de seção sem grant → modal (PERM-39); sem Navigate silencioso
  const pathNorm = location.pathname.replace(/\/+$/, "") || "/";
  const onDeniedSection =
    pathNorm.startsWith("/finance/") &&
    !visibleSections.some(
      (s) => pathNorm === s.path || pathNorm.startsWith(`${s.path}/`)
    ) &&
    pathNorm !== "/finance";
  if (onDeniedSection) {
    return <UnauthorizedAccessGate forceDenied />;
  }

  const can = (id: FinanceSectionId) => visibleIds.has(id);

  const sectionRoutes: Record<FinanceSectionId, React.ReactNode> = {
    "cash-flow": can("cash-flow") ? (
      <FinanceCashFlowPage />
    ) : (
      <UnauthorizedAccessGate forceDenied />
    ),
    "accounts-receivable": can("accounts-receivable") ? (
      <FinanceAccountsReceivablePage />
    ) : (
      <UnauthorizedAccessGate forceDenied />
    ),
    "accounts-payable": can("accounts-payable") ? (
      <FinanceAccountsPayablePage />
    ) : (
      <UnauthorizedAccessGate forceDenied />
    ),
    billing: can("billing") ? (
      <FinanceBillingPage />
    ) : (
      <UnauthorizedAccessGate forceDenied />
    ),
    "sales-orders": can("sales-orders") ? (
      <FinanceSalesOrdersPage />
    ) : (
      <UnauthorizedAccessGate forceDenied />
    ),
    "cost-centers": can("cost-centers") ? (
      <FinanceCostCentersPage />
    ) : (
      <UnauthorizedAccessGate forceDenied />
    ),
    "executive-report": can("executive-report") ? (
      <FinanceExecutiveReportPage />
    ) : (
      <UnauthorizedAccessGate forceDenied />
    ),
    dre: can("dre") ? <FinanceManagerialDrePage /> : <UnauthorizedAccessGate forceDenied />,
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
        <Route path="dre" element={sectionRoutes.dre} />
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
