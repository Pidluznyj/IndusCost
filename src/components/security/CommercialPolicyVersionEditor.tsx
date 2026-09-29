import React, { useMemo, useState } from "react";
import {
  POLICY_BLOCK_TYPE_LABELS,
  emptyPolicyChapter,
  parsePolicyChapters,
  serializePolicyChapters,
  slugifyPolicyTitle,
  type PolicyBlock,
  type PolicyChapter,
} from "@/src/lib/commercialPolicy/policyDocumentFormat";

export type EditorQuestion = {
  id: string;
  prompt: string;
  options: Array<{ id: string; text: string }>;
  correctOptionId: string;
  explanation: string;
  reviewChapterId?: string;
};

export type EditorVersion = {
  id: string;
  label: string;
  title: string;
  status: string;
  official: boolean;
  content: string;
  summaryRules: string[];
  declarations: string[];
  questions: EditorQuestion[];
  effectiveFrom: string;
};

export type EditorPayload = {
  title: string;
  content: string;
  summaryRules: string[];
  declarations: string[];
  questions: EditorQuestion[];
  effectiveFrom: string;
};

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function blockToText(block: PolicyBlock): string {
  if (block.type === "table") return block.rows.map((row) => row.join(" | ")).join("\n");
  if (block.type === "term") return `${block.term} :: ${block.definition}`;
  return block.text;
}

function textToBlock(type: PolicyBlock["type"], text: string): PolicyBlock {
  if (type === "table") {
    const rows = text.split(/\r?\n/).map((line) => line.split("|").map((cell) => cell.trim())).filter((row) => row.some(Boolean));
    return { type: "table", rows: rows.length ? rows : [["", ""]] };
  }
  if (type === "term") {
    const [term, ...rest] = text.split(" :: ");
    return { type: "term", term: term.trim(), definition: rest.join(" :: ").trim() };
  }
  return { type, text: text.replace(/\r?\n/g, " ").trim() } as PolicyBlock;
}

const inputClass = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
const smallButton = "rounded-md border border-border px-2 py-1 text-[11px] font-semibold hover:bg-accent disabled:opacity-40";

/**
 * Editor estruturado de uma versão em rascunho: capítulos e blocos (parágrafo,
 * subtítulo, tópico, termo, tabela), regras-resumo, declarações, perguntas e
 * vigência. O conteúdo é gravado como marcação (policyDocumentFormat) e é o
 * mesmo que o leitor do vendedor e o PDF renderizam. Versão publicada não abre.
 */
export const CommercialPolicyVersionEditor: React.FC<{
  version: EditorVersion;
  busy: boolean;
  onSave: (payload: EditorPayload) => Promise<void>;
  onPreview: (payload: EditorPayload) => void;
  onPublish: () => void;
  onDiscard: () => void;
  onClose: () => void;
}> = ({ version, busy, onSave, onPreview, onPublish, onDiscard, onClose }) => {
  const [title, setTitle] = useState(version.title);
  const [effectiveFrom, setEffectiveFrom] = useState(toLocalInput(version.effectiveFrom));
  const [chapters, setChapters] = useState<PolicyChapter[]>(() => parsePolicyChapters(version.content));
  const [selected, setSelected] = useState(0);
  const [summaryRules, setSummaryRules] = useState(version.summaryRules.join("\n"));
  const [declarations, setDeclarations] = useState(version.declarations.join("\n"));
  const [questions, setQuestions] = useState<EditorQuestion[]>(version.questions.map((q) => ({ ...q, options: q.options.map((o) => ({ ...o })) })));
  const [tab, setTab] = useState<"conteudo" | "regras" | "declaracoes" | "perguntas">("conteudo");
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const chapter = chapters[Math.min(selected, chapters.length - 1)];
  const chapterIds = useMemo(() => chapters.map((item) => ({ id: item.id, title: item.title })), [chapters]);

  const touch = () => setDirty(true);

  const updateChapter = (index: number, patch: (current: PolicyChapter) => PolicyChapter) => {
    setChapters((current) => current.map((item, i) => (i === index ? patch(item) : item)));
    touch();
  };
  const moveChapter = (index: number, delta: number) => {
    setChapters((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setSelected((current) => Math.max(0, Math.min(chapters.length - 1, current + delta)));
    touch();
  };
  const updateBlock = (blockIndex: number, patch: (current: PolicyBlock) => PolicyBlock) =>
    updateChapter(selected, (item) => ({ ...item, blocks: item.blocks.map((block, i) => (i === blockIndex ? patch(block) : block)) }));
  const moveBlock = (blockIndex: number, delta: number) =>
    updateChapter(selected, (item) => {
      const next = [...item.blocks];
      const target = blockIndex + delta;
      if (target < 0 || target >= next.length) return item;
      [next[blockIndex], next[target]] = [next[target], next[blockIndex]];
      return { ...item, blocks: next };
    });

  const payload = (): EditorPayload => ({
    title: title.trim(),
    content: serializePolicyChapters(chapters.map((item) => ({ ...item, id: slugifyPolicyTitle(item.title) || item.id }))),
    summaryRules: summaryRules.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    declarations: declarations.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    questions: questions.map((question) => ({
      ...question,
      prompt: question.prompt.trim(),
      explanation: question.explanation.trim(),
      options: question.options.map((option) => ({ ...option, text: option.text.trim() })).filter((option) => option.text),
    })),
    effectiveFrom: effectiveFrom ? new Date(effectiveFrom).toISOString() : version.effectiveFrom,
  });

  const save = async () => {
    await onSave(payload());
    setDirty(false);
  };

  return (
    <section className="space-y-3 rounded-xl border border-slate-300 bg-card p-4" aria-label="Editor de conteúdo da política">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700">Editor de conteúdo · rascunho versão {version.label}</p>
          <h3 className="text-sm font-bold">{title || "Sem título"}</h3>
          <p className="text-xs text-muted-foreground">
            Tudo o que você altera aqui é o que o vendedor lê, responde e aceita. Salve o rascunho, visualize e só então publique. A versão publicada fica imutável.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold" onClick={() => onPreview(payload())}>Visualizar como o vendedor</button>
          <button type="button" className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40" disabled={busy} onClick={() => void save()}>
            {dirty ? "Salvar rascunho *" : "Salvar rascunho"}
          </button>
          <button type="button" className="rounded-lg border border-emerald-600 px-3 py-2 text-xs font-semibold text-emerald-800 disabled:opacity-40" disabled={busy || dirty} title={dirty ? "Salve o rascunho antes de publicar." : "Publicar esta versão"} onClick={onPublish}>
            Publicar
          </button>
          <button type="button" className="rounded-lg border border-red-300 px-3 py-2 text-xs font-semibold text-red-800" onClick={() => setConfirmDiscard(true)}>Descartar rascunho</button>
          <button type="button" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold" onClick={onClose}>Fechar</button>
        </div>
      </div>
      {confirmDiscard ? (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs">
          <p className="font-semibold">Descartar este rascunho? Ele deixa de aparecer como pendente (fica aposentado no histórico).</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="rounded-lg bg-red-700 px-3 py-1.5 font-semibold text-white" onClick={onDiscard}>Descartar</button>
            <button type="button" className="rounded-lg border border-border px-3 py-1.5 font-semibold" onClick={() => setConfirmDiscard(false)}>Cancelar</button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[1fr_16rem]">
        <label className="block space-y-1 text-xs font-semibold">
          Título da versão
          <input className={inputClass} value={title} onChange={(event) => { setTitle(event.target.value); touch(); }} />
        </label>
        <label className="block space-y-1 text-xs font-semibold">
          Vigência (início)
          <input type="datetime-local" className={inputClass} value={effectiveFrom} onChange={(event) => { setEffectiveFrom(event.target.value); touch(); }} />
        </label>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border" role="tablist">
        {([["conteudo", `Capítulos (${chapters.length})`], ["regras", `Principais regras (${summaryRules.split(/\r?\n/).filter((l) => l.trim()).length})`], ["declaracoes", `Declarações (${declarations.split(/\r?\n/).filter((l) => l.trim()).length})`], ["perguntas", `Perguntas (${questions.length})`]] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`-mb-px border-b-2 px-3 py-2 text-xs font-semibold ${tab === key ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "conteudo" ? (
        <div className="grid gap-3 md:grid-cols-[18rem_1fr]">
          <div className="min-h-0 rounded-lg border border-border bg-muted/30 p-2">
            <div className="flex items-center justify-between px-1 pb-1">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Capítulos</p>
              <button type="button" className={smallButton} onClick={() => { setChapters((current) => [...current, emptyPolicyChapter(`Novo capítulo ${current.length + 1}`)]); setSelected(chapters.length); touch(); }}>+ capítulo</button>
            </div>
            <ol className="max-h-[28rem] space-y-0.5 overflow-auto">
              {chapters.map((item, index) => (
                <li key={`${item.id}-${index}`}>
                  <button type="button" className={`w-full rounded-md px-2 py-1.5 text-left text-xs ${index === selected ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`} onClick={() => setSelected(index)}>
                    {index + 1}. {item.title || "(sem título)"}
                  </button>
                </li>
              ))}
            </ol>
          </div>
          {chapter ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="block flex-1 space-y-1 text-xs font-semibold">
                  Título do capítulo
                  <input className={inputClass} value={chapter.title} onChange={(event) => updateChapter(selected, (item) => ({ ...item, title: event.target.value }))} />
                </label>
                <div className="flex gap-1">
                  <button type="button" className={smallButton} disabled={selected === 0} onClick={() => moveChapter(selected, -1)}>↑</button>
                  <button type="button" className={smallButton} disabled={selected >= chapters.length - 1} onClick={() => moveChapter(selected, 1)}>↓</button>
                  <button type="button" className={`${smallButton} text-red-800`} disabled={chapters.length <= 1} onClick={() => { setChapters((current) => current.filter((_, i) => i !== selected)); setSelected((current) => Math.max(0, current - 1)); touch(); }}>Remover capítulo</button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">Identificador: <code>{slugifyPolicyTitle(chapter.title) || chapter.id}</code> (usado pelas perguntas para "revisar o capítulo").</p>
              <ol className="space-y-2">
                {chapter.blocks.map((block, blockIndex) => (
                  <li key={blockIndex} className="rounded-lg border border-border p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                        value={block.type}
                        onChange={(event) => updateBlock(blockIndex, (current) => textToBlock(event.target.value as PolicyBlock["type"], blockToText(current)))}
                      >
                        {(Object.keys(POLICY_BLOCK_TYPE_LABELS) as PolicyBlock["type"][]).map((type) => (
                          <option key={type} value={type}>{POLICY_BLOCK_TYPE_LABELS[type]}</option>
                        ))}
                      </select>
                      <span className="text-[11px] text-muted-foreground">
                        {block.type === "table" ? "uma linha por linha, células separadas por |" : block.type === "term" ? "Termo :: Definição" : ""}
                      </span>
                      <div className="ml-auto flex gap-1">
                        <button type="button" className={smallButton} disabled={blockIndex === 0} onClick={() => moveBlock(blockIndex, -1)}>↑</button>
                        <button type="button" className={smallButton} disabled={blockIndex >= chapter.blocks.length - 1} onClick={() => moveBlock(blockIndex, 1)}>↓</button>
                        <button type="button" className={smallButton} onClick={() => updateChapter(selected, (item) => ({ ...item, blocks: [...item.blocks.slice(0, blockIndex + 1), { type: "paragraph", text: "" }, ...item.blocks.slice(blockIndex + 1)] }))}>+ abaixo</button>
                        <button type="button" className={`${smallButton} text-red-800`} onClick={() => updateChapter(selected, (item) => ({ ...item, blocks: item.blocks.filter((_, i) => i !== blockIndex) }))}>Remover</button>
                      </div>
                    </div>
                    <textarea
                      className={`${inputClass} mt-2 font-normal`}
                      rows={block.type === "table" ? 5 : block.type === "heading" ? 1 : 3}
                      value={blockToText(block)}
                      onChange={(event) => updateBlock(blockIndex, () => textToBlock(block.type, event.target.value))}
                    />
                  </li>
                ))}
              </ol>
              {chapter.blocks.length === 0 ? (
                <button type="button" className={smallButton} onClick={() => updateChapter(selected, (item) => ({ ...item, blocks: [{ type: "paragraph", text: "" }] }))}>+ bloco</button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "regras" ? (
        <label className="block space-y-1 text-xs font-semibold">
          Principais regras — resumo apresentado na Etapa 2 (uma por linha)
          <textarea className={inputClass} rows={8} value={summaryRules} onChange={(event) => { setSummaryRules(event.target.value); touch(); }} />
        </label>
      ) : null}

      {tab === "declaracoes" ? (
        <label className="block space-y-1 text-xs font-semibold">
          Declarações que o vendedor precisa aceitar (uma por linha, sem repetição, sem cláusula de renúncia)
          <textarea className={inputClass} rows={10} value={declarations} onChange={(event) => { setDeclarations(event.target.value); touch(); }} />
        </label>
      ) : null}

      {tab === "perguntas" ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Teste de compreensão: o vendedor precisa acertar 100%. Cada pergunta aponta para o capítulo que ele deve reler ao errar.</p>
          {questions.map((question, qIndex) => (
            <div key={question.id} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold">Pergunta {qIndex + 1} <code className="font-normal text-muted-foreground">({question.id})</code></p>
                <button type="button" className={`${smallButton} text-red-800`} disabled={questions.length <= 1} onClick={() => { setQuestions((current) => current.filter((_, i) => i !== qIndex)); touch(); }}>Remover</button>
              </div>
              <input className={inputClass} placeholder="Enunciado" value={question.prompt} onChange={(event) => { setQuestions((current) => current.map((item, i) => (i === qIndex ? { ...item, prompt: event.target.value } : item))); touch(); }} />
              <div className="space-y-1">
                {question.options.map((option, oIndex) => (
                  <div key={option.id} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`correct-${question.id}`}
                      checked={question.correctOptionId === option.id}
                      onChange={() => { setQuestions((current) => current.map((item, i) => (i === qIndex ? { ...item, correctOptionId: option.id } : item))); touch(); }}
                      title="Alternativa correta"
                    />
                    <input className={inputClass} placeholder={`Alternativa ${option.id}`} value={option.text} onChange={(event) => { setQuestions((current) => current.map((item, i) => (i === qIndex ? { ...item, options: item.options.map((o, j) => (j === oIndex ? { ...o, text: event.target.value } : o)) } : item))); touch(); }} />
                    <button type="button" className={`${smallButton} text-red-800`} disabled={question.options.length <= 2} onClick={() => { setQuestions((current) => current.map((item, i) => (i === qIndex ? { ...item, options: item.options.filter((_, j) => j !== oIndex) } : item))); touch(); }}>×</button>
                  </div>
                ))}
                <button type="button" className={smallButton} onClick={() => { setQuestions((current) => current.map((item, i) => (i === qIndex ? { ...item, options: [...item.options, { id: String.fromCharCode(97 + item.options.length), text: "" }] } : item))); touch(); }}>+ alternativa</button>
              </div>
              <input className={inputClass} placeholder="Explicação mostrada ao errar" value={question.explanation} onChange={(event) => { setQuestions((current) => current.map((item, i) => (i === qIndex ? { ...item, explanation: event.target.value } : item))); touch(); }} />
              <label className="block space-y-1 text-xs font-semibold">
                Capítulo a reler ao errar
                <select className={inputClass} value={question.reviewChapterId ?? ""} onChange={(event) => { setQuestions((current) => current.map((item, i) => (i === qIndex ? { ...item, reviewChapterId: event.target.value || undefined } : item))); touch(); }}>
                  <option value="">— nenhum —</option>
                  {chapterIds.map((item) => (
                    <option key={item.id} value={slugifyPolicyTitle(item.title) || item.id}>{item.title}</option>
                  ))}
                </select>
              </label>
            </div>
          ))}
          <button type="button" className={smallButton} onClick={() => { setQuestions((current) => [...current, { id: `q${current.length + 1}-${Date.now().toString(36)}`, prompt: "", options: [{ id: "a", text: "" }, { id: "b", text: "" }], correctOptionId: "a", explanation: "" }]); touch(); }}>+ pergunta</button>
        </div>
      ) : null}
    </section>
  );
};
