import React from "react";
import { 
  LayoutDashboard, 
  Users, 
  Settings, 
  Package, 
  Cpu, 
  Truck, 
  Calculator, 
  TrendingUp, 
  FileText,
  ChevronLeft,
  ChevronRight,
  LogOut,
  PieChart,
  Scale,
  Layers
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion } from "motion/react";

interface SidebarItemProps {
  key?: string;
  icon: React.ElementType;
  label: string;
  active?: boolean;
  collapsed?: boolean;
  onClick?: () => void;
}

const SidebarItem = ({ icon: Icon, label, active, collapsed, onClick }: SidebarItemProps) => (
  <button
    onClick={onClick}
    className={cn(
      "flex items-center w-full p-3 rounded-lg transition-all duration-200 group",
      active 
        ? "bg-primary text-primary-foreground shadow-md" 
        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
    )}
  >
    <Icon className={cn("h-5 w-5 shrink-0", active ? "" : "group-hover:scale-110 transition-transform")} />
    {!collapsed && (
      <span className="ml-3 font-medium text-sm truncate">{label}</span>
    )}
  </button>
);

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export const Sidebar = ({ activeTab, onTabChange }: SidebarProps) => {
  const [collapsed, setCollapsed] = React.useState(false);

  const menuItems = [
    { id: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { id: "employees", icon: Users, label: "Colaboradores" },
    { id: "machines", icon: Cpu, label: "Máquinas" },
    { id: "materials", icon: Truck, label: "Suprimentos" },
    { id: "products", icon: Package, label: "Produtos" },
    { id: "opex", icon: PieChart, label: "Custos Indiretos" },
    { id: "taxes", icon: Scale, label: "Tributos" },
    { id: "pricing", icon: Calculator, label: "Formação de Preço" },
    { id: "simulations", icon: Layers, label: "Simulações" },
    { id: "reports", icon: FileText, label: "Relatórios" },
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
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-1 overflow-y-auto scrollbar-hide">
        {menuItems.map((item) => (
          <SidebarItem
            key={item.id}
            icon={item.icon}
            label={item.label}
            active={activeTab === item.id}
            collapsed={collapsed}
            onClick={() => onTabChange(item.id)}
          />
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-border space-y-2">
        <SidebarItem
          icon={LogOut}
          label="Sair"
          collapsed={collapsed}
          onClick={() => console.log("Logout")}
        />
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center w-full p-2 rounded-md hover:bg-accent text-muted-foreground transition-colors"
        >
          {collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </button>
      </div>
    </motion.aside>
  );
};
