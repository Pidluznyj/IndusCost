/**
 * Módulo Comissões — modo simplificado (auditoria visual única).
 *
 * Telas antigas (dashboard, payable, generated, etc.) permanecem no repositório
 * para revisão futura do modelo, mas estão temporariamente desativadas na UI.
 * Ver COMMISSIONS_DISABLED_SECTION_IDS e páginas em pages/.
 */
import React from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { cn } from "@/src/lib/utils";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  canViewCommissionsSection,
  resolveFirstAccessibleCommissionsPath,
} from "@/src/lib/commissionsModulePermissions";
import {
  COMMISSIONS_LEGACY_PATH_REDIRECTS,
  COMMISSIONS_SECTIONS,
  getCommissionsDefaultPath,
  isCommissionsCanonicalPath,
  parseCommissionsSectionFromPath,
  resolveCommissionsCanonicalPath,
  type CommissionsSectionId,
} from "@/src/lib/commissionsNavigation";
import { CommissionsMonthlyClosingPage } from "@/src/components/commissions/pages/CommissionsMonthlyClosingPage";
import { CommissionsReceivableForecastPage } from "@/src/components/commissions/pages/CommissionsReceivableForecastPage";
import { CommissionsVisualAuditPage } from "@/src/components/commissions/pages/CommissionsVisualAuditPage";

function CommissionsHomeRedirect() {
  return <Navigate to={getCommissionsDefaultPath()} replace />;
}

function CommissionsLegacyRedirect() {
  return <Navigate to="/commissions" replace />;
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
    const target = resolveCommissionsCanonicalPath(location.pathname);
    return <Navigate to={target} replace />;
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
              end
              className={({ isActive }) =>
                cn(
                  "inline-flex shrink-0 items-center rounded-lg px-3 py-2 text-sm font-semibold transition-colors whitespace-nowrap",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )
              }
              title={section.description}
            >
              {section.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <Routes>
        <Route index element={guard("monthlyClosing", <CommissionsMonthlyClosingPage />)} />
        <Route path="previsao" element={guard("receivableForecast", <CommissionsReceivableForecastPage />)} />
        <Route path="auditoria" element={guard("visualAudit", <CommissionsVisualAuditPage />)} />
        {Object.keys(COMMISSIONS_LEGACY_PATH_REDIRECTS).map((legacy) => (
          <Route key={legacy} path={legacy} element={<CommissionsLegacyRedirect />} />
        ))}
        <Route path="*" element={<CommissionsHomeRedirect />} />
      </Routes>
    </div>
  );
}

export function CommissionsModuleLoadingFallback() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      Carregando Comissões…
    </div>
  );
}
