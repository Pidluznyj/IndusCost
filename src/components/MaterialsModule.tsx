import React from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { cn } from "@/src/lib/utils";
import { useAuth } from "@/src/contexts/AuthContext";
import { canAccessModule } from "@/src/lib/modulePermissions";
import {
  getMaterialsDefaultPath,
  isMaterialsCanonicalPath,
  MATERIALS_SECTIONS,
  parseMaterialsSectionFromPath,
  resolveMaterialsCanonicalPath,
} from "@/src/lib/materialsNavigation";
import {
  MATERIALS_UI_SECTIONS,
  MARKET_INTELLIGENCE_SECTION_KEYS,
} from "@/src/lib/moduleTabResources";
import { PERMISSION_EMPTY_TABS_MESSAGE } from "@/src/lib/permissionsClient";
import { useAuthorizedTabs } from "@/src/hooks/useAuthorizedTabs";
import { MaterialModule } from "@/src/components/MaterialModule";
import { MaterialsMarketIntelligencePage } from "@/src/components/materials/MaterialsMarketIntelligencePage";
import { MaterialsMarketIntelligenceDetailPage } from "@/src/components/materials/MaterialsMarketIntelligenceDetailPage";
import { MaterialsMarketIntelligenceReportsPage } from "@/src/components/materials/MaterialsMarketIntelligenceReportsPage";
import { PermissionDenied } from "@/src/components/security/PermissionDenied";
import { usePermissions } from "@/src/hooks/usePermissions";

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
  const requestedId = parseMaterialsSectionFromPath(location.pathname);
  const { visibleTabs, isEmpty, activeId } = useAuthorizedTabs({
    tabs: MATERIALS_UI_SECTIONS,
    requestedId,
  });
  const visibleIds = new Set(visibleTabs.map((t) => t.id));
  const visibleSections = MATERIALS_SECTIONS.filter((section) =>
    visibleIds.has(section.id)
  );

  const defaultPath =
    MATERIALS_SECTIONS.find((s) => s.id === activeId)?.path ??
    visibleSections[0]?.path ??
    getMaterialsDefaultPath();

  if (!canViewModule && isEmpty) {
    return (
      <PermissionDenied
        title="Sem permissão"
        message="Você não tem permissão para acessar Suprimentos."
        testId="materials-module-denied"
      />
    );
  }

  if (isEmpty) {
    return (
      <PermissionDenied
        title="Nenhuma aba disponível"
        message={PERMISSION_EMPTY_TABS_MESSAGE}
        testId="materials-empty-tabs"
      />
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
  const canCatalog = visibleIds.has("catalog");
  const canMi = visibleIds.has("marketIntelligence");

  if (onCatalog && !canCatalog) {
    return <Navigate to={defaultPath} replace />;
  }
  if ((onMiHome || location.pathname.includes("/market-intelligence")) && !canMi) {
    return <Navigate to={defaultPath} replace />;
  }
  if (
    onMiDetail &&
    !permissions.canViewTabResource(MARKET_INTELLIGENCE_SECTION_KEYS.material360)
  ) {
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
            canCatalog ? (
              <MaterialModule />
            ) : (
              <MaterialsHomeRedirect path={defaultPath} />
            )
          }
        />
        <Route
          path="market-intelligence/reports"
          element={
            canMi ? (
              <MaterialsMarketIntelligenceReportsPage />
            ) : (
              <PermissionDenied title="Aba sem permissão" />
            )
          }
        />
        <Route
          path="market-intelligence/:materialId"
          element={
            canMi ? (
              <MaterialsMarketIntelligenceDetailPage />
            ) : (
              <PermissionDenied title="Aba sem permissão" />
            )
          }
        />
        <Route
          path="market-intelligence"
          element={
            canMi ? (
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
