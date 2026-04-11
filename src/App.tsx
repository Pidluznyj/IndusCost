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

function ModulePageShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-1">
        <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
        <p className="text-muted-foreground">{description}</p>
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
          path="/purchases"
          element={
            <ModulePageShell
              title="Compras"
              description="Solicitações de compra, centro de custo e classificação da demanda (sem pedido, recebimento ou financeiro nesta fase)."
            >
              <PurchaseModule />
            </ModulePageShell>
          }
        />
        <Route
          path="/products"
          element={
            <ModulePageShell
              title="Engenharia de Produto"
              description="Definição de estrutura técnica (BOM) e roteiros produtivos."
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
          path="/pricing"
          element={
            <ModulePageShell
              title="Formação de Preço"
              description="Simulador comercial de markup, impostos e margens líquidas."
            >
              <PricingModule />
            </ModulePageShell>
          }
        />
        <Route
          path="/proposals"
          element={
            <ModulePageShell
              title="Propostas Comerciais"
              description="Gestão de propostas, orçamentos e negociações comerciais."
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
          path="/simulations"
          element={
            <ModulePageShell
              title="Cenários e Simulações"
              description="Analise o impacto de variações de mercado e eficiência."
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
