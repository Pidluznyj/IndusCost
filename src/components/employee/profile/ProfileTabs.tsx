import React from "react";
import { cn } from "@/src/lib/utils";
import type { PeopleProfileCapabilities, PeopleProfileTabId } from "@/src/lib/peopleProfileTypes";

export const PEOPLE_PROFILE_TAB_DEFS: { id: PeopleProfileTabId; label: string }[] = [
  { id: "overview", label: "Visão Geral" },
  { id: "professional", label: "Profissional" },
  { id: "career", label: "Carreira" },
  { id: "compensation", label: "Remuneração" },
  { id: "benefits", label: "Benefícios" },
  { id: "personal", label: "Pessoal" },
  { id: "emergency", label: "Emergência" },
  { id: "epi", label: "EPI / Uniformes" },
  { id: "documents", label: "Documentos" },
  { id: "absences", label: "Férias / Afastamentos" },
  { id: "history", label: "Histórico" },
  { id: "notes", label: "Observações" },
  { id: "links", label: "Vínculos" },
  { id: "admin", label: "Referência administrativa" },
];

export function visibleProfileTabs(
  caps: PeopleProfileCapabilities | null,
  extras?: { canViewLinks?: boolean; canViewAdmin?: boolean }
): PeopleProfileTabId[] {
  const ids: PeopleProfileTabId[] = ["overview"];
  if (!caps || caps.canViewProfessional) ids.push("professional");
  if (!caps || caps.canViewCareer) ids.push("career");
  if (!caps || caps.canViewCompensationEvents) ids.push("compensation");
  if (!caps || caps.canViewBenefits) ids.push("benefits");
  if (caps?.canViewPersonal) ids.push("personal");
  if (caps?.canViewEmergency) ids.push("emergency");
  if (!caps || caps.canViewEpi) ids.push("epi");
  if (!caps || caps.canViewDocuments) ids.push("documents");
  if (!caps || caps.canViewAbsences) ids.push("absences");
  if (!caps || caps.canViewHistory) ids.push("history");
  if (!caps || caps.canViewNotes) ids.push("notes");
  if (extras?.canViewLinks) ids.push("links");
  if (extras?.canViewAdmin) ids.push("admin");
  return ids;
}

export function ProfileTabs({
  activeTab,
  onTabChange,
  visibleTabIds,
}: {
  activeTab: PeopleProfileTabId;
  onTabChange: (tab: PeopleProfileTabId) => void;
  visibleTabIds: readonly PeopleProfileTabId[];
}) {
  const tabs = PEOPLE_PROFILE_TAB_DEFS.filter((t) => visibleTabIds.includes(t.id));
  return (
    <nav
      className="shrink-0 border-b border-border bg-background px-4 overflow-x-auto"
      role="tablist"
      aria-label="Guias da ficha funcional"
    >
      <div className="flex min-w-max gap-0">
        {tabs.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
                active
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
