import React from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { cn } from "@/src/lib/utils";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { canAccessModule } from "@/src/lib/modulePermissions";
import {
  getMaterialsDefaultPath,
  isMaterialsCanonicalPath,
  MATERIALS_SECTIONS,
  resolveMaterialsCanonicalPath,
} from "@/src/lib/materialsNavigation";
import {
  MATERIALS_UI_SECTIONS,
  MARKET_INTELLIGENCE_SECTION_KEYS,
  TabResourceKeys,
} from "@/src/lib/moduleTabResources";
import { PERMISSION_EMPTY_TABS_MESSAGE } from "@/src/lib/permissionsClient";
import { MaterialModule } from "@/src/components/MaterialModule";
import { MaterialsMarketIntelligencePage } from "@/src/components/materials/MaterialsMarketIntelligencePage";
import { MaterialsMarketIntelligenceDetailPage } from "@/src/components/materials/MaterialsMarketIntelligenceDetailPage";
import { MaterialsMarketIntelligenceReportsPage } from "@/src/components/materials/MaterialsMarketIntelligenceReportsPage";
import { PermissionDenied } from "@/src/components/security/PermissionDenied";

function MaterialsHomeRedirect({ path }: { path: string }) {
  return <Navigate to={path} replace />;
}

function MaterialsCanonicalRedirect() {
  const location = useLocation();
  return <Navigate to={resolveMaterialsCanonicalPath(location.pathname)} replace />;
}

export function MaterialsModule() {
  const auth = useAuth();
  const permissions = usePermissions();
  const location = useLocation();
  const canViewModule = canAccessModule("materials", auth);

  const visibleSections = MATERIALS_SECTIONS.filter((section) => {
    const mapped = MATERIALS_UI_SECTIONS.find((s) => s.id === section.id);
    if (!mapped) return canViewModule;
    return permissions.canView(mapped.resourceKey);
  });

  const defaultPath =
    visibleSections[0]?.path ??
    (permissions.canView(TabResourceKeys.SUPRIMENTOS_CATALOGO)
      ? getMaterialsDefaultPath()
      : MATERIALS_SECTIONS.find((s) => s.id === "marketIntelligence")?.path) ??
    getMaterialsDefaultPath();

  if (!canViewModule && visibleSections.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        Você não tem permissão para acessar Suprimentos.
      </div>
    );
  }

  if (visibleSections.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        {PERMISSION_EMPTY_TABS_MESSAGE}
      </div>
    );
  }

  if (!isMaterialsCanonicalPath(location.pathname)) {
    return <MaterialsCanonicalRedirect />;
  }

  const onMiHome = location.pathname === "/materials/market-intelligence";
  const onMiDetail =
    location.pathname.startsWith("/materials/market-intelligence/") &&
    !location.pathname.endsWith("/reports");
  const onCatalog = location.pathname === "/materials" || location.pathname === "/materials/";

  if (onCatalog && !permissions.canView(TabResourceKeys.SUPRIMENTOS_CATALOGO)) {
    return <Navigate to={defaultPath} replace />;
  }
  if (
    (onMiHome || location.pathname.includes("/market-intelligence")) &&
    !permissions.canView(TabResourceKeys.MI_HOME) &&
    !permissions.canView(TabResourceKeys.MI_360)
  ) {
    return <Navigate to={defaultPath} replace />;
  }
  if (onMiDetail && !permissions.canView(MARKET_INTELLIGENCE_SECTION_KEYS.material360)) {
    return (
      <PermissionDenied
        title="Aba sem permissão"
        message="Você não tem permissão para a Matéria-prima 360."
      />
    );
  }

  return (
    <div className="space-y-6" data-testid="materials-module">
      <nav
        className="materials-module-tabs -mx-1 overflow-x-auto border-b border-border pb-3"
        aria-label="Seções de Suprimentos"
        data-testid="materials-module-tabs"
      >
        <div className="flex min-w-max flex-wrap gap-2 px-1">
          {visibleSections.map((section) => (
            <NavLink
              key={section.id}
              to={section.path}
              end={section.id === "catalog"}
              className={({ isActive }) =>
                cn(
                  "inline-flex shrink-0 items-center rounded-lg px-3 py-2 text-sm font-semibold transition-colors whitespace-nowrap",
                  (section.id === "marketIntelligence"
                    ? location.pathname.startsWith(section.path)
                    : isActive)
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )
              }
              title={section.description}
              data-testid={`materials-tab-${section.id}`}
            >
              {section.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <Routes>
        <Route
          index
          element={
            permissions.canView(TabResourceKeys.SUPRIMENTOS_CATALOGO) ? (
              <MaterialModule />
            ) : (
              <MaterialsHomeRedirect path={defaultPath} />
            )
          }
        />
        <Route
          path="market-intelligence/reports"
          element={
            permissions.canView(TabResourceKeys.MI_HOME) ? (
              <MaterialsMarketIntelligenceReportsPage />
            ) : (
              <PermissionDenied title="Aba sem permissão" />
            )
          }
        />
        <Route
          path="market-intelligence/:materialId"
          element={<MaterialsMarketIntelligenceDetailPage />}
        />
        <Route
          path="market-intelligence"
          element={
            permissions.canView(TabResourceKeys.MI_HOME) ? (
              <MaterialsMarketIntelligencePage />
            ) : (
              <PermissionDenied title="Aba sem permissão" />
            )
          }
        />
        <Route path="*" element={<MaterialsHomeRedirect path={defaultPath} />} />
      </Routes>
    </div>
  );
}
