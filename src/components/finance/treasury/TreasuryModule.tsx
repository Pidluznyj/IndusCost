import React, { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { cn } from "@/src/lib/utils";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchTreasuryAvailability } from "@/src/lib/treasury/treasuryAvailabilityApi.js";
import {
  TREASURY_FEATURE_FLAG_IDS,
  type TreasuryFeatureFlagId,
} from "@/src/lib/treasury/treasuryFeatureFlags.js";
import {
  filterTreasuryUiSections,
  resolveTreasuryUiLandingPath,
  type TreasuryFeatureFlagsMap,
  type TreasuryRolloutUiSectionId,
  TREASURY_UI_SECTION_FEATURE_FLAG,
} from "@/src/lib/treasury/treasuryRollout.js";
import {
  canAccessTreasuryAdvancedNavigation,
  isTreasuryAdvancedPath,
} from "@/src/lib/treasury/treasurySimpleNavigation.js";
import {
  TREASURY_UI_ADVANCED_HUB_PATH,
  TREASURY_UI_BASE_PATH,
  TREASURY_UI_LABEL,
  TREASURY_UI_PRIMARY_SECTIONS,
} from "./treasuryFeatureUi.js";
import { TreasuryAdvancedHubPage } from "./TreasuryAdvancedHubPage.js";
import { TreasuryTodayPage } from "./TreasuryTodayPage.js";
import { TreasuryTodayOpeningPage } from "./TreasuryTodayOpeningPage.js";
import { TreasuryTodayClosingPage } from "./TreasuryTodayClosingPage.js";
import { TreasurySimpleReceivablesReviewPage } from "./TreasurySimpleReceivablesReviewPage.js";
import { TreasurySimplePayablesReviewPage } from "./TreasurySimplePayablesReviewPage.js";
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
import { TreasuryAlertSettingsPage } from "./TreasuryAlertSettingsPage.js";

function closedTreasuryFlagsMap(): TreasuryFeatureFlagsMap {
  const out = {} as TreasuryFeatureFlagsMap;
  for (const id of TREASURY_FEATURE_FLAG_IDS) {
    out[id] = false;
  }
  return out;
}

function TreasuryFlagGate(props: {
  sectionId: TreasuryRolloutUiSectionId;
  flags: TreasuryFeatureFlagsMap | null;
  landingPath: string;
  children: React.ReactNode;
}) {
  const { sectionId, flags, landingPath, children } = props;
  if (!flags) {
    return (
      <div
        className="rounded-lg border border-border px-4 py-8 text-sm text-muted-foreground"
        data-testid="treasury-flag-loading"
      >
        Carregando disponibilidade do módulo…
      </div>
    );
  }
  const required = TREASURY_UI_SECTION_FEATURE_FLAG[sectionId];
  const enabled =
    flags["treasury.enabled"] === true &&
    (required == null || flags[required] === true);
  if (!enabled) {
    return <Navigate to={landingPath} replace />;
  }
  return <>{children}</>;
}

/**
 * Shell da Central de Tesouraria — experiência simples na navegação principal.
 * Recursos avançados permanecem em rotas/deep-links; hub só para ADMIN/SUPER_ADMIN.
 */
export function TreasuryModule() {
  const location = useLocation();
  const auth = useAuth();
  const [flags, setFlags] = useState<TreasuryFeatureFlagsMap | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    void fetchTreasuryAvailability({ signal: ac.signal })
      .then((payload) => {
        setFlags(payload.flags as TreasuryFeatureFlagsMap);
      })
      .catch(() => {
        setFlags(closedTreasuryFlagsMap());
      });
    return () => ac.abort();
  }, []);

  const primarySections = filterTreasuryUiSections(
    TREASURY_UI_PRIMARY_SECTIONS,
    flags
  );
  const landingPath = resolveTreasuryUiLandingPath(
    TREASURY_UI_PRIMARY_SECTIONS,
    flags,
    `${TREASURY_UI_BASE_PATH}/today`
  );
  const showAdvancedEntry = canAccessTreasuryAdvancedNavigation(
    auth.authUser?.role
  );
  const advancedActive = isTreasuryAdvancedPath(location.pathname);

  const gate = (sectionId: TreasuryRolloutUiSectionId, node: React.ReactNode) => (
    <TreasuryFlagGate
      sectionId={sectionId}
      flags={flags}
      landingPath={landingPath}
    >
      {node}
    </TreasuryFlagGate>
  );

  return (
    <div className="space-y-6" data-testid="treasury-module">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Financeiro
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {TREASURY_UI_LABEL}
          </h1>
        </div>
        {showAdvancedEntry ? (
          <NavLink
            to={TREASURY_UI_ADVANCED_HUB_PATH}
            className={cn(
              "text-sm font-semibold underline-offset-4 hover:underline",
              advancedActive
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            data-testid="treasury-advanced-entry"
          >
            Recursos avançados
          </NavLink>
        ) : null}
      </div>

      <nav
        className="flex flex-wrap gap-2 border-b border-border pb-3"
        data-testid="treasury-module-tabs"
        aria-label="Navegação principal da Tesouraria"
      >
        {primarySections.map((section) => (
          <NavLink
            key={section.id}
            to={section.path}
            end={section.id === "today"}
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

      {!flags ? (
        <div
          className="rounded-lg border border-border px-4 py-8 text-sm text-muted-foreground"
          data-testid="treasury-module-loading"
        >
          Carregando disponibilidade do módulo…
        </div>
      ) : null}

      {flags && primarySections.length === 0 && !showAdvancedEntry ? (
        <div
          className="rounded-lg border border-border px-4 py-8 text-sm text-muted-foreground"
          data-testid="treasury-module-no-flags"
        >
          Nenhum submódulo liberado neste ambiente. Os dados permanecem
          preservados até a ativação das flags.
        </div>
      ) : null}

      <Routes>
        <Route
          index
          element={<Navigate to={landingPath} replace />}
        />
        <Route
          path="today/opening"
          element={gate("today", <TreasuryTodayOpeningPage />)}
        />
        <Route
          path="today/closing"
          element={gate("today", <TreasuryTodayClosingPage />)}
        />
        <Route
          path="today/receivables"
          element={gate("receivables", <TreasurySimpleReceivablesReviewPage />)}
        />
        <Route
          path="today/payables"
          element={gate("payables", <TreasurySimplePayablesReviewPage />)}
        />
        <Route
          path="today"
          element={gate("today", <TreasuryTodayPage />)}
        />
        <Route
          path="dashboard"
          element={gate("today", <TreasuryDashboardPage />)}
        />
        <Route
          path="accounts"
          element={gate("accounts", <TreasuryAccountsPage />)}
        />
        <Route
          path="accounts/:accountId/balances"
          element={gate("balances", <TreasuryAccountBalancePage />)}
        />
        <Route
          path="bank"
          element={gate("bank", <TreasuryReconcileWorkspacePage />)}
        />
        <Route
          path="projection"
          element={gate("projection", <TreasuryAgendaPage />)}
        />
        <Route
          path="advanced"
          element={
            showAdvancedEntry ? (
              gate("advanced", <TreasuryAdvancedHubPage flags={flags} />)
            ) : (
              <Navigate to={landingPath} replace />
            )
          }
        />
        {/* Deep-links e ferramentas avançadas — preservados */}
        <Route
          path="receivables"
          element={gate("receivables", <TreasuryReceivablesPage />)}
        />
        <Route
          path="payables"
          element={gate("payables", <TreasuryPayablesPage />)}
        />
        <Route
          path="payment-schedule"
          element={gate("payment-schedule", <TreasuryPaymentSchedulePage />)}
        />
        <Route path="agenda" element={gate("agenda", <TreasuryAgendaPage />)} />
        <Route
          path="projections"
          element={gate("projections", <TreasuryProjectionComparisonPage />)}
        />
        <Route
          path="transfers"
          element={gate("transfers", <TreasuryTransfersPage />)}
        />
        <Route
          path="manual-entries"
          element={gate("manual-entries", <TreasuryManualEntriesPage />)}
        />
        <Route
          path="bank-movements"
          element={gate("bank-movements", <TreasuryBankMovementsPage />)}
        />
        <Route
          path="ofx"
          element={gate("ofx", <TreasuryBankMovementsPage />)}
        />
        <Route
          path="reconcile"
          element={gate("reconcile", <TreasuryReconcileWorkspacePage />)}
        />
        <Route
          path="exceptions"
          element={gate("exceptions", <TreasuryExceptionsPage />)}
        />
        <Route
          path="alert-settings"
          element={gate("alert-settings", <TreasuryAlertSettingsPage />)}
        />
        <Route
          path="closing"
          element={gate("closing", <TreasuryDailyClosingPage />)}
        />
        <Route
          path="reports"
          element={gate("reports", <TreasuryReportsPage />)}
        />
        <Route path="audit" element={gate("audit", <TreasuryAuditPage />)} />
        <Route
          path="*"
          element={
            <Navigate
              to={landingPath}
              replace
              state={{ from: location.pathname }}
            />
          }
        />
      </Routes>
    </div>
  );
}

/** Exposto para testes de wiring. */
export type TreasuryModuleFlagId = TreasuryFeatureFlagId;
