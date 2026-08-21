import React from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  FINANCE_DEFAULT_SECTION,
  getFinanceDefaultPath,
  isFinanceCanonicalPath,
  parseFinanceSectionFromPath,
  resolveFinanceCanonicalPath,
  type FinanceSectionId,
} from "@/src/lib/financeNavigation";
import { FINANCE_UI_SECTIONS } from "@/src/lib/internalSurfaceAccess";
import { useAuthorizedTabs } from "@/src/hooks/useAuthorizedTabs";
import { UnauthorizedAccessGate } from "@/src/components/UnauthorizedAccessGate";
import { noteDevPerfRender } from "@/src/lib/devPerfBaselineClient";

// Cada seção do Financeiro é um chunk próprio: o roteador só monta a rota casada,
// então carregar as 8 seções no bundle inicial é download puro sem uso.
const FinanceAccountsReceivablePage = React.lazy(() =>
  import("@/src/components/finance/FinanceAccountsReceivablePage").then((m) => ({
    default: m.FinanceAccountsReceivablePage,
  }))
);
const FinanceAccountsPayablePage = React.lazy(() =>
  import("@/src/components/finance/FinanceAccountsPayablePage").then((m) => ({
    default: m.FinanceAccountsPayablePage,
  }))
);
const FinanceBillingPage = React.lazy(() =>
  import("@/src/components/finance/FinanceBillingPage").then((m) => ({
    default: m.FinanceBillingPage,
  }))
);
const FinanceCashFlowPage = React.lazy(() =>
  import("@/src/components/finance/FinanceCashFlowPage").then((m) => ({
    default: m.FinanceCashFlowPage,
  }))
);
const FinanceExecutiveReportPage = React.lazy(() =>
  import("@/src/components/finance/FinanceExecutiveReportPage").then((m) => ({
    default: m.FinanceExecutiveReportPage,
  }))
);
const FinanceManagerialDrePage = React.lazy(() =>
  import("@/src/components/finance/FinanceManagerialDrePage").then((m) => ({
    default: m.FinanceManagerialDrePage,
  }))
);
const FinanceDreCostCenterMappingPage = React.lazy(() =>
  import("@/src/components/finance/FinanceDreCostCenterMappingPage").then((m) => ({
    default: m.FinanceDreCostCenterMappingPage,
  }))
);
const FinanceCostCentersPage = React.lazy(() =>
  import("@/src/components/finance/cost-centers/FinanceCostCentersPage").then((m) => ({
    default: m.FinanceCostCentersPage,
  }))
);
const FinanceCostCenterDetailPage = React.lazy(() =>
  import("@/src/components/finance/cost-centers/FinanceCostCenterDetailPage").then((m) => ({
    default: m.FinanceCostCenterDetailPage,
  }))
);
const FinanceSalesOrdersPage = React.lazy(() =>
  import("@/src/components/finance/FinanceSalesOrdersPage").then((m) => ({
    default: m.FinanceSalesOrdersPage,
  }))
);

function FinanceCanonicalRedirect() {
  const location = useLocation();
  const target = resolveFinanceCanonicalPath(location.pathname);
  return <Navigate to={target} replace />;
}

export function FinanceModule() {
  noteDevPerfRender("FinanceModule");
  const location = useLocation();
  const requestedId = parseFinanceSectionFromPath(location.pathname);
  const { visibleTabs: visibleSections, isEmpty, activeId } = useAuthorizedTabs({
    tabs: FINANCE_UI_SECTIONS,
    requestedId,
  });
  const visibleIds = new Set(visibleSections.map((s) => s.id));
  const defaultPath =
    visibleSections.find((s) => s.id === activeId)?.path ??
    visibleSections.find((s) => s.id === FINANCE_DEFAULT_SECTION)?.path ??
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

      <React.Suspense fallback={<FinanceModuleLoadingFallback />}>
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
          <Route
            path="dre/parametrizacao"
            element={
              can("dre") ? (
                <FinanceDreCostCenterMappingPage />
              ) : (
                <UnauthorizedAccessGate forceDenied />
              )
            }
          />
          <Route path="dre" element={sectionRoutes.dre} />
          <Route path="*" element={<FinanceCanonicalRedirect />} />
        </Routes>
      </React.Suspense>
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
