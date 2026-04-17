import React from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Cpu,
  Factory,
  GitBranch,
  Layers,
  LineChart,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
};

const stagger = 0.08;

const pillars = [
  {
    icon: Factory,
    title: "Custeio industrial de ponta a ponta",
    body: "Da matéria-prima ao produto acabado, com engenharia, centros de trabalho e custos indiretos alinhados à sua operação real.",
  },
  {
    icon: Target,
    title: "Preço com margem que você enxerga",
    body: "Formação de preço com tributos, frete e comissão — para decidir com segurança, não com achismo.",
  },
  {
    icon: GitBranch,
    title: "Comercial e funil integrados",
    body: "Propostas, clientes e indicadores em um fluxo só: do orçamento ao pipeline, com visão gerencial no dashboard.",
  },
  {
    icon: Layers,
    title: "Simulações antes da decisão",
    body: "Cenários e novos produtos no ambiente certo para testar impacto sem bagunçar o cadastro até a hora de lançar.",
  },
];

const highlights = [
  { icon: Cpu, label: "Máquinas e roteiros" },
  { icon: BarChart3, label: "Relatórios e BI" },
  { icon: LineChart, label: "Dashboard gerencial" },
  { icon: Zap, label: "Simulações e cenários" },
];

export function LandingPage() {
  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-background text-foreground">
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,hsl(221.2_83.2%_53.3%_/_0.18),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_100%_50%,hsl(221.2_83.2%_53.3%_/_0.08),transparent_50%)]" />
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage: `linear-gradient(hsl(214.3 31.8% 91.4% / 0.5) 1px, transparent 1px),
              linear-gradient(90deg, hsl(214.3 31.8% 91.4% / 0.5) 1px, transparent 1px)`,
            backgroundSize: "48px 48px",
          }}
        />
      </div>

      <div className="relative z-10">
        {/* Top bar */}
        <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 md:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/25">
              <TrendingUp className="h-5 w-5 text-primary-foreground" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-bold tracking-tight">IndusCost</p>
              <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Intelligence</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              to="/guide"
              className="hidden rounded-full px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:inline-flex"
            >
              Guia do sistema
            </Link>
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/30 transition hover:opacity-95"
            >
              Entrar
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </header>

        {/* Hero */}
        <section className="mx-auto max-w-6xl px-6 pb-16 pt-4 md:px-8 md:pb-24 md:pt-8">
          <motion.div
            initial="initial"
            animate="animate"
            transition={{ staggerChildren: stagger, delayChildren: 0.05 }}
            className="mx-auto max-w-3xl text-center"
          >
            <motion.div
              variants={fadeUp}
              transition={{ duration: 0.5 }}
              className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-semibold text-primary"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              Inteligência para indústrias que precisam lucrar com método
            </motion.div>
            <motion.h1
              variants={fadeUp}
              transition={{ duration: 0.55 }}
              className="text-balance text-4xl font-bold tracking-tight text-foreground md:text-5xl lg:text-[3.25rem] lg:leading-[1.1]"
            >
              O custo claro.
              <span className="block bg-gradient-to-r from-primary to-sky-500 bg-clip-text text-transparent">
                O preço confiável.
              </span>
              O comercial alinhado.
            </motion.h1>
            <motion.p
              variants={fadeUp}
              transition={{ duration: 0.5 }}
              className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground md:text-lg"
            >
              O IndusCost Intelligence reúne custeio industrial, formação de preço e gestão comercial em uma experiência
              única — para sua equipe tomar decisões mais rápidas, com números que conversam entre engenharia, financeiro
              e vendas.
            </motion.p>
            <motion.div
              variants={fadeUp}
              transition={{ duration: 0.5 }}
              className="mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center"
            >
              <Link
                to="/dashboard"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-8 text-base font-semibold text-primary-foreground shadow-xl shadow-primary/25 transition hover:opacity-95"
              >
                Acessar o sistema
                <ArrowRight className="h-5 w-5" aria-hidden />
              </Link>
              <Link
                to="/guide"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card px-8 text-base font-semibold text-foreground shadow-sm transition hover:bg-accent"
              >
                <BookOpen className="h-5 w-5 text-primary" aria-hidden />
                Manual funcional
              </Link>
            </motion.div>
          </motion.div>

          {/* Floating stat cards */}
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.35, ease: "easeOut" }}
            className="mx-auto mt-16 grid max-w-4xl gap-4 sm:grid-cols-3"
          >
            {[
              { k: "Visão única", v: "Custo + venda + pipeline", sub: "Um só lugar para operar" },
              { k: "Menos surpresa", v: "Margem e tributos explícitos", sub: "Antes de fechar o orçamento" },
              { k: "Pronto para crescer", v: "Simulações e relatórios", sub: "Decisão com cenários" },
            ].map((card) => (
              <div
                key={card.k}
                className="rounded-2xl border border-border/80 bg-card/80 p-5 text-left shadow-sm backdrop-blur-sm"
              >
                <p className="text-[11px] font-bold uppercase tracking-wider text-primary">{card.k}</p>
                <p className="mt-2 text-lg font-bold text-foreground">{card.v}</p>
                <p className="mt-1 text-sm text-muted-foreground">{card.sub}</p>
              </div>
            ))}
          </motion.div>
        </section>

        {/* Pillars */}
        <section className="border-y border-border/80 bg-muted/30 py-16 md:py-20">
          <div className="mx-auto max-w-6xl px-6 md:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Por que o IndusCost faz diferença</h2>
              <p className="mt-3 text-muted-foreground">
                Valor real para quem fabrica, precifica e vende — sem planilhas soltas nem versões conflitantes do “custo
                verdadeiro”.
              </p>
            </div>
            <div className="mt-12 grid gap-6 md:grid-cols-2">
              {pillars.map((p, i) => (
                <motion.div
                  key={p.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ duration: 0.45, delay: i * 0.06 }}
                  className="group rounded-2xl border border-border bg-card p-6 shadow-sm transition hover:border-primary/25 hover:shadow-md"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition group-hover:bg-primary/15">
                    <p.icon className="h-5 w-5" aria-hidden />
                  </div>
                  <h3 className="mt-4 text-lg font-bold">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Module strip */}
        <section className="mx-auto max-w-6xl px-6 py-16 md:px-8 md:py-20">
          <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
            <div className="max-w-xl">
              <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Tudo o que a operação precisa</h2>
              <p className="mt-3 text-muted-foreground">
                Dashboard, engenharia, suprimentos, compras, tributos, propostas, clientes, simulações e relatórios — cada
                peça conectada ao restante do fluxo.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {highlights.map((h) => (
                <span
                  key={h.label}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground"
                >
                  <h.icon className="h-3.5 w-3.5 text-primary" aria-hidden />
                  {h.label}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-10 rounded-3xl border border-border bg-gradient-to-br from-card via-card to-primary/5 p-8 md:p-10">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
                  <Shield className="h-6 w-6" aria-hidden />
                </div>
                <div>
                  <p className="text-lg font-bold">Feito para uso diário</p>
                  <p className="mt-1 max-w-lg text-sm text-muted-foreground">
                    Comece pelo dashboard, ajuste premissas nos cadastros e evolua para propostas e análises. O guia interno
                    explica cada módulo — mantenha-o atualizado junto com as mudanças do sistema.
                  </p>
                </div>
              </div>
              <Link
                to="/dashboard"
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-95"
              >
                Começar agora
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-border py-10">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-center text-sm text-muted-foreground md:flex-row md:text-left md:px-8">
            <p>© {new Date().getFullYear()} IndusCost Intelligence. Custeio, preço e comercial em um só lugar.</p>
            <Link to="/guide" className="font-medium text-primary hover:underline">
              Abrir guia do sistema
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
