import React from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { useAuth } from "@/src/contexts/AuthContext";
import { FinanceAccountsReceivablePage } from "@/src/components/finance/FinanceAccountsReceivablePage";
import { FinanceAccountsPayablePage } from "@/src/components/finance/FinanceAccountsPayablePage";
import {
  canViewFinanceAccountsPayable,
} from "@/src/lib/financeAccountsPayablePermissions";
import { canViewFinanceAccountsReceivable } from "@/src/lib/financeAccountsReceivablePermissions";

const FINANCE_SECTIONS = [
  { id: "accounts-receivable", label: "Contas a Receber", to: "accounts-receivable" },
  { id: "accounts-payable", label: "Contas a Pagar", to: "accounts-payable" },
] as const;

export function FinanceModule() {
  const auth = useAuth();
  const canViewAccountsReceivable = canViewFinanceAccountsReceivable(auth);
  const canViewAccountsPayable = canViewFinanceAccountsPayable(auth);

  const visibleSections = FINANCE_SECTIONS.filter((section) => {
    if (section.id === "accounts-receivable") return canViewAccountsReceivable;
    if (section.id === "accounts-payable") return canViewAccountsPayable;
    return false;
  });

  const defaultSection = visibleSections[0]?.to ?? "accounts-receivable";

  if (visibleSections.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        Você não tem permissão para acessar o domínio Financeiro nesta fase.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-2 border-b border-border pb-3">
        {visibleSections.map((section) => (
          <NavLink
            key={section.id}
            to={section.to}
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
        <Route index element={<Navigate to={defaultSection} replace />} />
        <Route
          path="accounts-receivable"
          element={
            canViewAccountsReceivable ? (
              <FinanceAccountsReceivablePage />
            ) : (
              <div className="rounded-xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">
                Sem permissão para Contas a Receber.
              </div>
            )
          }
        />
        <Route
          path="accounts-payable"
          element={
            canViewAccountsPayable ? (
              <FinanceAccountsPayablePage />
            ) : (
              <div className="rounded-xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">
                Sem permissão para Contas a Pagar.
              </div>
            )
          }
        />
        <Route path="*" element={<Navigate to={defaultSection} replace />} />
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
