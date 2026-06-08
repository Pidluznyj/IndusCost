export type FleetNavPermissions = {
  canView: boolean;
  canFinancial: boolean;
};

export const FLEET_TAB_IDS = [
  "overview",
  "vehicles",
  "drivers",
  "reservations",
  "publicRequests",
  "checklists",
  "maintenances",
  "reports",
  "costs",
  "incidents",
  "settings",
  // Legado — mantidos para estado interno, ocultos da navegação principal
  "mobile",
  "contracts",
  "documents",
] as const;

export type FleetTabId = (typeof FLEET_TAB_IDS)[number];

export type FleetTabDef = {
  id: FleetTabId;
  label: string;
  description?: string;
  /** Exibir na barra de abas principal */
  showInNav: boolean;
  /** Ordem na navegação (menor = mais à esquerda) */
  navOrder: number;
  /** Seção avançada (financeiro) */
  advanced?: boolean;
};

type FleetPerms = FleetNavPermissions;

const TAB_DEFS: FleetTabDef[] = [
  {
    id: "overview",
    label: "Visão Geral",
    description: "Resumo da operação e atalhos rápidos.",
    showInNav: true,
    navOrder: 10,
  },
  {
    id: "vehicles",
    label: "Veículos",
    description: "Cadastro, status e QR de checklist por veículo.",
    showInNav: true,
    navOrder: 20,
  },
  {
    id: "drivers",
    label: "Motoristas",
    description: "Condutores autorizados, CNH e aprovações.",
    showInNav: true,
    navOrder: 30,
  },
  {
    id: "reservations",
    label: "Reservas",
    description: "Agenda, aprovação, retirada e devolução.",
    showInNav: true,
    navOrder: 40,
  },
  {
    id: "publicRequests",
    label: "Solicitações QR",
    description: "Pedidos feitos pelo link ou QR público de reserva.",
    showInNav: true,
    navOrder: 50,
  },
  {
    id: "checklists",
    label: "Checklists",
    description: "Check-in/out por QR, pendências e histórico.",
    showInNav: true,
    navOrder: 60,
  },
  {
    id: "maintenances",
    label: "Manutenção",
    description: "Ordens de manutenção e bloqueio de veículos.",
    showInNav: true,
    navOrder: 70,
  },
  {
    id: "reports",
    label: "Relatórios",
    description: "Exportação analítica da frota.",
    showInNav: false,
    navOrder: 200,
    advanced: true,
  },
  {
    id: "costs",
    label: "Custos",
    description: "Custos, abastecimentos e multas.",
    showInNav: false,
    navOrder: 210,
    advanced: true,
  },
  {
    id: "incidents",
    label: "Ocorrências",
    description: "Sinistros e avarias registradas.",
    showInNav: false,
    navOrder: 220,
    advanced: true,
  },
  {
    id: "settings",
    label: "Configurações",
    description: "Link público, parâmetros e importação.",
    showInNav: true,
    navOrder: 80,
  },
  {
    id: "mobile",
    label: "Uso em campo",
    showInNav: false,
    navOrder: 999,
  },
  {
    id: "contracts",
    label: "Contratos",
    showInNav: false,
    navOrder: 999,
  },
  {
    id: "documents",
    label: "Documentos",
    showInNav: false,
    navOrder: 999,
  },
];

/** Mapeia id legado "dashboard" para "overview". */
export function normalizeFleetTabId(tab: string | null | undefined): FleetTabId {
  if (tab === "dashboard") return "overview";
  if (FLEET_TAB_IDS.includes(tab as FleetTabId)) return tab as FleetTabId;
  return "overview";
}

export function getFleetTabDef(id: FleetTabId): FleetTabDef | undefined {
  return TAB_DEFS.find((t) => t.id === id);
}

export function getVisibleFleetTabs(perms: FleetPerms): FleetTabDef[] {
  return TAB_DEFS.filter((tab) => {
    if (!tab.showInNav) return false;
    if (tab.advanced && !perms.canFinancial) return false;
    if (tab.id === "settings" && !perms.canView) return false;
    return true;
  }).sort((a, b) => a.navOrder - b.navOrder);
}

export function getAdvancedFleetTabs(perms: FleetPerms): FleetTabDef[] {
  if (!perms.canFinancial) return [];
  return TAB_DEFS.filter((t) => t.advanced && t.showInNav === false).sort(
    (a, b) => a.navOrder - b.navOrder
  );
}
