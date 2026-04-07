import React, { useState } from "react";
import { Layout } from "./components/layout/Layout";
import { DashboardModule } from "./components/DashboardModule";
import { EmployeeModule } from "./components/EmployeeModule";
import { MaterialModule } from "./components/MaterialModule";
import { ProductModule } from "./components/ProductModule";
import { IndirectCostModule } from "./components/IndirectCostModule";
import { TaxModule } from "./components/TaxModule";
import { PricingModule } from "./components/PricingModule";
import { SimulationModule } from "./components/SimulationModule";
import { 
  TrendingUp, 
  Users, 
  Cpu, 
  Package, 
  ArrowUpRight, 
  ArrowDownRight,
  Activity,
  DollarSign,
  Settings,
  PieChart,
  Scale,
  Calculator,
  Layers
} from "lucide-react";
import { cn } from "@/src/lib/utils";

export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");

  return (
    <Layout onTabChange={setActiveTab} activeTab={activeTab}>
      {activeTab === "dashboard" && (
        <div className="space-y-8">
          <div className="flex flex-col gap-1">
            <h2 className="text-3xl font-bold tracking-tight">Dashboard Gerencial</h2>
            <p className="text-muted-foreground">Visão executiva de custos, rentabilidade e eficiência operacional.</p>
          </div>
          <DashboardModule />
        </div>
      )}

      {activeTab === "employees" && (
        <div className="space-y-8">
          <div className="flex flex-col gap-1">
            <h2 className="text-3xl font-bold tracking-tight">Colaboradores</h2>
            <p className="text-muted-foreground">Gestão de pessoas e custos de mão de obra direta.</p>
          </div>
          <EmployeeModule />
        </div>
      )}

      {activeTab === "materials" && (
        <div className="space-y-8">
          <div className="flex flex-col gap-1">
            <h2 className="text-3xl font-bold tracking-tight">Suprimentos</h2>
            <p className="text-muted-foreground">Gestão de matérias-primas, insumos e custos de aquisição.</p>
          </div>
          <MaterialModule />
        </div>
      )}

      {activeTab === "products" && (
        <div className="space-y-8">
          <div className="flex flex-col gap-1">
            <h2 className="text-3xl font-bold tracking-tight">Engenharia de Produto</h2>
            <p className="text-muted-foreground">Definição de estrutura técnica (BOM) e roteiros produtivos.</p>
          </div>
          <ProductModule />
        </div>
      )}

      {activeTab === "opex" && (
        <div className="space-y-8">
          <div className="flex flex-col gap-1">
            <h2 className="text-3xl font-bold tracking-tight">Custos Indiretos e OPEX</h2>
            <p className="text-muted-foreground">Gestão de despesas fixas, CIF e rateios administrativos.</p>
          </div>
          <IndirectCostModule />
        </div>
      )}

      {activeTab === "taxes" && (
        <div className="space-y-8">
          <div className="flex flex-col gap-1">
            <h2 className="text-3xl font-bold tracking-tight">Configuração Fiscal</h2>
            <p className="text-muted-foreground">Gestão de impostos sobre venda e regras de tributação.</p>
          </div>
          <TaxModule />
        </div>
      )}

      {activeTab === "pricing" && (
        <div className="space-y-8">
          <div className="flex flex-col gap-1">
            <h2 className="text-3xl font-bold tracking-tight">Formação de Preço</h2>
            <p className="text-muted-foreground">Simulador comercial de markup, impostos e margens líquidas.</p>
          </div>
          <PricingModule />
        </div>
      )}

      {activeTab === "simulations" && (
        <div className="space-y-8">
          <div className="flex flex-col gap-1">
            <h2 className="text-3xl font-bold tracking-tight">Cenários e Simulações</h2>
            <p className="text-muted-foreground">Analise o impacto de variações de mercado e eficiência.</p>
          </div>
          <SimulationModule />
        </div>
      )}
    </Layout>
  );
}
