/**
 * Abas do módulo Estoque / Almoxarifado.
 */

export const INVENTORY_TAB_IDS = [
  "overview",
  "items",
  "warehouses",
  "balances",
  "movements",
  "counts",
  "reservations",
  "audit",
] as const;

export type InventoryTabId = (typeof INVENTORY_TAB_IDS)[number];

export type InventoryTabDef = {
  id: InventoryTabId;
  label: string;
  description: string;
  showInNav: boolean;
  navOrder: number;
  /** Fase futura — aba ainda não implementada. */
  comingSoon?: boolean;
};

export const INVENTORY_TAB_DEFS: InventoryTabDef[] = [
  {
    id: "overview",
    label: "Visão Geral",
    description: "Indicadores, alertas e últimas movimentações.",
    showInNav: true,
    navOrder: 10,
  },
  {
    id: "items",
    label: "Itens",
    description: "Cadastro e consulta de itens de estoque.",
    showInNav: true,
    navOrder: 20,
  },
  {
    id: "warehouses",
    label: "Almoxarifados",
    description: "Cadastro de almoxarifados e locais.",
    showInNav: true,
    navOrder: 30,
  },
  {
    id: "balances",
    label: "Saldos",
    description: "Consulta de saldos por item e local.",
    showInNav: true,
    navOrder: 40,
  },
  {
    id: "movements",
    label: "Movimentações",
    description: "Histórico e registro de movimentações.",
    showInNav: true,
    navOrder: 50,
  },
  {
    id: "counts",
    label: "Conferência Física",
    description: "Sessões de inventário e ajustes rastreáveis.",
    showInNav: true,
    navOrder: 60,
    comingSoon: true,
  },
  {
    id: "reservations",
    label: "Reservas",
    description: "Reservas ativas e cancelamentos.",
    showInNav: true,
    navOrder: 70,
    comingSoon: true,
  },
  {
    id: "audit",
    label: "Auditoria",
    description: "Trilha de auditoria do módulo.",
    showInNav: true,
    navOrder: 80,
    comingSoon: true,
  },
];

export const INVENTORY_BASE_PATH = "/inventory";

export function getInventoryTabDef(id: InventoryTabId): InventoryTabDef | undefined {
  return INVENTORY_TAB_DEFS.find((t) => t.id === id);
}

export function getVisibleInventoryTabs(): InventoryTabDef[] {
  return INVENTORY_TAB_DEFS.filter((t) => t.showInNav).sort((a, b) => a.navOrder - b.navOrder);
}

export function resolveInventoryTabFromPath(pathname: string): InventoryTabId {
  if (pathname.includes("/inventory/items")) return "items";
  if (pathname.includes("/inventory/warehouses")) return "warehouses";
  if (pathname.includes("/inventory/movements")) return "movements";
  if (pathname.includes("/inventory/balances")) return "balances";
  return "overview";
}
