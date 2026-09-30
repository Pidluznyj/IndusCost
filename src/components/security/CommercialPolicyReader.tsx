import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  BookOpen,
  CalendarClock,
  Check,
  Clock,
  FileDown,
  Handshake,
  ListChecks,
  Lock,
  Menu,
  PenLine,
  Percent,
  Search,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
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
const KEY_POINTS: Array<{ chapterId: string; label: string; teaser: string; icon: LucideIcon }> = [
  { icon: Users, chapterId: "10-responsabilidade-comercial-e-carteira", label: "Carteira", teaser: "Clientes e carteira são ativos da empresa; a atribuição é responsabilidade, não propriedade." },
  { icon: Percent, chapterId: "anexo-i-matriz-de-referencia-de-formacao-de-preco-comissao-e-alcada", label: "Matriz de comissão", teaser: "Níveis de referência da Formação de Preço; entre dois níveis, interpolação pelo preço praticado — Anexo I." },
  { icon: CalendarClock, chapterId: "11-inatividade-de-cliente-e-revisao-de-carteira", label: "90 dias", teaser: "Sem novo faturamento válido e sem CRM válido, a exclusividade é revista." },
  { icon: Handshake, chapterId: "8-vendas-recorrentes-oem-cobertura-e-canais-de-entrada", label: "Cobertura", teaser: "Venda já iniciada fica com o responsável; nova demanda segue a Seção 8." },
  { icon: Ban, chapterId: "22-condutas-vedadas", label: "Condutas vedadas", teaser: "O que nunca fazer com preço, margem, registros, campanhas e comissão." },
  { icon: Lock, chapterId: "23-confidencialidade-documento-controlado-e-uso-restrito", label: "Uso restrito", teaser: "Documento controlado: ler e aceitar não autoriza divulgar." },
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
    <div className="overflow-x-auto rounded-2xl border border-slate-200/80">
      <table className="w-full border-collapse text-[15px]">
        {head ? (
          <thead className="bg-[#F7F5F0] text-[#1F2F4F]">
            <tr>
              {head.map((cell, cellIndex) => (
                <th key={cellIndex} className="border-b border-slate-200 px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em]">{cell}</th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex} className="bg-white">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className={`px-5 py-3 align-top leading-relaxed ${rowIndex > 0 ? "border-t border-slate-200/80" : ""} ${cellIndex === 0 ? "font-semibold text-slate-900" : "text-slate-700"}`}>{cell}</td>
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
 * Tom: leitura acolhedora e executiva — papel claro, azul-marinho e um
 * dourado discreto; capa que recebe o leitor e explica o percurso, índice
 * claro com progresso, pontos que valem guardar e coluna de texto confortável.
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
    [chaptersProp, versionLabel, publishedAt, effectiveFrom, approver?.name, approver?.role, approver?.jobTitle, signer?.name, signer?.email, signer?.role, signer?.jobTitle, acceptance?.id, today, commissionMatrix]
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

  // O índice acompanha a leitura: o capítulo aberto fica sempre à vista.
  useEffect(() => {
    document.querySelector('nav[aria-label="Capítulos da política"] [aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [chapterId]);

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
  const nextChapter = !isLast ? chapters[index + 1] : null;
  const firstName = signer?.name?.trim().split(/\s+/)[0] ?? null;

  const renderIndexItem = (item: OfficialPolicyChapter) => {
    const kind = chapterKind(item);
    const active = item.id === chapter?.id;
    const seen = visited.has(item.id);
    return (
      <li key={item.id}>
        <button
          type="button"
          aria-current={active ? "page" : undefined}
          className={`group flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-[13.5px] leading-snug transition ${
            active ? "bg-[#1F2F4F]/[0.06] text-[#1F2F4F]" : "text-slate-600 hover:bg-slate-900/[0.035] hover:text-slate-900"
          }`}
          onClick={() => openChapter(item.id)}
        >
          <span
            className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition ${
              active
                ? "border-[#1F2F4F] bg-[#1F2F4F] text-white"
                : seen
                  ? "border-emerald-600/30 bg-emerald-50 text-emerald-700"
                  : "border-slate-300 bg-white text-transparent"
            }`}
            aria-hidden="true"
          >
            {seen && !active ? <Check className="h-3 w-3" strokeWidth={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
          </span>
          <span className="min-w-0">
            <span className={`block text-[10.5px] font-semibold uppercase tracking-[0.12em] ${active ? "text-[#9A6B1F]" : "text-slate-400"}`}>{kind.short}</span>
            <span className={`block ${active ? "font-semibold" : ""}`}>{titleCase(kind.title)}</span>
          </span>
        </button>
      </li>
    );
  };

  const renderBlock = (block: OfficialPolicyBlock, blockIndex: number) => {
    if (block.type === "heading") {
      return (
        <h3 key={blockIndex} className="pt-5 font-serif text-[22px] font-semibold leading-snug tracking-tight text-[#1F2F4F]">{block.text}</h3>
      );
    }
    if (block.type === "table") return <PolicyTable key={blockIndex} rows={block.rows} />;
    if (block.type === "term") return null;
    // Listas (princípios, condutas vedadas) ficam uniformes: destacar um item entre iguais distorce a leitura.
    if (block.type === "bullet") {
      return (
        <div key={blockIndex} className="flex gap-3.5 pl-1">
          <span className="mt-[13px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#C9A35A]" aria-hidden="true" />
          <p className="text-[17px] leading-8 text-slate-700">{block.text}</p>
        </div>
      );
    }
    if (isKeyPoint(block.text)) {
      return (
        <aside key={blockIndex} className="rounded-r-xl border-l-[3px] border-[#C9A35A] bg-[#FBF6EA] px-5 py-4">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9A6B1F]">Vale guardar</p>
          <p className="text-[17px] leading-8 text-slate-800">{block.text}</p>
        </aside>
      );
    }
    return <p key={blockIndex} className="text-[17px] leading-8 text-slate-700">{block.text}</p>;
  };

  const cover = chapter?.id === "capa";
  const coverTitle = cover ? chapter.blocks.filter((block) => block.type === "paragraph").slice(0, 2).map((block) => (block.type === "paragraph" ? block.text : "")).join(" ") : "";
  const coverSubtitle = cover ? chapter.blocks.find((block, i) => i === 2 && block.type === "paragraph") : null;
  const coverTable = cover ? chapter.blocks.find((block) => block.type === "table") : null;
  const coverIntro = cover ? chapter.blocks.filter((block) => block.type === "paragraph").slice(3) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#F7F5F0] text-slate-800">
      {/* Cabeçalho enxuto: identificação, busca e uma linha fina de progresso. */}
      <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className={`mx-auto flex ${frame} flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 sm:px-6`}>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 text-[11px] font-medium text-slate-500">
              <span className="inline-flex items-center gap-1 rounded-full bg-[#FBF6EA] px-2 py-0.5 font-semibold text-[#9A6B1F]">
                <Lock className="h-3 w-3" aria-hidden="true" /> Documento controlado
              </span>
              <span>Uso interno e restrito{mode === "preview" ? " · prévia do super admin" : ""}</span>
            </p>
            <h1 className="mt-1 truncate font-serif text-lg font-semibold leading-tight tracking-tight text-[#1F2F4F]">{documentTitle}</h1>
            <p className="truncate text-xs text-slate-500">
              {POL_COM_001_CODE} · Versão {versionLabel} · {POL_COM_001_COMPANY} · CNPJ {POL_COM_001_CNPJ} · Vigência: {vigencia}
            </p>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 md:hidden"
              onClick={() => setIndexOpen((open) => !open)}
            >
              {indexOpen ? <X className="h-3.5 w-3.5" aria-hidden="true" /> : <Menu className="h-3.5 w-3.5" aria-hidden="true" />}
              {indexOpen ? "Fechar índice" : "Índice"}
            </button>
            <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
              <label className="sr-only" htmlFor="policy-search">Buscar na política</label>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                id="policy-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="w-full rounded-full border border-slate-200 bg-[#F7F5F0] py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-[#1F2F4F]/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1F2F4F]/10"
                placeholder="Buscar: 90 dias, cobertura, comissão…"
              />
            </div>
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              onClick={onGeneratePdf}
            >
              <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden lg:inline">Gerar cópia controlada em PDF</span>
              <span className="lg:hidden">PDF</span>
            </button>
          </div>
        </div>
        {hits.length > 0 ? (
          <ul className={`mx-auto mb-2 max-h-44 ${frame} space-y-0.5 overflow-auto rounded-2xl border border-slate-200 bg-white p-2 text-[13px] shadow-lg shadow-slate-900/5 sm:mx-6`}>
            {hits.map((hit, hitIndex) => (
              <li key={`${hit.chapterId}-${hitIndex}`}>
                <button type="button" className="w-full rounded-xl px-3 py-2 text-left hover:bg-[#F7F5F0]" onClick={() => openChapter(hit.chapterId)}>
                  <span className="font-semibold text-[#1F2F4F]">{titleCase(hit.chapterTitle)}. </span>
                  <span className="text-slate-600">…{hit.snippet}…</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="h-[3px] bg-slate-200/70" role="progressbar" aria-label="Progresso da leitura" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-r-full bg-gradient-to-r from-[#1F2F4F] to-[#C9A35A] transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
      </header>

      <div className={`mx-auto flex min-h-0 w-full ${frame} flex-1`}>
        {/* Índice: claro e discreto, com os capítulos lidos marcados; rola sozinho. */}
        <aside className={`${indexOpen ? "block" : "hidden"} min-h-0 w-full border-r border-slate-200/80 bg-white md:block md:w-[19rem] md:shrink-0 md:overflow-y-auto`}>
          <nav aria-label="Capítulos da política" className="max-h-[70vh] overflow-auto p-4 md:max-h-none md:overflow-visible">
            <div className="mb-4 rounded-2xl bg-[#F7F5F0] px-4 py-3.5">
              <div className="flex items-baseline justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Sua leitura</p>
                <p className="font-serif text-lg font-semibold text-[#1F2F4F]">{progress}%</p>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {visited.size} de {chapters.length} capítulos · cerca de {readingMinutes(totalWords)} min no total
              </p>
            </div>
            <ul className="space-y-0.5">{chapters.filter((item) => chapterKind(item).kind === "capa").map(renderIndexItem)}</ul>
            <p className="mt-4 px-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">Seções</p>
            <ul className="mt-1 space-y-0.5">{sections.map(renderIndexItem)}</ul>
            {annexes.length ? (
              <>
                <p className="mt-4 px-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">Anexos</p>
                <ul className="mt-1 space-y-0.5">{annexes.map(renderIndexItem)}</ul>
              </>
            ) : null}
          </nav>
        </aside>

        {/* Coluna de leitura: papel claro, medida de texto confortável. */}
        <main id="policy-chapter" tabIndex={-1} className="min-w-0 flex-1 overflow-auto px-3 py-5 outline-none sm:px-8 sm:py-8">
          {cover ? (
            <div className={`mx-auto ${fluid ? "max-w-5xl" : "max-w-4xl"} space-y-5`}>
              <section className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_40px_-12px_rgba(15,23,42,0.12)]">
                <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-[#1F2F4F] via-[#1F2F4F] to-[#C9A35A]" aria-hidden="true" />
                <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#FBF6EA]" aria-hidden="true" />
                <div className="relative px-6 pb-8 pt-10 sm:px-12 sm:pb-10 sm:pt-14">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{POL_COM_001_COMPANY}</p>
                  <p className="mt-6 text-[15px] text-slate-600">
                    {firstName ? `Olá, ${firstName}.` : "Boas-vindas."} Esta é a política que orienta o nosso trabalho comercial.
                  </p>
                  <h2 className="mt-2 max-w-3xl font-serif text-[2.1rem] font-semibold leading-[1.12] tracking-tight text-[#1F2F4F] sm:text-5xl">{titleCase(coverTitle)}</h2>
                  {coverSubtitle && coverSubtitle.type === "paragraph" ? (
                    <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">{coverSubtitle.text}</p>
                  ) : null}
                  <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-full bg-[#1F2F4F] px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[#1F2F4F]/20 transition hover:bg-[#182540]"
                      onClick={() => chapters[1] && openChapter(chapters[1].id)}
                    >
                      Começar a leitura <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <span className="inline-flex items-center gap-1.5 text-sm text-slate-500">
                      <Clock className="h-4 w-4" aria-hidden="true" />
                      {chapters.length} capítulos · cerca de {readingMinutes(totalWords)} minutos · no seu ritmo
                    </span>
                  </div>
                </div>
                <ol className="relative grid gap-px border-t border-slate-200/80 bg-slate-200/80 sm:grid-cols-3">
                  {[
                    { icon: BookOpen, title: "1. Leia com calma", text: "Capítulo a capítulo, com os pontos importantes em destaque." },
                    { icon: ListChecks, title: "2. Confira o que entendeu", text: "Perguntas rápidas sobre situações do dia a dia." },
                    { icon: PenLine, title: "3. Assine eletronicamente", text: "Você recebe um certificado do seu aceite." },
                  ].map((stepItem) => (
                    <li key={stepItem.title} className="flex items-start gap-3 bg-white px-6 py-4 sm:px-7">
                      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F7F5F0] text-[#1F2F4F]">
                        <stepItem.icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-slate-900">{stepItem.title}</span>
                        <span className="block text-[13px] leading-relaxed text-slate-500">{stepItem.text}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </section>

              <section className="rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-8">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">O que esta política define para você</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {KEY_POINTS.filter((point) => chapters.some((item) => item.id === point.chapterId)).map((point) => (
                    <button
                      key={point.chapterId}
                      type="button"
                      className="group rounded-2xl border border-slate-200/80 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-[#1F2F4F]/30 hover:shadow-lg hover:shadow-slate-900/5"
                      onClick={() => openChapter(point.chapterId)}
                    >
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#F7F5F0] text-[#1F2F4F] transition group-hover:bg-[#1F2F4F] group-hover:text-white">
                        <point.icon className="h-[18px] w-[18px]" aria-hidden="true" />
                      </span>
                      <p className="mt-3 text-[15px] font-semibold text-slate-900">{point.label}</p>
                      <p className="mt-1 text-[13px] leading-relaxed text-slate-600">{point.teaser}</p>
                      <p className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#9A6B1F]">
                        Ler a seção <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" aria-hidden="true" />
                      </p>
                    </button>
                  ))}
                </div>
                <p className="mt-4 text-xs text-slate-500">Os atalhos só levam ao capítulo; o texto normativo é sempre o do documento. A leitura integral é obrigatória para o aceite.</p>
              </section>

              <section className="flex gap-4 rounded-3xl border border-[#E9DDBF] bg-[#FBF6EA] p-5 sm:p-6">
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#9A6B1F]">
                  <ShieldCheck className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="font-serif text-lg font-semibold text-[#1F2F4F]">Documento controlado — uso interno e restrito</h3>
                  <p className="mt-1.5 text-[14.5px] leading-7 text-slate-700">
                    Este documento contém informações comerciais, estratégicas, operacionais e de remuneração de uso exclusivo interno.
                    Sua divulgação, reprodução, compartilhamento, encaminhamento ou disponibilização a terceiros sem autorização expressa da empresa/Diretoria é vedada, ressalvadas as hipóteses legais aplicáveis.
                    O uso ou compartilhamento não autorizado poderá resultar na adoção das medidas administrativas, contratuais e legais cabíveis.
                    A leitura e o aceite eletrônico desta Política não autorizam sua distribuição externa.
                  </p>
                </div>
              </section>

              {coverTable && coverTable.type === "table" ? (
                <section className="rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-8">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Identificação do documento</p>
                  <dl className="mt-4 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    {coverTable.rows.map((row) => (
                      <div key={row[0]} className="border-l-2 border-slate-200 pl-3">
                        <dt className="text-[11px] font-medium text-slate-500">{row[0]}</dt>
                        <dd className="mt-0.5 font-semibold text-slate-900">{row[1]}</dd>
                      </div>
                    ))}
                  </dl>
                  {coverIntro.length ? <div className="mt-6 space-y-3 border-t border-slate-200/80 pt-5">{coverIntro.map((block, blockIndex) => renderBlock(block, blockIndex))}</div> : null}
                  <dl className="mt-5 grid gap-3 border-t border-slate-200/80 pt-4 text-xs text-slate-600 sm:grid-cols-3">
                    <div><dt className="font-medium text-slate-500">Área responsável</dt><dd className="font-semibold text-slate-800">{POL_COM_001_AREA}</dd></div>
                    <div><dt className="font-medium text-slate-500">Aprovador</dt><dd className="font-semibold text-slate-800">{POL_COM_001_APPROVER}</dd></div>
                    <div><dt className="font-medium text-slate-500">Vigência</dt><dd className="font-semibold text-slate-800">{vigencia}</dd></div>
                  </dl>
                </section>
              ) : null}
            </div>
          ) : (
            <article className={`mx-auto ${fluid ? "max-w-4xl" : "max-w-3xl"} rounded-3xl border border-slate-200/80 bg-white px-6 py-8 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_40px_-16px_rgba(15,23,42,0.10)] sm:px-14 sm:py-12`}>
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                <span className="rounded-full bg-[#FBF6EA] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#9A6B1F]">{meta.short || "Capítulo"}</span>
                <span>Capítulo {index + 1} de {chapters.length}</span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden="true" /> cerca de {readingMinutes(chapterWords(chapter))} min</span>
              </p>
              <h2 className="mt-4 font-serif text-[2rem] font-semibold leading-[1.15] tracking-tight text-[#1F2F4F] sm:text-[2.4rem]">{titleCase(meta.title)}</h2>
              <div className="my-7 h-px bg-gradient-to-r from-[#C9A35A] via-slate-200 to-transparent" aria-hidden="true" />
              {chapter?.id === "4-definicoes" ? (
                <div className="mb-7 space-y-3">
                  <label className="sr-only" htmlFor="glossary-search">Glossário</label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <input
                      id="glossary-search"
                      value={glossaryQuery}
                      onChange={(event) => setGlossaryQuery(event.target.value)}
                      className="w-full rounded-full border border-slate-200 bg-[#F7F5F0] py-2.5 pl-9 pr-3 text-sm focus:border-[#1F2F4F]/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1F2F4F]/10"
                      placeholder="Filtrar termos: Pedido de Venda, Margem Oficial, Registro Material…"
                    />
                  </div>
                  <dl className="divide-y divide-slate-200/80 overflow-hidden rounded-2xl border border-slate-200/80">
                    {glossary.map((term) => (
                      <div key={term.term} className="grid gap-1 bg-white px-5 py-3.5 sm:grid-cols-[minmax(10rem,14rem)_1fr] sm:gap-5">
                        <dt className="font-semibold text-[#1F2F4F]">{term.term}</dt>
                        <dd className="text-[15.5px] leading-7 text-slate-700">{term.definition}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
              <div className="space-y-5">{chapter?.blocks.map(renderBlock)}</div>
              {nextChapter ? (
                <button
                  type="button"
                  className="group mt-10 flex w-full items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-[#F7F5F0] px-5 py-4 text-left transition hover:border-[#1F2F4F]/30 hover:bg-white hover:shadow-lg hover:shadow-slate-900/5"
                  onClick={() => openChapter(nextChapter.id)}
                >
                  <span className="min-w-0">
                    <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Continuar a leitura</span>
                    <span className="mt-0.5 block truncate font-serif text-lg font-semibold text-[#1F2F4F]">
                      {chapterKind(nextChapter).short ? `${chapterKind(nextChapter).short} — ` : ""}{titleCase(chapterKind(nextChapter).title)}
                    </span>
                  </span>
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1F2F4F] text-white transition group-hover:translate-x-0.5">
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </span>
                </button>
              ) : null}
              <p className="mt-8 border-t border-slate-200/80 pt-4 text-[11px] text-slate-400">{POL_COM_001_CLASSIFICATION}</p>
            </article>
          )}
        </main>
      </div>

      {/* Rodapé: onde estou, voltar e avançar. */}
      <footer className="border-t border-slate-200/80 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className={`mx-auto flex ${frame} flex-wrap items-center justify-between gap-3`}>
          <p className="text-xs text-slate-500">
            <span className="font-semibold text-slate-700">Capítulo {index + 1} de {chapters.length}</span>
            <span className="hidden sm:inline"> · {cover ? "Capa e identificação" : `${meta.short ? `${meta.short} — ` : ""}${titleCase(meta.title)}`}</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
              disabled={index <= 0}
              onClick={() => openChapter(chapters[index - 1].id)}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Anterior
            </button>
            {!isLast ? (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-full bg-[#1F2F4F] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#182540]"
                onClick={() => openChapter(chapters[index + 1].id)}
              >
                Próximo <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : mode === "preview" || !onFinish ? (
              <p className="px-3 py-2.5 text-sm font-semibold text-slate-500">Fim do documento</p>
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800"
                onClick={onFinish}
              >
                <Check className="h-4 w-4" aria-hidden="true" /> Concluir leitura
              </button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
};
