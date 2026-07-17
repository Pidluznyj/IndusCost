import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Calculator,
  DollarSign,
  Droplets,
  Factory,
  GitBranch,
  Package,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  WalletCards,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import {
  MARKET_HEADER_TICKER_API,
  MARKET_HEADER_TICKER_POLL_MS,
  type MarketHeaderTickerPayload,
} from "@/src/lib/marketHeaderTicker";
import {
  canAccessPath,
  navigationAccessContextFromAuth,
} from "@/src/lib/resourceNavigationAccess";
import { formatNumber } from "@/src/lib/utils";

type Feature = {
  title: string;
  description: string;
  path: string;
  icon: LucideIcon;
  eyebrow: string;
};

const FEATURES: Feature[] = [
  {
    title: "Engenharia e custo do produto",
    description:
      "Estruture produtos, componentes e processos para transformar dados técnicos em custos confiáveis.",
    path: "/products",
    icon: Package,
    eyebrow: "Engenharia",
  },
  {
    title: "Formação de preço",
    description:
      "Simule preços com tributos, comissões, frete e margem antes de assumir compromissos comerciais.",
    path: "/pricing",
    icon: Calculator,
    eyebrow: "Rentabilidade",
  },
  {
    title: "Compras e suprimentos",
    description:
      "Acompanhe materiais, solicitações e referências de mercado que impactam o custo industrial.",
    path: "/purchases",
    icon: ShoppingCart,
    eyebrow: "Suprimentos",
  },
  {
    title: "Pedidos e operação",
    description:
      "Conecte pedidos de venda, produção, prazos e entregas para navegar do comercial ao chão de fábrica.",
    path: "/sales-orders",
    icon: Factory,
    eyebrow: "Operação integrada",
  },
  {
    title: "Financeiro e conciliação",
    description:
      "Enxergue contas, previsões e vínculos financeiros para apoiar decisões com visão de caixa.",
    path: "/finance/accounts-receivable",
    icon: WalletCards,
    eyebrow: "Financeiro",
  },
  {
    title: "Indicadores e rastreabilidade",
    description:
      "Analise resultados e percorra o caminho completo entre custo, preço, venda e comissão.",
    path: "/reports",
    icon: GitBranch,
    eyebrow: "Gestão",
  },
];

export function getHomeFirstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "usuário";
}

export function getHomeGreeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

function formatUpdatedAt(value: string | undefined): string {
  if (!value) return "Atualização indisponível";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Atualização indisponível";
  return `Atualizado em ${date.toLocaleString("pt-BR")}`;
}

function MarketCard({
  icon: Icon,
  label,
  value,
  detail,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  accent: string;
}) {
  return (
    <article className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${accent}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>
    </article>
  );
}

export function HomePage() {
  const auth = useAuth();
  const firstName = getHomeFirstName(auth.authUser?.name);
  const [market, setMarket] = useState<MarketHeaderTickerPayload | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const payload = await fetchJsonOk<MarketHeaderTickerPayload>(
          MARKET_HEADER_TICKER_API
        );
        if (!cancelled) setMarket(payload);
      } catch {
        if (!cancelled) setMarket(null);
      } finally {
        if (!cancelled) setMarketLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(load, MARKET_HEADER_TICKER_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const availableFeatures = useMemo(() => {
    const context = navigationAccessContextFromAuth(auth);
    return FEATURES.filter((feature) => canAccessPath(feature.path, context));
  }, [auth]);

  const ptax = market?.ptax;
  const brent = market?.brent;
  const ptaxValue =
    !marketLoading && ptax?.available && ptax.sell != null
      ? `R$ ${formatNumber(ptax.sell, 2)}`
      : marketLoading
        ? "Carregando…"
        : "Indisponível";
  const brentValue =
    !marketLoading && brent?.available && brent.priceUsd != null
      ? `US$ ${formatNumber(brent.priceUsd, 2)}`
      : marketLoading
        ? "Carregando…"
        : "Indisponível";

  return (
    <div className="space-y-8 pb-8" data-testid="authenticated-home-page">
      <section className="relative overflow-hidden rounded-3xl border border-primary/15 bg-gradient-to-br from-primary/10 via-card to-sky-50 p-6 shadow-sm sm:p-8 lg:p-10">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-background/70 px-3 py-1.5 text-xs font-semibold text-primary">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Inteligência industrial para decidir melhor
          </div>
          <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">
            {getHomeGreeting()}, {firstName}.
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
            Bem-vindo ao IndusCost. Aqui, {firstName}, custo, preço, operação e
            resultado trabalham juntos para transformar dados da indústria em decisões
            mais seguras.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/guide"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 transition hover:opacity-90"
            >
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              Abrir guia do sistema
            </Link>
            {availableFeatures[0] ? (
              <Link
                to={availableFeatures[0].path}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-background/80 px-5 py-3 text-sm font-semibold shadow-sm transition hover:bg-accent"
              >
                Explorar funcionalidades
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <section aria-labelledby="home-market-title">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-primary">
              Cenário de mercado
            </p>
            <h2 id="home-market-title" className="mt-1 text-xl font-bold">
              Indicadores que impactam a indústria
            </h2>
          </div>
          {marketLoading ? <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <MarketCard
            icon={DollarSign}
            label="Dólar PTAX venda"
            value={ptaxValue}
            detail={formatUpdatedAt(ptax?.collectedAt)}
            accent="bg-emerald-50 text-emerald-700"
          />
          <MarketCard
            icon={Droplets}
            label="Petróleo Brent"
            value={brentValue}
            detail={
              brent?.changePercent != null
                ? `${brent.changePercent >= 0 ? "+" : ""}${formatNumber(brent.changePercent, 2)}% · ${formatUpdatedAt(brent.collectedAt)}`
                : formatUpdatedAt(brent?.collectedAt)
            }
            accent="bg-amber-50 text-amber-700"
          />
          <MarketCard
            icon={Wifi}
            label="Disponibilidade"
            value="Sistema online"
            detail={`Tudo certo para continuar, ${firstName}.`}
            accent="bg-sky-50 text-sky-700"
          />
        </div>
      </section>

      <section aria-labelledby="home-features-title">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-primary">
            O que você pode fazer
          </p>
          <h2 id="home-features-title" className="mt-1 text-2xl font-bold">
            Uma plataforma para conectar a indústria
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Cada área resolve uma parte do processo e compartilha informação com as
            demais. Veja as funcionalidades disponíveis para você, {firstName}.
          </p>
        </div>

        {availableFeatures.length > 0 ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {availableFeatures.map((feature) => (
              <Link
                key={feature.path}
                to={feature.path}
                className="group rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <feature.icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary" />
                </div>
                <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.08em] text-primary">
                  {feature.eyebrow}
                </p>
                <h3 className="mt-1 font-bold">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
            {firstName}, seu acesso está ativo. Solicite ao administrador a liberação dos
            módulos necessários para começar.
          </div>
        )}

        <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-border bg-slate-950 p-6 text-white sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10">
              <BarChart3 className="h-5 w-5 text-sky-300" aria-hidden="true" />
            </div>
            <div>
              <h3 className="font-bold">Precisa entender por onde começar?</h3>
              <p className="mt-1 text-sm text-slate-300">
                O guia explica cada módulo e mostra como as informações se conectam.
              </p>
            </div>
          </div>
          <Link
            to="/guide"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-slate-100"
          >
            Consultar o guia
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </div>
  );
}
