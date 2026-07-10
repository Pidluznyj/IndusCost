import React from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { FileText, Loader2 } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { useAuth } from "@/src/contexts/AuthContext";
import { FinanceAccountsReceivablePage } from "@/src/components/finance/FinanceAccountsReceivablePage";
import { FinanceAccountsPayablePage } from "@/src/components/finance/FinanceAccountsPayablePage";
import { FinanceBillingPage } from "@/src/components/finance/FinanceBillingPage";
import { FinanceCashFlowPage } from "@/src/components/finance/FinanceCashFlowPage";
import { FinanceExecutiveReportPage } from "@/src/components/finance/FinanceExecutiveReportPage";
import {
  canViewFinanceAccountsPayable,
} from "@/src/lib/financeAccountsPayablePermissions";
import { canViewFinanceAccountsReceivable } from "@/src/lib/financeAccountsReceivablePermissions";
import { canViewFinanceBilling } from "@/src/lib/financeBillingPermissions";
import { canViewFinanceCashFlow } from "@/src/lib/financeCashFlowPermissions";
import { canViewFinanceExecutiveReport } from "@/src/lib/financeExecutiveReportPermissions";
import { canViewFinanceCostCenters } from "@/src/lib/financeCostCentersPermissions";
import { FinanceCostCentersPage } from "@/src/components/finance/cost-centers/FinanceCostCentersPage";
import { FinanceCostCenterDetailPage } from "@/src/components/finance/cost-centers/FinanceCostCenterDetailPage";
import { canViewFinanceSalesOrders } from "@/src/lib/financeSalesOrdersPermissions";
import { FinanceSalesOrdersPage } from "@/src/components/finance/FinanceSalesOrdersPage";
import {
  FINANCE_SECTIONS,
  getFinanceDefaultPath,
  getFinanceSectionPath,
  isFinanceCanonicalPath,
  resolveFinanceCanonicalPath,
  type FinanceSectionId,
} from "@/src/lib/financeNavigation";

function FinanceCanonicalRedirect() {
  const location = useLocation();
  const target = resolveFinanceCanonicalPath(location.pathname);
  return <Navigate to={target} replace />;
}

export function FinanceModule() {
  const auth = useAuth();
  const location = useLocation();
  const canViewAccountsReceivable = canViewFinanceAccountsReceivable(auth);
  const canViewAccountsPayable = canViewFinanceAccountsPayable(auth);
  const canViewBilling = canViewFinanceBilling(auth);
  const canViewCashFlow = canViewFinanceCashFlow(auth);
  const canViewExecutiveReport = canViewFinanceExecutiveReport(auth);
  const canViewSalesOrders = canViewFinanceSalesOrders(auth);
  const canViewCostCenters = canViewFinanceCostCenters(auth);

  const visibleSections = FINANCE_SECTIONS.filter((section) => {
    if (section.id === "cash-flow") return canViewCashFlow;
    if (section.id === "accounts-receivable") return canViewAccountsReceivable;
    if (section.id === "accounts-payable") return canViewAccountsPayable;
    if (section.id === "billing") return canViewBilling;
    if (section.id === "sales-orders") return canViewSalesOrders;
    if (section.id === "cost-centers") return canViewCostCenters;
    if (section.id === "executive-report") return canViewExecutiveReport;
    return false;
  });

  const defaultPath = visibleSections[0]?.path ?? getFinanceDefaultPath();

  if (!isFinanceCanonicalPath(location.pathname)) {
    return <FinanceCanonicalRedirect />;
  }

  if (visibleSections.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        Você não tem permissão para acessar o domínio Financeiro nesta fase.
      </div>
    );
  }

  const sectionRoutes: Record<FinanceSectionId, React.ReactNode> = {
    "cash-flow": canViewCashFlow ? (
      <FinanceCashFlowPage />
    ) : (
      <div className="rounded-xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">
        Sem permissão para Fluxo de Caixa.
      </div>
    ),
    "accounts-receivable": canViewAccountsReceivable ? (
      <FinanceAccountsReceivablePage />
    ) : (
      <div className="rounded-xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">
        Sem permissão para Contas a Receber.
      </div>
    ),
    "accounts-payable": canViewAccountsPayable ? (
      <FinanceAccountsPayablePage />
    ) : (
      <div className="rounded-xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">
        Sem permissão para Contas a Pagar.
      </div>
    ),
    billing: canViewBilling ? (
      <FinanceBillingPage />
    ) : (
      <div className="rounded-xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">
        Sem permissão para Faturamento.
      </div>
    ),
    "sales-orders": canViewSalesOrders ? (
      <FinanceSalesOrdersPage />
    ) : (
      <div className="rounded-xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">
        Sem permissão para Pedidos de Venda.
      </div>
    ),
    "cost-centers": canViewCostCenters ? (
      <FinanceCostCentersPage />
    ) : (
      <div className="rounded-xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">
        Sem permissão para Centros de Custo.
      </div>
    ),
    "executive-report": canViewExecutiveReport ? (
      <FinanceExecutiveReportPage />
    ) : (
      <div className="rounded-xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">
        Sem permissão para Relatório Presidencial.
      </div>
    ),
  };

  return (
    <div className="space-y-6" data-testid="finance-module-with-tabs">
      {canViewExecutiveReport ? (
        <div className="finance-executive-report-print-no-print flex justify-end">
          <NavLink
            to={getFinanceSectionPath("executive-report")}
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
        <Route path="cost-centers/:costCenterId" element={sectionRoutes["cost-centers"] ? <FinanceCostCenterDetailPage /> : <Navigate to={defaultPath} replace />} />
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
