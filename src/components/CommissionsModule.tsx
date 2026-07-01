import React from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  canViewCommissionsSection,
  resolveFirstAccessibleCommissionsPath,
} from "@/src/lib/commissionsModulePermissions";
import {
  COMMISSIONS_SECTIONS,
  getCommissionsDefaultPath,
  isCommissionsCanonicalPath,
  parseCommissionsSectionFromPath,
  resolveCommissionsCanonicalPath,
  type CommissionsSectionId,
} from "@/src/lib/commissionsNavigation";
import { CommissionsDashboardPage } from "@/src/components/commissions/pages/CommissionsDashboardPage";
import { CommissionsForecastPage } from "@/src/components/commissions/pages/CommissionsForecastPage";
import { CommissionsConfirmedPage } from "@/src/components/commissions/pages/CommissionsConfirmedPage";
import { CommissionsReleasesPage } from "@/src/components/commissions/pages/CommissionsReleasesPage";
import { CommissionsPaymentsPage } from "@/src/components/commissions/pages/CommissionsPaymentsPage";
import { CommissionsPersonsPage } from "@/src/components/commissions/pages/CommissionsPersonsPage";
import { CommissionsRulesPage } from "@/src/components/commissions/pages/CommissionsRulesPage";
import { CommissionsAuditPage } from "@/src/components/commissions/pages/CommissionsAuditPage";
import { CommissionsSettingsPage } from "@/src/components/commissions/pages/CommissionsSettingsPage";

function CommissionsCanonicalRedirect() {
  const location = useLocation();
  const target = resolveCommissionsCanonicalPath(location.pathname);
  return <Navigate to={target} replace />;
}

function CommissionsSectionGuard({
  sectionId,
  children,
  fallbackPath,
}: {
  sectionId: CommissionsSectionId;
  children: React.ReactNode;
  fallbackPath: string;
}) {
  const auth = useAuth();
  if (!canViewCommissionsSection(sectionId, auth)) {
    return <Navigate to={fallbackPath} replace />;
  }
  return <>{children}</>;
}

export function CommissionsModule() {
  const auth = useAuth();
  const location = useLocation();

  const visibleSections = COMMISSIONS_SECTIONS.filter((section) =>
    canViewCommissionsSection(section.id, auth)
  );

  const defaultPath =
    resolveFirstAccessibleCommissionsPath(auth) ??
    visibleSections[0]?.path ??
    getCommissionsDefaultPath();

  if (!isCommissionsCanonicalPath(location.pathname)) {
    return <CommissionsCanonicalRedirect />;
  }

  const currentSection = parseCommissionsSectionFromPath(location.pathname);
  if (
    currentSection &&
    !canViewCommissionsSection(currentSection, auth) &&
    location.pathname !== defaultPath
  ) {
    return <Navigate to={defaultPath} replace />;
  }

  if (visibleSections.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        Você não tem permissão para acessar o módulo Comissões.
      </div>
    );
  }

  const guard = (sectionId: CommissionsSectionId, page: React.ReactNode) => (
    <CommissionsSectionGuard sectionId={sectionId} fallbackPath={defaultPath}>
      {page}
    </CommissionsSectionGuard>
  );

  return (
    <div className="space-y-6" data-testid="commissions-module">
      <nav
        className="commissions-module-tabs -mx-1 overflow-x-auto border-b border-border pb-3"
        aria-label="Seções de Comissões"
      >
        <div className="flex min-w-max flex-wrap gap-2 px-1">
          {visibleSections.map((section) => (
            <NavLink
              key={section.id}
              to={section.path}
              end={section.id === "dashboard"}
              className={({ isActive }) =>
                cn(
                  "inline-flex shrink-0 items-center rounded-lg px-3 py-2 text-sm font-semibold transition-colors whitespace-nowrap",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )
              }
            >
              {section.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <Routes>
        <Route index element={guard("dashboard", <CommissionsDashboardPage />)} />
        <Route path="forecast" element={guard("forecast", <CommissionsForecastPage />)} />
        <Route path="confirmed" element={guard("confirmed", <CommissionsConfirmedPage />)} />
        <Route path="releases" element={guard("releases", <CommissionsReleasesPage />)} />
        <Route path="payments" element={guard("payments", <CommissionsPaymentsPage />)} />
        <Route path="persons" element={guard("persons", <CommissionsPersonsPage />)} />
        <Route path="rules" element={guard("rules", <CommissionsRulesPage />)} />
        <Route path="audit" element={guard("audit", <CommissionsAuditPage />)} />
        <Route path="settings" element={guard("settings", <CommissionsSettingsPage />)} />
        <Route path="*" element={<CommissionsCanonicalRedirect />} />
      </Routes>
    </div>
  );
}

export function CommissionsModuleLoadingFallback() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Carregando Comissões…
    </div>
  );
}
