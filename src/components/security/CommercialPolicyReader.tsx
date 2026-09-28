import React, { useEffect, useMemo, useState } from "react";
import { POL_COM_001_CHAPTERS, type OfficialPolicyBlock } from "@/src/lib/commercialPolicy/official/polCom001V1Document.js";
import {
  POL_COM_001_APPROVER,
  POL_COM_001_AREA,
  POL_COM_001_CLASSIFICATION,
  POL_COM_001_CODE,
  POL_COM_001_VERSION_LABEL,
} from "@/src/lib/commercialPolicy/official/polCom001V1View.js";

const NOTICE_PHRASES = [
  "ativos da empresa",
  "não propriedade pessoal",
  "USO INTERNO",
  "DOCUMENTO CONTROLADO",
  "não autorizam sua distribuição",
  "90 dias",
  "Registro Material",
  "Margem Oficial",
  "Anexo I",
  "cobertura",
  "CRM",
];

function tone(text: string): string {
  const hit = NOTICE_PHRASES.some((phrase) => text.toLowerCase().includes(phrase.toLowerCase()));
  return hit ? "border-l-4 border-amber-500 bg-amber-50/80" : "";
}

function blockText(block: OfficialPolicyBlock): string {
  return block.type === "term" ? `${block.term} ${block.definition}` : block.text;
}

export const CommercialPolicyReader: React.FC<{
  effectiveFrom: string;
  initialChapterId?: string | null;
  onGeneratePdf: () => void;
  onFinish: () => void;
}> = ({ effectiveFrom, initialChapterId, onGeneratePdf, onFinish }) => {
  const chapters = POL_COM_001_CHAPTERS;
  const start = chapters.find((chapter) => chapter.id === initialChapterId)?.id ?? chapters[0]?.id ?? "capa";
  const [chapterId, setChapterId] = useState(start);
  const [visited, setVisited] = useState<Set<string>>(() => new Set([start]));
  const [query, setQuery] = useState("");
  const [glossaryQuery, setGlossaryQuery] = useState("");
  const [indexOpen, setIndexOpen] = useState(false);

  useEffect(() => {
    if (!initialChapterId) return;
    setChapterId(initialChapterId);
    setVisited((current) => new Set(current).add(initialChapterId));
  }, [initialChapterId]);

  const index = Math.max(0, chapters.findIndex((chapter) => chapter.id === chapterId));
  const chapter = chapters[index] ?? chapters[0];
  const terms = useMemo(
    () =>
      chapters
        .flatMap((item) => item.blocks)
        .filter((block): block is Extract<OfficialPolicyBlock, { type: "term" }> => block.type === "term"),
    [chapters]
  );
  const hits = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    const found: Array<{ chapterId: string; chapterTitle: string; snippet: string }> = [];
    for (const item of chapters) {
      for (const block of item.blocks) {
        const text = blockText(block);
        const at = text.toLowerCase().indexOf(needle);
        if (at < 0) continue;
        const snippet = text.slice(Math.max(0, at - 40), at + needle.length + 80);
        found.push({ chapterId: item.id, chapterTitle: item.title, snippet });
        if (found.length >= 12) return found;
      }
    }
    return found;
  }, [chapters, query]);

  const openChapter = (id: string) => {
    setChapterId(id);
    setVisited((current) => new Set(current).add(id));
    setIndexOpen(false);
    document.getElementById("policy-chapter")?.focus();
  };

  const glossary = terms.filter((term) => {
    const needle = glossaryQuery.trim().toLowerCase();
    if (!needle) return true;
    return `${term.term} ${term.definition}`.toLowerCase().includes(needle);
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold tracking-wide text-amber-800">DOCUMENTO CONTROLADO · USO INTERNO E RESTRITO</p>
            <h1 className="text-lg font-bold">Política Comercial e de Comissionamento</h1>
            <p className="text-xs text-muted-foreground">
              {POL_COM_001_CODE} · Versão {POL_COM_001_VERSION_LABEL} · {POL_COM_001_CLASSIFICATION}
            </p>
            <p className="text-xs text-muted-foreground">
              Área: {POL_COM_001_AREA} · Aprovador: {POL_COM_001_APPROVER} · Vigência: {new Date(effectiveFrom).toLocaleString("pt-BR")}
            </p>
          </div>
          <button type="button" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold" onClick={onGeneratePdf}>
            Gerar cópia controlada em PDF
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="text-xs font-semibold" htmlFor="policy-search">Buscar na política</label>
          <input
            id="policy-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-[12rem] flex-1 rounded-lg border border-border px-3 py-2 text-sm"
            placeholder="90 dias, cobertura, comissão, CRM"
          />
          <p className="text-xs text-muted-foreground">
            {visited.size} de {chapters.length} capítulos · {Math.round((visited.size / chapters.length) * 100)}% da navegação
          </p>
        </div>
        {hits.length > 0 ? (
          <ul className="mt-2 max-h-36 space-y-1 overflow-auto text-xs">
            {hits.map((hit, hitIndex) => (
              <li key={`${hit.chapterId}-${hitIndex}`}>
                <button type="button" className="text-left text-primary" onClick={() => openChapter(hit.chapterId)}>
                  <span className="font-semibold">{hit.chapterTitle}. </span>
                  {hit.snippet}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className={`${indexOpen ? "block" : "hidden"} w-full border-r border-border bg-muted/40 md:block md:w-72 md:shrink-0`}>
          <nav aria-label="Capítulos da política" className="max-h-[70vh] overflow-auto p-3 md:max-h-none">
            <ul className="space-y-1">
              {chapters.map((item, itemIndex) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`w-full rounded-lg px-2 py-2 text-left text-xs ${item.id === chapter?.id ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
                    onClick={() => openChapter(item.id)}
                  >
                    {itemIndex + 1}. {item.title}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <main id="policy-chapter" tabIndex={-1} className="min-w-0 flex-1 overflow-auto px-4 py-4">
          <button type="button" className="mb-3 rounded-lg border border-border px-3 py-2 text-xs font-semibold md:hidden" onClick={() => setIndexOpen((open) => !open)}>
            {indexOpen ? "Fechar índice" : "Abrir índice"}
          </button>
          {chapter?.id === "capa" ? (
            <section className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
              <h2 className="font-bold">Documento controlado — uso interno e restrito</h2>
              <p className="mt-2">
                Este documento contém informações comerciais, estratégicas, operacionais e de remuneração de uso exclusivo interno.
                Sua divulgação, reprodução, compartilhamento, encaminhamento ou disponibilização a terceiros sem autorização expressa da empresa/Diretoria é vedada, ressalvadas as hipóteses legais aplicáveis.
                O uso ou compartilhamento não autorizado poderá resultar na adoção das medidas administrativas, contratuais e legais cabíveis.
                A leitura e o aceite eletrônico desta Política não autorizam sua distribuição externa.
              </p>
            </section>
          ) : null}
          <article className="mx-auto max-w-3xl space-y-3">
            <h2 className="text-xl font-bold">{chapter?.title}</h2>
            {chapter?.id === "4-definicoes" ? (
              <div className="space-y-2">
                <label className="text-xs font-semibold" htmlFor="glossary-search">Glossário</label>
                <input
                  id="glossary-search"
                  value={glossaryQuery}
                  onChange={(event) => setGlossaryQuery(event.target.value)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                  placeholder="Pedido de Venda, Margem Oficial, Registro Material"
                />
                <dl className="space-y-3">
                  {glossary.map((term) => (
                    <div key={term.term} className="rounded-lg border border-border p-3">
                      <dt className="text-sm font-semibold">{term.term}</dt>
                      <dd className="mt-1 text-sm leading-relaxed">{term.definition}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
            {chapter?.blocks.map((block, blockIndex) => {
              if (block.type === "heading") return <h3 key={blockIndex} className="pt-2 text-base font-bold">{block.text}</h3>;
              if (block.type === "bullet") return <p key={blockIndex} className={`rounded-lg px-3 py-2 text-sm leading-relaxed ${tone(block.text)}`}>• {block.text}</p>;
              if (block.type === "term") return null;
              return <p key={blockIndex} className={`rounded-lg px-3 py-2 text-sm leading-relaxed ${tone(block.text)}`}>{block.text}</p>;
            })}
          </article>
        </main>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-4 py-3">
        <p className="text-[11px] font-semibold text-muted-foreground">USO INTERNO E RESTRITO · DOCUMENTO CONTROLADO</p>
        <div className="flex gap-2">
          <button type="button" className="rounded-lg border border-border px-4 py-3 text-sm font-semibold disabled:opacity-40" disabled={index <= 0} onClick={() => openChapter(chapters[index - 1].id)}>
            Anterior
          </button>
          {index < chapters.length - 1 ? (
            <button type="button" className="rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground" onClick={() => openChapter(chapters[index + 1].id)}>
              Próximo
            </button>
          ) : (
            <button type="button" className="rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground" onClick={onFinish}>
              Concluir leitura
            </button>
          )}
        </div>
      </footer>
    </div>
  );
};
