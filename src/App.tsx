import React, { useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
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
import { PurchaseModule } from "./components/PurchaseModule";
import { EVENT_OPEN_PROPOSAL } from "@/src/lib/salesFunnel";
import { ModuleIndicatorsButton } from "@/src/components/contextual/ModuleIndicatorsButton";
import { PurchaseIndicatorsDashboard } from "@/src/components/contextual/PurchaseIndicatorsDashboard";
import { ProposalIndicatorsDashboard } from "@/src/components/contextual/ProposalIndicatorsDashboard";
import { SimulationIndicatorsDashboard } from "@/src/components/contextual/SimulationIndicatorsDashboard";
import { ProductEngineeringIndicatorsDashboard } from "@/src/components/contextual/ProductEngineeringIndicatorsDashboard";
import { PricingFormationIndicatorsDashboard } from "@/src/components/contextual/PricingFormationIndicatorsDashboard";

function ModulePageShell({
  title,
  description,
  children,
  headerActions,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  headerActions?: React.ReactNode;
}) {
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
          <p className="text-muted-foreground">{description}</p>
        </div>
        {headerActions ? <div className="shrink-0 flex flex-wrap gap-2">{headerActions}</div> : null}
      </div>
      {children}
    </div>
  );
}

export default function App() {
  const navigate = useNavigate();

  useEffect(() => {
    const goProposals = () => navigate("/proposals");
    window.addEventListener(EVENT_OPEN_PROPOSAL, goProposals);
    return () => window.removeEventListener(EVENT_OPEN_PROPOSAL, goProposals);
  }, [navigate]);

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route
          path="/dashboard"
          element={
            <ModulePageShell
              title="Dashboard Gerencial"
              description="Operação e financeiro, ou funil comercial B2B (propostas, pipeline e responsáveis) — use as abas internas."
            >
              <DashboardModule />
            </ModulePageShell>
          }
        />
        <Route
          path="/employees"
          element={
            <ModulePageShell
              title="Colaboradores"
              description="Gestão de pessoas e custos de mão de obra direta."
            >
              <EmployeeModule />
            </ModulePageShell>
          }
        />
        <Route
          path="/machines"
          element={
            <ModulePageShell
              title="Centro de Trabalho (Máquinas)"
              description="Gestão de ativos produtivos e custos de depreciação/operação."
            >
              <MachineModule />
            </ModulePageShell>
          }
        />
        <Route
          path="/materials"
          element={
            <ModulePageShell
              title="Suprimentos"
              description="Gestão de matérias-primas, insumos e custos de aquisição."
            >
              <MaterialModule />
            </ModulePageShell>
          }
        />
        <Route
          path="/purchases/indicators"
          element={
            <ModulePageShell
              title="Compras — Indicadores"
              description="Panorama das solicitações já registradas no módulo de compras."
            >
              <PurchaseIndicatorsDashboard />
            </ModulePageShell>
          }
        />
        <Route
          path="/purchases"
          element={
            <ModulePageShell
              title="Compras"
              description="Solicitações de compra, centro de custo e classificação da demanda (sem pedido, recebimento ou financeiro nesta fase)."
              headerActions={<ModuleIndicatorsButton to="/purchases/indicators" />}
            >
              <PurchaseModule />
            </ModulePageShell>
          }
        />
        <Route
          path="/products/indicators"
          element={
            <ModulePageShell
              title="Engenharia — Indicadores"
              description="Contagens estruturais sobre o cadastro de produtos e componentes."
            >
              <ProductEngineeringIndicatorsDashboard />
            </ModulePageShell>
          }
        />
        <Route
          path="/products"
          element={
            <ModulePageShell
              title="Engenharia de Produto"
              description="Definição de estrutura técnica (BOM) e roteiros produtivos."
              headerActions={<ModuleIndicatorsButton to="/products/indicators" />}
            >
              <ProductModule />
            </ModulePageShell>
          }
        />
        <Route
          path="/opex"
          element={
            <ModulePageShell
              title="Custos Indiretos e OPEX"
              description="Gestão de despesas fixas, CIF e rateios administrativos."
            >
              <IndirectCostModule />
            </ModulePageShell>
          }
        />
        <Route
          path="/taxes"
          element={
            <ModulePageShell
              title="Configuração Fiscal"
              description="Gestão de impostos sobre venda e regras de tributação."
            >
              <TaxModule />
            </ModulePageShell>
          }
        />
        <Route
          path="/pricing/indicators"
          element={
            <ModulePageShell
              title="Formação de Preço — Indicadores"
              description="Cobertura de premissas produto × regra fiscal."
            >
              <PricingFormationIndicatorsDashboard />
            </ModulePageShell>
          }
        />
        <Route
          path="/pricing"
          element={
            <ModulePageShell
              title="Formação de Preço"
              description="Simulador comercial de markup, impostos e margens líquidas."
              headerActions={<ModuleIndicatorsButton to="/pricing/indicators" />}
            >
              <PricingModule />
            </ModulePageShell>
          }
        />
        <Route
          path="/proposals/indicators"
          element={
            <ModulePageShell
              title="Propostas — Indicadores"
              description="Funil e totais consolidados a partir das propostas cadastradas."
            >
              <ProposalIndicatorsDashboard />
            </ModulePageShell>
          }
        />
        <Route
          path="/proposals"
          element={
            <ModulePageShell
              title="Propostas Comerciais"
              description="Gestão de propostas, orçamentos e negociações comerciais."
              headerActions={<ModuleIndicatorsButton to="/proposals/indicators" />}
            >
              <ProposalModule />
            </ModulePageShell>
          }
        />
        <Route
          path="/customers"
          element={
            <ModulePageShell
              title="Clientes"
              description="Gestão da carteira de clientes e contatos comerciais."
            >
              <CustomerModule />
            </ModulePageShell>
          }
        />
        <Route
          path="/simulations/indicators"
          element={
            <ModulePageShell
              title="Simulações — Indicadores"
              description="Cenários what-if e simulações de novo produto persistidas."
            >
              <SimulationIndicatorsDashboard />
            </ModulePageShell>
          }
        />
        <Route
          path="/simulations"
          element={
            <ModulePageShell
              title="Cenários e Simulações"
              description="Analise o impacto de variações de mercado e eficiência."
              headerActions={<ModuleIndicatorsButton to="/simulations/indicators" />}
            >
              <SimulationModule />
            </ModulePageShell>
          }
        />
        <Route
          path="/reports"
          element={
            <ModulePageShell
              title="Relatórios e BI"
              description="Analise indicadores e exporte dados estratégicos."
            >
              <ReportsModule />
            </ModulePageShell>
          }
        />
        <Route
          path="/settings"
          element={
            <ModulePageShell
              title="Configurações do Sistema"
              description="Gerencie cargos, encargos e parâmetros globais."
            >
              <SettingsModule />
            </ModulePageShell>
          }
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Layout>
  );
}
