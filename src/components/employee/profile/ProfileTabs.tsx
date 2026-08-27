import React from "react";
import {
  Briefcase,
  CalendarDays,
  FileText,
  Gift,
  Heart,
  History,
  Landmark,
  LayoutGrid,
  Link2,
  MessageSquare,
  Shield,
  TrendingUp,
  User,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import type { PeopleProfileCapabilities, PeopleProfileTabId } from "@/src/lib/peopleProfileTypes";

export const PEOPLE_PROFILE_TAB_DEFS: { id: PeopleProfileTabId; label: string }[] = [
  { id: "overview", label: "Visão geral" },
  { id: "professional", label: "Cargo & contrato" },
  { id: "career", label: "Carreira" },
  { id: "compensation", label: "Remuneração" },
  { id: "benefits", label: "Benefícios" },
  { id: "personal", label: "Dados pessoais" },
  { id: "emergency", label: "Contatos de emergência" },
  { id: "epi", label: "EPI & uniformes" },
  { id: "documents", label: "Documentos" },
  { id: "absences", label: "Férias & afastamentos" },
  { id: "history", label: "Histórico" },
  { id: "notes", label: "Observações" },
  { id: "links", label: "Vínculos & acessos" },
  { id: "admin", label: "Referência administrativa" },
];

/** Grupos de navegação da ficha — ordem de leitura para quem não é técnico. */
export const PEOPLE_PROFILE_TAB_GROUPS: { label: string; ids: PeopleProfileTabId[] }[] = [
  { label: "Perfil", ids: ["overview", "personal", "emergency"] },
  { label: "Trabalho", ids: ["professional", "career", "compensation", "benefits"] },
  { label: "Rotina", ids: ["absences", "epi", "documents"] },
  { label: "Registro", ids: ["history", "notes", "links", "admin"] },
];

const TAB_ICONS: Record<PeopleProfileTabId, LucideIcon> = {
  overview: LayoutGrid,
  professional: Briefcase,
  career: TrendingUp,
  compensation: Wallet,
  benefits: Gift,
  personal: User,
  emergency: Heart,
  epi: Shield,
  documents: FileText,
  absences: CalendarDays,
  history: History,
  notes: MessageSquare,
  links: Link2,
  admin: Landmark,
};

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
  const labelById = new Map(PEOPLE_PROFILE_TAB_DEFS.map((t) => [t.id, t.label]));
  const groups = PEOPLE_PROFILE_TAB_GROUPS.map((group) => ({
    label: group.label,
    ids: group.ids.filter((id) => visibleTabIds.includes(id)),
  })).filter((group) => group.ids.length > 0);

  return (
    <nav
      className="shrink-0 h-full overflow-y-auto px-3 py-4 flex flex-col gap-4"
      role="tablist"
      aria-orientation="vertical"
      aria-label="Guias da ficha funcional"
    >
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          <div className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            {group.label}
          </div>
          {group.ids.map((id) => {
            const active = id === activeTab;
            const Icon = TAB_ICONS[id];
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onTabChange(id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors",
                  active
                    ? "bg-primary/10 font-semibold text-primary"
                    : "text-foreground hover:bg-accent"
                )}
              >
                <Icon
                  className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")}
                  aria-hidden
                />
                <span className="truncate">{labelById.get(id) ?? id}</span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
