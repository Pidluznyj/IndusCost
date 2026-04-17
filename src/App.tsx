import React, { useEffect, useState } from "react";
import { Routes, Route, Navigate, useNavigate, Link } from "react-router-dom";
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
import { ProductMaterialDemandDashboard } from "@/src/components/contextual/ProductMaterialDemandDashboard";
import { CustomerIndicatorsDashboard } from "@/src/components/contextual/CustomerIndicatorsDashboard";
import { fetchJsonOk } from "@/src/lib/http";
import { AlertCircle, Loader2, Package, ShieldCheck, ShieldOff } from "lucide-react";

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

function BootstrapAdminSettingsRoute() {
  const [status, setStatus] = useState<BootstrapAdminStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [pendingLogin, setPendingLogin] = useState(false);
  const [pendingLogout, setPendingLogout] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

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
                Este acesso é controlado por variáveis de ambiente e existe apenas como bootstrap. Login completo e
                permissionamento serão implementados em etapa futura.
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
              Sessão administrativa temporária ativa para <strong>{status.username}</strong>. Este acesso bootstrap é
              provisório e será substituído por autenticação completa com permissionamento.
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
          path="/products/material-demand"
          element={
            <ModulePageShell
              title="Engenharia — Inteligência de Matéria-Prima"
              description="Demanda estimada de MP derivada de propostas (itens vendidos/orçados)."
            >
              <ProductMaterialDemandDashboard />
            </ModulePageShell>
          }
        />
        <Route
          path="/products"
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
                    Inteligência MP
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
          path="/customers/indicators"
          element={
            <ModulePageShell
              title="Clientes — Indicadores"
              description="Carteira, geografia (UF) e segmentos a partir do cadastro e vínculos com propostas."
            >
              <CustomerIndicatorsDashboard />
            </ModulePageShell>
          }
        />
        <Route
          path="/customers"
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
          element={<BootstrapAdminSettingsRoute />}
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Layout>
  );
}
