import React, { useMemo, useState } from "react";
import { BookOpen, ChevronDown, ListTree, Search } from "lucide-react";
import {
  SYSTEM_GUIDE_SECTIONS,
  type SystemGuideEntry,
  type SystemGuideSection,
} from "@/src/lib/systemGuideContent";

function entryMatchesQuery(query: string, entry: SystemGuideEntry): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const blob = [
    entry.title,
    entry.objective,
    ...entry.features,
    ...entry.basicFlow,
    ...entry.notes,
    ...(entry.relatedModules ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return blob.includes(q);
}

function filterSections(sections: SystemGuideSection[], query: string): SystemGuideSection[] {
  const q = query.trim();
  if (!q) return sections;
  return sections
    .map((s) => ({
      ...s,
      entries: s.entries.filter((e) => entryMatchesQuery(q, e)),
    }))
    .filter((s) => s.entries.length > 0);
}

function GuideEntryCard({ entry }: { entry: SystemGuideEntry }) {
  const domId = `guide-${entry.anchor}`;
  return (
    <details
      id={domId}
      className="group rounded-2xl border border-border bg-card shadow-sm scroll-mt-28 open:shadow-md transition-shadow"
    >
      <summary className="cursor-pointer list-none px-5 py-4 rounded-2xl [&::-webkit-details-marker]:hidden">
        <div className="flex items-start justify-between gap-3">
          <h4 className="text-base font-semibold text-foreground pr-2">{entry.title}</h4>
          <ChevronDown
            className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 group-open:text-primary"
            aria-hidden
          />
        </div>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{entry.objective}</p>
      </summary>
      <div className="border-t border-border px-5 pb-5 pt-0 space-y-4 text-sm">
        {entry.features.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Principais funcionalidades</p>
            <ul className="list-disc pl-5 space-y-1.5 text-foreground/90">
              {entry.features.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
        {entry.basicFlow.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Fluxo básico de uso</p>
            <ol className="list-decimal pl-5 space-y-1.5 text-foreground/90">
              {entry.basicFlow.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          </div>
        )}
        {entry.notes.length > 0 && (
          <div className="rounded-xl bg-muted/40 border border-border/60 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Observações</p>
            <ul className="list-disc pl-5 space-y-1.5 text-foreground/90">
              {entry.notes.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
        {entry.relatedModules && entry.relatedModules.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Módulos relacionados</p>
            <p className="text-sm text-foreground/90">{entry.relatedModules.join(" · ")}</p>
          </div>
        )}
      </div>
    </details>
  );
}

export function SystemGuideModule() {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterSections(SYSTEM_GUIDE_SECTIONS, query), [query]);

  const hasQuery = query.trim().length > 0;
  const emptySearch = hasQuery && filtered.length === 0;
  const indexSections = emptySearch ? [] : filtered;

  return (
    <div data-tour="system-guide-root" className="space-y-8 pb-12">
      <div className="rounded-2xl border border-border bg-gradient-to-br from-primary/5 via-card to-card p-6 md:p-8 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex gap-4 min-w-0">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
              <BookOpen className="h-6 w-6 text-primary" aria-hidden />
            </div>
            <div className="min-w-0 space-y-1">
              <h3 className="text-lg font-bold tracking-tight text-foreground">Manual funcional do IndusCost</h3>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-3xl">
                Referência oficial para uso do sistema: objetivos por módulo, fluxos básicos e observações de negócio. O conteúdo é
                versionado junto ao código; alterações de telas ou regras visíveis devem ser refletidas na fonte central do guia.
              </p>
            </div>
          </div>
        </div>
        <div className="mt-6 relative max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar no guia por palavra-chave…"
            className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-primary/20"
            aria-label="Buscar no guia do sistema"
          />
        </div>
      </div>

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
          </nav>
        </aside>

        <div className="min-w-0 flex-1 space-y-10">
          {emptySearch ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-6 py-12 text-center">
              <p className="text-sm font-medium text-foreground max-w-md mx-auto">
                Nenhum trecho encontrado para sua busca. Ajuste os termos ou limpe o filtro para ver o guia completo.
              </p>
            </div>
          ) : (
            filtered.map((section) => (
              <section key={section.anchor} id={`section-${section.anchor}`} className="scroll-mt-28 space-y-4">
                <div className="space-y-2">
                  <h3 className="text-xl font-bold tracking-tight text-foreground">{section.title}</h3>
                  {section.intro ? (
                    <p className="text-sm text-muted-foreground leading-relaxed max-w-4xl">{section.intro}</p>
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
            ))
          )}
        </div>
      </div>
    </div>
  );
}
