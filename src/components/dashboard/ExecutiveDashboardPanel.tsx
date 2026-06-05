import React from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Car,
  Factory,
  GitBranch,
  Loader2,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  Truck,
  Users,
} from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import type { ExecutiveDashboardSummary } from "@/src/lib/executiveDashboardTypes";

type Props = {
  data: ExecutiveDashboardSummary | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
};

function MetricTile({
  label,
  value,
  sub,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  href?: string;
}) {
  const inner = (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-black text-foreground">{value}</p>
      {sub ? <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
  if (href) {
    return (
      <Link to={href} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-2xl">
        {inner}
      </Link>
    );
  }
  return inner;
}

function SectionCard({
  title,
  icon: Icon,
  available,
  unavailableReason,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  available: boolean;
  unavailableReason?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <h3 className="text-lg font-bold">{title}</h3>
      </div>
      {!available ? (
        <p className="text-sm text-muted-foreground">
          {unavailableReason ?? "Indicadores não disponíveis para seu perfil."}
        </p>
      ) : (
        children
      )}
    </section>
  );
}

function displayMetric(value: number | null | undefined, asCurrency = false): string {
  if (value == null || !Number.isFinite(value)) return "Não disponível";
  return asCurrency ? formatCurrency(value) : formatNumber(value);
}

export function ExecutiveDashboardPanel({ data, loading, error, onRefresh }: Props) {
  if (loading && !data) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-sm font-medium text-muted-foreground">Carregando visão executiva…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
        <h3 className="text-lg font-semibold">Não foi possível carregar a visão executiva</h3>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        <button
          type="button"
          onClick={onRefresh}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          <RefreshCw className="h-4 w-4" />
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!data) return null;

  const updatedAt = new Date(data.generatedAt).toLocaleString("pt-BR");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight">Visão Geral</h2>
          <p className="mt-1 text-sm text-muted-foreground">Atualizado em {updatedAt}</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-accent/50 disabled:opacity-60"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          Atualizar
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 px-4 py-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
          Falha ao atualizar — exibindo última carga bem-sucedida.
        </div>
      ) : null}

      {data.overview.available && data.overview.kpis.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {data.overview.kpis.map((kpi) => (
            <div key={kpi.id}>
              <MetricTile
                label={kpi.label}
                value={kpi.formatted}
                sub={kpi.hint}
                href={kpi.href}
              />
            </div>
          ))}
        </div>
      ) : null}

      {data.alerts.length > 0 ? (
        <section className="rounded-3xl border border-border bg-gradient-to-br from-card to-accent/20 p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <h3 className="text-lg font-bold">Atenção agora</h3>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {data.alerts.slice(0, 6).map((alert) => (
              <div
                key={alert.id}
                className={cn(
                  "rounded-2xl border p-4",
                  alert.severity === "critical" && "border-red-200 bg-red-50/80 dark:border-red-900/40 dark:bg-red-950/20",
                  alert.severity === "warning" && "border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20",
                  alert.severity === "info" && "border-border bg-card/80"
                )}
              >
                <p className="font-semibold text-sm">{alert.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{alert.message}</p>
                {alert.href ? (
                  <Link
                    to={alert.href}
                    className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
                  >
                    Ver detalhes
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard
          title="Comercial"
          icon={ShoppingCart}
          available={data.commercial.available}
          unavailableReason={data.commercial.unavailableReason}
        >
          <div className="grid grid-cols-2 gap-3">
            <MetricTile
              label="Pedidos no mês"
              value={displayMetric(data.commercial.ordersThisMonth)}
              sub={data.commercial.periodLabel}
              href="/sales-orders"
            />
            <MetricTile
              label="Faturamento mês (líq.)"
              value={displayMetric(data.commercial.ordersNetThisMonth, true)}
              href="/sales-orders"
            />
            <MetricTile
              label="Propostas abertas"
              value={displayMetric(data.commercial.proposalsOpen)}
              href="/proposals"
            />
            <MetricTile
              label="Pipeline aberto"
              value={displayMetric(data.commercial.pipelineOpenNet, true)}
              href="/proposals"
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Nomus / Engenharia"
          icon={Sparkles}
          available={data.nomus.available}
          unavailableReason={data.nomus.unavailableReason}
        >
          {data.nomus.emptyMessage && !data.nomus.hasReport ? (
            <p className="text-sm text-muted-foreground">{data.nomus.emptyMessage}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <MetricTile label="Bloqueados" value={displayMetric(data.nomus.blocked)} href="/products" />
              <MetricTile label="Aplicados" value={displayMetric(data.nomus.applied)} href="/products" />
              <MetricTile label="Sem alteração" value={displayMetric(data.nomus.noChanges)} href="/products" />
              <MetricTile label="Erros" value={displayMetric(data.nomus.errors)} href="/products" />
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Produtos"
          icon={Factory}
          available={data.products.available}
          unavailableReason={data.products.unavailableReason}
        >
          <div className="grid grid-cols-2 gap-3">
            <MetricTile label="Ativos" value={displayMetric(data.products.activeProducts)} href="/products" />
            <MetricTile label="Com BOM" value={displayMetric(data.products.withProductBom)} href="/products" />
            <MetricTile label="Com precificação" value={displayMetric(data.products.withPricing)} href="/pricing" />
            <MetricTile label="Fabricados" value={displayMetric(data.products.manufacturedProducts)} href="/products" />
          </div>
        </SectionCard>

        <SectionCard
          title="Clientes"
          icon={Building2}
          available={data.customers.available}
          unavailableReason={data.customers.unavailableReason}
        >
          <div className="grid grid-cols-2 gap-3">
            <MetricTile label="Cadastrados" value={displayMetric(data.customers.totalCustomers)} href="/customers" />
            <MetricTile label="Ativos" value={displayMetric(data.customers.activeCustomers)} href="/customers" />
            <MetricTile
              label="Cadastro incompleto"
              value={displayMetric(data.customers.incompleteRegistration)}
              href="/customers"
            />
            <MetricTile
              label="Consultas CNPJ (30d)"
              value={displayMetric(data.customers.cnpjLookupsLast30Days)}
              href="/customers"
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Frota"
          icon={Truck}
          available={data.fleet.available}
          unavailableReason={data.fleet.unavailableReason}
        >
          <div className="grid grid-cols-2 gap-3">
            <MetricTile label="Veículos" value={displayMetric(data.fleet.totalVehicles)} href="/fleet" />
            <MetricTile label="Disponíveis" value={displayMetric(data.fleet.vehiclesAvailable)} href="/fleet" />
            <MetricTile label="Em uso" value={displayMetric(data.fleet.inUse)} href="/fleet" />
            <MetricTile label="Manutenção" value={displayMetric(data.fleet.maintenance)} href="/fleet" />
          </div>
        </SectionCard>

        <SectionCard
          title="Pessoas / RH"
          icon={Users}
          available={data.people.available}
          unavailableReason={data.people.unavailableReason}
        >
          <MetricTile
            label="Colaboradores ativos"
            value={displayMetric(data.people.activeEmployees)}
            href="/employees"
          />
        </SectionCard>
      </div>

      {data.quickLinks.length > 0 ? (
        <section className="rounded-3xl border border-dashed border-border bg-accent/20 p-6">
          <div className="mb-4 flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-primary" />
            <h3 className="font-bold">Acesso rápido</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.quickLinks.map((link) => (
              <Link
                key={link.id}
                to={link.href}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold hover:border-primary/40 hover:text-primary"
              >
                {link.label}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
