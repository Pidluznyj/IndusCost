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
import { COMMISSIONS_LIVE_UI_TABS } from "@/src/lib/moduleTabResources";
import { useAuthorizedTabs } from "@/src/hooks/useAuthorizedTabs";
import { PermissionDenied } from "@/src/components/security/PermissionDenied";
import { CommissionsReceiptClosingPage } from "@/src/components/commissions/pages/CommissionsReceiptClosingPage";
import { CommissionsClosingsPage } from "@/src/components/commissions/pages/CommissionsClosingsPage";
import { CommissionsCustomerExclusionsPage } from "@/src/components/commissions/pages/CommissionsCustomerExclusionsPage";
import { CommissionsReportsPage } from "@/src/components/commissions/pages/CommissionsReportsPage";
import { CommissionsReprocessPage } from "@/src/components/commissions/pages/CommissionsReprocessPage";

function CommissionsHomeRedirect({ path }: { path: string }) {
  return <Navigate to={path} replace />;
}

function CommissionsDeprecatedTabRedirect({ path }: { path: string }) {
  return <Navigate to={path} replace />;
}

function CommissionsLegacyRedirect({ fallbackPath }: { fallbackPath: string }) {
  const location = useLocation();
  const segments = location.pathname.split("/").filter(Boolean);
  const legacySegment = segments[segments.indexOf("commissions") + 1] ?? "";
  const target = resolveCommissionsLegacyRedirect(legacySegment) ?? fallbackPath;
  return <Navigate to={target} replace />;
}

function CommissionsSectionGuard({
  sectionId,
  allowedIds,
  children,
  fallbackPath,
}: {
  sectionId: CommissionsSectionId;
  allowedIds: ReadonlySet<string>;
  children: React.ReactNode;
  fallbackPath: string;
}) {
  if (!allowedIds.has(sectionId)) {
    return <Navigate to={fallbackPath} replace />;
  }
  return <>{children}</>;
}

export function CommissionsModule() {
  const location = useLocation();
  const currentSection = parseCommissionsSectionFromPath(location.pathname);
  const requestedId =
    currentSection &&
    COMMISSIONS_LIVE_UI_TABS.some((t) => t.id === currentSection)
      ? currentSection
      : null;

  const { visibleTabs, isEmpty, activeId } = useAuthorizedTabs({
    tabs: COMMISSIONS_LIVE_UI_TABS,
    requestedId,
  });
  const allowedIds = new Set(visibleTabs.map((t) => t.id));
  const visibleSections = COMMISSIONS_SECTIONS.filter((section) =>
    allowedIds.has(section.id)
  );
  const defaultPath =
    COMMISSIONS_SECTIONS.find((s) => s.id === activeId)?.path ??
    visibleSections[0]?.path ??
    getCommissionsDefaultPath();

  if (!isCommissionsCanonicalPath(location.pathname)) {
    const target = resolveCommissionsCanonicalPath(location.pathname);
    return <Navigate to={target} replace />;
  }

  if (isEmpty) {
    return (
      <PermissionDenied
        title="Nenhuma aba disponível"
        message={PERMISSION_EMPTY_TABS_MESSAGE}
        testId="commissions-empty-tabs"
      />
    );
  }

  if (
    currentSection &&
    COMMISSIONS_LIVE_UI_TABS.some((t) => t.id === currentSection) &&
    !allowedIds.has(currentSection) &&
    location.pathname !== defaultPath
  ) {
    return <Navigate to={defaultPath} replace />;
  }

  const guard = (sectionId: CommissionsSectionId, page: React.ReactNode) => (
    <CommissionsSectionGuard
      sectionId={sectionId}
      allowedIds={allowedIds}
      fallbackPath={defaultPath}
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
        <Route
          path="previsao"
          element={<CommissionsDeprecatedTabRedirect path={defaultPath} />}
        />
        <Route
          path="auditoria"
          element={<CommissionsDeprecatedTabRedirect path={defaultPath} />}
        />
        <Route path="fechamentos" element={guard("closings", <CommissionsClosingsPage />)} />
        <Route
          path="exclusoes-cliente"
          element={guard("customerExclusions", <CommissionsCustomerExclusionsPage />)}
        />
        <Route path="relatorios" element={guard("reports", <CommissionsReportsPage />)} />
        <Route path="reprocessar" element={guard("reprocess", <CommissionsReprocessPage />)} />
        {Object.keys(COMMISSIONS_LEGACY_PATH_REDIRECTS).map((legacy) => (
          <Route
            key={legacy}
            path={legacy}
            element={<CommissionsLegacyRedirect fallbackPath={defaultPath} />}
          />
        ))}
        <Route path="*" element={<CommissionsHomeRedirect path={defaultPath} />} />
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
