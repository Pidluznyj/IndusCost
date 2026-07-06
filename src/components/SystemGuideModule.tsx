import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUp,
  BookOpen,
  ChevronDown,
  Copy,
  Info,
  Lightbulb,
  Link2,
  ListTree,
  Search,
  Shield,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  SYSTEM_GUIDE_SECTIONS,
  SYSTEM_WIKI_GLOSSARY,
  SYSTEM_WIKI_MAIN_FLOWS,
  SYSTEM_WIKI_MODULE_CARDS,
  SYSTEM_WIKI_QUICK_START,
  type SystemGuideEntry,
  type SystemGuideSection,
  type WikiAlert,
  type WikiBadge,
  type WikiGlossaryTerm,
} from "@/src/lib/systemGuideContent";

const BADGE_LABEL: Record<WikiBadge, string> = {
  operacional: "Operacional",
  administrativo: "Administrativo",
  integracao: "Integração",
  financeiro: "Financeiro",
  frota: "Frota",
  avancado: "Avançado",
};

const BADGE_CLASS: Record<WikiBadge, string> = {
  operacional: "bg-slate-100 text-slate-700 border-slate-200",
  administrativo: "bg-violet-50 text-violet-800 border-violet-200",
  integracao: "bg-blue-50 text-blue-800 border-blue-200",
  financeiro: "bg-emerald-50 text-emerald-800 border-emerald-200",
  frota: "bg-amber-50 text-amber-900 border-amber-200",
  avancado: "bg-slate-800 text-slate-100 border-slate-700",
};

function entrySearchBlob(entry: SystemGuideEntry): string {
  return [
    entry.title,
    entry.objective,
    entry.whoUses,
    entry.whereToAccess,
    entry.permissions,
    entry.statusNote,
    ...entry.features,
    ...entry.basicFlow,
    ...entry.importantFields ?? [],
    ...entry.businessRules ?? [],
    ...entry.commonErrors ?? [],
    ...entry.examples ?? [],
    ...entry.securityNotes ?? [],
    ...entry.notes,
    ...(entry.relatedModules ?? []),
    ...(entry.tags ?? []),
    ...(entry.alerts ?? []).map((a) => a.text),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function glossaryMatchesQuery(query: string, term: WikiGlossaryTerm): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    term.term.toLowerCase().includes(q) ||
    term.definition.toLowerCase().includes(q)
  );
}

function filterSections(sections: SystemGuideSection[], query: string): SystemGuideSection[] {
  const q = query.trim();
  if (!q) return sections;
  const lower = q.toLowerCase();
  return sections
    .map((s) => ({
      ...s,
      entries: s.entries.filter((e) => entrySearchBlob(e).includes(lower)),
    }))
    .filter((s) => s.entries.length > 0);
}

function WikiAlertBox({ alert }: { alert: WikiAlert }) {
  const styles =
    alert.type === "attention"
      ? "border-amber-200 bg-amber-50 text-amber-950"
      : alert.type === "common-error"
        ? "border-red-200 bg-red-50 text-red-900"
        : alert.type === "permission"
          ? "border-violet-200 bg-violet-50 text-violet-950"
          : "border-sky-200 bg-sky-50 text-sky-950";

  const Icon =
    alert.type === "attention"
      ? AlertTriangle
      : alert.type === "common-error"
        ? AlertTriangle
        : alert.type === "permission"
          ? Shield
          : Lightbulb;

  const label =
    alert.type === "attention"
      ? "Atenção"
      : alert.type === "common-error"
        ? "Erro comum"
        : alert.type === "permission"
          ? "Permissão necessária"
          : "Dica";

  return (
    <div className={cn("rounded-xl border px-4 py-3 text-sm flex gap-3", styles)}>
      <Icon className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{label}</p>
        <p className="mt-1 leading-relaxed">{alert.text}</p>
      </div>
    </div>
  );
}

function GuideEntryCard({ entry }: { entry: SystemGuideEntry }) {
  const domId = `guide-${entry.anchor}`;
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}#${domId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <details
      id={domId}
      className="group rounded-2xl border border-border bg-card shadow-sm scroll-mt-28 open:shadow-md transition-shadow"
    >
      <summary className="cursor-pointer list-none px-5 py-4 rounded-2xl [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {entry.badge && (
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    BADGE_CLASS[entry.badge]
                  )}
                >
                  {BADGE_LABEL[entry.badge]}
                </span>
              )}
              {entry.statusNote && (
                <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-orange-800">
                  {entry.statusNote}
                </span>
              )}
            </div>
            <h4 className="text-base font-semibold text-foreground pr-2">{entry.title}</h4>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                void copyLink();
              }}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Copiar link desta seção"
            >
              {copied ? (
                <span className="text-[10px] font-medium text-green-700 px-1">Copiado</span>
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
            <ChevronDown
              className="h-5 w-5 text-muted-foreground transition-transform group-open:rotate-180 group-open:text-primary"
              aria-hidden
            />
          </div>
        </div>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{entry.objective}</p>
      </summary>
      <div className="border-t border-border px-5 pb-5 pt-4 space-y-4 text-sm">
        {(entry.whoUses || entry.whereToAccess || entry.permissions) && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {entry.whoUses && (
              <div className="rounded-xl bg-muted/30 border border-border/60 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">Quem usa</p>
                <p className="mt-1 text-foreground/90">{entry.whoUses}</p>
              </div>
            )}
            {entry.whereToAccess && (
              <div className="rounded-xl bg-muted/30 border border-border/60 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">Onde acessar</p>
                <p className="mt-1 text-foreground/90">{entry.whereToAccess}</p>
              </div>
            )}
            {entry.permissions && (
              <div className="rounded-xl bg-muted/30 border border-border/60 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">Permissões</p>
                <p className="mt-1 text-foreground/90">{entry.permissions}</p>
              </div>
            )}
          </div>
        )}

        {entry.alerts?.map((a, i) => (
          <React.Fragment key={`${entry.anchor}-alert-${i}`}>
            <WikiAlertBox alert={a} />
          </React.Fragment>
        ))}

        {entry.features.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Principais funcionalidades
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-foreground/90">
              {entry.features.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {entry.basicFlow.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Passo a passo
            </p>
            <ol className="list-decimal pl-5 space-y-2 text-foreground/90">
              {entry.basicFlow.map((line, idx) => (
                <li key={`${entry.anchor}-step-${idx}`} className="leading-relaxed">
                  {line}
                </li>
              ))}
            </ol>
          </div>
        )}

        {entry.importantFields && entry.importantFields.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Campos importantes
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-foreground/90">
              {entry.importantFields.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {entry.businessRules && entry.businessRules.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Regras de negócio
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-foreground/90">
              {entry.businessRules.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {entry.commonErrors && entry.commonErrors.length > 0 && (
          <div className="rounded-xl border border-red-100 bg-red-50/50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-800 mb-2">
              Erros comuns
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-red-900/90">
              {entry.commonErrors.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {entry.examples && entry.examples.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Exemplos práticos
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-foreground/90">
              {entry.examples.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {entry.securityNotes && entry.securityNotes.length > 0 && (
          <div className="rounded-xl border border-violet-100 bg-violet-50/40 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-800 mb-2">
              Segurança
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-violet-950/90">
              {entry.securityNotes.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {entry.notes.length > 0 && (
          <div className="rounded-xl bg-muted/40 border border-border/60 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Observações
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-foreground/90">
              {entry.notes.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {entry.relatedModules && entry.relatedModules.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Módulos relacionados
            </p>
            <p className="text-sm text-foreground/90">{entry.relatedModules.join(" · ")}</p>
          </div>
        )}
      </div>
    </details>
  );
}

function GlossaryPanel({ query }: { query: string }) {
  const terms = useMemo(() => {
    const q = query.trim();
    if (!q) return SYSTEM_WIKI_GLOSSARY;
    return SYSTEM_WIKI_GLOSSARY.filter((t) => glossaryMatchesQuery(q, t));
  }, [query]);

  if (terms.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        Nenhum termo encontrado no glossário para sua busca.
      </p>
    );
  }

  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {terms.map((t) => (
        <div
          key={t.term}
          className="rounded-xl border border-border bg-card px-4 py-3 scroll-mt-28"
          id={`glossary-${t.term.toLowerCase().replace(/\s+/g, "-")}`}
        >
          <dt className="font-semibold text-foreground">{t.term}</dt>
          <dd className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{t.definition}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SystemGuideModule() {
  const [query, setQuery] = useState("");
  const [showBackTop, setShowBackTop] = useState(false);

  const filtered = useMemo(() => filterSections(SYSTEM_GUIDE_SECTIONS, query), [query]);
  const glossaryHits = useMemo(
    () => (query.trim() ? SYSTEM_WIKI_GLOSSARY.filter((t) => glossaryMatchesQuery(query, t)) : []),
    [query]
  );

  const hasQuery = query.trim().length > 0;
  const emptySearch = hasQuery && filtered.length === 0 && glossaryHits.length === 0;
  const indexSections = emptySearch ? [] : filtered;

  useEffect(() => {
    const onScroll = () => setShowBackTop(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const jumpToSection = (anchor: string) => {
    const el = document.getElementById(`section-${anchor}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div data-tour="system-guide-root" className="space-y-8 pb-16 relative">
      <div className="rounded-2xl border border-border bg-gradient-to-br from-primary/5 via-card to-card p-6 md:p-8 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex gap-4 min-w-0">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
              <BookOpen className="h-6 w-6 text-primary" aria-hidden />
            </div>
            <div className="min-w-0 space-y-1">
              <h3 className="text-xl font-bold tracking-tight text-foreground">
                Manual do Sistema IndusCost
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-3xl">
                Wiki interna com passo a passo de cada módulo, regras de negócio e glossário. Escrita
                em linguagem simples para o dia a dia — sem depender do time de desenvolvimento.
              </p>
            </div>
          </div>
        </div>
        <div className="mt-6 relative max-w-xl">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por palavra-chave (módulo, passo, sigla…)…"
            className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-primary/20"
            aria-label="Buscar no manual do sistema"
          />
        </div>
      </div>

      {!hasQuery && (
        <>
          <section className="space-y-4">
            <h3 className="text-lg font-bold text-foreground">Módulos do sistema</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {SYSTEM_WIKI_MODULE_CARDS.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => jumpToSection(card.sectionAnchor)}
                  className="rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition-all hover:border-primary/30 hover:shadow-md"
                >
                  <span
                    className={cn(
                      "inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
                      BADGE_CLASS[card.badge]
                    )}
                  >
                    {BADGE_LABEL[card.badge]}
                  </span>
                  <p className="mt-2 font-semibold text-foreground">{card.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground leading-snug">{card.description}</p>
                </button>
              ))}
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <Info className="h-4 w-4 text-primary" />
                Primeiros passos
              </h3>
              <ol className="mt-4 list-decimal pl-5 space-y-2 text-sm text-foreground/90">
                {SYSTEM_WIKI_QUICK_START.map((step, i) => (
                  <li key={i} className="leading-relaxed">
                    {step}
                  </li>
                ))}
              </ol>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <Link2 className="h-4 w-4 text-primary" />
                Fluxos principais
              </h3>
              {SYSTEM_WIKI_MAIN_FLOWS.map((flow) => (
                <div key={flow.title}>
                  <p className="text-sm font-semibold text-foreground">{flow.title}</p>
                  <ol className="mt-2 list-decimal pl-5 space-y-1 text-sm text-muted-foreground">
                    {flow.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-12">
        <aside className="lg:w-64 shrink-0 lg:sticky lg:top-4 self-start">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
            <ListTree className="h-4 w-4 text-primary" aria-hidden />
            Índice
          </div>
          <nav className="rounded-2xl border border-border bg-card p-3 max-h-[min(70vh,520px)] overflow-y-auto space-y-4 text-sm">
            {indexSections.length === 0 ? (
              <p className="text-xs text-muted-foreground leading-relaxed px-1">
                Nenhum tópico corresponde à busca. Limpe o filtro para ver o índice completo.
              </p>
            ) : (
              indexSections.map((section) => (
                <div key={section.anchor}>
                  <a
                    href={`#section-${section.anchor}`}
                    className="block font-semibold text-foreground hover:text-primary transition-colors mb-2 scroll-mt-28"
                  >
                    {section.title}
                  </a>
                  <ul className="space-y-1 border-l border-border ml-1.5 pl-2.5">
                    {section.entries.map((e) => (
                      <li key={e.anchor}>
                        <a
                          href={`#guide-${e.anchor}`}
                          className="block text-muted-foreground hover:text-foreground transition-colors py-0.5"
                        >
                          {e.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
            {!hasQuery && (
              <div>
                <a
                  href="#section-glossario"
                  className="block font-semibold text-foreground hover:text-primary transition-colors"
                >
                  Glossário
                </a>
              </div>
            )}
          </nav>
        </aside>

        <div className="min-w-0 flex-1 space-y-10">
          {emptySearch ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-6 py-12 text-center">
              <p className="text-sm font-medium text-foreground max-w-md mx-auto">
                Nenhum conteúdo encontrado para sua busca.
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Tente outro termo ou limpe o campo de busca para ver o manual completo.
              </p>
            </div>
          ) : (
            <>
              {filtered.map((section) => (
                <section
                  key={section.anchor}
                  id={`section-${section.anchor}`}
                  className="scroll-mt-28 space-y-4"
                >
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {section.badge && (
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
                            BADGE_CLASS[section.badge]
                          )}
                        >
                          {BADGE_LABEL[section.badge]}
                        </span>
                      )}
                      <h3 className="text-xl font-bold tracking-tight text-foreground">
                        {section.title}
                      </h3>
                    </div>
                    {section.intro ? (
                      <p className="text-sm text-muted-foreground leading-relaxed max-w-4xl">
                        {section.intro}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-4">
                    {section.entries.map((entry) => (
                      <React.Fragment key={entry.anchor}>
                        <GuideEntryCard entry={entry} />
                      </React.Fragment>
                    ))}
                  </div>
                </section>
              ))}

              {hasQuery && glossaryHits.length > 0 && (
                <section className="scroll-mt-28 space-y-4">
                  <h3 className="text-xl font-bold text-foreground">Glossário — resultados da busca</h3>
                  <GlossaryPanel query={query} />
                </section>
              )}

              {!hasQuery && (
                <section id="section-glossario" className="scroll-mt-28 space-y-4">
                  <h3 className="text-xl font-bold text-foreground">Glossário</h3>
                  <p className="text-sm text-muted-foreground max-w-3xl">
                    Siglas e termos usados no IndusCost. Use a busca no topo para localizar rapidamente.
                  </p>
                  <GlossaryPanel query="" />
                </section>
              )}
            </>
          )}
        </div>
      </div>

      {showBackTop && (
        <button
          type="button"
          onClick={scrollTop}
          className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-1 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium shadow-lg hover:bg-accent transition-colors"
          aria-label="Voltar ao topo"
        >
          <ArrowUp className="h-4 w-4" />
          Topo
        </button>
      )}
    </div>
  );
}
