import React from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  CalendarClock,
  History,
  Loader2,
  MapPin,
  MessageSquare,
  Package,
  Plus,
  Receipt,
  ShoppingCart,
  Sparkles,
  Target,
  Thermometer,
  UserCircle,
  Wallet,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import type { CrmCommercialIntelResponse } from "@/src/lib/crmCommercialIntelligence";
import type { CrmCustomerListItem } from "@/src/lib/crmCustomersListTypes";
import {
  computePortfolioEmptySummary,
  CRM_PORTFOLIO_FILTER_CHIPS,
  buildCustomerListStatusTags,
} from "@/src/components/crm/crmCustomerPortfolioUi";
import type { PortfolioEmptySummary } from "@/src/components/crm/crmCustomerPortfolioUi";

export type CrmAccountCockpitActivity = {
  id: string;
  subject: string | null;
  description: string | null;
  contactDate: string | null;
  createdAt: string;
  nextActionAt: string | null;
  nextActionDescription: string | null;
  status: string;
  channel: string | null;
  assignedTo: string | null;
};

export type CrmAccountCockpitProfile = {
  commercialTemperature: string | null;
  relationshipLevel: string | null;
  relationshipNotes: string | null;
  preferredChannel: string | null;
  assignedTo?: string | null;
};

type Formatters = {
  formatDateShortPt: (iso: string | null | undefined) => string;
  formatDateTimePt: (iso: string | null | undefined) => string;
  formatIntelCurrency: (v: unknown) => string;
  formatCommercialStatusLabel: (raw: string | null | undefined) => string;
  displayLine: (v: unknown) => string;
  getCustomerDisplayName: (c: CrmCustomerListItem) => string;
  getCustomerTaxId: (c: CrmCustomerListItem) => string;
  formatCityState: (city: unknown, state: unknown) => string;
};

function SummaryMetric({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/90 p-4 space-y-1.5">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <p className="text-[10px] font-semibold uppercase tracking-wide">{label}</p>
      </div>
      <p className="text-lg font-bold text-foreground tabular-nums leading-tight">{value}</p>
      {hint ? <p className="text-[11px] text-muted-foreground leading-snug">{hint}</p> : null}
    </div>
  );
}

export type CrmCustomerPortfolioEmptyStateProps = {
  summary: PortfolioEmptySummary;
  scopeLabel: string;
};

export const CrmCustomerPortfolioEmptyState: React.FC<CrmCustomerPortfolioEmptyStateProps> = ({
  summary,
  scopeLabel,
}) => (
  <div className="rounded-2xl border border-dashed border-border bg-gradient-to-br from-muted/30 to-card p-10 sm:p-12 text-center space-y-6">
    <UserCircle className="h-14 w-14 text-muted-foreground/40 mx-auto" />
    <div className="space-y-2 max-w-lg mx-auto">
      <p className="text-lg font-bold text-foreground">Selecione um cliente da carteira</p>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Use a busca e os filtros à esquerda para localizar um cliente. O cockpit comercial abre aqui
        com resumo de vendas, relacionamento, agenda e histórico.
      </p>
      <p className="text-xs text-muted-foreground italic">{scopeLabel}</p>
    </div>
    {summary.totalListed > 0 ? (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 max-w-3xl mx-auto text-left">
        <SummaryMetric label="Na lista" value={String(summary.totalListed)} icon={Target} />
        <SummaryMetric
          label="Carteira aberta"
          value={String(summary.withOpenPortfolio)}
          icon={Wallet}
        />
        <SummaryMetric
          label="Follow-up atrasado"
          value={String(summary.withOverdueFollowUp)}
          icon={CalendarClock}
        />
        <SummaryMetric
          label="Sem contato"
          value={String(summary.withoutContact)}
          icon={MessageSquare}
        />
      </div>
    ) : null}
  </div>
);

export type CrmCustomerAccountCockpitProps = {
  customer: CrmCustomerListItem;
  showSellerColumn: boolean;
  intel: CrmCommercialIntelResponse | null;
  intelLoading: boolean;
  intelError: string | null;
  onIntelRetry: () => void;
  profile: CrmAccountCockpitProfile | null;
  activities: CrmAccountCockpitActivity[];
  activitiesLoading: boolean;
  intelligencePath: string;
  onRegisterContact: () => void;
  onEditProfile: () => void;
  formatters: Formatters;
};

export const CrmCustomerAccountCockpit: React.FC<CrmCustomerAccountCockpitProps> = ({
  customer,
  showSellerColumn,
  intel,
  intelLoading,
  intelError,
  onIntelRetry,
  profile,
  activities,
  activitiesLoading,
  intelligencePath,
  onRegisterContact,
  onEditProfile,
  formatters,
}) => {
  const {
    formatDateShortPt,
    formatDateTimePt,
    formatIntelCurrency,
    formatCommercialStatusLabel,
    displayLine,
    getCustomerDisplayName,
    getCustomerTaxId,
    formatCityState,
  } = formatters;

  const sellerName =
    customer.primarySellerResponsible?.trim() ||
    intel?.openOrders.latestOrders.find((o) => o.responsible?.trim())?.responsible?.trim() ||
    null;

  const ticketAvg =
    intel && intel.orders.ordersLast12MonthsCount > 0
      ? intel.orders.totalPurchasedLast12Months / intel.orders.ordersLast12MonthsCount
      : 0;

  const lastInvoicedOrder = intel?.openOrders.latestOrders.find((o) => o.hasInvoicing) ?? null;

  const now = Date.now();
  const overdueActivities = activities.filter((a) => {
    if (!a.nextActionAt) return false;
    const t = Date.parse(a.nextActionAt);
    return Number.isFinite(t) && t < now && !["done", "closed", "cancelled", "canceled"].includes(a.status.toLowerCase());
  });
  const upcomingActivities = activities
    .filter((a) => {
      if (!a.nextActionAt) return false;
      const t = Date.parse(a.nextActionAt);
      return Number.isFinite(t) && t >= now;
    })
    .sort((a, b) => Date.parse(a.nextActionAt!) - Date.parse(b.nextActionAt!))
    .slice(0, 5);

  const recentActivities = [...activities]
    .sort((a, b) => Date.parse(b.contactDate ?? b.createdAt) - Date.parse(a.contactDate ?? a.createdAt))
    .slice(0, 5);

  const portfolioStatus = intel?.summary.hasOpenOrders
    ? "Carteira aberta"
    : intel?.summary.hasPurchaseHistory
      ? "Cliente ativo"
      : "Sem histórico de compra";

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4 min-w-0">
            <div className="rounded-xl bg-primary/10 p-3 text-primary shrink-0">
              <Building2 className="h-6 w-6" />
            </div>
            <div className="min-w-0 space-y-2">
              <h2 className="text-2xl sm:text-3xl font-bold leading-tight text-foreground break-words">
                {getCustomerDisplayName(customer)}
              </h2>
              {customer.tradeName?.trim() ? (
                <p className="text-sm text-muted-foreground">Fantasia: {displayLine(customer.tradeName)}</p>
              ) : null}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="tabular-nums">CNPJ/CPF: {getCustomerTaxId(customer)}</span>
                {formatCityState(customer.city, customer.state) !== "—" ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {formatCityState(customer.city, customer.state)}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <span className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-[10px] font-bold uppercase text-primary">
                  {portfolioStatus}
                </span>
                {buildCustomerListStatusTags(customer).map((tag) => (
                  <span
                    key={tag.key}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase",
                      tag.className
                    )}
                  >
                    {tag.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Link
              to={intelligencePath}
              className="inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary/15"
            >
              <Sparkles className="h-4 w-4" />
              Inteligência
            </Link>
            <button
              type="button"
              onClick={onRegisterContact}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              Registrar contato
            </button>
            <button
              type="button"
              onClick={onEditProfile}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-semibold hover:bg-accent"
            >
              Perfil
            </button>
          </div>
        </div>

        {showSellerColumn && sellerName ? (
          <p className="text-sm text-muted-foreground border-t border-border/60 pt-4">
            Vendedor responsável:{" "}
            <span className="font-semibold text-foreground">{sellerName}</span>
            {customer.primaryExternalSellerId != null
              ? ` · ID Nomus ${customer.primaryExternalSellerId}`
              : ""}
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-bold text-foreground">Resumo comercial</h3>
        {intelLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando indicadores comerciais…
          </div>
        ) : intelError ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 space-y-2">
            <p>{intelError}</p>
            <button type="button" onClick={onIntelRetry} className="text-xs font-semibold underline">
              Tentar novamente
            </button>
          </div>
        ) : intel ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryMetric
              label="Vendido (12 meses)"
              value={formatIntelCurrency(intel.orders.totalPurchasedLast12Months)}
              hint={`${intel.orders.ordersLast12MonthsCount} pedido(s)`}
              icon={ShoppingCart}
            />
            <SummaryMetric
              label="Carteira aberta"
              value={formatIntelCurrency(intel.openOrders.openOrdersValue)}
              hint={`${intel.openOrders.openOrdersCount} pedido(s)`}
              icon={Wallet}
            />
            <SummaryMetric
              label="Ticket médio (12m)"
              value={formatIntelCurrency(ticketAvg)}
              icon={Receipt}
            />
            <SummaryMetric
              label="Último pedido"
              value={
                intel.orders.lastOrder
                  ? formatIntelCurrency(intel.orders.lastOrder.totalNetValue)
                  : "—"
              }
              hint={
                intel.orders.lastOrder
                  ? `${displayLine(intel.orders.lastOrder.orderCode)} · ${formatDateShortPt(intel.orders.lastOrder.issueDate)}`
                  : "Sem pedido"
              }
              icon={Package}
            />
            <SummaryMetric
              label="Último faturamento"
              value={
                lastInvoicedOrder ? formatIntelCurrency(lastInvoicedOrder.totalNetValue) : "—"
              }
              hint={
                lastInvoicedOrder
                  ? `${displayLine(lastInvoicedOrder.orderCode)} · ${formatDateShortPt(lastInvoicedOrder.issueDate)}`
                  : "Sem NF processada recente"
              }
              icon={Receipt}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Indicadores comerciais indisponíveis.</p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            Relacionamento
          </h3>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[10px] font-semibold uppercase text-muted-foreground">Último contato</dt>
              <dd className="font-semibold mt-0.5">{formatDateShortPt(customer.lastContactAt)}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase text-muted-foreground">Próximo follow-up</dt>
              <dd className="font-semibold mt-0.5">{formatDateShortPt(customer.nextFollowUpAt)}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase text-muted-foreground">Temperatura</dt>
              <dd className="font-semibold mt-0.5">{displayLine(profile?.commercialTemperature)}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase text-muted-foreground">Canal preferido</dt>
              <dd className="font-semibold mt-0.5">{displayLine(profile?.preferredChannel)}</dd>
            </div>
          </dl>
          {profile?.relationshipNotes?.trim() ? (
            <p className="text-sm text-muted-foreground rounded-lg bg-muted/30 border border-border/50 px-3 py-2.5 leading-relaxed">
              {profile.relationshipNotes.trim()}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground italic">Sem observações no perfil de relacionamento.</p>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            Agenda comercial
          </h3>
          {activitiesLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando agenda…
            </div>
          ) : (
            <>
              {overdueActivities.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase text-red-800">Atrasados</p>
                  <ul className="space-y-1.5">
                    {overdueActivities.slice(0, 3).map((a) => (
                      <li key={a.id} className="text-xs rounded-lg border border-red-200/80 bg-red-50/50 px-3 py-2">
                        <span className="font-semibold text-foreground">
                          {displayLine(a.nextActionDescription ?? a.subject ?? "Follow-up")}
                        </span>
                        <span className="text-muted-foreground block mt-0.5">
                          {formatDateTimePt(a.nextActionAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {upcomingActivities.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">Próximos</p>
                  <ul className="space-y-1.5">
                    {upcomingActivities.map((a) => (
                      <li key={a.id} className="text-xs rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                        <span className="font-semibold text-foreground">
                          {displayLine(a.nextActionDescription ?? a.subject ?? "Follow-up")}
                        </span>
                        <span className="text-muted-foreground block mt-0.5">
                          {formatDateTimePt(a.nextActionAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">Nenhum compromisso agendado.</p>
              )}
              <button
                type="button"
                onClick={onRegisterContact}
                className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-semibold hover:bg-accent"
              >
                <Plus className="h-3.5 w-3.5" />
                Adicionar contato / follow-up
              </button>
            </>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          Histórico resumido
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-2">Últimos contatos</p>
            {recentActivities.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Nenhum contato registrado.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {recentActivities.map((a) => (
                  <li key={a.id} className="rounded-lg border border-border/60 px-3 py-2">
                    <span className="font-semibold">{displayLine(a.subject ?? a.description ?? "Contato")}</span>
                    <span className="text-muted-foreground block text-xs mt-0.5">
                      {formatDateShortPt(a.contactDate ?? a.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-2">Últimos pedidos</p>
            {!intel || intel.openOrders.latestOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Nenhum pedido recente.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {intel.openOrders.latestOrders.slice(0, 5).map((o) => (
                  <li key={o.id} className="rounded-lg border border-border/60 px-3 py-2">
                    <span className="font-semibold">{displayLine(o.orderCode)}</span>
                    <span className="text-muted-foreground block text-xs mt-0.5">
                      {formatDateShortPt(o.issueDate)} · {formatIntelCurrency(o.totalNetValue)} ·{" "}
                      {formatCommercialStatusLabel(o.status)}
                      {o.hasInvoicing ? " · Faturado" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-dashed border-primary/20 bg-primary/5 p-5">
        <h3 className="text-sm font-bold text-foreground mb-3">Próximas ações</h3>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRegisterContact}
            className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
          >
            Registrar contato
          </button>
          <Link
            to={intelligencePath}
            className="rounded-xl border border-primary/30 bg-card px-4 py-2 text-xs font-semibold text-primary"
          >
            Abrir inteligência
          </Link>
          <button
            type="button"
            onClick={onEditProfile}
            className="rounded-xl border border-border bg-card px-4 py-2 text-xs font-semibold"
          >
            Editar perfil
          </button>
          {intel?.summary.nextSuggestedAction ? (
            <p className="w-full text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
              Sugestão: {displayLine(intel.summary.nextSuggestedAction)}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
};

export { computePortfolioEmptySummary, CRM_PORTFOLIO_FILTER_CHIPS };
