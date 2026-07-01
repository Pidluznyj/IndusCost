import React from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
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
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion } from "motion/react";
import { useAuth } from "@/src/contexts/AuthContext";
import { formatRoleLabel } from "@/src/lib/appAuthClient";
import {
  canAccessModule,
  MODULE_LABELS,
  type AppModuleId,
} from "@/src/lib/modulePermissions";

const ALL_MENU_ITEMS: {
  id: AppModuleId;
  icon: typeof LayoutDashboard;
  label: string;
}[] = [
  { id: "dashboard", icon: LayoutDashboard, label: MODULE_LABELS.dashboard },
  { id: "employees", icon: Users, label: MODULE_LABELS.employees },
  { id: "machines", icon: Cpu, label: MODULE_LABELS.machines },
  { id: "materials", icon: Truck, label: MODULE_LABELS.materials },
  { id: "purchases", icon: ShoppingCart, label: MODULE_LABELS.purchases },
  { id: "maintenance", icon: Wrench, label: MODULE_LABELS.maintenance },
  { id: "inventory", icon: Warehouse, label: MODULE_LABELS.inventory },
  { id: "projects", icon: FolderKanban, label: MODULE_LABELS.projects },
  { id: "fleet", icon: Car, label: MODULE_LABELS.fleet },
  { id: "products", icon: Package, label: MODULE_LABELS.products },
  { id: "opex", icon: PieChart, label: MODULE_LABELS.opex },
  { id: "taxes", icon: Scale, label: MODULE_LABELS.taxes },
  { id: "pricing", icon: Calculator, label: MODULE_LABELS.pricing },
  { id: "proposals", icon: FileText, label: MODULE_LABELS.proposals },
  { id: "sales-orders", icon: ClipboardList, label: MODULE_LABELS["sales-orders"] },
  { id: "customers", icon: Users, label: MODULE_LABELS.customers },
  { id: "crm-commercial", icon: Contact, label: MODULE_LABELS["crm-commercial"] },
  { id: "commissions", icon: HandCoins, label: MODULE_LABELS.commissions },
  { id: "simulations", icon: Layers, label: MODULE_LABELS.simulations },
  { id: "finance", icon: Banknote, label: MODULE_LABELS.finance },
  { id: "reports", icon: FileText, label: MODULE_LABELS.reports },
  { id: "guide", icon: BookOpen, label: MODULE_LABELS.guide },
  { id: "settings", icon: Settings, label: MODULE_LABELS.settings },
];

export const Sidebar = () => {
  const navigate = useNavigate();
  const auth = useAuth();
  const { authUser, logout } = auth;
  const [collapsed, setCollapsed] = React.useState(false);
  const [pendingLogout, setPendingLogout] = React.useState(false);

  const menuItems = React.useMemo(
    () => ALL_MENU_ITEMS.filter((item) => canAccessModule(item.id, auth)),
    [auth]
  );

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 80 : 260 }}
      className={cn(
        "h-screen bg-card border-r border-border flex flex-col relative z-20 transition-all duration-300 ease-in-out",
        collapsed ? "items-center" : ""
      )}
    >
      {/* Header */}
      <div className={cn("p-6 flex items-center mb-4", collapsed ? "justify-center" : "justify-between")}>
        <Link
          to="/"
          title="Página inicial"
          className={cn(
            "rounded-lg outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary/40",
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

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-1 overflow-y-auto scrollbar-hide">
        {menuItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.id}
              to={`/${item.id}`}
              end
              className={({ isActive }) =>
                cn(
                  "group flex items-center w-full p-3 rounded-lg transition-all duration-200",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )
              }
            >
              <Icon className="h-5 w-5 shrink-0 group-hover:scale-110 transition-transform" />
              {!collapsed && <span className="ml-3 font-medium text-sm truncate">{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-border space-y-2">
        {authUser && !collapsed ? (
          <div className="px-3 py-2 rounded-lg bg-muted/40 border border-border/60 mb-1">
            <p className="text-xs font-semibold text-foreground truncate">{authUser.name}</p>
            <p className="text-[10px] text-muted-foreground truncate">{formatRoleLabel(authUser.role)}</p>
          </div>
        ) : null}
        <button
          type="button"
          disabled={pendingLogout}
          className={cn(
            "flex items-center w-full p-3 rounded-lg transition-all duration-200 group",
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
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center w-full p-2 rounded-md hover:bg-accent text-muted-foreground transition-colors"
        >
          {collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </button>
      </div>
    </motion.aside>
  );
};
