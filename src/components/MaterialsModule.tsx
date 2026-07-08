import React from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { cn } from "@/src/lib/utils";
import { useAuth } from "@/src/contexts/AuthContext";
import { canAccessModule } from "@/src/lib/modulePermissions";
import {
  getMaterialsDefaultPath,
  isMaterialsCanonicalPath,
  MATERIALS_SECTIONS,
  resolveMaterialsCanonicalPath,
} from "@/src/lib/materialsNavigation";
import { MaterialModule } from "@/src/components/MaterialModule";
import { MaterialsMarketIntelligencePage } from "@/src/components/materials/MaterialsMarketIntelligencePage";
import { MaterialsMarketIntelligenceDetailPage } from "@/src/components/materials/MaterialsMarketIntelligenceDetailPage";

function MaterialsHomeRedirect() {
  return <Navigate to={getMaterialsDefaultPath()} replace />;
}

function MaterialsCanonicalRedirect() {
  const location = useLocation();
  return <Navigate to={resolveMaterialsCanonicalPath(location.pathname)} replace />;
}

export function MaterialsModule() {
  const auth = useAuth();
  const location = useLocation();
  const canView = canAccessModule("materials", auth);

  if (!canView) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        Você não tem permissão para acessar Suprimentos.
      </div>
    );
  }

  if (!isMaterialsCanonicalPath(location.pathname)) {
    return <MaterialsCanonicalRedirect />;
  }

  return (
    <div className="space-y-6" data-testid="materials-module">
      <nav
        className="materials-module-tabs -mx-1 overflow-x-auto border-b border-border pb-3"
        aria-label="Seções de Suprimentos"
        data-testid="materials-module-tabs"
      >
        <div className="flex min-w-max flex-wrap gap-2 px-1">
          {MATERIALS_SECTIONS.map((section) => (
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
        <Route index element={<MaterialModule />} />
        <Route path="market-intelligence/:materialId" element={<MaterialsMarketIntelligenceDetailPage />} />
        <Route path="market-intelligence" element={<MaterialsMarketIntelligencePage />} />
        <Route path="*" element={<MaterialsHomeRedirect />} />
      </Routes>
    </div>
  );
}
