import React from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { cn } from "@/src/lib/utils";
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
import { useAuthorizedTabs } from "@/src/hooks/useAuthorizedTabs";
import { MaterialModule } from "@/src/components/MaterialModule";
import { MaterialStockConferencePage } from "@/src/components/materials/MaterialStockConferencePage";
import { MaterialsMarketIntelligencePage } from "@/src/components/materials/MaterialsMarketIntelligencePage";
import { MaterialsMarketIntelligenceDetailPage } from "@/src/components/materials/MaterialsMarketIntelligenceDetailPage";
import { MaterialsMarketIntelligenceReportsPage } from "@/src/components/materials/MaterialsMarketIntelligenceReportsPage";
import { RawMaterialPlanningPage } from "@/src/components/materials/RawMaterialPlanningPage";
import { UnauthorizedAccessGate } from "@/src/components/UnauthorizedAccessGate";
import { usePermissions } from "@/src/hooks/usePermissions";

function MaterialsHomeRedirect({ path }: { path: string }) {
  return <Navigate to={path} replace />;
}

function MaterialsCanonicalRedirect() {
  const location = useLocation();
  return <Navigate to={resolveMaterialsCanonicalPath(location.pathname)} replace />;
}

export function MaterialsModule() {
  const permissions = usePermissions();
  const location = useLocation();
  /** PERM-40 — view via DTO/sidebar oficial (não bag canAccessModule). */
  const canViewModule = permissions.canViewModule("materials");
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
    return <UnauthorizedAccessGate forceDenied />;
  }

  if (isEmpty) {
    return <UnauthorizedAccessGate forceDenied />;
  }

  if (!isMaterialsCanonicalPath(location.pathname)) {
    return <MaterialsCanonicalRedirect />;
  }

  const onMiHome = location.pathname === "/materials/market-intelligence";
  const onMiDetail =
    location.pathname.startsWith("/materials/market-intelligence/") &&
    !location.pathname.endsWith("/reports");
  const onCatalog = location.pathname === "/materials" || location.pathname === "/materials/";
  const onStockConference = location.pathname.startsWith("/materials/stock-conference");
  const onPlanning = location.pathname.startsWith("/materials/planning");
  const canCatalog = visibleIds.has("catalog");
  const canStockConference = visibleIds.has("stockConference");
  const canMi = visibleIds.has("marketIntelligence");
  const canPlanning = visibleIds.has("planning");

  if (onCatalog && !canCatalog) {
    return <UnauthorizedAccessGate forceDenied />;
  }
  if (onStockConference && !canStockConference) {
    return <UnauthorizedAccessGate forceDenied />;
  }
  if ((onMiHome || location.pathname.includes("/market-intelligence")) && !canMi) {
    return <UnauthorizedAccessGate forceDenied />;
  }
  if (
    onMiDetail &&
    !permissions.canViewTabResource(MARKET_INTELLIGENCE_SECTION_KEYS.material360)
  ) {
    return <UnauthorizedAccessGate forceDenied />;
  }
  if (onPlanning && !canPlanning) {
    return <UnauthorizedAccessGate forceDenied />;
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
                  (section.id === "marketIntelligence" ||
                  section.id === "stockConference" ||
                  section.id === "planning"
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
          path="stock-conference/:materialId"
          element={
            canStockConference ? (
              <MaterialStockConferencePage />
            ) : (
              <UnauthorizedAccessGate forceDenied />
            )
          }
        />
        <Route
          path="stock-conference"
          element={
            canStockConference ? (
              <MaterialStockConferencePage />
            ) : (
              <UnauthorizedAccessGate forceDenied />
            )
          }
        />
        <Route
          path="market-intelligence/reports"
          element={
            canMi ? (
              <MaterialsMarketIntelligenceReportsPage />
            ) : (
              <UnauthorizedAccessGate forceDenied />
            )
          }
        />
        <Route
          path="market-intelligence/:materialId"
          element={
            canMi ? (
              <MaterialsMarketIntelligenceDetailPage />
            ) : (
              <UnauthorizedAccessGate forceDenied />
            )
          }
        />
        <Route
          path="market-intelligence"
          element={
            canMi ? (
              <MaterialsMarketIntelligencePage />
            ) : (
              <UnauthorizedAccessGate forceDenied />
            )
          }
        />
        <Route
          path="planning"
          element={
            canPlanning ? (
              <RawMaterialPlanningPage />
            ) : (
              <UnauthorizedAccessGate forceDenied />
            )
          }
        />
        <Route path="*" element={<MaterialsHomeRedirect path={defaultPath} />} />
      </Routes>
    </div>
  );
}
