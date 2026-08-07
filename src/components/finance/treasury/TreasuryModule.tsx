import React, { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { cn } from "@/src/lib/utils";
import { useAuth } from "@/src/contexts/AuthContext";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import { fetchTreasuryAvailability } from "@/src/lib/treasury/treasuryAvailabilityApi.js";
import type { TreasuryFeatureFlagId } from "@/src/lib/treasury/treasuryFeatureFlags.js";
import {
  filterTreasuryUiSections,
  resolveTreasuryFlagGateDecision,
  resolveTreasuryUiEnabledLandingPath,
  type TreasuryFeatureFlagsMap,
  type TreasuryRolloutUiSectionId,
} from "@/src/lib/treasury/treasuryRollout.js";
import {
  canAccessTreasuryAdvancedNavigation,
  isTreasuryAdvancedPath,
} from "@/src/lib/treasury/treasurySimpleNavigation.js";
import {
  TREASURY_UI_ADVANCED_HUB_PATH,
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
import { TreasurySimpleCashRiskProjectionPage } from "./TreasurySimpleCashRiskProjectionPage.js";
import { TreasuryCaixaPage } from "./TreasuryCaixaPage.js";
import { TreasuryProjectionComparisonPage } from "./TreasuryProjectionComparisonPage.js";
import { TreasuryTransfersPage } from "./TreasuryTransfersPage.js";
import { TreasuryBankMovementsPage } from "./TreasuryBankMovementsPage.js";
import { TreasurySimpleOfxInvestigationPage } from "./TreasurySimpleOfxInvestigationPage.js";
import { TreasuryExceptionsPage } from "./TreasuryExceptionsPage.js";
import { TreasuryDailyClosingPage } from "./TreasuryDailyClosingPage.js";
import { TreasuryReportsPage } from "./TreasuryReportsPage.js";
import { TreasuryManualEntriesPage } from "./TreasuryManualEntriesPage.js";
import { TreasuryPaymentSchedulePage } from "./TreasuryPaymentSchedulePage.js";
import { TreasuryReconcileWorkspacePage } from "./TreasuryReconcileWorkspacePage.js";
import { CashSupportWorkspacePage } from "./CashSupportWorkspacePage.js";
import { todayTreasuryCivilDateInSaoPaulo } from "@/src/lib/treasury/contracts/treasuryContracts.js";
import { TreasuryAuditPage } from "./TreasuryAuditPage.js";
import { TreasuryAlertSettingsPage } from "./TreasuryAlertSettingsPage.js";

function TreasuryFlagGate(props: {
  sectionId: TreasuryRolloutUiSectionId;
  flags: TreasuryFeatureFlagsMap | null;
  landingPath: string | null;
  currentPath: string;
  /** Flags extras que também precisam estar ON (ex.: abertura exige balances). */
  alsoRequire?: readonly TreasuryFeatureFlagId[];
  children: React.ReactNode;
}) {
  const { sectionId, flags, landingPath, currentPath, alsoRequire, children } =
    props;
  const decision = resolveTreasuryFlagGateDecision({
    flags,
    sectionId,
    alsoRequire,
    landingPath,
    currentPath,
  });
  if (decision.action === "loading") {
    return (
      <div
        className="rounded-lg border border-border px-4 py-8 text-sm text-muted-foreground"
        data-testid="treasury-flag-loading"
      >
        Carregando disponibilidade do módulo…
      </div>
    );
  }
  if (decision.action === "redirect") {
    return <Navigate to={decision.to} replace />;
  }
  if (decision.action === "blocked") {
    return null;
  }
  return <>{children}</>;
}

/** Apoio ao Caixa (CS-007) — período padrão: mês corrente até hoje. */
function CashSupportRoutePage() {
  const today = todayTreasuryCivilDateInSaoPaulo();
  const civilDateFrom = `${today.slice(0, 7)}-01`;
  return <CashSupportWorkspacePage civilDateFrom={civilDateFrom} civilDateTo={today} />;
}

/**
 * Shell da Central de Tesouraria — experiência simples na navegação principal.
 * Recursos avançados permanecem em rotas/deep-links; hub só para ADMIN/SUPER_ADMIN.
 */
export function TreasuryModule() {
  const location = useLocation();
  const auth = useAuth();
  const [flags, setFlags] = useState<TreasuryFeatureFlagsMap | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(
    null
  );

  useEffect(() => {
    const ac = new AbortController();
    setAvailabilityError(null);
    void fetchTreasuryAvailability({ signal: ac.signal })
      .then((payload) => {
        if (ac.signal.aborted) return;
        setFlags(payload.flags as TreasuryFeatureFlagsMap);
        setAvailabilityError(null);
      })
      .catch((err: unknown) => {
        // StrictMode (dev) abort no unmount NÃO pode fechar todas as flags —
        // isso gerava Navigate em loop para /today desabilitado.
        if (ac.signal.aborted) return;
        if (
          err instanceof DOMException &&
          err.name === "AbortError"
        ) {
          return;
        }
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        setFlags(null);
        setAvailabilityError(
          buildFinanceTabLoadError(
            "Não foi possível carregar a disponibilidade da Tesouraria.",
            err
          )
        );
      });
    return () => ac.abort();
  }, []);

  const primarySections = filterTreasuryUiSections(
    TREASURY_UI_PRIMARY_SECTIONS,
    flags
  );
  // A Central abre SEMPRE na aba Caixa quando liberada (pedido do produto);
  // "accounts" segue primeira na barra, mas o pouso inicial é o Caixa.
  const landingPath = resolveTreasuryUiEnabledLandingPath(
    TREASURY_UI_PRIMARY_SECTIONS,
    flags,
    "caixa"
  );
  const showAdvancedEntry = canAccessTreasuryAdvancedNavigation(
    auth.authUser?.role
  );
  const advancedActive = isTreasuryAdvancedPath(location.pathname);

  const gate = (
    sectionId: TreasuryRolloutUiSectionId,
    node: React.ReactNode,
    alsoRequire?: readonly TreasuryFeatureFlagId[]
  ) => (
    <TreasuryFlagGate
      sectionId={sectionId}
      flags={flags}
      landingPath={landingPath}
      currentPath={location.pathname}
      alsoRequire={alsoRequire}
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
            end={section.id === "caixa"}
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

      {availabilityError ? (
        <div
          className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-8 text-sm text-destructive"
          data-testid="treasury-module-availability-error"
          role="alert"
        >
          {availabilityError}
        </div>
      ) : null}

      {!flags && !availabilityError ? (
        <div
          className="rounded-lg border border-border px-4 py-8 text-sm text-muted-foreground"
          data-testid="treasury-module-loading"
        >
          Carregando disponibilidade do módulo…
        </div>
      ) : null}

      {flags && primarySections.length === 0 ? (
        <div
          className="rounded-lg border border-border px-4 py-8 text-sm text-muted-foreground"
          data-testid="treasury-module-no-flags"
        >
          Nenhum submódulo liberado neste ambiente. Os dados permanecem
          preservados até a ativação das flags.
          {showAdvancedEntry ? (
            <>
              {" "}
              Administradores podem abrir{" "}
              <NavLink
                to={TREASURY_UI_ADVANCED_HUB_PATH}
                className="font-semibold underline underline-offset-4"
              >
                Recursos avançados
              </NavLink>{" "}
              quando a mestra estiver ligada.
            </>
          ) : null}
        </div>
      ) : null}

      {flags && !availabilityError ? (
        <Routes>
          <Route
            index
            element={
              landingPath ? (
                <Navigate to={landingPath} replace />
              ) : (
                <div
                  className="sr-only"
                  data-testid="treasury-index-no-landing"
                />
              )
            }
          />
          <Route
            path="today/opening"
            element={gate("today", <TreasuryTodayOpeningPage />, [
              "treasury.balances.enabled",
            ])}
          />
          <Route
            path="today/closing"
            element={gate("today", <TreasuryTodayClosingPage />, [
              "treasury.balances.enabled",
            ])}
          />
          <Route
            path="today/receivables"
            element={gate("receivables", <TreasurySimpleReceivablesReviewPage />)}
          />
          <Route
            path="today/payables"
            element={gate("payables", <TreasurySimplePayablesReviewPage />)}
          />
          <Route path="today" element={gate("today", <TreasuryTodayPage />)} />
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
            element={gate("bank", <TreasurySimpleOfxInvestigationPage />, [
              "treasury.reconciliation.enabled",
            ])}
          />
          <Route
            path="today/bank"
            element={gate("bank", <TreasurySimpleOfxInvestigationPage />, [
              "treasury.reconciliation.enabled",
            ])}
          />
          <Route
            path="projection"
            element={gate("projection", <TreasurySimpleCashRiskProjectionPage />)}
          />
          <Route path="caixa" element={gate("caixa", <TreasuryCaixaPage />)} />
          <Route
            path="advanced"
            element={
              showAdvancedEntry ? (
                gate("advanced", <TreasuryAdvancedHubPage flags={flags} />)
              ) : landingPath ? (
                <Navigate to={landingPath} replace />
              ) : (
                <div className="text-sm text-muted-foreground">
                  Recursos avançados indisponíveis para este perfil.
                </div>
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
            path="cash-support"
            element={gate("reconcile", <CashSupportRoutePage />)}
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
              landingPath ? (
                <Navigate
                  to={landingPath}
                  replace
                  state={{ from: location.pathname }}
                />
              ) : (
                <div
                  className="sr-only"
                  data-testid="treasury-wildcard-no-landing"
                />
              )
            }
          />
        </Routes>
      ) : null}
    </div>
  );
}

/** Exposto para testes de wiring. */
export type TreasuryModuleFlagId = TreasuryFeatureFlagId;
