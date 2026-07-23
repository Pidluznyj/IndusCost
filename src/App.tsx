import React, { useEffect, useState } from "react";
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
import { FinancePortfolioReconciliationPage } from "./components/finance/FinancePortfolioReconciliationPage";
import { CommissionsModule } from "./components/CommissionsModule";
import { ReportsModule } from "./components/ReportsModule";
import { CustomerModule } from "./components/CustomerModule";
import { CrmModule } from "./components/CrmModule";
import { CustomerIntelligencePage } from "./components/crm/CustomerIntelligencePage";
import { ProposalModule } from "./components/ProposalModule";
import { SalesOrdersModule } from "./components/SalesOrdersModule";
import { SalesOrderManagementPage } from "./components/sales/SalesOrderManagementPage";
import { SalesOrderResultPage } from "./components/sales/SalesOrderResultPage";
import { SalesOrderMonthlyReceivablesReportPage } from "./components/sales/SalesOrderMonthlyReceivablesReportPage";
import { PurchaseModule } from "./components/PurchaseModule";
import { MaintenanceModule } from "./components/MaintenanceModule";
import { ProjectsModule } from "./components/ProjectsModule";
import { ProjectExecutiveReportPage } from "./components/projects/ProjectExecutiveReportPage";
import { ProjectClientReportPage } from "./components/projects/ProjectClientReportPage";
import { ProjectIntakeFormPage } from "./components/projects/ProjectIntakeFormPage";
import { FleetModule } from "./components/FleetModule";
import { InventoryModule } from "./components/InventoryModule";
import { OperationsPerformanceModule } from "./components/operations/OperationsPerformanceModule";
import { ProductionOrdersModule } from "./components/operations/ProductionOrdersModule";
import { FleetMobileUsageFlow } from "./components/fleet/FleetMobileUsageFlow";
import { FleetPublicReservationPage } from "./components/fleet/FleetPublicReservationPage";
import { FleetPublicVehicleChecklistPage } from "./components/fleet/FleetPublicVehicleChecklistPage";
import { FleetPublicReservationShortLinkPage } from "./components/fleet/FleetPublicReservationShortLinkPage";
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
import { PricingFormationIndicatorsDashboard } from "@/src/components/contextual/PricingFormationIndicatorsDashboard";
import { ProductMaterialDemandDashboard } from "@/src/components/contextual/ProductMaterialDemandDashboard";
import { ProductBomWhereUsedDashboard } from "@/src/components/contextual/ProductBomWhereUsedDashboard";
import { CustomerIndicatorsDashboard } from "@/src/components/contextual/CustomerIndicatorsDashboard";
import { SalesOrdersIndicatorsDashboard } from "@/src/components/contextual/SalesOrdersIndicatorsDashboard";
import { SoldProductsReportPage } from "@/src/components/commercial/SoldProductsReportPage";
import { SoldProductCustomersPage } from "@/src/components/commercial/SoldProductCustomersPage";
import { OutputDocumentsModule } from "@/src/components/commercial/OutputDocumentsModule";
import { SalesOrderFlowModule } from "@/src/components/commercial/SalesOrderFlowModule";
import {
  SALES_ORDER_FLOW_PAGE_SUBTITLE,
  SALES_ORDER_FLOW_PAGE_TITLE,
} from "@/src/lib/salesOrderFlowUi";
import { ProposalPrintView } from "@/src/components/proposal/ProposalPrintView";
import { ProposalInternalManagementPrintView } from "@/src/components/proposal/ProposalInternalManagementPrintView";
import { SalesOrderPrintView } from "@/src/components/sales/SalesOrderPrintView";
import { SupplierServiceTerminationPrintView } from "@/src/components/finance/cost-centers/SupplierServiceTerminationPrintView";
import { RequireAuth } from "@/src/components/RequireAuth";
import { DefaultModuleRedirect } from "@/src/components/DefaultModuleRedirect";
import { RequirePathViewAccess } from "@/src/components/RequirePathViewAccess";
import { AccessDenied } from "@/src/components/AccessDenied";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import { CostToCashTracePage } from "./components/audit/CostToCashTracePage";
import { AlertCircle, BarChart3, CalendarRange, ClipboardList, Factory, GitBranch, Layers, Loader2, Package, ShieldCheck, ShieldOff, TrendingUp } from "lucide-react";

type BootstrapAdminStatus = {
  enabled: boolean;
  authenticated: boolean;
  mode: "bootstrap-env";
  misconfigured: boolean;
  username: string | null;
  expiresAt: string | null;
};

function ModulePageShell({
  title,
  description,
  children,
  headerActions,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  headerActions?: React.ReactNode;
}) {
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
          {description ? <p className="text-muted-foreground">{description}</p> : null}
        </div>
        {headerActions ? <div className="shrink-0 flex flex-wrap gap-2">{headerActions}</div> : null}
      </div>
      {children}
    </div>
  );
}

function BootstrapAdminSettingsRoute() {
  const auth = useAuth();
  const [status, setStatus] = useState<BootstrapAdminStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [pendingLogin, setPendingLogin] = useState(false);
  const [pendingLogout, setPendingLogout] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  /** Hub settings: sessão App OU bootstrap autenticado — nunca os dois mal alinhados. */
  const appCanOpenSettings =
    auth.hasPermission("settings.view") ||
    auth.hasPermission("users.manage") ||
    auth.hasAnyPermission([
      "settings.global_params.view",
      "settings.branding.view",
      "settings.operational.view",
      "settings.nomus.view",
      "settings.price_tables.view",
      "accessProfiles.view",
      "accessProfiles.manage",
    ]);

  const refreshStatus = async () => {
    setLoadingStatus(true);
    try {
      const data = await fetchJsonOk<BootstrapAdminStatus>("/api/bootstrap-admin/status");
      setStatus(data);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Não foi possível validar acesso administrativo.");
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPendingLogin(true);
    setErrorMessage(null);
    try {
      await fetchJsonOk("/api/bootstrap-admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      setPassword("");
      await refreshStatus();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao autenticar acesso administrativo.");
    } finally {
      setPendingLogin(false);
    }
  };

  const handleLogout = async () => {
    setPendingLogout(true);
    setErrorMessage(null);
    try {
      await fetchJsonOk("/api/bootstrap-admin/logout", { method: "POST" });
      await refreshStatus();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao encerrar sessão administrativa.");
    } finally {
      setPendingLogout(false);
    }
  };

  if (loadingStatus) {
    return (
      <ModulePageShell
        title="Configurações do Sistema"
        description="Validação de acesso administrativo temporário em andamento."
      >
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="mt-3 text-sm text-muted-foreground">Verificando sessão administrativa...</p>
        </div>
      </ModulePageShell>
    );
  }

  const bootstrapAuthenticated = Boolean(status?.enabled && status?.authenticated);

  // Sessão bootstrap ativa sem grants App de settings: força logout bootstrap (não abre hub no contexto do VIEWER).
  if (bootstrapAuthenticated && !appCanOpenSettings) {
    return (
      <ModulePageShell
        title="Configurações do Sistema"
        description="Sessão bootstrap incompatível com as permissões deste usuário."
        headerActions={
          <button
            type="button"
            onClick={handleLogout}
            disabled={pendingLogout}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-accent disabled:opacity-60"
          >
            {pendingLogout ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4" />}
            Logout Admin (Bootstrap)
          </button>
        }
      >
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 space-y-2">
          <p>
            Há uma sessão administrativa temporária ativa para{" "}
            <strong>{status?.username ?? "bootstrap"}</strong>, mas o usuário logado no IndusCost
            não tem permissão de Configurações.
          </p>
          <p>
            Use <strong>Logout Admin (Bootstrap)</strong> e continue apenas com o login principal
            (ex.: Contas a Pagar). O bootstrap é só para recuperação / SUPER_ADMIN.
          </p>
        </div>
        <AccessDenied moduleId="settings" />
      </ModulePageShell>
    );
  }

  if (!appCanOpenSettings) {
    return <AccessDenied moduleId="settings" />;
  }

  if (status?.enabled && !status.authenticated) {
    return (
      <ModulePageShell
        title="Configurações do Sistema"
        description="Acesso administrativo bootstrap temporário obrigatório para esta área."
      >
        <div className="max-w-xl rounded-2xl border border-border bg-card p-6 space-y-5">
          <div className="flex items-start gap-3">
            <ShieldOff className="h-5 w-5 text-amber-600 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-semibold">Acesso administrativo temporário</p>
              <p className="text-sm text-muted-foreground">
                Este acesso é controlado por variáveis de ambiente e existe apenas como bootstrap de recuperação.
                O login principal do IndusCost usa usuários cadastrados em Configurações → Usuários e Permissões.
              </p>
            </div>
          </div>
          {status.misconfigured && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              Bootstrap admin habilitado no backend, mas sem configuração completa de ambiente.
            </div>
          )}
          {errorMessage && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{errorMessage}</div>
          )}
          <form onSubmit={handleLogin} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Usuário administrativo
              </label>
              <input
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="Informe o usuário bootstrap"
                autoComplete="username"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Senha</label>
              <input
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="Informe a senha bootstrap"
                autoComplete="current-password"
              />
            </div>
            <button
              type="submit"
              disabled={pendingLogin || status.misconfigured}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {pendingLogin ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Entrar no hub administrativo
            </button>
          </form>
        </div>
      </ModulePageShell>
    );
  }

  const headerActions =
    status?.enabled && status?.authenticated ? (
      <button
        type="button"
        onClick={handleLogout}
        disabled={pendingLogout}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-accent disabled:opacity-60"
      >
        {pendingLogout ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4" />}
        Logout Admin (Bootstrap)
      </button>
    ) : undefined;

  return (
    <ModulePageShell
      title="Configurações do Sistema"
      description="Gerencie cargos, encargos e parâmetros globais."
      headerActions={headerActions}
    >
      {status?.enabled && status?.authenticated && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5" />
            <p>
              Sessão administrativa temporária ativa para <strong>{status.username}</strong>. Use o login principal do
              IndusCost no dia a dia; o bootstrap permanece para recuperação e criação do super administrador.
            </p>
          </div>
        </div>
      )}
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
      <Route path="/r/:sub" element={<FleetPublicReservationShortLinkPage />} />
      <Route element={<RequireAuth />}>
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
              description="Panorama das solicitações já registradas no módulo de compras."
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
          path="pricing/indicators"
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
          path="pricing"
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
          path="sales-orders/indicators"
          element={
            <ModulePageShell
              title="Pedidos de Venda — Indicadores"
              description="Dashboard executivo com visão consolidada de volume, valor líquido e distribuição por status."
            >
              <SalesOrdersIndicatorsDashboard />
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
                  <Link
                    to="/reports/cost-to-cash-trace"
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent"
                  >
                    <GitBranch className="h-4 w-4 text-primary" />
                    Rastreabilidade
                  </Link>
                  <ModuleIndicatorsButton to="/sales-orders/indicators" />
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
        <Route
          path="finance/suppliers"
          element={<FinanceSuppliersPage />}
        />
        <Route
          path="finance/portfolio-reconciliation"
          element={<FinancePortfolioReconciliationPage />}
        />
        <Route
          path="finance"
          element={<Navigate to="/finance/accounts-receivable" replace />}
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
          path="reports"
          element={
            <ModulePageShell
              title="Relatórios e BI"
              description="Analise indicadores e exporte dados estratégicos."
              headerActions={
                <Link
                  to="/reports/cost-to-cash-trace"
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent"
                >
                  <GitBranch className="h-4 w-4 text-primary" />
                  Rastreabilidade
                </Link>
              }
            >
              <ReportsModule />
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
          path="settings"
          element={<BootstrapAdminSettingsRoute />}
        />
        <Route path="*" element={<DefaultModuleRedirect />} />
      </Route>
      </Route>
    </Routes>
  );
}
