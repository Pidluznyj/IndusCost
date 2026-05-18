import React from "react";
import { Link, NavLink } from "react-router-dom";
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
  BookOpen,
  ClipboardList,
  Wrench,
  Contact,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion } from "motion/react";
import { useAuth } from "@/src/contexts/AuthContext";
import { formatRoleLabel } from "@/src/lib/appAuthClient";

export const Sidebar = () => {
  const { authUser, logout } = useAuth();
  const [collapsed, setCollapsed] = React.useState(false);
  const [pendingLogout, setPendingLogout] = React.useState(false);

  const menuItems = [
    { id: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { id: "employees", icon: Users, label: "Colaboradores" },
    { id: "machines", icon: Cpu, label: "Máquinas" },
    { id: "materials", icon: Truck, label: "Suprimentos" },
    { id: "purchases", icon: ShoppingCart, label: "Compras" },
    { id: "maintenance", icon: Wrench, label: "Manutenção Predial" },
    { id: "products", icon: Package, label: "Produtos" },
    { id: "opex", icon: PieChart, label: "Custos Indiretos" },
    { id: "taxes", icon: Scale, label: "Tributos" },
    { id: "pricing", icon: Calculator, label: "Formação de Preço" },
    { id: "proposals", icon: FileText, label: "Propostas" },
    { id: "sales-orders", icon: ClipboardList, label: "Pedidos de venda" },
    { id: "customers", icon: Users, label: "Clientes" },
    { id: "crm-commercial", icon: Contact, label: "CRM Comercial" },
    { id: "simulations", icon: Layers, label: "Simulações" },
    { id: "reports", icon: FileText, label: "Relatórios" },
    { id: "guide", icon: BookOpen, label: "Guia do Sistema" },
    { id: "settings", icon: Settings, label: "Configurações" },
  ];

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
            void logout().finally(() => setPendingLogout(false));
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
