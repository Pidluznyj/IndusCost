import React, { useState, useEffect } from "react";
import { Layout } from "./components/layout/Layout";
import { DashboardModule } from "./components/DashboardModule";
import { EmployeeModule } from "./components/EmployeeModule";
import { MachineModule } from "./components/MachineModule";
import { MaterialModule } from "./components/MaterialModule";
import { ProductModule } from "./components/ProductModule";
import { IndirectCostModule } from "./components/IndirectCostModule";
import { TaxModule } from "./components/TaxModule";
import { PricingModule } from "./components/PricingModule";
import { SimulationModule } from "./components/SimulationModule";
import { SettingsModule } from "./components/SettingsModule";
import { ReportsModule } from "./components/ReportsModule";
import { CustomerModule } from "./components/CustomerModule";
import { ProposalModule } from "./components/ProposalModule";
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
  Layers,
  Briefcase,
  UserCircle
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { EVENT_OPEN_PROPOSAL } from "@/src/lib/salesFunnel";

export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");

  useEffect(() => {
    const goProposals = () => setActiveTab("proposals");
    window.addEventListener(EVENT_OPEN_PROPOSAL, goProposals);
    return () => window.removeEventListener(EVENT_OPEN_PROPOSAL, goProposals);
  }, []);

  return (
    <Layout onTabChange={setActiveTab} activeTab={activeTab}>
      {activeTab === "dashboard" && (
        <div className="space-y-8">
          <div className="flex flex-col gap-1">
            <h2 className="text-3xl font-bold tracking-tight">Dashboard Gerencial</h2>
            <p className="text-muted-foreground">
              Operação e financeiro, ou funil comercial B2B (propostas, pipeline e responsáveis) — use as abas internas.
            </p>
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

      {activeTab === "machines" && (
        <div className="space-y-8">
          <div className="flex flex-col gap-1">
            <h2 className="text-3xl font-bold tracking-tight">Centro de Trabalho (Máquinas)</h2>
            <p className="text-muted-foreground">Gestão de ativos produtivos e custos de depreciação/operação.</p>
          </div>
          <MachineModule />
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

      {activeTab === "proposals" && (
        <div className="space-y-8">
          <div className="flex flex-col gap-1">
            <h2 className="text-3xl font-bold tracking-tight">Propostas Comerciais</h2>
            <p className="text-muted-foreground">Gestão de propostas, orçamentos e negociações comerciais.</p>
          </div>
          <ProposalModule />
        </div>
      )}

      {activeTab === "customers" && (
        <div className="space-y-8">
          <div className="flex flex-col gap-1">
            <h2 className="text-3xl font-bold tracking-tight">Clientes</h2>
            <p className="text-muted-foreground">Gestão da carteira de clientes e contatos comerciais.</p>
          </div>
          <CustomerModule />
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

      {activeTab === "reports" && (
        <div className="space-y-8">
          <div className="flex flex-col gap-1">
            <h2 className="text-3xl font-bold tracking-tight">Relatórios e BI</h2>
            <p className="text-muted-foreground">Analise indicadores e exporte dados estratégicos.</p>
          </div>
          <ReportsModule />
        </div>
      )}

      {activeTab === "settings" && (
        <div className="space-y-8">
          <div className="flex flex-col gap-1">
            <h2 className="text-3xl font-bold tracking-tight">Configurações do Sistema</h2>
            <p className="text-muted-foreground">Gerencie cargos, encargos e parâmetros globais.</p>
          </div>
          <SettingsModule />
        </div>
      )}
    </Layout>
  );
}
