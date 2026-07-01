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
  Scale,
  Layers,
  HandCoins,
  BookOpen,
  ClipboardList,
  Wrench,
  Contact,
  Car,
  Banknote,
  FolderKanban,
  Warehouse,
  Briefcase,
  Factory,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion } from "motion/react";
import { useAuth } from "@/src/contexts/AuthContext";
import { formatRoleLabel } from "@/src/lib/appAuthClient";
import {
  MODULE_LABELS,
  type AppModuleId,
} from "@/src/lib/modulePermissions";
import type { NavigationGroupId, NavigationGroupedItem } from "@/src/lib/navigationGroups";
import {
  buildAccessibleSidebarNavigation,
  mergeExpandedNavigationGroups,
  resolveExpandedGroupsForPath,
  type SidebarMenuItemDef,
} from "@/src/lib/sidebarNavigation";

const MENU_ITEM_ICONS: Record<AppModuleId, LucideIcon> = {
  dashboard: LayoutDashboard,
  employees: Users,
  machines: Cpu,
  materials: Truck,
  purchases: ShoppingCart,
  maintenance: Wrench,
  inventory: Warehouse,
  projects: FolderKanban,
  fleet: Car,
  products: Package,
  opex: PieChart,
  taxes: Scale,
  pricing: Calculator,
  proposals: FileText,
  "sales-orders": ClipboardList,
  customers: Users,
  "crm-commercial": Contact,
  commissions: HandCoins,
  simulations: Layers,
  finance: Banknote,
  reports: FileText,
  guide: BookOpen,
  settings: Settings,
};

const GROUP_ICONS: Record<NavigationGroupId, LucideIcon> = {
  dashboard: LayoutDashboard,
  engenharia: Package,
  comercial: Briefcase,
  financeiro: Banknote,
  operacoes: Factory,
  administracao: Settings,
  outros: HelpCircle,
};

function SidebarNavLink({
  item,
  collapsed,
  nested = false,
}: {
  item: SidebarMenuItemDef | NavigationGroupedItem;
  collapsed: boolean;
  nested?: boolean;
}) {
  const moduleId = "itemId" in item ? item.itemId : item.id;
  const label = item.label;
  const path = item.path;
  const Icon = MENU_ITEM_ICONS[moduleId];

  return (
    <NavLink
      to={path}
      end
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          "group flex items-center w-full rounded-lg transition-all duration-200 min-w-0",
          nested ? "p-2 pl-3" : "p-3",
          isActive
            ? "bg-primary text-primary-foreground shadow-md"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        )
      }
    >
      <Icon className="h-5 w-5 shrink-0 group-hover:scale-110 transition-transform" />
      {!collapsed && (
        <span className={cn("font-medium text-sm truncate", nested ? "ml-2.5" : "ml-3")}>
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
  collapsed,
  expanded,
  isActiveGroup,
  onToggle,
}: {
  groupId: NavigationGroupId;
  label: string;
  items: NavigationGroupedItem[];
  collapsed: boolean;
  expanded: boolean;
  isActiveGroup: boolean;
  onToggle: (groupId: NavigationGroupId) => void;
}) {
  const GroupIcon = GROUP_ICONS[groupId];

  if (collapsed) {
    return null;
  }

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => onToggle(groupId)}
        className={cn(
          "flex items-center w-full p-3 rounded-lg transition-all duration-200 min-w-0",
          isActiveGroup
            ? "bg-accent/70 text-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        )}
      >
        <GroupIcon className="h-5 w-5 shrink-0" />
        <span className="ml-3 font-medium text-sm truncate flex-1 text-left">{label}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 opacity-70 transition-transform duration-200",
            expanded ? "rotate-180" : "rotate-0"
          )}
        />
      </button>
      {expanded ? (
        <div className="mt-1 ml-3 pl-2 border-l border-border/60 space-y-0.5 min-w-0">
          {items.map((item) => (
            <SidebarNavLink key={item.itemId} item={item} collapsed={false} nested />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const Sidebar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const { authUser, logout } = auth;
  const [collapsed, setCollapsed] = React.useState(false);
  const [pendingLogout, setPendingLogout] = React.useState(false);

  const navigation = React.useMemo(
    () => buildAccessibleSidebarNavigation(auth),
    [auth]
  );

  const [expandedGroups, setExpandedGroups] = React.useState<Set<NavigationGroupId>>(() =>
    mergeExpandedNavigationGroups(
      new Set<NavigationGroupId>(),
      resolveExpandedGroupsForPath(location.pathname, navigation)
    )
  );

  React.useEffect(() => {
    setExpandedGroups((current) =>
      mergeExpandedNavigationGroups(current, resolveExpandedGroupsForPath(location.pathname, navigation))
    );
  }, [location.pathname, navigation]);

  const toggleGroup = React.useCallback((groupId: NavigationGroupId) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const activeGroupId = React.useMemo(
    () => resolveExpandedGroupsForPath(location.pathname, navigation)[0] ?? null,
    [location.pathname, navigation]
  );

  const collapsibleGroups = React.useMemo(() => {
    const groups = [...navigation.groups];
    if (navigation.fallbackGroup) groups.push(navigation.fallbackGroup);
    return groups;
  }, [navigation]);

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 80 : 260 }}
      className={cn(
        "h-screen bg-card border-r border-border flex flex-col relative z-20 transition-all duration-300 ease-in-out",
        collapsed ? "items-center" : ""
      )}
    >
      <div className={cn("p-6 flex items-center mb-4", collapsed ? "justify-center" : "justify-between")}>
        <Link
          to="/"
          title="Página inicial"
          className={cn(
            "rounded-lg outline-none transition-opacity hover:opacity-90 focus-visible:ring-ring/40 focus-visible:ring-2",
            collapsed ? "flex justify-center" : ""
          )}
        >
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2 overflow-hidden"
            >
              <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="font-bold text-lg tracking-tight whitespace-nowrap">IndusCost</span>
            </motion.div>
          )}
          {collapsed && (
            <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-primary-foreground" />
            </div>
          )}
        </Link>
      </div>

      <nav className="flex-1 px-3 space-y-1 overflow-y-auto overflow-x-hidden scrollbar-hide min-w-0">
        {collapsed ? (
          navigation.flatAccessibleItems.map((item) => (
            <SidebarNavLink key={item.id} item={item} collapsed />
          ))
        ) : (
          <>
            {navigation.directItems.map((item) => (
              <SidebarNavLink key={item.itemId} item={item} collapsed={false} />
            ))}

            {collapsibleGroups.map((group) => (
              <SidebarNavGroup
                key={group.id}
                groupId={group.id}
                label={group.label}
                items={group.items}
                collapsed={collapsed}
                expanded={expandedGroups.has(group.id) || activeGroupId === group.id}
                isActiveGroup={activeGroupId === group.id}
                onToggle={toggleGroup}
              />
            ))}
          </>
        )}
      </nav>

      <div className="p-4 border-t border-border space-y-2 w-full min-w-0">
        {authUser && !collapsed ? (
          <div className="px-3 py-2 rounded-lg bg-muted/40 border border-border/60 mb-1">
            <p className="text-xs font-semibold text-foreground truncate">{authUser.name}</p>
            <p className="text-[10px] text-muted-foreground truncate">{formatRoleLabel(authUser.role)}</p>
          </div>
        ) : null}
        <button
          type="button"
          disabled={pendingLogout}
          title={collapsed ? (pendingLogout ? "Saindo…" : "Sair") : undefined}
          className={cn(
            "flex items-center w-full p-3 rounded-lg transition-all duration-200 group min-w-0",
            "text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-60"
          )}
          onClick={() => {
            setPendingLogout(true);
            void logout()
              .then(() => navigate("/", { replace: true }))
              .finally(() => setPendingLogout(false));
          }}
        >
          <LogOut className="h-5 w-5 shrink-0" />
          {!collapsed && (
            <span className="ml-3 font-medium text-sm truncate">
              {pendingLogout ? "Saindo…" : "Sair"}
            </span>
          )}
        </button>
        <button
          type="button"
          title={collapsed ? "Expandir menu" : "Recolher menu"}
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center w-full p-2 rounded-md hover:bg-accent text-muted-foreground transition-colors"
        >
          {collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </button>
      </div>
    </motion.aside>
  );
};

/** Mapa de ícones exportado para testes/auditoria (labels oficiais inalterados). */
export const SIDEBAR_MENU_ITEM_LABELS = MODULE_LABELS;
