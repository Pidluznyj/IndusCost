/**
 * Modelos de avaliação: lista, criação, edição do rascunho, publicação, duplicação e
 * inativação. Versão publicada não muda no lugar: o editor fica só leitura e oferece
 * duplicar para nascer a versão seguinte.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Eye, FilePlus2, Lock, Pencil, Send, Archive } from "lucide-react";
import { Overlay, OverlayBody, OverlayFooter, OverlayHeader, OverlayField, OverlayFieldGrid, OverlayInput, OverlaySection, OverlayTextarea, OverlayBadge } from "@/src/components/ui/overlay";
import {
  PILLARS,
  PILLAR_LABELS,
  FREQUENCY_SCALE,
  NOT_OBSERVED_LABEL,
  MODEL_STATUS_LABELS,
  formatCut,
  type PerformanceRules,
  type Pillar,
} from "@/src/lib/hrPerformance/performanceDomain";
import {
  archivePerformanceModel,
  createPerformanceModel,
  duplicatePerformanceModel,
  fetchPerformanceModel,
  fetchPerformanceModels,
  movePerformanceQuestion,
  publishPerformanceModel,
  savePerformanceQuestion,
  updatePerformanceModel,
  type ModelDetail,
  type ModelQuestion,
  type ModelSummary,
} from "@/src/lib/hrPerformance/performanceClient";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, ErrorBanner, InfoBanner, PANEL, PanelState, PERF_EYEBROW, PerformanceModal, TableScroll, dateBr } from "./performanceUi";

type Props = { canManage: boolean; onToast: (message: string) => void; onChanged: () => void };

export function PerformanceModelsTab({ canManage, onToast, onChanged }: Props) {
  const [models, setModels] = useState<ModelSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const payload = await fetchPerformanceModels();
      setModels(payload.models);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar os modelos.");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setError(null);
    try {
      await fn();
      onToast(message);
      await reload();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir.");
    }
  };

  return (
    <section className="space-y-4" data-testid="perf-models-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Cada modelo tem três pilares com quatro perguntas. Textos, escala e cortes são proposta até a validação do RH. Uma versão publicada não muda: para melhorar, duplique.
        </p>
        {canManage ? (
          <button type="button" className={BTN_PRIMARY} onClick={() => setCreating(true)} data-testid="perf-model-new">
            <FilePlus2 className="h-4 w-4" aria-hidden /> Novo modelo
          </button>
        ) : null}
      </div>
      <ErrorBanner message={error} testId="perf-models-error" />
      <div className={PANEL}>
        {models === null ? (
          <PanelState kind="loading" message="Carregando modelos…" />
        ) : models.length === 0 ? (
          <PanelState kind="empty" message="Nenhum modelo ainda. Crie o primeiro rascunho: ele já nasce com as 12 perguntas propostas." />
        ) : (
          <TableScroll>
            <table className="w-full min-w-[760px] text-left text-sm" data-testid="perf-models-table">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-semibold">Modelo</th>
                  <th className="px-2 py-2 font-semibold">Versão</th>
                  <th className="px-2 py-2 font-semibold">Situação</th>
                  <th className="px-2 py-2 font-semibold">Regras</th>
                  <th className="px-2 py-2 font-semibold">Perguntas</th>
                  <th className="px-2 py-2 font-semibold">Ciclos</th>
                  <th className="px-4 py-2 text-right font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {models.map((model) => (
                  <tr key={model.id} data-testid={`perf-model-row-${model.version}-${model.status}`}>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{model.name}</p>
                      {model.description ? <p className="text-xs text-muted-foreground">{model.description}</p> : null}
                    </td>
                    <td className="px-2 py-3 tabular-nums">v{model.version}</td>
                    <td className="px-2 py-3">
                      <OverlayBadge tone={model.status === "PUBLISHED" ? "emerald" : model.status === "DRAFT" ? "amber" : "slate"}>
                        {MODEL_STATUS_LABELS[model.status]}
                        {model.status !== "ARCHIVED" ? " · em validação" : ""}
                      </OverlayBadge>
                      {model.publishedAt ? <p className="mt-1 text-xs text-muted-foreground">desde {dateBr(model.publishedAt)}</p> : null}
                    </td>
                    <td className="px-2 py-3 text-xs text-muted-foreground">{model.ruleSetId}</td>
                    <td className="px-2 py-3 tabular-nums">{model.questionCount}</td>
                    <td className="px-2 py-3 tabular-nums">{model.cycles}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1">
                        <button type="button" className={BTN_GHOST} onClick={() => setEditing(model.id)} data-testid={`perf-model-open-${model.version}`}>
                          {model.status === "DRAFT" && canManage ? <Pencil className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
                          {model.status === "DRAFT" && canManage ? "Editar" : "Ver"}
                        </button>
                        {canManage && model.status !== "DRAFT" ? (
                          <button type="button" className={BTN_GHOST} onClick={() => void run(() => duplicatePerformanceModel(model.id), `Versão v${model.version + 1} criada em rascunho`)}>
                            <Copy className="h-3.5 w-3.5" aria-hidden /> Duplicar
                          </button>
                        ) : null}
                        {canManage && model.status !== "ARCHIVED" && model.cycles === 0 ? (
                          <button
                            type="button"
                            className={BTN_GHOST}
                            onClick={() => {
                              if (!window.confirm(`Inativar ${model.name} v${model.version}? A versão continua consultável.`)) return;
                              void run(() => archivePerformanceModel(model.id), "Versão inativada");
                            }}
                          >
                            <Archive className="h-3.5 w-3.5" aria-hidden /> Inativar
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </div>
      <CreateModelOverlay
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          onToast("Rascunho criado com as 12 perguntas propostas");
          void reload();
          setEditing(id);
        }}
      />
      {editing ? (
        <ModelEditorOverlay
          modelId={editing}
          canManage={canManage}
          onClose={() => {
            setEditing(null);
            void reload();
          }}
          onToast={onToast}
          onChanged={() => {
            void reload();
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}

function CreateModelOverlay({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("Avaliação de desempenho, cultura e potencial");
  const [description, setDescription] = useState("");
  return (
    <PerformanceModal
      open={open}
      title="Novo modelo"
      subtitle="Nasce em rascunho, com as 12 perguntas e as regras propostas. Você edita tudo antes de publicar."
      saveLabel="Criar rascunho"
      footerHint="Nada é publicado agora."
      canSave={name.trim().length >= 3}
      onClose={onClose}
      size="md"
      testId="perf-model-create"
      onSave={async () => {
        const created = await createPerformanceModel({ name, description });
        onCreated(created.modelId);
      }}
    >
      <OverlayField label="Nome do modelo" required>
        {(p) => <OverlayInput {...p} value={name} onChange={(e) => setName(e.target.value)} data-testid="perf-model-create-name" />}
      </OverlayField>
      <OverlayField label="Descrição" description="Opcional. Para quem e quando usar.">
        {(p) => <OverlayTextarea {...p} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />}
      </OverlayField>
    </PerformanceModal>
  );
}

type QuestionDraft = {
  competency: string;
  selfText: string;
  leaderText: string;
  hint: string;
  description: string;
  positiveExample: string;
  negativeExample: string;
  roleExamples: { roleName: string; text: string }[];
};

function draftOf(q: ModelQuestion): QuestionDraft {
  return {
    competency: q.competency,
    selfText: q.selfText,
    leaderText: q.leaderText,
    hint: q.hint ?? "",
    description: q.description ?? "",
    positiveExample: q.positiveExample ?? "",
    negativeExample: q.negativeExample ?? "",
    roleExamples: (q.roleExamples ?? []).map((row) => ({ ...row })),
  };
}

function centsFromText(text: string): number {
  const normalized = text.replace(",", ".").trim();
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) : NaN;
}

function ModelEditorOverlay({
  modelId,
  canManage,
  onClose,
  onToast,
  onChanged,
}: {
  modelId: string;
  canManage: boolean;
  onClose: () => void;
  onToast: (message: string) => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<ModelDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>({});
  const [meta, setMeta] = useState({ name: "", description: "", instructions: "" });
  const [rules, setRules] = useState<Record<string, string | boolean>>({});
  const [preview, setPreview] = useState<"self" | "leader" | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await fetchPerformanceModel(modelId);
      setDetail(next);
      setDrafts(Object.fromEntries(next.questions.map((q) => [q.code, draftOf(q)])));
      setMeta({ name: next.model.name, description: next.model.description ?? "", instructions: next.model.instructions ?? "" });
      const r = next.model.rules;
      setRules({
        ruleSetId: r.ruleSetId,
        minValidAnswers: String(r.minValidAnswers),
        nineBoxLowCut: formatCut(r.nineBoxLowCut),
        nineBoxHighCut: formatCut(r.nineBoxHighCut),
        cultureConsistentCut: formatCut(r.cultureConsistentCut),
        divergenceThreshold: String(r.divergenceThreshold),
        requireExtremeEvidence: r.requireExtremeEvidence,
        evidenceMinChars: String(r.evidenceMinChars),
        minObservationDays: String(r.minObservationDays),
      });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir o modelo.");
    }
  }, [modelId]);

  useEffect(() => {
    void load();
  }, [load]);

  const editable = Boolean(detail && detail.model.status === "DRAFT" && canManage);
  const byPillar = useMemo(() => {
    const grouped: Record<Pillar, ModelQuestion[]> = { TECHNICAL: [], CULTURE: [], POTENTIAL: [] };
    for (const q of [...(detail?.questions ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)) grouped[q.pillar as Pillar]?.push(q);
    return grouped;
  }, [detail]);

  const dirtyCodes = useMemo(() => {
    if (!detail) return [];
    return detail.questions
      .filter((q) => {
        const d = drafts[q.code];
        return d && JSON.stringify(d) !== JSON.stringify(draftOf(q));
      })
      .map((q) => q.code);
  }, [detail, drafts]);

  const metaDirty = Boolean(
    detail && (meta.name !== detail.model.name || meta.description !== (detail.model.description ?? "") || meta.instructions !== (detail.model.instructions ?? ""))
  );

  const rulesPayload = (): PerformanceRules => ({
    ruleSetId: String(rules.ruleSetId ?? "").trim(),
    minValidAnswers: Number(rules.minValidAnswers),
    nineBoxLowCut: centsFromText(String(rules.nineBoxLowCut)),
    nineBoxHighCut: centsFromText(String(rules.nineBoxHighCut)),
    cultureConsistentCut: centsFromText(String(rules.cultureConsistentCut)),
    divergenceThreshold: Number(rules.divergenceThreshold),
    requireExtremeEvidence: Boolean(rules.requireExtremeEvidence),
    evidenceMinChars: Number(rules.evidenceMinChars),
    minObservationDays: Number(rules.minObservationDays),
  });

  // Campo a campo: o banco (JSONB) não preserva a ordem das chaves.
  const rulesDirty = Boolean(
    detail && (Object.keys(rulesPayload()) as (keyof PerformanceRules)[]).some((key) => rulesPayload()[key] !== detail.model.rules[key])
  );

  const saveAll = async () => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      if (metaDirty || rulesDirty) {
        await updatePerformanceModel(modelId, {
          name: meta.name,
          description: meta.description || null,
          instructions: meta.instructions,
          ...(rulesDirty ? { rules: rulesPayload() } : {}),
        });
      }
      for (const code of dirtyCodes) await savePerformanceQuestion(modelId, code, drafts[code]!);
      onToast("Rascunho salvo");
      await load();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar.");
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const move = async (code: string, direction: "up" | "down") => {
    if (dirtyCodes.length > 0 || metaDirty || rulesDirty) {
      setError("Salve as alterações antes de reordenar.");
      return;
    }
    try {
      await movePerformanceQuestion(modelId, code, direction);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível reordenar.");
    }
  };

  const dirty = dirtyCodes.length > 0 || metaDirty || rulesDirty;

  return (
    <Overlay open onClose={onClose} size="xl" ariaLabelledBy="perf-model-editor-title" testId="perf-model-editor">
      <OverlayHeader
        titleId="perf-model-editor-title"
        eyebrow={PERF_EYEBROW}
        title={detail ? `${detail.model.name} · v${detail.model.version}` : "Modelo"}
        subtitle={
          detail
            ? `${MODEL_STATUS_LABELS[detail.model.status]} · ${detail.questions.length} perguntas · regras ${detail.model.rules.ruleSetId}`
            : "Carregando…"
        }
        onClose={onClose}
        actions={
          <div className="flex gap-2">
            <button type="button" className={BTN_SECONDARY} onClick={() => setPreview(preview === "self" ? null : "self")} data-testid="perf-model-preview-self">
              <Eye className="h-4 w-4" aria-hidden /> {preview === "self" ? "Fechar prévia" : "Prévia da pessoa"}
            </button>
            <button type="button" className={BTN_SECONDARY} onClick={() => setPreview(preview === "leader" ? null : "leader")}>
              <Eye className="h-4 w-4" aria-hidden /> {preview === "leader" ? "Fechar prévia" : "Prévia do líder"}
            </button>
          </div>
        }
      />
      <OverlayBody>
        <div className="space-y-5">
          <ErrorBanner message={error} testId="perf-model-editor-error" />
          {!detail ? <PanelState kind="loading" message="Carregando…" /> : null}
          {detail && !editable ? (
            <InfoBanner tone="slate" testId="perf-model-readonly">
              <span className="inline-flex items-center gap-2">
                <Lock className="h-4 w-4" aria-hidden />
                {detail.model.status === "DRAFT"
                  ? "Somente leitura: seu perfil não gerencia modelos."
                  : "Versão publicada ou inativa não muda. Use Duplicar na lista para criar a versão seguinte."}
              </span>
            </InfoBanner>
          ) : null}
          {detail && detail.problems.length > 0 && editable ? (
            <InfoBanner tone="amber" testId="perf-model-problems">
              <p className="font-semibold">Antes de publicar:</p>
              <ul className="list-disc pl-5">
                {detail.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </InfoBanner>
          ) : null}
          {detail && preview ? <ModelPreview detail={detail} drafts={drafts} kind={preview} instructions={meta.instructions} /> : null}
          {detail && !preview ? (
            <>
              <OverlaySection title="Dados do modelo">
                <OverlayFieldGrid columns={2}>
                  <OverlayField label="Nome" required>
                    {(p) => <OverlayInput {...p} disabled={!editable} value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />}
                  </OverlayField>
                  <OverlayField label="Descrição">
                    {(p) => <OverlayInput {...p} disabled={!editable} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />}
                  </OverlayField>
                  <OverlayField label="Orientação antes das perguntas" required colSpan={2} description="Aparece no celular antes da primeira pergunta. Diga o período de referência.">
                    {(p) => <OverlayTextarea {...p} rows={2} disabled={!editable} value={meta.instructions} onChange={(e) => setMeta({ ...meta, instructions: e.target.value })} data-testid="perf-model-instructions" />}
                  </OverlayField>
                </OverlayFieldGrid>
              </OverlaySection>
              <OverlaySection title="Regras de cálculo (proposta)" description="Ficam gravadas com esta versão. O ciclo calcula sempre com as regras do modelo dele.">
                <OverlayFieldGrid columns={4}>
                  <RuleInput label="Identificador" field="ruleSetId" rules={rules} setRules={setRules} disabled={!editable} />
                  <RuleInput label="Mínimo de respostas válidas por pilar (de 4)" field="minValidAnswers" rules={rules} setRules={setRules} disabled={!editable} inputMode="numeric" />
                  <RuleInput label="Corte baixo da Nine-Box (abaixo de)" field="nineBoxLowCut" rules={rules} setRules={setRules} disabled={!editable} inputMode="decimal" />
                  <RuleInput label="Corte alto da Nine-Box (a partir de)" field="nineBoxHighCut" rules={rules} setRules={setRules} disabled={!editable} inputMode="decimal" />
                  <RuleInput label="Cultura consistente a partir de" field="cultureConsistentCut" rules={rules} setRules={setRules} disabled={!editable} inputMode="decimal" />
                  <RuleInput label="Divergência que pede revisão (pontos)" field="divergenceThreshold" rules={rules} setRules={setRules} disabled={!editable} inputMode="numeric" />
                  <RuleInput label="Tamanho mínimo do exemplo (caracteres)" field="evidenceMinChars" rules={rules} setRules={setRules} disabled={!editable} inputMode="numeric" />
                  <RuleInput label="Dias mínimos de observação" field="minObservationDays" rules={rules} setRules={setRules} disabled={!editable} inputMode="numeric" />
                </OverlayFieldGrid>
                <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" disabled={!editable} checked={Boolean(rules.requireExtremeEvidence)} onChange={(e) => setRules({ ...rules, requireExtremeEvidence: e.target.checked })} />
                  O líder escreve um exemplo observado quando dá nota 1 ou 4
                </label>
              </OverlaySection>
              {PILLARS.map((pillar) => (
                <React.Fragment key={pillar}>
                <OverlaySection title={PILLAR_LABELS[pillar]} description="Quatro perguntas. Uma ideia por pergunta, frase curta.">
                  <div className="space-y-3">
                    {byPillar[pillar].map((q, index) => {
                      const d = drafts[q.code] ?? draftOf(q);
                      const setD = (patch: Partial<QuestionDraft>) => setDrafts({ ...drafts, [q.code]: { ...d, ...patch } });
                      const changed = dirtyCodes.includes(q.code);
                      return (
                        <div key={q.code} className="rounded-lg border border-border p-3" data-testid={`perf-question-${q.code}`}>
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                              {q.code}
                              {changed ? <OverlayBadge tone="amber">alterada</OverlayBadge> : null}
                            </span>
                            {editable ? (
                              <span className="flex gap-1">
                                <button type="button" className={BTN_GHOST} disabled={index === 0} onClick={() => void move(q.code, "up")} aria-label={`Subir ${q.code}`}>
                                  <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                                </button>
                                <button type="button" className={BTN_GHOST} disabled={index === byPillar[pillar].length - 1} onClick={() => void move(q.code, "down")} aria-label={`Descer ${q.code}`}>
                                  <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                                </button>
                              </span>
                            ) : null}
                          </div>
                          <OverlayFieldGrid columns={2}>
                            <OverlayField label="Competência" required>
                              {(p) => <OverlayInput {...p} disabled={!editable} value={d.competency} onChange={(e) => setDrafts({ ...drafts, [q.code]: { ...d, competency: e.target.value } })} />}
                            </OverlayField>
                            <OverlayField label="Orientação para o líder" description="Opcional: exemplo do que observar.">
                              {(p) => <OverlayInput {...p} disabled={!editable} value={d.hint} onChange={(e) => setDrafts({ ...drafts, [q.code]: { ...d, hint: e.target.value } })} />}
                            </OverlayField>
                            <OverlayField label="Pergunta para a pessoa (eu…)" required>
                              {(p) => <OverlayTextarea {...p} rows={2} disabled={!editable} value={d.selfText} onChange={(e) => setDrafts({ ...drafts, [q.code]: { ...d, selfText: e.target.value } })} data-testid={`perf-question-${q.code}-self`} />}
                            </OverlayField>
                            <OverlayField label="Mesma pergunta para o líder (ele / ela…)" required>
                              {(p) => <OverlayTextarea {...p} rows={2} disabled={!editable} value={d.leaderText} onChange={(e) => setDrafts({ ...drafts, [q.code]: { ...d, leaderText: e.target.value } })} data-testid={`perf-question-${q.code}-leader`} />}
                            </OverlayField>
                            <OverlayField label="Comportamento observável" colSpan={2} description="O que conta como evidência. Aparece para o líder.">
                              {(p) => <OverlayInput {...p} disabled={!editable} value={d.description} onChange={(e) => setD({ description: e.target.value })} data-testid={`perf-question-${q.code}-description`} />}
                            </OverlayField>
                            <OverlayField label="Exemplo positivo">
                              {(p) => <OverlayInput {...p} disabled={!editable} value={d.positiveExample} onChange={(e) => setD({ positiveExample: e.target.value })} />}
                            </OverlayField>
                            <OverlayField label="Exemplo negativo" description="Ilustra; não é punição automática.">
                              {(p) => <OverlayInput {...p} disabled={!editable} value={d.negativeExample} onChange={(e) => setD({ negativeExample: e.target.value })} />}
                            </OverlayField>
                          </OverlayFieldGrid>
                          <div className="mt-3 space-y-2" data-testid={`perf-question-${q.code}-roles`}>
                            <p className="text-xs font-semibold text-muted-foreground">Exemplos por cargo (opcional; o critério não muda)</p>
                            {d.roleExamples.map((row, rowIndex) => (
                              <div key={rowIndex} className="grid gap-2 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto]">
                                <input
                                  className="h-9 rounded-lg border border-border px-2 text-sm"
                                  aria-label="Cargo"
                                  placeholder="Cargo, como no cadastro"
                                  disabled={!editable}
                                  value={row.roleName}
                                  onChange={(e) => setD({ roleExamples: d.roleExamples.map((r, i) => (i === rowIndex ? { ...r, roleName: e.target.value } : r)) })}
                                  data-testid={`perf-question-${q.code}-role-${rowIndex}`}
                                />
                                <input
                                  className="h-9 rounded-lg border border-border px-2 text-sm"
                                  aria-label="Exemplo para o cargo"
                                  placeholder="Exemplo observável para este cargo"
                                  disabled={!editable}
                                  value={row.text}
                                  onChange={(e) => setD({ roleExamples: d.roleExamples.map((r, i) => (i === rowIndex ? { ...r, text: e.target.value } : r)) })}
                                  data-testid={`perf-question-${q.code}-role-text-${rowIndex}`}
                                />
                                {editable ? (
                                  <button type="button" className={BTN_GHOST} onClick={() => setD({ roleExamples: d.roleExamples.filter((_, i) => i !== rowIndex) })} aria-label="Remover exemplo">
                                    Remover
                                  </button>
                                ) : null}
                              </div>
                            ))}
                            {editable ? (
                              <button type="button" className={BTN_GHOST} onClick={() => setD({ roleExamples: [...d.roleExamples, { roleName: "", text: "" }] })} data-testid={`perf-question-${q.code}-add-role`}>
                                + Exemplo por cargo
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </OverlaySection>
                </React.Fragment>
              ))}
              <OverlaySection title="Versões deste modelo">
                <ul className="divide-y divide-border text-sm">
                  {detail.lineage.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        v{item.version} · {MODEL_STATUS_LABELS[item.status as keyof typeof MODEL_STATUS_LABELS] ?? item.status} · regras {item.ruleSetId}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {item.publishedAt ? `publicada em ${dateBr(item.publishedAt)}` : "não publicada"}
                        {item.archivedAt ? ` · inativa desde ${dateBr(item.archivedAt)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                {detail.usedBy.length > 0 ? <p className="mt-2 text-xs text-muted-foreground">Usada por: {detail.usedBy.map((c) => c.name).join(", ")}</p> : null}
              </OverlaySection>
            </>
          ) : null}
        </div>
      </OverlayBody>
      <OverlayFooter hint={editable ? (dirty ? "Há alterações não salvas." : "Rascunho salvo. Publicar congela esta versão.") : "Somente leitura."}>
        <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={busy}>
          Fechar
        </button>
        {editable ? (
          <>
            <button type="button" className={BTN_SECONDARY} onClick={() => void saveAll()} disabled={busy || !dirty} data-testid="perf-model-save">
              Salvar rascunho
            </button>
            <button
              type="button"
              className={BTN_PRIMARY}
              disabled={busy || dirty || (detail?.problems.length ?? 0) > 0}
              onClick={() => setConfirmPublish(true)}
              data-testid="perf-model-publish"
            >
              <Send className="h-4 w-4" aria-hidden /> Publicar versão
            </button>
          </>
        ) : null}
      </OverlayFooter>
      <PerformanceModal
        open={confirmPublish}
        title="Publicar esta versão?"
        subtitle="Depois de publicada, a versão não muda. Ciclos passam a usar exatamente este texto e estas regras."
        saveLabel="Publicar"
        footerHint="Publicar não homologa a metodologia: ela continua em validação."
        canSave
        size="sm"
        testId="perf-model-publish-confirm"
        onClose={() => setConfirmPublish(false)}
        onSave={async () => {
          await publishPerformanceModel(modelId);
          setConfirmPublish(false);
          onToast("Versão publicada");
          await load();
          onChanged();
        }}
      >
        <p className="text-sm">As 12 perguntas, a escala de frequência e os cortes desta versão ficam congelados.</p>
      </PerformanceModal>
    </Overlay>
  );
}

function RuleInput({
  label,
  field,
  rules,
  setRules,
  disabled,
  inputMode,
}: {
  label: string;
  field: string;
  rules: Record<string, string | boolean>;
  setRules: (next: Record<string, string | boolean>) => void;
  disabled: boolean;
  inputMode?: "numeric" | "decimal";
}) {
  return (
    <OverlayField label={label}>
      {(p) => (
        <OverlayInput
          {...p}
          disabled={disabled}
          inputMode={inputMode}
          value={String(rules[field] ?? "")}
          onChange={(e) => setRules({ ...rules, [field]: e.target.value })}
          data-testid={`perf-rule-${field}`}
        />
      )}
    </OverlayField>
  );
}

function ModelPreview({ detail, drafts, kind, instructions }: { detail: ModelDetail; drafts: Record<string, QuestionDraft>; kind: "self" | "leader"; instructions: string }) {
  const ordered = [...detail.questions].sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <div className="space-y-3" data-testid={`perf-model-preview-${kind}`}>
      <InfoBanner>
        {kind === "self" ? "Assim a pessoa lê no celular, uma pergunta por tela." : "Assim o líder lê no formulário da equipe."} {instructions}
      </InfoBanner>
      <ol className="grid gap-3 md:grid-cols-2">
        {ordered.map((q, index) => (
          <li key={q.code} className="rounded-xl border border-border p-4">
            <p className="text-xs font-semibold text-primary">
              {index + 1} de {ordered.length} · {PILLAR_LABELS[q.pillar as Pillar]}
            </p>
            <p className="mt-1 text-base font-medium">{kind === "self" ? drafts[q.code]?.selfText : drafts[q.code]?.leaderText}</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {FREQUENCY_SCALE.map((s) => (
                <li key={s.score}>○ {s.label}</li>
              ))}
              <li>○ {NOT_OBSERVED_LABEL}</li>
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
