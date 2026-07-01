import React from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { useAuth } from "@/src/contexts/AuthContext";
import { canViewCommissionsSection } from "@/src/lib/commissionsModulePermissions";
import {
  COMMISSIONS_SECTIONS,
  getCommissionsDefaultPath,
  isCommissionsCanonicalPath,
  resolveCommissionsCanonicalPath,
  type CommissionsSectionId,
} from "@/src/lib/commissionsNavigation";
import { CommissionsDashboardPage } from "@/src/components/commissions/pages/CommissionsDashboardPage";
import {
  CommissionsForecastPage,
  CommissionsConfirmedPage,
} from "@/src/components/commissions/pages/CommissionsForecastPage";
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

export function CommissionsModule() {
  const auth = useAuth();
  const location = useLocation();

  const visibleSections = COMMISSIONS_SECTIONS.filter((section) =>
    canViewCommissionsSection(section.id, auth)
  );

  const defaultPath = visibleSections[0]?.path ?? getCommissionsDefaultPath();

  if (!isCommissionsCanonicalPath(location.pathname)) {
    return <CommissionsCanonicalRedirect />;
  }

  if (visibleSections.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        Você não tem permissão para acessar o módulo Comissões.
      </div>
    );
  }

  const sectionRoutes: Record<CommissionsSectionId, React.ReactNode> = {
    dashboard: canViewCommissionsSection("dashboard", auth) ? (
      <CommissionsDashboardPage />
    ) : (
      <SectionDenied label="Dashboard" />
    ),
    forecast: canViewCommissionsSection("forecast", auth) ? (
      <CommissionsForecastPage />
    ) : (
      <SectionDenied label="Comissões Previstas" />
    ),
    confirmed: canViewCommissionsSection("confirmed", auth) ? (
      <CommissionsConfirmedPage />
    ) : (
      <SectionDenied label="Comissões Confirmadas" />
    ),
    releases: canViewCommissionsSection("releases", auth) ? (
      <CommissionsReleasesPage />
    ) : (
      <SectionDenied label="Liberação por Recebimento" />
    ),
    payments: canViewCommissionsSection("payments", auth) ? (
      <CommissionsPaymentsPage />
    ) : (
      <SectionDenied label="Pagamentos" />
    ),
    persons: canViewCommissionsSection("persons", auth) ? (
      <CommissionsPersonsPage />
    ) : (
      <SectionDenied label="Pessoas Comissionadas" />
    ),
    rules: canViewCommissionsSection("rules", auth) ? (
      <CommissionsRulesPage />
    ) : (
      <SectionDenied label="Regras de Comissão" />
    ),
    audit: canViewCommissionsSection("audit", auth) ? (
      <CommissionsAuditPage />
    ) : (
      <SectionDenied label="Auditoria" />
    ),
    settings: canViewCommissionsSection("settings", auth) ? (
      <CommissionsSettingsPage />
    ) : (
      <SectionDenied label="Configurações" />
    ),
  };

  return (
    <div className="space-y-6">
      <nav
        className="commissions-module-tabs flex flex-wrap gap-2 border-b border-border pb-3"
        aria-label="Seções de Comissões"
      >
        {visibleSections.map((section) => (
          <NavLink
            key={section.id}
            to={section.path}
            end={section.id === "dashboard"}
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
        <Route index element={sectionRoutes.dashboard} />
        <Route path="forecast" element={sectionRoutes.forecast} />
        <Route path="confirmed" element={sectionRoutes.confirmed} />
        <Route path="releases" element={sectionRoutes.releases} />
        <Route path="payments" element={sectionRoutes.payments} />
        <Route path="persons" element={sectionRoutes.persons} />
        <Route path="rules" element={sectionRoutes.rules} />
        <Route path="audit" element={sectionRoutes.audit} />
        <Route path="settings" element={sectionRoutes.settings} />
        <Route path="*" element={<CommissionsCanonicalRedirect />} />
      </Routes>
    </div>
  );
}

function SectionDenied({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">
      Sem permissão para {label}.
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
