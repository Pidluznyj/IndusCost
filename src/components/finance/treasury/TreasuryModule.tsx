import React from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { cn } from "@/src/lib/utils";
import {
  TREASURY_UI_BASE_PATH,
  TREASURY_UI_LABEL,
  TREASURY_UI_SECTIONS,
} from "./treasuryFeatureUi.js";
import { TreasuryDashboardPage } from "./TreasuryDashboardPage.js";
import { TreasuryAccountsPage } from "./TreasuryAccountsPage.js";
import { TreasuryAccountBalancePage } from "./TreasuryAccountBalancePage.js";
import { TreasuryReceivablesPage } from "./TreasuryReceivablesPage.js";
import { TreasuryPayablesPage } from "./TreasuryPayablesPage.js";
import { TreasuryAgendaPage } from "./TreasuryAgendaPage.js";
import { TreasuryProjectionComparisonPage } from "./TreasuryProjectionComparisonPage.js";
import { TreasuryTransfersPage } from "./TreasuryTransfersPage.js";
import { TreasuryBankMovementsPage } from "./TreasuryBankMovementsPage.js";
import { TreasuryExceptionsPage } from "./TreasuryExceptionsPage.js";
import { TreasuryDailyClosingPage } from "./TreasuryDailyClosingPage.js";
import { TreasuryReportsPage } from "./TreasuryReportsPage.js";
import { TreasuryManualEntriesPage } from "./TreasuryManualEntriesPage.js";
import { TreasuryPaymentSchedulePage } from "./TreasuryPaymentSchedulePage.js";
import { TreasuryReconcileWorkspacePage } from "./TreasuryReconcileWorkspacePage.js";
import { TreasuryAuditPage } from "./TreasuryAuditPage.js";

/**
 * Shell da Central de Tesouraria — rotas aninhadas sob /finance/treasury/*.
 */
export function TreasuryModule() {
  return (
    <div className="space-y-6" data-testid="treasury-module">
      <div className="space-y-1">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Financeiro
        </p>
        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          {TREASURY_UI_LABEL}
        </h1>
      </div>

      <nav
        className="flex flex-wrap gap-2 border-b border-border pb-3"
        data-testid="treasury-module-tabs"
      >
        {TREASURY_UI_SECTIONS.map((section) => (
          <NavLink
            key={section.id}
            to={section.path}
            end={section.id === "home"}
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
        <Route index element={<TreasuryDashboardPage />} />
        <Route path="accounts" element={<TreasuryAccountsPage />} />
        <Route
          path="accounts/:accountId/balances"
          element={<TreasuryAccountBalancePage />}
        />
        <Route path="receivables" element={<TreasuryReceivablesPage />} />
        <Route path="payables" element={<TreasuryPayablesPage />} />
        <Route
          path="payment-schedule"
          element={<TreasuryPaymentSchedulePage />}
        />
        <Route path="agenda" element={<TreasuryAgendaPage />} />
        <Route
          path="projections"
          element={<TreasuryProjectionComparisonPage />}
        />
        <Route path="transfers" element={<TreasuryTransfersPage />} />
        <Route path="manual-entries" element={<TreasuryManualEntriesPage />} />
        <Route path="bank-movements" element={<TreasuryBankMovementsPage />} />
        <Route path="ofx" element={<TreasuryBankMovementsPage />} />
        <Route path="reconcile" element={<TreasuryReconcileWorkspacePage />} />
        <Route path="exceptions" element={<TreasuryExceptionsPage />} />
        <Route path="closing" element={<TreasuryDailyClosingPage />} />
        <Route path="reports" element={<TreasuryReportsPage />} />
        <Route path="audit" element={<TreasuryAuditPage />} />
        <Route
          path="*"
          element={<Navigate to={TREASURY_UI_BASE_PATH} replace />}
        />
      </Routes>
    </div>
  );
}
