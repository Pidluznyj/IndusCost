import React, { useEffect } from "react";
import { Routes, Route, Navigate, useNavigate, Link } from "react-router-dom";
import { Layout } from "./components/layout/Layout";
import { DashboardModule } from "./components/DashboardModule";
import { EmployeeModule } from "./components/EmployeeModule";
import { HrOrgChartPage } from "./components/employee/HrOrgChartPage";
import { EmployeesDashboardPage } from "./components/employee/EmployeesDashboardPage";
import { MachineModule } from "./components/MachineModule";
import { MaterialsModule } from "./components/MaterialsModule";
import { ProductModule } from "./components/ProductModule";
import { IndirectCostModule } from "./components/IndirectCostModule";
import { TaxModule } from "./components/TaxModule";
import { PricingModule } from "./components/PricingModule";
import { SimulationModule } from "./components/SimulationModule";
import { TransformationCostSimulatorModule } from "./components/TransformationCostSimulatorModule";
import { SettingsModule } from "./components/SettingsModule";
import { FinanceModule } from "./components/FinanceModule";
import { FinanceSuppliersPage } from "./components/finance/FinanceSuppliersPage";
import { SupplierPerformanceReportPage } from "./components/supply-chain/supplier-performance/SupplierPerformanceReportPage";
import { FinancePortfolioReconciliationPage } from "./components/finance/FinancePortfolioReconciliationPage";
import { TreasuryModule } from "./components/finance/treasury/TreasuryModule";
import { InvestedCapitalRecoveryPage } from "./components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPage";
import { GoalsCockpitPage } from "./components/goals/GoalsCockpitPage";
import { SatisfactionModule } from "./components/commercial/satisfaction/SatisfactionModule";
import { SatisfactionResultsPage } from "./components/commercial/satisfaction/SatisfactionResultsPage";
import { SatisfactionInvitationsPage } from "./components/commercial/satisfaction/SatisfactionInvitationsPage";
import { SatisfactionResponsePage } from "./components/commercial/satisfaction/SatisfactionResponsePage";
import { GoalDetailPage } from "./components/goals/GoalDetailPage";
import { CommissionsModule } from "./components/CommissionsModule";
import { CustomerModule } from "./components/CustomerModule";
import { CrmModule } from "./components/CrmModule";
import { CustomerIntelligencePage } from "./components/crm/CustomerIntelligencePage";
import { ProposalModule } from "./components/ProposalModule";
import { SalesOrdersModule } from "./components/SalesOrdersModule";
import { SalesOrdersPageLastUpdateSubtitle } from "./components/sales-orders/SalesOrdersPageLastUpdateSubtitle";
import { SalesOrderManagementPage } from "./components/sales/SalesOrderManagementPage";
import { SalesOrderResultPage } from "./components/sales/SalesOrderResultPage";
import { SalesOrderMonthlyReceivablesReportPage } from "./components/sales/SalesOrderMonthlyReceivablesReportPage";
import { SalesOrderCommercialDiscountReportPage } from "./components/sales/SalesOrderCommercialDiscountReportPage";
import { PurchaseModule } from "./components/PurchaseModule";
import { PurchaseQuotationModule } from "./components/PurchaseQuotationModule";
import { PurchaseQuotationComparisonModule } from "./components/PurchaseQuotationComparisonModule";
import { PurchaseOrderModule } from "./components/PurchaseOrderModule";
import { PurchaseSavingsComparisonModule } from "./components/PurchaseSavingsComparisonModule";
import { PurchaseWorkstationModule } from "./components/PurchaseWorkstationModule";
import { PurchaseReceivingStationModule } from "./components/PurchaseReceivingStationModule";
import { ShadowPurchasePlanningModule } from "./components/ShadowPurchasePlanningModule";
import { MaintenanceModule } from "./components/MaintenanceModule";
import { ProjectsModule } from "./components/ProjectsModule";
import { ProjectExecutiveReportPage } from "./components/projects/ProjectExecutiveReportPage";
import { ProjectClientReportPage } from "./components/projects/ProjectClientReportPage";
import { ProjectIntakeFormPage } from "./components/projects/ProjectIntakeFormPage";
import { FleetModule } from "./components/FleetModule";
import { InventoryModule } from "./components/InventoryModule";
import { SupplyChainModuleShell } from "./components/supply-chain/SupplyChainModuleShell";
import { OperationsPerformanceModule } from "./components/operations/OperationsPerformanceModule";
import { ProductionOrdersModule } from "./components/operations/ProductionOrdersModule";
import { FleetMobileUsageFlow } from "./components/fleet/FleetMobileUsageFlow";
import { FleetPublicReservationPage } from "./components/fleet/FleetPublicReservationPage";
import { FleetPublicVehicleChecklistPage } from "./components/fleet/FleetPublicVehicleChecklistPage";
import { FleetPublicReservationShortLinkPage } from "./components/fleet/FleetPublicReservationShortLinkPage";
import { CollectorPage } from "./components/inventory/collector/CollectorPage";
import { CollectorSectorPage } from "./components/inventory/collector/CollectorSectorPage";
import { InventoryCountLabelsPage } from "./components/inventory/collector/InventoryCountLabelsPage";
import { SystemGuideModule } from "./components/SystemGuideModule";
import { PublicLandingRoute } from "./components/PublicLandingRoute";
import { PublicLoginRoute } from "./components/PublicLoginRoute";
import { HomePage } from "./components/HomePage";
import { EVENT_OPEN_PROPOSAL } from "@/src/lib/salesFunnel";
import { ModuleIndicatorsButton } from "@/src/components/contextual/ModuleIndicatorsButton";
import { PurchaseIndicatorsDashboard } from "@/src/components/contextual/PurchaseIndicatorsDashboard";
import { ProposalIndicatorsDashboard } from "@/src/components/contextual/ProposalIndicatorsDashboard";
import { SimulationIndicatorsDashboard } from "@/src/components/contextual/SimulationIndicatorsDashboard";
import { ProductEngineeringIndicatorsDashboard } from "@/src/components/contextual/ProductEngineeringIndicatorsDashboard";
import { ProductMaterialDemandDashboard } from "@/src/components/contextual/ProductMaterialDemandDashboard";
import { ProductBomWhereUsedDashboard } from "@/src/components/contextual/ProductBomWhereUsedDashboard";
import { CustomerIndicatorsDashboard } from "@/src/components/contextual/CustomerIndicatorsDashboard";
import { SoldProductsReportPage } from "@/src/components/commercial/SoldProductsReportPage";
import { SoldProductCustomersPage } from "@/src/components/commercial/SoldProductCustomersPage";
import { OutputDocumentsModule } from "@/src/components/commercial/OutputDocumentsModule";
import { SalesOrderFlowModule } from "@/src/components/commercial/SalesOrderFlowModule";
import { CommercialPriceTableModule } from "@/src/components/commercial/CommercialPriceTableModule";
import {
  SALES_ORDER_FLOW_PAGE_SUBTITLE,
  SALES_ORDER_FLOW_PAGE_TITLE,
} from "@/src/lib/salesOrderFlowUi";
import {
  COMMERCIAL_PRICE_TABLE_PAGE_SUBTITLE,
  COMMERCIAL_PRICE_TABLE_PAGE_TITLE,
} from "@/src/lib/commercialPriceTableAccess";
import { ProposalPrintView } from "@/src/components/proposal/ProposalPrintView";
import { ProposalInternalManagementPrintView } from "@/src/components/proposal/ProposalInternalManagementPrintView";
import { SalesOrderPrintView } from "@/src/components/sales/SalesOrderPrintView";
import { SupplierServiceTerminationPrintView } from "@/src/components/finance/cost-centers/SupplierServiceTerminationPrintView";
import { RequireAuth } from "@/src/components/RequireAuth";
import { PasswordChangePage } from "@/src/components/security/PasswordChangePage";
import { DefaultModuleRedirect } from "@/src/components/DefaultModuleRedirect";
import { RequirePathViewAccess } from "@/src/components/RequirePathViewAccess";
import { AccessDenied } from "@/src/components/AccessDenied";
import { useAuth } from "@/src/contexts/AuthContext";
import { canOpenAdminSettingsHub } from "@/src/lib/adminSettingsAccess";
import { CostToCashTracePage } from "./components/audit/CostToCashTracePage";
import { BarChart3, CalendarRange, ClipboardList, Factory, Layers, Package, Percent, TrendingUp } from "lucide-react";

function ModulePageShell({
  title,
  description,
  children,
  headerActions,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  headerActions?: React.ReactNode;
}) {
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
          {description ? (
            typeof description === "string" ? (
              <p className="text-muted-foreground">{description}</p>
            ) : (
              description
            )
          ) : null}
        </div>
        {headerActions ? <div className="shrink-0 flex flex-wrap gap-2">{headerActions}</div> : null}
      </div>
      {children}
    </div>
  );
}

function AdminSettingsRoute() {
  const auth = useAuth();
  if (!canOpenAdminSettingsHub(auth.authUser)) {
    return <AccessDenied moduleId="settings" />;
  }
  return (
    <ModulePageShell
      title="Configurações do Sistema"
      description="Acesso exclusivo para Super Administradores."
    >
      <SettingsModule />
    </ModulePageShell>
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
    <Routes>
      <Route path="/" element={<PublicLandingRoute />} />
      <Route path="/login" element={<PublicLoginRoute />} />
      <Route path="/proposals/:id/print" element={<ProposalPrintView />} />
      <Route
        path="/proposals/:id/internal-management-print"
        element={<ProposalInternalManagementPrintView />}
      />
      <Route path="/sales-orders/:id/print" element={<SalesOrderPrintView />} />
      <Route
        path="/finance/suppliers/:supplierId/service-terminations/:id/print"
        element={<SupplierServiceTerminationPrintView />}
      />
      <Route path="/public/fleet/reservation/:token" element={<FleetPublicReservationPage />} />
      <Route
        path="/public/fleet/vehicle-checklist/:vehicleToken"
        element={<FleetPublicVehicleChecklistPage />}
      />
      <Route path="/reservar-carro" element={<FleetPublicReservationShortLinkPage />} />
      {/* Stock Collector: auth = Tailscale + Device Registry (server-side), sem login humano. */}
      <Route path="/collector" element={<CollectorPage />} />
      <Route path="/collector/sector/:sectorSlug" element={<CollectorSectorPage />} />
      {/* Etiquetas QR: página standalone de impressão; dados exigem login humano + permissão. */}
      <Route path="/inventory-labels" element={<InventoryCountLabelsPage />} />
      <Route path="/r/:sub" element={<FleetPublicReservationShortLinkPage />} />
      <Route element={<RequireAuth />}>
      {/* Ciclo de senha do próprio usuário: fora do Layout e fora do
          RequirePathViewAccess — precisa abrir mesmo com a ACL bloqueada
          durante a troca obrigatória. */}
      <Route path="/security/change-password" element={<PasswordChangePage />} />
      {/* P11: telas autenticadas fora do Layout — mesmo view da sidebar */}
      <Route element={<RequirePathViewAccess />}>
      <Route path="/projects/intake-form" element={<ProjectIntakeFormPage />} />
      <Route path="/projects/intake-form/print" element={<ProjectIntakeFormPage />} />
      <Route path="/projects/intake-form/blank" element={<ProjectIntakeFormPage />} />
      <Route path="/projects/intake-form/blank/print" element={<ProjectIntakeFormPage />} />
      <Route path="/projects/intake-form/full" element={<ProjectIntakeFormPage />} />
      <Route path="/projects/intake-form/full/print" element={<ProjectIntakeFormPage />} />
      <Route path="/projects/intake-form/blank/full" element={<ProjectIntakeFormPage />} />
      <Route path="/projects/intake-form/blank/full/print" element={<ProjectIntakeFormPage />} />
      <Route path="/projects/:projectId/intake-form" element={<ProjectIntakeFormPage />} />
      <Route path="/projects/:projectId/intake-form/print" element={<ProjectIntakeFormPage />} />
      <Route path="/projects/:projectId/intake-form/full" element={<ProjectIntakeFormPage />} />
      <Route path="/projects/:projectId/intake-form/full/print" element={<ProjectIntakeFormPage />} />
      <Route path="/projects/:projectId/report" element={<ProjectExecutiveReportPage />} />
      <Route path="/projects/:projectId/client-report" element={<ProjectClientReportPage />} />
      </Route>
      <Route element={<Layout />}>
        <Route path="home" element={<HomePage />} />
        <Route
          path="dashboard"
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
          path="employees-dashboard"
          element={
            <ModulePageShell
              title="Dashboard de Pessoas"
              description="Headcount, qualidade cadastral e custo estimado RH (referência salarial + verbas). Não é folha oficial."
            >
              <EmployeesDashboardPage />
            </ModulePageShell>
          }
        />
        <Route
          path="employees"
          element={
            <ModulePageShell
              title="Pessoas / RH"
              description="Cadastro administrativo de colaboradores, cargos e benefícios. Não altera CIU, custo de produtos, HH global ou roteiros de produção."
            >
              <EmployeeModule />
            </ModulePageShell>
          }
        />
        <Route
          path="org-chart"
          element={
            <ModulePageShell
              title="Organograma"
              description="Visão hierárquica da estrutura organizacional — diretorias, departamentos, responsáveis e equipes."
            >
              <HrOrgChartPage />
            </ModulePageShell>
          }
        />
        <Route
          path="machines"
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
          path="materials/*"
          element={
            <ModulePageShell
              title="Suprimentos"
              description="Gestão de matérias-primas, insumos e custos de aquisição."
            >
              <MaterialsModule />
            </ModulePageShell>
          }
        />
        <Route
          path="purchases/indicators"
          element={
            <ModulePageShell
              title="Compras — Indicadores"
              description="Indicadores executivos SC (valores, ganhos, estoque, atrasos) com bases declaradas — sem alterar relatórios oficiais. Panorama legado de solicitações permanece abaixo."
            >
              <PurchaseIndicatorsDashboard />
            </ModulePageShell>
          }
        />
        <Route
          path="purchases"
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
          path="purchases/quotations"
          element={
            <ModulePageShell
              title="Cotações"
              description="Coleta de propostas por fornecedor oficial. Sem adjudicação nem pedido nesta fase."
            >
              <PurchaseQuotationModule />
            </ModulePageShell>
          }
        />
        <Route
          path="purchases/quotations/:quotationId"
          element={
            <ModulePageShell
              title="Cotação"
              description="Entrada de propostas iniciais por fornecedor. A primeira oferta fica congelada após o registro."
            >
              <PurchaseQuotationModule />
            </ModulePageShell>
          }
        />
        <Route
          path="purchases/quotations/:quotationId/compare"
          element={
            <ModulePageShell
              title="Comparação de cotações"
              description="Compare fornecedores na mesma base. A escolha do vencedor é humana e justificada — não automática pelo menor preço."
            >
              <PurchaseQuotationComparisonModule />
            </ModulePageShell>
          }
        />
        <Route
          path="purchases/workstation"
          element={
            <ModulePageShell
              title="Estação de Compras"
              description="Visão operacional integrada: solicitações, cotações, negociações, evidências, aprovações e pedidos."
            >
              <PurchaseWorkstationModule />
            </ModulePageShell>
          }
        />
        <Route
          path="purchases/receiving"
          element={
            <ModulePageShell
              title="Estação de Recebimento"
              description="Conferência e recebimento físico. Pedido confirmado não é estoque — só o recebimento confirmado altera o saldo."
            >
              <PurchaseReceivingStationModule />
            </ModulePageShell>
          }
        />
        <Route
          path="purchases/receiving/:orderId"
          element={
            <ModulePageShell
              title="Recebimento do pedido"
              description="Itens, lotes, documentos, evidências e movimentos PURCHASE_RECEIPT do ledger SC."
            >
              <PurchaseReceivingStationModule />
            </ModulePageShell>
          }
        />
        <Route
          path="purchases/shadow-planning"
          element={
            <ModulePageShell
              title="Planejamento de compra (sombra)"
              description="Sugestão read-only: demanda + segurança − disponível − compras confirmadas no prazo. Não altera BOM/OP/custo; rascunho de SC só com ação humana."
            >
              <ShadowPurchasePlanningModule />
            </ModulePageShell>
          }
        />
        <Route
          path="purchases/orders"
          element={
            <ModulePageShell
              title="Pedidos de compra"
              description="Pedidos formais a partir da cotação adjudicada. Aprovação cria compromisso operacional sem estoque nem Contas a Pagar."
            >
              <PurchaseOrderModule />
            </ModulePageShell>
          }
        />
        <Route
          path="purchases/orders/:orderId/savings"
          element={
            <ModulePageShell
              title="Ganho negociado × realizado"
              description="Compara preço inicial, negociado, pedido e custo efetivo recebido — sem alterar o mérito histórico da negociação."
            >
              <PurchaseSavingsComparisonModule />
            </ModulePageShell>
          }
        />
        <Route
          path="purchases/orders/:orderId"
          element={
            <ModulePageShell
              title="Pedido de compra"
              description="Snapshots congelados da negociação. Sem recebimento de estoque nesta etapa."
            >
              <PurchaseOrderModule />
            </ModulePageShell>
          }
        />
        <Route
          path="maintenance"
          element={
            <ModulePageShell
              title="Manutenção Predial"
              description="Controle de solicitações de manutenção predial/facilities, responsáveis, status e materiais."
            >
              <MaintenanceModule />
            </ModulePageShell>
          }
        />
        <Route
          path="operations-performance"
          element={
            <ModulePageShell
              title="Performance de Componentes"
              description="Atualize ciclo e cavidades dos componentes. Alterações impactam apenas novas gerações de DRAFT de custo; custos publicados permanecem congelados."
            >
              <OperationsPerformanceModule />
            </ModulePageShell>
          }
        />
        <Route
          path="production-orders"
          element={
            <ModulePageShell
              title="Ordens de Produção"
              description="Consulta e auditoria das ordens sincronizadas do Nomus."
            >
              <ProductionOrdersModule />
            </ModulePageShell>
          }
        />
        <Route
          path="inventory"
          element={
            <ModulePageShell
              title="Estoque / Almoxarifado"
              description="Controle de itens, saldos, movimentações e conferências."
            >
              <InventoryModule />
            </ModulePageShell>
          }
        />
        <Route
          path="inventory/items"
          element={
            <ModulePageShell
              title="Estoque / Almoxarifado"
              description="Controle de itens, saldos, movimentações e conferências."
            >
              <InventoryModule initialTab="items" />
            </ModulePageShell>
          }
        />
        <Route
          path="inventory/warehouses"
          element={
            <ModulePageShell
              title="Estoque / Almoxarifado"
              description="Controle de itens, saldos, movimentações e conferências."
            >
              <InventoryModule initialTab="warehouses" />
            </ModulePageShell>
          }
        />
        <Route
          path="inventory/movements"
          element={
            <ModulePageShell
              title="Estoque / Almoxarifado"
              description="Controle de itens, saldos, movimentações e conferências."
            >
              <InventoryModule initialTab="movements" />
            </ModulePageShell>
          }
        />
        <Route
          path="inventory/balances"
          element={
            <ModulePageShell
              title="Estoque / Almoxarifado"
              description="Controle de itens, saldos, movimentações e conferências."
            >
              <InventoryModule initialTab="balances" />
            </ModulePageShell>
          }
        />
        <Route
          path="inventory/implantation"
          element={
            <ModulePageShell
              title="Estoque / Almoxarifado"
              description="Implantação inicial de estoque auditável."
            >
              <InventoryModule initialTab="implantation" />
            </ModulePageShell>
          }
        />
        <Route
          path="inventory/collector-devices"
          element={
            <ModulePageShell
              title="Estoque / Almoxarifado"
              description="Autorização dos tablets do Stock Collector."
            >
              <InventoryModule initialTab="collectorDevices" />
            </ModulePageShell>
          }
        />
        <Route
          path="inventory/counts"
          element={
            <ModulePageShell
              title="Estoque / Almoxarifado"
              description="Controle de itens, saldos, movimentações e conferências."
            >
              <InventoryModule initialTab="counts" />
            </ModulePageShell>
          }
        />
        <Route
          path="inventory/reservations"
          element={
            <ModulePageShell
              title="Estoque / Almoxarifado"
              description="Reservas, bloqueios e cancelamentos autorizados."
            >
              <InventoryModule initialTab="reservations" />
            </ModulePageShell>
          }
        />
        <Route
          path="inventory/audit"
          element={
            <ModulePageShell
              title="Estoque / Almoxarifado"
              description="Trilha de auditoria do módulo de estoque."
            >
              <InventoryModule initialTab="audit" />
            </ModulePageShell>
          }
        />
        <Route
          path="supply-chain/purchases"
          element={
            <ModulePageShell
              title="Compras SC"
              description="Estação operacional da Cadeia de Suprimentos — compras (feature flag)."
            >
              <SupplyChainModuleShell moduleId="sc-purchases" />
            </ModulePageShell>
          }
        />
        <Route
          path="supply-chain/inventory"
          element={
            <ModulePageShell
              title="Estoque SC"
              description="Casca controlada da Cadeia de Suprimentos — estoque."
            >
              <SupplyChainModuleShell moduleId="sc-inventory" />
            </ModulePageShell>
          }
        />
        <Route
          path="supply-chain/receiving"
          element={
            <ModulePageShell
              title="Recebimentos SC"
              description="Estação operacional de recebimento — feature flag SUPPLY_CHAIN_RECEIVING_MODULE_ENABLED."
            >
              <SupplyChainModuleShell moduleId="sc-receiving" />
            </ModulePageShell>
          }
        />
        <Route
          path="projects"
          element={
            <ModulePageShell
              title="Projetos"
              description="Orçamentos técnicos, simulações de novos produtos, componentes e moldes."
            >
              <ProjectsModule />
            </ModulePageShell>
          }
        />
        <Route
          path="projects/:projectId"
          element={
            <ModulePageShell
              title="Projetos"
              description="Orçamentos técnicos, simulações de novos produtos, componentes e moldes."
            >
              <ProjectsModule />
            </ModulePageShell>
          }
        />
        <Route
          path="projects/:projectId/:tab"
          element={
            <ModulePageShell
              title="Projetos"
              description="Orçamentos técnicos, simulações de novos produtos, componentes e moldes."
            >
              <ProjectsModule />
            </ModulePageShell>
          }
        />
        <Route
          path="fleet"
          element={
            <ModulePageShell
              title="Gestão de Frota"
              description="Cadastro de veículos, motoristas, reservas, manutenções, documentos e custos operacionais da frota."
            >
              <FleetModule />
            </ModulePageShell>
          }
        />
        <Route
          path="fleet/field"
          element={
            <ModulePageShell
              title="Frota — uso em campo"
              description="Retirada e devolução guiadas para celular ou tablet (sem app nativo)."
            >
              <FleetMobileUsageFlow fullscreen />
            </ModulePageShell>
          }
        />
        <Route
          path="products/indicators"
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
          path="products/material-demand"
          element={
            <ModulePageShell
              title="Engenharia — Inteligência de Matéria-Prima"
              description="Visão estimada da necessidade de matéria-prima com base nos itens dos pedidos de venda selecionados."
            >
              <ProductMaterialDemandDashboard context="products" />
            </ModulePageShell>
          }
        />
        <Route
          path="products/where-used"
          element={
            <ModulePageShell
              title="Engenharia — Onde é usado"
              description="Consulte em quais produtos um componente ou matéria-prima é usado diretamente na estrutura ProductBOM."
            >
              <ProductBomWhereUsedDashboard />
            </ModulePageShell>
          }
        />
        <Route
          path="sales-orders/material-usage"
          element={<Navigate to="/sales-orders/material-demand" replace />}
        />
        <Route
          path="sales-orders/material-demand"
          element={
            <ModulePageShell
              title="Pedidos de venda — Inteligência de Matéria-Prima"
              description="Previsto x Faturado — demanda estimada de matéria-prima a partir dos pedidos de venda filtrados."
            >
              <ProductMaterialDemandDashboard context="sales-orders" />
            </ModulePageShell>
          }
        />
        <Route
          path="products"
          element={
            <ModulePageShell
              title="Engenharia de Produto"
              description="Definição de estrutura técnica (BOM) e roteiros produtivos."
              headerActions={
                <>
                  <Link
                    to="/products/material-demand"
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent"
                  >
                    <Package className="h-4 w-4 text-primary" />
                    Inteligência de MP — estimativa
                  </Link>
                  <Link
                    to="/products/where-used"
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent"
                  >
                    <Layers className="h-4 w-4 text-primary" />
                    Onde é usado
                  </Link>
                  <ModuleIndicatorsButton to="/products/indicators" />
                </>
              }
            >
              <ProductModule />
            </ModulePageShell>
          }
        />
        <Route
          path="transformation-simulator"
          element={
            <ModulePageShell
              title="Simulador de Custo de Injeção"
              description="Estimativa operacional de HH, HM e custo de transformação por peça — sem impacto em custos oficiais."
            >
              <TransformationCostSimulatorModule />
            </ModulePageShell>
          }
        />
        <Route
          path="opex"
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
          path="taxes"
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
          path="pricing"
          element={
            <ModulePageShell
              title="Formação de Preço"
              description="Gestão de preços publicados, custos oficiais e auditoria de margem."
            >
              <PricingModule />
            </ModulePageShell>
          }
        />
        <Route
          path="proposals/indicators"
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
          path="proposals"
          element={
            <ModulePageShell
              title="Propostas Comerciais"
              description="Gestão de propostas, orçamentos e negociações comerciais."
              headerActions={
                <>
                  <Link
                    to="/sales-orders"
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent"
                  >
                    Pedidos de venda
                  </Link>
                  <ModuleIndicatorsButton to="/proposals/indicators" />
                </>
              }
            >
              <ProposalModule />
            </ModulePageShell>
          }
        />
        <Route
          path="sales-orders/sold-products/:productId/customers"
          element={
            <ModulePageShell
              title="Clientes compradores"
              description="Clientes que compraram o produto selecionado, com métricas comerciais e ações sugeridas."
            >
              <SoldProductCustomersPage />
            </ModulePageShell>
          }
        />
        <Route
          path="sales-orders/sold-products"
          element={
            <ModulePageShell
              title="Produtos Vendidos"
              description="Ranking de produtos por quantidade vendida com base em pedidos de venda."
            >
              <SoldProductsReportPage />
            </ModulePageShell>
          }
        />
        <Route
          path="sales-orders/management"
          element={
            <ModulePageShell
              title="Gestão de Pedidos de Venda"
              description="Central operacional com status gerencial, prazo, NF, OP, riscos e inteligência por pedido."
              headerActions={
                <Link
                  to="/sales-orders"
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent"
                >
                  Lista de pedidos
                </Link>
              }
            >
              <SalesOrderManagementPage />
            </ModulePageShell>
          }
        />
        <Route
          path="sales-orders/result"
          element={
            <ModulePageShell
              title="Resultado — Pedidos de Venda"
              description="Visão executiva de venda, custo, margem gerencial e projeção comercial."
              headerActions={
                <Link
                  to="/sales-orders"
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent"
                >
                  Lista de pedidos
                </Link>
              }
            >
              <SalesOrderResultPage />
            </ModulePageShell>
          }
        />
        <Route
          path="sales-orders/monthly-receivables"
          element={
            <ModulePageShell
              title="Recebíveis mensais por Pedido de Venda"
              description="Agenda financeira efetiva (FIN-05/FIN-08) agrupada por mês de vencimento."
              headerActions={
                <Link
                  to="/sales-orders"
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent"
                >
                  Lista de pedidos
                </Link>
              }
            >
              <SalesOrderMonthlyReceivablesReportPage />
            </ModulePageShell>
          }
        />
        <Route
          path="sales-orders/commercial-discounts"
          element={
            <ModulePageShell
              title="Relatório de descontos comerciais"
              description="Valor bruto, valor concedido em descontos, líquido e margem comercial dos Pedidos de Venda."
              headerActions={
                <Link
                  to="/sales-orders"
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent"
                >
                  Lista de pedidos
                </Link>
              }
            >
              <SalesOrderCommercialDiscountReportPage />
            </ModulePageShell>
          }
        />
        <Route
          path="sales-orders/:id"
          element={
            <ModulePageShell
              title="Pedido de venda"
              description="Pedido interno gerado a partir de proposta aprovada. Envio ao Nomus será acionado em etapa futura."
            >
              <SalesOrdersModule />
            </ModulePageShell>
          }
        />
        <Route
          path="sales-orders"
          element={
            <ModulePageShell
              title="Pedidos de venda"
              description={<SalesOrdersPageLastUpdateSubtitle />}
              headerActions={
                <>
                  <Link
                    to="/sales-orders/result"
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent"
                  >
                    <TrendingUp className="h-4 w-4 text-primary" />
                    Resultado
                  </Link>
                  <Link
                    to="/sales-orders/monthly-receivables"
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent"
                  >
                    <CalendarRange className="h-4 w-4 text-primary" />
                    Recebíveis mensais
                  </Link>
                  <Link
                    to="/sales-orders/commercial-discounts"
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent"
                  >
                    <Percent className="h-4 w-4 text-primary" />
                    Descontos comerciais
                  </Link>
                  <Link
                    to="/sales-orders/management"
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent"
                  >
                    <ClipboardList className="h-4 w-4 text-primary" />
                    Gestão de Pedidos
                  </Link>
                  <Link
                    to="/sales-orders/sold-products"
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent"
                  >
                    <BarChart3 className="h-4 w-4 text-primary" />
                    Produtos Vendidos
                  </Link>
                  <Link
                    to="/sales-orders/material-demand"
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent"
                  >
                    <Factory className="h-4 w-4 text-primary" />
                    Inteligência de Matéria-Prima
                  </Link>
                </>
              }
            >
              <SalesOrdersModule />
            </ModulePageShell>
          }
        />
        <Route
          path="commercial/sales-order-flow"
          element={
            <ModulePageShell
              title={SALES_ORDER_FLOW_PAGE_TITLE}
              description={SALES_ORDER_FLOW_PAGE_SUBTITLE}
            >
              <SalesOrderFlowModule />
            </ModulePageShell>
          }
        />
        <Route
          path="commercial/price-table"
          element={
            <ModulePageShell
              title={COMMERCIAL_PRICE_TABLE_PAGE_TITLE}
              description={COMMERCIAL_PRICE_TABLE_PAGE_SUBTITLE}
            >
              <CommercialPriceTableModule />
            </ModulePageShell>
          }
        />
        <Route
          path="commercial/satisfaction"
          element={
            <ModulePageShell
              title="Satisfação"
              description="Pesquisas de satisfação de clientes, indicadores e respostas."
            >
              <SatisfactionModule />
            </ModulePageShell>
          }
        />
        <Route
          path="commercial/satisfaction/surveys/:campaignId/results"
          element={
            <ModulePageShell
              title="Resultado da pesquisa"
              description="Resumo, critérios, respostas e comentários da campanha."
            >
              <SatisfactionResultsPage />
            </ModulePageShell>
          }
        />
        <Route
          path="commercial/satisfaction/surveys/:campaignId/invitations"
          element={
            <ModulePageShell
              title="Convites da pesquisa"
              description="Acompanhe a adesão e gerencie os links individuais."
            >
              <SatisfactionInvitationsPage />
            </ModulePageShell>
          }
        />
        <Route
          path="commercial/satisfaction/responses/:responseId"
          element={
            <ModulePageShell
              title="Resposta do cliente"
              description="Notas, comentário e histórico comparável do cliente."
            >
              <SatisfactionResponsePage />
            </ModulePageShell>
          }
        />
        <Route
          path="output-documents"
          element={
            <ModulePageShell
              title="Documentos de Saída"
              description="Consulta read-only dos documentos sincronizados do Nomus."
            >
              <OutputDocumentsModule />
            </ModulePageShell>
          }
        />
        <Route
          path="customers/indicators"
          element={
            <ModulePageShell
              title="Clientes — Indicadores"
              description="Carteira, geografia (UF) e segmentos a partir do cadastro e pedidos de venda."
            >
              <CustomerIndicatorsDashboard />
            </ModulePageShell>
          }
        />
        <Route
          path="customers"
          element={
            <ModulePageShell
              title="Clientes"
              description="Gestão da carteira de clientes e contatos comerciais."
              headerActions={<ModuleIndicatorsButton to="/customers/indicators" />}
            >
              <CustomerModule />
            </ModulePageShell>
          }
        />
        <Route
          path="crm/customers/:customerId/intelligence"
          element={
            <ModulePageShell
              title="Inteligência do Cliente"
              description="Central 360º — comercial, financeiro e CRM a partir do endpoint consolidado."
            >
              <CustomerIntelligencePage />
            </ModulePageShell>
          }
        />
        <Route
          path="customers/:customerId/intelligence"
          element={
            <ModulePageShell
              title="Inteligência do Cliente"
              description="Central 360º — comercial, financeiro e CRM a partir do endpoint consolidado."
            >
              <CustomerIntelligencePage />
            </ModulePageShell>
          }
        />
        <Route
          path="crm-commercial"
          element={
            <ModulePageShell
              title="CRM Comercial"
              description="Gestão de relacionamento e follow-up de clientes."
            >
              <CrmModule />
            </ModulePageShell>
          }
        />
        <Route
          path="simulations/indicators"
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
          path="simulations"
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
          path="commissions/*"
          element={
            <ModulePageShell
              title="Comissões"
              description="Gestão de comissões comerciais — previsão, confirmação, liberação por recebimento e pagamentos."
            >
              <CommissionsModule />
            </ModulePageShell>
          }
        />
        {/* OP-26 — relatório de desempenho a partir de Financeiro > Fornecedores. */}
        <Route
          path="finance/suppliers/performance"
          element={<SupplierPerformanceReportPage />}
        />
        <Route
          path="finance/suppliers"
          element={<FinanceSuppliersPage />}
        />
        <Route
          path="finance/portfolio-reconciliation"
          element={<FinancePortfolioReconciliationPage />}
        />
        <Route
          path="finance/treasury/*"
          element={
            <ModulePageShell
              title="Central de Tesouraria"
              description="Contas financeiras locais, saldos e operações de caixa — distinto do Fluxo de Caixa e da Conciliação de Carteira."
            >
              <TreasuryModule />
            </ModulePageShell>
          }
        />
        <Route
          path="finance/invested-capital-recovery"
          element={
            <ModulePageShell
              title="Recuperação do Dinheiro Investido"
              description="Quanto do capital aplicado nos pedidos já retornou e quanto ainda está na rua."
            >
              <InvestedCapitalRecoveryPage />
            </ModulePageShell>
          }
        />
        <Route
          path="finance"
          element={<Navigate to="/finance/cash-flow" replace />}
        />
        <Route
          path="finance/*"
          element={
            <ModulePageShell
              title="Financeiro"
              description="Contas a receber e contas a pagar a partir dos dados sincronizados do Nomus."
            >
              <FinanceModule />
            </ModulePageShell>
          }
        />
        <Route
          path="reports/cost-to-cash-trace"
          element={
            <ModulePageShell
              title="Rastreabilidade"
              description="Auditoria executiva Custo → Preço → Venda → Comissão (read-only)."
              headerActions={
                <Link
                  to="/reports"
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent"
                >
                  Relatórios e BI
                </Link>
              }
            >
              <CostToCashTracePage />
            </ModulePageShell>
          }
        />
        <Route
          path="guide"
          element={
            <ModulePageShell
              title="Guia do Sistema"
              description="Wiki completa do IndusCost — manual navegável com passo a passo de cada módulo."
            >
              <SystemGuideModule />
            </ModulePageShell>
          }
        />
        <Route
          path="goals"
          element={
            <ModulePageShell
              title="Metas (OKR)"
              description="Objetivos estratégicos e Key Results com progresso calculado pelo sistema — para todos os perfis."
            >
              <GoalsCockpitPage />
            </ModulePageShell>
          }
        />
        <Route
          path="goals/:goalId"
          element={
            <ModulePageShell
              title="Detalhe da Meta"
              description="Trajetória, fatias da equipe e iniciativas do objetivo."
            >
              <GoalDetailPage />
            </ModulePageShell>
          }
        />
        <Route
          path="settings"
          element={<AdminSettingsRoute />}
        />
        <Route path="*" element={<DefaultModuleRedirect />} />
      </Route>
      </Route>
    </Routes>
  );
}
