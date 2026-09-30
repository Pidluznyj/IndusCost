import React, { useEffect, useMemo, useState } from "react";
import { POL_COM_001_CHAPTERS, type OfficialPolicyBlock, type OfficialPolicyChapter } from "@/src/lib/commercialPolicy/official/polCom001V1Document.js";
import {
  POL_COM_001_APPROVER,
  POL_COM_001_AREA,
  POL_COM_001_CLASSIFICATION,
  POL_COM_001_CNPJ,
  POL_COM_001_CODE,
  POL_COM_001_COMPANY,
  POL_COM_001_VERSION_LABEL,
} from "@/src/lib/commercialPolicy/official/polCom001V1View.js";
import { applyPolicyAutoFields, type PolicyAutoFieldContext } from "@/src/lib/commercialPolicy/policyAutoFields.js";

/** Frases que o documento trata como regra central: viram "ponto-chave" destacado. */
const NOTICE_PHRASES = [
  "ativos da empresa",
  "não propriedade pessoal",
  "USO INTERNO",
  "DOCUMENTO CONTROLADO",
  "não autorizam sua distribuição",
  "90 dias",
  "única matriz normativa",
  "pontos de referência",
  "única fonte oficial",
  "não substituem",
  "automaticamente",
  "retroativamente",
  "é vedad",
  "não será utilizada",
];

/** Atalhos da capa para o que mais pesa na rotina do vendedor (só navegação; o texto é o do documento). */
const KEY_POINTS: Array<{ chapterId: string; label: string; teaser: string }> = [
  { chapterId: "10-responsabilidade-comercial-e-carteira", label: "Carteira", teaser: "Clientes e carteira são ativos da empresa; a atribuição é responsabilidade, não propriedade." },
  { chapterId: "anexo-i-matriz-de-referencia-de-formacao-de-preco-comissao-e-alcada", label: "Matriz de comissão", teaser: "Níveis de referência da Formação de Preço; entre dois níveis, interpolação pelo preço praticado — Anexo I." },
  { chapterId: "11-inatividade-de-cliente-e-revisao-de-carteira", label: "90 dias", teaser: "Sem novo faturamento válido e sem CRM válido, a exclusividade é revista." },
  { chapterId: "8-vendas-recorrentes-oem-cobertura-e-canais-de-entrada", label: "Cobertura", teaser: "Venda já iniciada fica com o responsável; nova demanda segue a Seção 8." },
  { chapterId: "22-condutas-vedadas", label: "Condutas vedadas", teaser: "O que nunca fazer com preço, margem, registros, campanhas e comissão." },
  { chapterId: "23-confidencialidade-documento-controlado-e-uso-restrito", label: "Uso restrito", teaser: "Documento controlado: ler e aceitar não autoriza divulgar." },
];

function isKeyPoint(text: string): boolean {
  return NOTICE_PHRASES.some((phrase) => text.toLowerCase().includes(phrase.toLowerCase()));
}

function blockText(block: OfficialPolicyBlock): string {
  if (block.type === "term") return `${block.term} ${block.definition}`;
  if (block.type === "table") return block.rows.map((row) => row.join(" ")).join(" ");
  return block.text;
}

function chapterWords(chapter: OfficialPolicyChapter): number {
  return chapter.blocks.reduce((sum, block) => sum + blockText(block).split(/\s+/).filter(Boolean).length, 0);
}

function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 180));
}

/** Rótulo curto do índice: "Seção 7", "Anexo I", "Capa". */
function chapterKind(chapter: OfficialPolicyChapter): { kind: "capa" | "secao" | "anexo"; short: string; title: string } {
  if (chapter.id === "capa") return { kind: "capa", short: "Capa", title: "Capa e identificação" };
  const annex = /^ANEXO\s+([IVX]+)\s+—\s+(.+)$/i.exec(chapter.title);
  if (annex) return { kind: "anexo", short: `Anexo ${annex[1]}`, title: annex[2] };
  const section = /^(\d+)\.\s+(.+)$/.exec(chapter.title);
  if (section) return { kind: "secao", short: `Seção ${section[1]}`, title: section[2] };
  return { kind: "secao", short: "", title: chapter.title };
}

function titleCase(text: string): string {
  return text.charAt(0) + text.slice(1).toLowerCase();
}

/** Tabela do documento oficial (capa, aprovação, Anexo I, Anexo IV): primeira linha é cabeçalho. */
const PolicyTable: React.FC<{ rows: string[][] }> = ({ rows }) => {
  const [head, ...body] = rows;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
      <table className="w-full border-collapse text-[15px]">
        {head ? (
          <thead className="bg-slate-900 text-slate-50">
            <tr>
              {head.map((cell, cellIndex) => (
                <th key={cellIndex} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">{cell}</th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex} className={rowIndex % 2 === 1 ? "bg-slate-50" : "bg-white"}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className={`border-t border-slate-200 px-4 py-2.5 align-top leading-relaxed ${cellIndex === 0 ? "font-medium text-slate-900" : "text-slate-700"}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/**
 * Leitor do documento oficial. É o MESMO renderizador para o vendedor
 * (modo aceite) e para a prévia do SUPER_ADMIN (modo preview, sem
 * "Concluir leitura"). Renderiza texto, listas, glossário e tabelas.
 * Tom: documento corporativo controlado — capa como termo de referência,
 * índice com progresso, pontos-chave destacados, leitura em coluna de texto.
 */
export const CommercialPolicyReader: React.FC<{
  effectiveFrom: string | null;
  initialChapterId?: string | null;
  mode?: "acceptance" | "preview";
  versionLabel?: string;
  title?: string;
  chapters?: OfficialPolicyChapter[];
  onGeneratePdf: () => void;
  onFinish?: () => void;
  /** Ocupa toda a largura do contêiner (prévia em tela cheia) em vez da moldura de 80rem. */
  fluid?: boolean;
  /** Dados reais que preenchem as lacunas do documento: publicação, quem aprovou, quem assina, o aceite e a Matriz do Anexo I. */
  commissionMatrix?: PolicyAutoFieldContext["commissionMatrix"];
  publishedAt?: string | null;
  approver?: PolicyAutoFieldContext["approver"];
  signer?: PolicyAutoFieldContext["signer"];
  acceptance?: PolicyAutoFieldContext["acceptance"];
}> = ({ effectiveFrom, initialChapterId, mode = "acceptance", versionLabel = POL_COM_001_VERSION_LABEL, title: titleProp, chapters: chaptersProp, onGeneratePdf, onFinish, fluid = false, commissionMatrix = null, publishedAt = null, approver = null, signer = null, acceptance = null }) => {
  const frame = fluid ? "max-w-none" : "max-w-7xl";
  const documentTitle = titleProp ? titleCase(titleProp) : "Política Comercial e de Comissionamento";
  const [today] = useState(() => new Date().toISOString());
  // Datas, aprovação e termo de ciência são preenchidos pelo sistema; o texto gravado (e o hash) não muda.
  const chapters = useMemo(
    () => applyPolicyAutoFields(chaptersProp ?? POL_COM_001_CHAPTERS, { versionLabel, publishedAt, effectiveFrom, approver, signer, acceptance, today, commissionMatrix }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- objetos comparados pelos campos: o pai os recria a cada render
    [chaptersProp, versionLabel, publishedAt, effectiveFrom, approver?.name, approver?.role, signer?.name, signer?.email, signer?.role, acceptance?.id, today, commissionMatrix]
  );
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
  const meta = chapterKind(chapter);
  const totalWords = useMemo(() => chapters.reduce((sum, item) => sum + chapterWords(item), 0), [chapters]);
  const sections = useMemo(() => chapters.filter((item) => chapterKind(item).kind === "secao"), [chapters]);
  const annexes = useMemo(() => chapters.filter((item) => chapterKind(item).kind === "anexo"), [chapters]);
  const progress = Math.round((visited.size / chapters.length) * 100);
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
    const main = document.getElementById("policy-chapter");
    main?.scrollTo({ top: 0 });
    main?.focus();
  };

  const glossary = terms.filter((term) => {
    const needle = glossaryQuery.trim().toLowerCase();
    if (!needle) return true;
    return `${term.term} ${term.definition}`.toLowerCase().includes(needle);
  });

  const vigencia = effectiveFrom ? new Date(effectiveFrom).toLocaleDateString("pt-BR") : "a definir na publicação";
  const isLast = index >= chapters.length - 1;

  const renderIndexItem = (item: OfficialPolicyChapter) => {
    const kind = chapterKind(item);
    const active = item.id === chapter?.id;
    const seen = visited.has(item.id);
    return (
      <li key={item.id}>
        <button
          type="button"
          aria-current={active ? "page" : undefined}
          className={`group flex w-full items-start gap-2 rounded-lg border-l-2 px-2.5 py-2 text-left text-[13px] leading-snug transition ${
            active ? "border-amber-400 bg-slate-800 text-white" : "border-transparent text-slate-300 hover:bg-slate-800/70 hover:text-white"
          }`}
          onClick={() => openChapter(item.id)}
        >
          <span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${seen ? "border-emerald-400 bg-emerald-400 text-slate-900" : "border-slate-600 text-transparent"}`} aria-hidden="true">
            ✓
          </span>
          <span className="min-w-0">
            <span className={`block text-[10px] font-semibold uppercase tracking-wider ${active ? "text-amber-300" : "text-slate-500 group-hover:text-slate-400"}`}>{kind.short}</span>
            <span className="block">{titleCase(kind.title)}</span>
          </span>
        </button>
      </li>
    );
  };

  const renderBlock = (block: OfficialPolicyBlock, blockIndex: number) => {
    if (block.type === "heading") {
      return (
        <h3 key={blockIndex} className="pt-4 font-serif text-xl font-semibold tracking-tight text-slate-900">{block.text}</h3>
      );
    }
    if (block.type === "table") return <PolicyTable key={blockIndex} rows={block.rows} />;
    if (block.type === "term") return null;
    // Listas (princípios, condutas vedadas) ficam uniformes: destacar um item entre iguais distorce a leitura.
    if (block.type === "bullet") {
      return (
        <div key={blockIndex} className="flex gap-3 px-3 py-1.5">
          <span className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
          <p className="text-[16px] leading-7 text-slate-800">{block.text}</p>
        </div>
      );
    }
    if (isKeyPoint(block.text)) {
      return (
        <div key={blockIndex} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-800">Ponto-chave</p>
          <p className="text-[16px] leading-7 text-slate-900">{block.text}</p>
        </div>
      );
    }
    return <p key={blockIndex} className="text-[16px] leading-7 text-slate-800">{block.text}</p>;
  };

  const cover = chapter?.id === "capa";
  const coverTitle = cover ? chapter.blocks.filter((block) => block.type === "paragraph").slice(0, 2).map((block) => (block.type === "paragraph" ? block.text : "")).join(" ") : "";
  const coverSubtitle = cover ? chapter.blocks.find((block, i) => i === 2 && block.type === "paragraph") : null;
  const coverTable = cover ? chapter.blocks.find((block) => block.type === "table") : null;
  const coverIntro = cover ? chapter.blocks.filter((block) => block.type === "paragraph").slice(3) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-100">
      {/* Cabeçalho: identificação do documento controlado + busca. */}
      <header className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className={`mx-auto flex ${frame} flex-wrap items-start justify-between gap-3`}>
          <div className="flex min-w-0 items-start gap-3">
            <div className="hidden shrink-0 rounded-md border-2 border-amber-600 px-2 py-1 text-center sm:block" aria-hidden="true">
              <p className="text-[9px] font-black uppercase leading-tight tracking-widest text-amber-700">Documento<br />controlado</p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-700">
                Uso interno e restrito{mode === "preview" ? " · prévia do super admin" : ""}
              </p>
              <h1 className="font-serif text-xl font-semibold leading-tight tracking-tight text-slate-900">{documentTitle}</h1>
              <p className="text-xs text-slate-600">
                {POL_COM_001_CODE} · Versão {versionLabel} · {POL_COM_001_COMPANY} · CNPJ {POL_COM_001_CNPJ} · Vigência: {vigencia}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50" onClick={onGeneratePdf}>
              Gerar cópia controlada em PDF
            </button>
          </div>
        </div>
        <div className={`mx-auto mt-3 flex ${frame} flex-wrap items-center gap-3`}>
          <label className="sr-only" htmlFor="policy-search">Buscar na política</label>
          <input
            id="policy-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-[14rem] flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm placeholder:text-slate-400 focus:bg-white"
            placeholder="Buscar na política: 90 dias, cobertura, comissão, CRM…"
          />
          <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold md:hidden" onClick={() => setIndexOpen((open) => !open)}>
            {indexOpen ? "Fechar índice" : "Índice"}
          </button>
          <p className="text-xs text-slate-600">
            {visited.size} de {chapters.length} capítulos · leitura ≈ {readingMinutes(totalWords)} min
          </p>
        </div>
        {hits.length > 0 ? (
          <ul className={`mx-auto mt-2 max-h-40 ${frame} space-y-1 overflow-auto rounded-lg border border-slate-200 bg-white p-2 text-xs shadow-sm`}>
            {hits.map((hit, hitIndex) => (
              <li key={`${hit.chapterId}-${hitIndex}`}>
                <button type="button" className="w-full rounded px-2 py-1 text-left hover:bg-slate-50" onClick={() => openChapter(hit.chapterId)}>
                  <span className="font-semibold text-slate-900">{hit.chapterTitle}. </span>
                  <span className="text-slate-600">…{hit.snippet}…</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <div className={`mx-auto flex min-h-0 w-full ${frame} flex-1`}>
        {/* Índice: escuro, com progresso e capítulos lidos marcados; rola sozinho. */}
        <aside className={`${indexOpen ? "block" : "hidden"} min-h-0 w-full bg-slate-900 text-slate-200 md:block md:w-80 md:shrink-0 md:overflow-y-auto`}>
          <nav aria-label="Capítulos da política" className="max-h-[70vh] overflow-auto p-4 md:max-h-none md:overflow-visible">
            <div className="mb-4">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <span>Progresso da leitura</span>
                <span className="text-slate-200">{progress}%</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-700" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-slate-400">Capítulo {index + 1} de {chapters.length}</p>
            </div>
            <ul className="space-y-0.5">{chapters.filter((item) => chapterKind(item).kind === "capa").map(renderIndexItem)}</ul>
            <p className="mt-3 px-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Seções</p>
            <ul className="mt-1 space-y-0.5">{sections.map(renderIndexItem)}</ul>
            {annexes.length ? (
              <>
                <p className="mt-3 px-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Anexos</p>
                <ul className="mt-1 space-y-0.5">{annexes.map(renderIndexItem)}</ul>
              </>
            ) : null}
          </nav>
        </aside>

        {/* Coluna de leitura: folha branca com medida de texto confortável. */}
        <main id="policy-chapter" tabIndex={-1} className="min-w-0 flex-1 overflow-auto bg-slate-100 px-3 py-4 outline-none sm:px-6 sm:py-6">
          {cover ? (
            <div className={`mx-auto ${fluid ? "max-w-5xl" : "max-w-4xl"} space-y-5`}>
              <section className="overflow-hidden rounded-2xl bg-slate-900 text-slate-50 shadow-xl">
                <div className="border-b border-slate-700/60 px-6 py-4 sm:px-10">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-300">
                    <span>{POL_COM_001_COMPANY}</span>
                    <span className="rounded border border-amber-400/70 px-2 py-0.5 text-amber-300">{POL_COM_001_CLASSIFICATION}</span>
                  </div>
                </div>
                <div className="px-6 py-8 sm:px-10 sm:py-12">
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-300">{POL_COM_001_CODE} · Versão {versionLabel}</p>
                  <h2 className="mt-3 font-serif text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">{titleCase(coverTitle)}</h2>
                  {coverSubtitle && coverSubtitle.type === "paragraph" ? (
                    <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">{coverSubtitle.text}</p>
                  ) : null}
                  <div className="mt-8 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      className="rounded-lg bg-amber-400 px-5 py-3 text-sm font-bold text-slate-900 shadow hover:bg-amber-300"
                      onClick={() => chapters[1] && openChapter(chapters[1].id)}
                    >
                      Começar a leitura
                    </button>
                    <span className="text-sm text-slate-300">{chapters.length} capítulos · cerca de {readingMinutes(totalWords)} minutos</span>
                  </div>
                </div>
                {coverTable && coverTable.type === "table" ? (
                  <dl className="grid gap-x-6 gap-y-3 border-t border-slate-700/60 bg-slate-950/40 px-6 py-5 text-sm sm:grid-cols-2 sm:px-10 lg:grid-cols-4">
                    {coverTable.rows.map((row) => (
                      <div key={row[0]}>
                        <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{row[0]}</dt>
                        <dd className="mt-0.5 font-medium text-slate-100">{row[1]}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </section>

              <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:p-6">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-800">Antes de começar</p>
                <h3 className="mt-1 font-serif text-xl font-semibold text-slate-900">Documento controlado — uso interno e restrito</h3>
                <p className="mt-2 text-[15px] leading-7 text-slate-800">
                  Este documento contém informações comerciais, estratégicas, operacionais e de remuneração de uso exclusivo interno.
                  Sua divulgação, reprodução, compartilhamento, encaminhamento ou disponibilização a terceiros sem autorização expressa da empresa/Diretoria é vedada, ressalvadas as hipóteses legais aplicáveis.
                  O uso ou compartilhamento não autorizado poderá resultar na adoção das medidas administrativas, contratuais e legais cabíveis.
                  A leitura e o aceite eletrônico desta Política não autorizam sua distribuição externa.
                </p>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">O que esta política define para você</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {KEY_POINTS.filter((point) => chapters.some((item) => item.id === point.chapterId)).map((point) => (
                    <button
                      key={point.chapterId}
                      type="button"
                      className="group rounded-xl border border-slate-200 p-4 text-left transition hover:border-slate-900 hover:shadow-md"
                      onClick={() => openChapter(point.chapterId)}
                    >
                      <p className="text-sm font-bold text-slate-900">{point.label}</p>
                      <p className="mt-1 text-[13px] leading-relaxed text-slate-600">{point.teaser}</p>
                      <p className="mt-2 text-[11px] font-semibold text-amber-700 group-hover:underline">Ler a seção →</p>
                    </button>
                  ))}
                </div>
                <p className="mt-4 text-xs text-slate-500">Os atalhos só levam ao capítulo; o texto normativo é sempre o do documento. A leitura integral é obrigatória para o aceite.</p>
              </section>

              {coverIntro.length ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
                  <div className="space-y-3">{coverIntro.map((block, blockIndex) => renderBlock(block, blockIndex))}</div>
                  <dl className="mt-4 grid gap-3 border-t border-slate-200 pt-4 text-xs text-slate-600 sm:grid-cols-3">
                    <div><dt className="font-semibold text-slate-500">Área responsável</dt><dd>{POL_COM_001_AREA}</dd></div>
                    <div><dt className="font-semibold text-slate-500">Aprovador</dt><dd>{POL_COM_001_APPROVER}</dd></div>
                    <div><dt className="font-semibold text-slate-500">Vigência</dt><dd>{vigencia}</dd></div>
                  </dl>
                </section>
              ) : null}
            </div>
          ) : (
            <article className={`mx-auto ${fluid ? "max-w-4xl" : "max-w-3xl"} rounded-2xl border border-slate-200 bg-white px-5 py-7 shadow-sm sm:px-10 sm:py-10`}>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-700">
                {meta.short}{meta.short ? " · " : ""}{POL_COM_001_CODE} v{versionLabel}
              </p>
              <h2 className="mt-2 font-serif text-3xl font-semibold leading-tight tracking-tight text-slate-900">{titleCase(meta.title)}</h2>
              <p className="mt-1 text-xs text-slate-500">≈ {readingMinutes(chapterWords(chapter))} min de leitura · capítulo {index + 1} de {chapters.length}</p>
              <div className="my-5 h-px bg-gradient-to-r from-amber-400 via-slate-200 to-transparent" aria-hidden="true" />
              {chapter?.id === "4-definicoes" ? (
                <div className="mb-6 space-y-3">
                  <label className="sr-only" htmlFor="glossary-search">Glossário</label>
                  <input
                    id="glossary-search"
                    value={glossaryQuery}
                    onChange={(event) => setGlossaryQuery(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
                    placeholder="Filtrar termos: Pedido de Venda, Margem Oficial, Registro Material…"
                  />
                  <dl className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200">
                    {glossary.map((term) => (
                      <div key={term.term} className="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[minmax(10rem,14rem)_1fr] sm:gap-4">
                        <dt className="font-semibold text-slate-900">{term.term}</dt>
                        <dd className="text-[15px] leading-7 text-slate-700">{term.definition}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
              <div className="space-y-4">{chapter?.blocks.map(renderBlock)}</div>
              <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5 text-xs text-slate-500">
                <span>{POL_COM_001_CLASSIFICATION}</span>
                {!isLast && chapters[index + 1] ? (
                  <button type="button" className="font-semibold text-slate-900 hover:underline" onClick={() => openChapter(chapters[index + 1].id)}>
                    Continuar: {chapterKind(chapters[index + 1]).short || titleCase(chapterKind(chapters[index + 1]).title)} →
                  </button>
                ) : null}
              </div>
            </article>
          )}
        </main>
      </div>

      {/* Rodapé: navegação e conclusão. */}
      <footer className="border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className={`mx-auto flex ${frame} flex-wrap items-center justify-between gap-3`}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Uso interno e restrito · documento controlado</p>
          <div className="flex items-center gap-2">
            <button type="button" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40" disabled={index <= 0} onClick={() => openChapter(chapters[index - 1].id)}>
              Anterior
            </button>
            {!isLast ? (
              <button type="button" className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800" onClick={() => openChapter(chapters[index + 1].id)}>
                Próximo
              </button>
            ) : mode === "preview" || !onFinish ? (
              <p className="px-3 py-2.5 text-sm font-semibold text-slate-500">Fim do documento</p>
            ) : (
              <button type="button" className="rounded-lg bg-amber-400 px-5 py-2.5 text-sm font-bold text-slate-900 hover:bg-amber-300" onClick={onFinish}>
                Concluir leitura
              </button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
};
