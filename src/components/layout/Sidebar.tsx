import React from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Settings,
  Package,
  Cpu,
  Truck,
  ShoppingCart,
  Calculator,
  TrendingUp,
  FileText,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  LogOut,
  PieChart,
  GitCompare,
  Scale,
  Layers,
  HandCoins,
  BookOpen,
  ClipboardList,
  Wrench,
  Contact,
  Car,
  Banknote,
  Building2,
  FolderKanban,
  Warehouse,
  Briefcase,
  Factory,
  Gauge,
  Activity,
  Cog,
  HelpCircle,
  Network,
  Table2,
  PackageCheck,
  Landmark,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion } from "motion/react";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { useSidebarLayout } from "@/src/contexts/SidebarLayoutContext";
import { formatRoleLabel } from "@/src/lib/appAuthClient";
import { resolveSidebarAsideWidth } from "@/src/lib/sidebarLayout";
import {
  MODULE_LABELS,
  type AppModuleId,
} from "@/src/lib/modulePermissions";
import type { NavigationGroupId, NavigationGroupedItem } from "@/src/lib/navigationGroups";
import { buildResourceAwareSidebarNavigation } from "@/src/lib/resourceNavigationAccess";
import { fetchSalesOrderFlowFeatureStatus } from "@/src/lib/salesOrderFlowClient";
import { filterSalesOrderFlowMenuNavigation } from "@/src/lib/salesOrderFlowNavigation";
import { filterSupplyChainMenuNavigation } from "@/src/lib/supply-chain/supplyChainNavigation";
import {
  canViewTreasuryModule,
  filterTreasuryMenuNavigation,
} from "@/src/lib/treasury/treasuryNavigation";
import { fetchTreasuryAvailability } from "@/src/lib/treasury/treasuryAvailabilityApi";
import { fetchSupplyChainFeatureStatus } from "@/src/lib/supply-chain/supplyChainClient";
import {
  canViewSupplyChainInventoryModule,
  canViewSupplyChainPurchasesModule,
  canViewSupplyChainReceivingModule,
} from "@/src/lib/supply-chain/supplyChainAccess";
import { canViewSalesOrderFlow } from "@/src/lib/salesOrderFlowUi";
import {
  getSidebarGroupButtonId,
  getSidebarGroupPanelId,
  isNavigationGroupExpanded,
  mergeExpandedNavigationGroups,
  parseStoredExpandedGroups,
  resolveActiveNavigationGroupId,
  resolveExpandedGroupsForPath,
  resolveInitialExpandedGroups,
  serializeExpandedGroups,
  SIDEBAR_EXPANDED_GROUPS_STORAGE_KEY,
  SIDEBAR_GROUP_UI_LABELS,
  toggleExpandedGroupInSet,
  type SidebarMenuItemDef,
} from "@/src/lib/sidebarNavigation";
import {
  resolveModuleShortLabel,
  resolveNavigationGroupShortLabel,
} from "@/src/lib/sidebarLabels";
import type { NavigationGroupWithItems } from "@/src/lib/navigationGroups";

/** Marcadores estáveis para testes/auditoria de layout (sem alterar rotas). */
export const SIDEBAR_LAYOUT_MARKERS = {
  navScroll: "sidebar-nav-scroll",
  footer: "sidebar-footer",
  groupRoot: "sidebar-group",
  groupActive: "sidebar-group-active",
  navLink: "sidebar-nav-link",
  navLinkActive: "sidebar-nav-link-active",
  collapsedRail: "sidebar-collapsed-rail",
  collapsedFlyout: "sidebar-collapsed-flyout",
  collapsedShortLabel: "sidebar-collapsed-short-label",
} as const;

const MENU_ITEM_ICONS: Record<AppModuleId, LucideIcon> = {
  dashboard: LayoutDashboard,
  employees: Users,
  "employees-dashboard": LayoutDashboard,
  "org-chart": Network,
  machines: Cpu,
  materials: Truck,
  purchases: ShoppingCart,
  "sc-purchases": ShoppingCart,
  maintenance: Wrench,
  inventory: Warehouse,
  "sc-inventory": Warehouse,
  "sc-receiving": PackageCheck,
  "operations-performance": Activity,
  "production-orders": Cog,
  projects: FolderKanban,
  fleet: Car,
  products: Package,
  "transformation-simulator": Gauge,
  opex: PieChart,
  taxes: Scale,
  pricing: Calculator,
  "commercial-price-table": Table2,
  proposals: FileText,
  "sales-orders": ClipboardList,
  "sales-order-flow": FolderKanban,
  "output-documents": FileText,
  customers: Users,
  "crm-commercial": Contact,
  commissions: HandCoins,
  simulations: Layers,
  finance: Banknote,
  treasury: Landmark,
  suppliers: Building2,
  "portfolio-reconciliation": GitCompare,
  reports: FileText,
  guide: BookOpen,
  settings: Settings,
};

const GROUP_ICONS: Record<NavigationGroupId, LucideIcon> = {
  dashboard: LayoutDashboard,
  engenharia: Package,
  cadeia_suprimentos: Truck,
  comercial: Briefcase,
  financeiro: Banknote,
  operacoes: Factory,
  gestao_pessoas: Users,
  administracao: Settings,
  outros: HelpCircle,
};

function readStoredExpandedGroups(): Set<NavigationGroupId> {
  if (typeof window === "undefined") return new Set();
  return parseStoredExpandedGroups(window.localStorage.getItem(SIDEBAR_EXPANDED_GROUPS_STORAGE_KEY));
}

function persistExpandedGroups(groups: ReadonlySet<NavigationGroupId>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SIDEBAR_EXPANDED_GROUPS_STORAGE_KEY, serializeExpandedGroups(groups));
}

function SidebarNavLink({
  item,
  collapsed,
  nested = false,
  onNavigate,
}: {
  item: SidebarMenuItemDef | NavigationGroupedItem;
  collapsed: boolean;
  nested?: boolean;
  onNavigate?: () => void;
}) {
  const moduleId = "itemId" in item ? item.itemId : item.id;
  const label = item.label;
  const shortLabel = resolveModuleShortLabel(moduleId);
  const path = item.path;
  const Icon = MENU_ITEM_ICONS[moduleId];

  return (
    <NavLink
      to={path}
      end
      title={collapsed ? label : undefined}
      aria-label={label}
      data-sidebar-item={moduleId}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          SIDEBAR_LAYOUT_MARKERS.navLink,
          "group flex items-center w-full rounded-md transition-colors duration-200 min-w-0",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          collapsed
            ? cn(
                "flex-col justify-center gap-0.5 min-h-11 px-1 py-2",
                isActive && "border-l-[3px] border-l-primary pl-0.5"
              )
            : nested
              ? "min-h-11 py-2 pl-2.5 pr-2.5"
              : "min-h-11 px-3 py-2.5",
          isActive
            ? cn(
                SIDEBAR_LAYOUT_MARKERS.navLinkActive,
                "bg-primary text-primary-foreground shadow-sm font-medium"
              )
            : "text-muted-foreground hover:bg-accent/80 hover:text-foreground"
        )
      }
    >
      <Icon
        className={cn(
          "shrink-0 transition-transform group-hover:scale-105",
          collapsed ? "h-5 w-5" : nested ? "h-4 w-4" : "h-[18px] w-[18px]"
        )}
      />
      {collapsed ? (
        <span
          data-sidebar-short-label={SIDEBAR_LAYOUT_MARKERS.collapsedShortLabel}
          className="w-full truncate text-center text-[10px] font-semibold leading-tight"
        >
          {shortLabel}
        </span>
      ) : (
        <span
          className={cn(
            "truncate",
            nested ? "ml-2.5 text-[13px] leading-tight" : "ml-3 text-sm font-medium"
          )}
        >
          {label}
        </span>
      )}
    </NavLink>
  );
}

function SidebarNavGroup({
  groupId,
  label,
  items,
  expanded,
  isActiveGroup,
  onToggle,
}: {
  groupId: NavigationGroupId;
  label: string;
  items: NavigationGroupedItem[];
  expanded: boolean;
  isActiveGroup: boolean;
  onToggle: (groupId: NavigationGroupId) => void;
}) {
  const GroupIcon = GROUP_ICONS[groupId];
  const buttonId = getSidebarGroupButtonId(groupId);
  const panelId = getSidebarGroupPanelId(groupId);

  return (
    <div
      className={cn(
        SIDEBAR_LAYOUT_MARKERS.groupRoot,
        "min-w-0 rounded-lg",
        isActiveGroup && SIDEBAR_LAYOUT_MARKERS.groupActive
      )}
      data-sidebar-group={groupId}
      data-sidebar-group-active={isActiveGroup ? "true" : "false"}
      role="group"
      aria-labelledby={buttonId}
    >
      <button
        id={buttonId}
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        aria-label={`${label}, ${expanded ? "recolher" : "expandir"} seção`}
        onClick={() => onToggle(groupId)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle(groupId);
          }
        }}
        className={cn(
          "flex items-center w-full rounded-md px-3 py-2.5 transition-colors duration-200 min-w-0 min-h-11",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          isActiveGroup
            ? "bg-primary/8 text-foreground ring-1 ring-inset ring-primary/25"
            : "text-muted-foreground hover:bg-accent/70 hover:text-foreground"
        )}
      >
        <GroupIcon className="h-[18px] w-[18px] shrink-0 opacity-90" aria-hidden="true" />
        <span className="ml-3 text-sm font-semibold truncate flex-1 text-left tracking-tight">
          {label}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "h-4 w-4 shrink-0 opacity-60 transition-transform duration-200",
            expanded ? "rotate-180" : "rotate-0"
          )}
        />
      </button>
      {expanded ? (
        <div
          id={panelId}
          role="region"
          aria-labelledby={buttonId}
          className="mt-1 mb-0.5 ml-4 pl-2.5 border-l-2 border-border/70 space-y-0.5 min-w-0"
        >
          {items.map((item) => (
            <SidebarNavLink key={item.itemId} item={item} collapsed={false} nested />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SidebarCollapsedGroupButton({
  group,
  isActiveGroup,
  isFlyoutOpen,
  onToggleFlyout,
  buttonRef,
}: {
  group: NavigationGroupWithItems;
  isActiveGroup: boolean;
  isFlyoutOpen: boolean;
  onToggleFlyout: () => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const GroupIcon = GROUP_ICONS[group.id];
  const shortLabel = resolveNavigationGroupShortLabel(group.id);

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-expanded={isFlyoutOpen}
      aria-haspopup="menu"
      aria-label={`${group.label}, abrir submenu`}
      data-sidebar-group={group.id}
      data-sidebar-group-active={isActiveGroup ? "true" : "false"}
      onClick={onToggleFlyout}
      className={cn(
        SIDEBAR_LAYOUT_MARKERS.groupRoot,
        "flex w-full flex-col items-center justify-center gap-0.5 rounded-md min-h-11 px-1 py-2 transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        isActiveGroup
          ? cn(
              SIDEBAR_LAYOUT_MARKERS.groupActive,
              "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40 border-l-[3px] border-l-primary"
            )
          : "text-muted-foreground hover:bg-accent/80 hover:text-foreground",
        isFlyoutOpen && "bg-accent text-foreground"
      )}
    >
      <GroupIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span
        data-sidebar-short-label={SIDEBAR_LAYOUT_MARKERS.collapsedShortLabel}
        className="w-full truncate text-center text-[10px] font-semibold leading-tight"
      >
        {shortLabel}
      </span>
    </button>
  );
}

function SidebarCollapsedFlyout({
  group,
  anchorTop,
  sidebarWidth,
  onClose,
  onSelectItem,
}: {
  group: NavigationGroupWithItems;
  anchorTop: number;
  sidebarWidth: number;
  onClose: () => void;
  onSelectItem: () => void;
}) {
  const panelId = getSidebarGroupPanelId(group.id);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <>
      <button
        type="button"
        aria-label="Fechar submenu"
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
      />
      <div
        id={panelId}
        role="menu"
        aria-label={group.label}
        data-sidebar-flyout={SIDEBAR_LAYOUT_MARKERS.collapsedFlyout}
        className="fixed z-50 flex max-h-[min(70vh,28rem)] w-64 flex-col rounded-lg border border-border bg-card shadow-xl"
        style={{ left: sidebarWidth + 4, top: Math.max(8, anchorTop) }}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3 py-2.5">
          <span className="truncate text-sm font-semibold text-foreground">{group.label}</span>
          <button
            type="button"
            aria-label="Fechar submenu"
            onClick={onClose}
            className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-0.5">
          {group.items.map((item) => (
            <SidebarNavLink
              key={item.itemId}
              item={item}
              collapsed={false}
              nested
              onNavigate={onSelectItem}
            />
          ))}
        </div>
      </div>
    </>
  );
}

export const Sidebar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const permissions = usePermissions();
  const { authUser, logout } = auth;
  const {
    desktopCollapsed,
    isMobile,
    mobileOpen,
    toggleDesktopCollapsed,
    closeMobileSidebar,
  } = useSidebarLayout();
  const collapsed = isMobile ? false : desktopCollapsed;
  const [pendingLogout, setPendingLogout] = React.useState(false);

  const asideWidth = resolveSidebarAsideWidth({ isMobile, desktopCollapsed });

  React.useEffect(() => {
    if (isMobile) closeMobileSidebar();
  }, [location.pathname, isMobile, closeMobileSidebar]);

  const permissionKey = [
    permissions.authUser?.id ?? "",
    permissions.authUser?.role ?? "",
    (permissions.authUser?.effectivePermissions ?? []).join("|"),
    permissions.authLoading ? "1" : "0",
    permissions.authError ?? "",
    (auth.effectiveAccess?.allowedResources ?? []).join("|"),
  ].join("::");

  // PERM-36: filtro só via DTO /me + catálogo oficial (sem regras locais de auth).
  const baseNavigation = React.useMemo(
    () =>
      buildResourceAwareSidebarNavigation({
        user: permissions.authUser,
        checker: auth,
        effectiveAccess: auth.effectiveAccess,
        authLoading: permissions.authLoading,
        authError: permissions.authError,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [permissionKey]
  );

  const [salesOrderFlowFeatureEnabled, setSalesOrderFlowFeatureEnabled] =
    React.useState<boolean | null>(null);
  const [treasuryFeatureEnabled, setTreasuryFeatureEnabled] =
    React.useState<boolean | null>(null);
  const [supplyChainFeatures, setSupplyChainFeatures] = React.useState<{
    purchases: boolean | null;
    inventory: boolean | null;
    receiving: boolean | null;
  }>({ purchases: null, inventory: null, receiving: null });

  React.useEffect(() => {
    if (permissions.authLoading || !permissions.authUser) {
      setSalesOrderFlowFeatureEnabled(null);
      return;
    }
    const hasFlowView = canViewSalesOrderFlow({
      canPerformAction: permissions.canPerformAction,
      hasPermission: auth.hasPermission,
    });
    if (!hasFlowView) {
      setSalesOrderFlowFeatureEnabled(false);
      return;
    }
    const controller = new AbortController();
    void fetchSalesOrderFlowFeatureStatus(controller.signal)
      .then((status) => {
        if (!controller.signal.aborted) {
          setSalesOrderFlowFeatureEnabled(status.enabled);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSalesOrderFlowFeatureEnabled(false);
        }
      });
    return () => controller.abort();
  }, [
    permissions.authLoading,
    permissions.authUser,
    permissions.canPerformAction,
    auth.hasPermission,
  ]);

  React.useEffect(() => {
    if (permissions.authLoading || !permissions.authUser) {
      setTreasuryFeatureEnabled(null);
      return;
    }
    const hasTreasuryView = canViewTreasuryModule({
      canPerformAction: permissions.canPerformAction,
      hasPermission: auth.hasPermission,
    });
    if (!hasTreasuryView) {
      setTreasuryFeatureEnabled(false);
      return;
    }
    const controller = new AbortController();
    void fetchTreasuryAvailability({ signal: controller.signal })
      .then((status) => {
        if (!controller.signal.aborted) {
          setTreasuryFeatureEnabled(status.enabled === true);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setTreasuryFeatureEnabled(false);
        }
      });
    return () => controller.abort();
  }, [
    permissions.authLoading,
    permissions.authUser,
    permissions.canPerformAction,
    auth.hasPermission,
  ]);

  React.useEffect(() => {
    if (permissions.authLoading || !permissions.authUser) {
      setSupplyChainFeatures({ purchases: null, inventory: null, receiving: null });
      return;
    }
    const controller = new AbortController();
    void fetchSupplyChainFeatureStatus(controller.signal)
      .then((status) => {
        if (!controller.signal.aborted) {
          setSupplyChainFeatures({
            purchases: status.enabled.purchases,
            inventory: status.enabled.inventory,
            receiving: status.enabled.receiving,
          });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSupplyChainFeatures({
            purchases: false,
            inventory: false,
            receiving: false,
          });
        }
      });
    return () => controller.abort();
  }, [permissions.authLoading, permissions.authUser]);

  const navigation = React.useMemo(() => {
    const withSalesOrderFlow = filterSalesOrderFlowMenuNavigation(baseNavigation, {
      featureEnabled: salesOrderFlowFeatureEnabled,
      hasFlowViewAccess: canViewSalesOrderFlow({
        canPerformAction: permissions.canPerformAction,
        hasPermission: auth.hasPermission,
      }),
    });
    const withTreasury = filterTreasuryMenuNavigation(withSalesOrderFlow, {
      featureEnabled: treasuryFeatureEnabled,
      hasTreasuryViewAccess: canViewTreasuryModule({
        canPerformAction: permissions.canPerformAction,
        hasPermission: auth.hasPermission,
      }),
    });
    return filterSupplyChainMenuNavigation(withTreasury, supplyChainFeatures, {
      purchases: canViewSupplyChainPurchasesModule({
        hasPermission: auth.hasPermission,
      }),
      inventory: canViewSupplyChainInventoryModule({
        hasPermission: auth.hasPermission,
      }),
      receiving: canViewSupplyChainReceivingModule({
        hasPermission: auth.hasPermission,
      }),
    });
  }, [
    baseNavigation,
    salesOrderFlowFeatureEnabled,
    treasuryFeatureEnabled,
    supplyChainFeatures,
    permissions.canPerformAction,
    auth.hasPermission,
  ]);

  const [expandedGroups, setExpandedGroups] = React.useState<Set<NavigationGroupId>>(() =>
    resolveInitialExpandedGroups(location.pathname, navigation, readStoredExpandedGroups())
  );

  const activeGroupId = React.useMemo(
    () => resolveActiveNavigationGroupId(location.pathname, navigation),
    [location.pathname, navigation]
  );

  React.useEffect(() => {
    setExpandedGroups((current) => {
      const next = mergeExpandedNavigationGroups(
        current,
        resolveExpandedGroupsForPath(location.pathname, navigation)
      );
      persistExpandedGroups(next);
      return next;
    });
  }, [location.pathname, navigation]);

  const toggleGroup = React.useCallback(
    (groupId: NavigationGroupId) => {
      setExpandedGroups((current) => {
        const next = toggleExpandedGroupInSet(current, groupId, activeGroupId);
        persistExpandedGroups(next);
        return next;
      });
    },
    [activeGroupId]
  );

  const collapsibleGroups = React.useMemo(() => {
    const groups = [...navigation.groups];
    if (navigation.fallbackGroup) groups.push(navigation.fallbackGroup);
    return groups;
  }, [navigation]);

  const [openFlyoutGroupId, setOpenFlyoutGroupId] = React.useState<NavigationGroupId | null>(null);
  const [flyoutAnchorTop, setFlyoutAnchorTop] = React.useState(0);
  const groupButtonRefs = React.useRef<Partial<Record<NavigationGroupId, HTMLButtonElement | null>>>({});

  const closeFlyout = React.useCallback(() => setOpenFlyoutGroupId(null), []);

  const toggleFlyout = React.useCallback((groupId: NavigationGroupId) => {
    setOpenFlyoutGroupId((current) => {
      if (current === groupId) return null;
      const button = groupButtonRefs.current[groupId];
      if (button) {
        setFlyoutAnchorTop(button.getBoundingClientRect().top);
      }
      return groupId;
    });
  }, []);

  React.useEffect(() => {
    closeFlyout();
  }, [location.pathname, collapsed, closeFlyout]);

  const openFlyoutGroup =
    collapsibleGroups.find((group) => group.id === openFlyoutGroupId) ?? null;

  return (
    <motion.aside
      initial={false}
      animate={{ width: asideWidth }}
      data-sidebar-collapsed={collapsed ? "true" : "false"}
      data-sidebar-mobile={isMobile ? "true" : "false"}
      data-sidebar-mobile-open={isMobile && mobileOpen ? "true" : "false"}
      className={cn(
        "h-screen min-h-0 bg-card border-r border-border flex flex-col",
        isMobile
          ? cn(
              "fixed inset-y-0 left-0 z-30 shadow-xl transition-transform duration-300 ease-in-out",
              mobileOpen ? "translate-x-0" : "-translate-x-full pointer-events-none"
            )
          : "relative shrink-0 z-20 transition-[width] duration-300 ease-in-out"
      )}
    >
      <div
        className={cn(
          "shrink-0 px-4 pt-5 pb-3 border-b border-border/50",
          collapsed ? "flex justify-center" : ""
        )}
      >
        <Link
          to="/home"
          title="Página inicial"
          className={cn(
            "rounded-lg outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50",
            collapsed ? "flex justify-center" : ""
          )}
        >
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2.5 overflow-hidden"
            >
              <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center shadow-sm">
                <TrendingUp className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="font-bold text-lg tracking-tight whitespace-nowrap text-foreground">
                IndusCost
              </span>
            </motion.div>
          )}
          {collapsed && (
            <div
              className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center shadow-sm"
              title="IndusCost"
            >
              <TrendingUp className="h-5 w-5 text-primary-foreground" />
            </div>
          )}
        </Link>
      </div>

      <nav
        aria-label="Menu principal"
        data-sidebar-nav={SIDEBAR_LAYOUT_MARKERS.navScroll}
        className={cn(
          SIDEBAR_LAYOUT_MARKERS.navScroll,
          "flex-1 min-h-0 px-2.5 py-3 overflow-y-auto overflow-x-hidden scrollbar-hide w-full"
        )}
      >
        {collapsed ? (
          <div
            data-sidebar-collapsed-rail={SIDEBAR_LAYOUT_MARKERS.collapsedRail}
            className="flex flex-col gap-1 min-w-0"
          >
            {navigation.directItems.length > 0 ? (
              <div className="mb-1 flex flex-col gap-1 border-b border-border/60 pb-2">
                {navigation.directItems.map((item) => (
                  <SidebarNavLink key={item.itemId} item={item} collapsed />
                ))}
              </div>
            ) : null}

            {collapsibleGroups.map((group) => (
              <SidebarCollapsedGroupButton
                key={group.id}
                group={group}
                isActiveGroup={activeGroupId === group.id}
                isFlyoutOpen={openFlyoutGroupId === group.id}
                onToggleFlyout={() => toggleFlyout(group.id)}
                buttonRef={{
                  get current() {
                    return groupButtonRefs.current[group.id] ?? null;
                  },
                  set current(node: HTMLButtonElement | null) {
                    groupButtonRefs.current[group.id] = node;
                  },
                }}
              />
            ))}

            {openFlyoutGroup ? (
              <SidebarCollapsedFlyout
                group={openFlyoutGroup}
                anchorTop={flyoutAnchorTop}
                sidebarWidth={asideWidth}
                onClose={closeFlyout}
                onSelectItem={closeFlyout}
              />
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-3 min-w-0 pb-1">
            {navigation.directItems.length > 0 ? (
              <div className="pb-2 mb-1 border-b border-border/60">
                {navigation.directItems.map((item) => (
                  <SidebarNavLink key={item.itemId} item={item} collapsed={false} />
                ))}
              </div>
            ) : null}

            {collapsibleGroups.length > 0 ? (
              <div className="flex flex-col gap-2">
                {collapsibleGroups.map((group) => {
                  const expanded = isNavigationGroupExpanded(
                    group.id,
                    expandedGroups,
                    activeGroupId
                  );
                  return (
                    <SidebarNavGroup
                      key={group.id}
                      groupId={group.id}
                      label={group.label}
                      items={group.items}
                      expanded={expanded}
                      isActiveGroup={activeGroupId === group.id}
                      onToggle={toggleGroup}
                    />
                  );
                })}
              </div>
            ) : null}
          </div>
        )}
      </nav>

      <div
        data-sidebar-footer={SIDEBAR_LAYOUT_MARKERS.footer}
        className={cn(
          SIDEBAR_LAYOUT_MARKERS.footer,
          "shrink-0 p-3 border-t border-border/80 bg-card/95 space-y-1.5 w-full min-w-0"
        )}
      >
        {authUser && !collapsed ? (
          <div className="px-3 py-2 rounded-md bg-muted/50 border border-border/60">
            <p className="text-xs font-semibold text-foreground truncate">{authUser.name}</p>
            <p className="text-[10px] text-muted-foreground truncate">{formatRoleLabel(authUser.role)}</p>
          </div>
        ) : null}
        <button
          type="button"
          disabled={pendingLogout}
          title={collapsed ? (pendingLogout ? "Saindo…" : "Sair") : undefined}
          aria-label={collapsed ? (pendingLogout ? "Saindo…" : "Sair") : undefined}
          className={cn(
            "flex items-center w-full rounded-md transition-colors duration-200 min-w-0 min-h-11",
            collapsed ? "justify-center px-1 py-2" : "px-3 py-2.5",
            "text-muted-foreground hover:bg-accent/80 hover:text-foreground disabled:opacity-60",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          )}
          onClick={() => {
            setPendingLogout(true);
            void logout()
              .then(() => navigate("/", { replace: true }))
              .finally(() => setPendingLogout(false));
          }}
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && (
            <span className="ml-3 text-sm font-medium truncate">
              {pendingLogout ? "Saindo…" : "Sair"}
            </span>
          )}
        </button>
        <button
          type="button"
          title={isMobile ? "Fechar menu" : collapsed ? "Expandir menu" : "Recolher menu"}
          aria-label={
            isMobile
              ? "Fechar menu lateral"
              : collapsed
                ? "Expandir menu lateral"
                : "Recolher menu lateral"
          }
          onClick={() => {
            if (isMobile) closeMobileSidebar();
            else toggleDesktopCollapsed();
          }}
          className={cn(
            "flex items-center justify-center w-full min-h-11 rounded-md transition-colors",
            "text-muted-foreground hover:bg-accent/80 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          )}
        >
          {isMobile || collapsed ? (
            <ChevronRight className="h-5 w-5" />
          ) : (
            <ChevronLeft className="h-5 w-5" />
          )}
        </button>
      </div>
    </motion.aside>
  );
};

/** Mapa de ícones exportado para testes/auditoria (labels oficiais inalterados). */
export const SIDEBAR_MENU_ITEM_ICONS = MENU_ITEM_ICONS;
export const SIDEBAR_MENU_ITEM_LABELS = MODULE_LABELS;

/** Ordem oficial dos rótulos de grupo na sidebar expandida. */
export const SIDEBAR_VISIBLE_GROUP_LABELS = SIDEBAR_GROUP_UI_LABELS;
