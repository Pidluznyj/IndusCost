/**
 * Módulo Comissões — Fechamento do mês + Exceções por cliente + Relatórios.
 *
 * Previsão e Auditoria Visual permanecem em pages/ para reescrita futura,
 * mas estão ocultas na UI (rotas redirecionam para Fechamento).
 * Ver COMMISSIONS_HIDDEN_SECTION_IDS e COMMISSIONS_LEGACY_PATH_REDIRECTS.
 */
import React from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { cn } from "@/src/lib/utils";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import {
  canViewCommissionsSection,
  resolveFirstAccessibleCommissionsPath,
} from "@/src/lib/commissionsModulePermissions";
import { PERMISSION_EMPTY_TABS_MESSAGE } from "@/src/lib/permissionsClient";
import {
  COMMISSIONS_LEGACY_PATH_REDIRECTS,
  COMMISSIONS_SECTIONS,
  getCommissionsDefaultPath,
  isCommissionsCanonicalPath,
  parseCommissionsSectionFromPath,
  resolveCommissionsCanonicalPath,
  resolveCommissionsLegacyRedirect,
  type CommissionsSectionId,
} from "@/src/lib/commissionsNavigation";
import { CommissionsReceiptClosingPage } from "@/src/components/commissions/pages/CommissionsReceiptClosingPage";
import { CommissionsCustomerExclusionsPage } from "@/src/components/commissions/pages/CommissionsCustomerExclusionsPage";
import { CommissionsReportsPage } from "@/src/components/commissions/pages/CommissionsReportsPage";

function CommissionsHomeRedirect() {
  return <Navigate to={getCommissionsDefaultPath()} replace />;
}

function CommissionsDeprecatedTabRedirect() {
  return <Navigate to={getCommissionsDefaultPath()} replace />;
}

function CommissionsLegacyRedirect() {
  const location = useLocation();
  const segments = location.pathname.split("/").filter(Boolean);
  const legacySegment = segments[segments.indexOf("commissions") + 1] ?? "";
  const target = resolveCommissionsLegacyRedirect(legacySegment) ?? getCommissionsDefaultPath();
  return <Navigate to={target} replace />;
}

function CommissionsSectionGuard({
  sectionId,
  children,
  fallbackPath,
  canViewResource,
}: {
  sectionId: CommissionsSectionId;
  children: React.ReactNode;
  fallbackPath: string;
  canViewResource: (key: string) => boolean;
}) {
  const auth = useAuth();
  if (!canViewCommissionsSection(sectionId, { ...auth, canViewResource })) {
    return <Navigate to={fallbackPath} replace />;
  }
  return <>{children}</>;
}

export function CommissionsModule() {
  const auth = useAuth();
  const permissions = usePermissions();
  const location = useLocation();
  const check = { ...auth, canViewResource: permissions.canView };

  const visibleSections = COMMISSIONS_SECTIONS.filter((section) =>
    canViewCommissionsSection(section.id, check)
  );

  const defaultPath =
    resolveFirstAccessibleCommissionsPath(check) ??
    visibleSections[0]?.path ??
    getCommissionsDefaultPath();

  if (!isCommissionsCanonicalPath(location.pathname)) {
    const target = resolveCommissionsCanonicalPath(location.pathname);
    return <Navigate to={target} replace />;
  }

  const currentSection = parseCommissionsSectionFromPath(location.pathname);
  if (
    currentSection &&
    !canViewCommissionsSection(currentSection, check) &&
    location.pathname !== defaultPath
  ) {
    return <Navigate to={defaultPath} replace />;
  }

  if (visibleSections.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        {PERMISSION_EMPTY_TABS_MESSAGE}
      </div>
    );
  }

  const guard = (sectionId: CommissionsSectionId, page: React.ReactNode) => (
    <CommissionsSectionGuard
      sectionId={sectionId}
      fallbackPath={defaultPath}
      canViewResource={permissions.canView}
    >
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
              data-testid={`commissions-tab-${section.id}`}
            >
              {section.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <Routes>
        <Route index element={guard("monthlyClosing", <CommissionsReceiptClosingPage />)} />
        <Route path="previsao" element={<CommissionsDeprecatedTabRedirect />} />
        <Route path="auditoria" element={<CommissionsDeprecatedTabRedirect />} />
        <Route
          path="exclusoes-cliente"
          element={guard("customerExclusions", <CommissionsCustomerExclusionsPage />)}
        />
        <Route path="relatorios" element={guard("reports", <CommissionsReportsPage />)} />
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
