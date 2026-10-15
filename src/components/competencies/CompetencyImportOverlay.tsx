/**
 * Importação assistida de níveis por planilha: escolher arquivo → prévia (conciliação,
 * conflitos, alterações) → aplicar. Toda regra está no servidor (`competencyImport.ts`);
 * aqui só se exibe a prévia e se coletam as decisões. Cada decisão refaz a prévia.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { OverlayBadge, OverlaySelect } from "@/src/components/ui/overlay";
import {
  COMPETENCY_IMPORT_TEMPLATE_URL,
  applyCompetencyImport,
  previewCompetencyImport,
} from "@/src/lib/competencies/competencyClient";
import { conflictKey, type ImportResolutions, type RowMatchStatus } from "@/src/lib/competencies/competencyImport";
import type { CompetencyImportPreviewDto } from "@/src/lib/competencies/competencyTypes";
import { HttpError } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { CompetencyModalFrame } from "./CompetencyModalFrame";
import { BTN_GHOST, BTN_SECONDARY, LevelChip } from "./competencyUi";

const STATUS_LABEL: Record<RowMatchStatus, string> = {
  MATCHED: "Reconhecido",
  AMBIGUOUS: "Nome repetido — escolha",
  NOT_FOUND: "Não encontrado",
  OUT_OF_SCOPE: "Fora da sua equipe",
  DUPLICATE_ROW: "Linha repetida (ignorada)",
  EMPTY_NAME: "Sem nome",
};

const SHOW_CHANGES = 200;

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Não foi possível processar a planilha.";
}

export function CompetencyImportOverlay({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [resolutions, setResolutions] = useState<ImportResolutions>({ employeeChoices: {}, conflictDecisions: {} });
  const [preview, setPreview] = useState<CompetencyImportPreviewDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setResolutions({ employeeChoices: {}, conflictDecisions: {} });
    setPreview(null);
    setError(null);
  }, [open]);

  // Prévia recalculada a cada arquivo/decisão (só a resposta mais recente vale).
  useEffect(() => {
    if (!file) return;
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    previewCompetencyImport(file, resolutions)
      .then((p) => {
        if (seq.current === mine) setPreview(p);
      })
      .catch((e) => {
        if (seq.current === mine) {
          setPreview(null);
          setError(errorText(e));
        }
      })
      .finally(() => {
        if (seq.current === mine) setLoading(false);
      });
  }, [file, resolutions]);

  const plan = preview?.plan ?? null;
  const compName = useMemo(() => new Map((preview?.competencies ?? []).map((c) => [c.id, c.name])), [preview]);
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of plan?.rows ?? []) if (r.employeeId && r.employeeName) m.set(r.employeeId, r.employeeName);
    return m;
  }, [plan]);
  const pendingRows = (plan?.rows ?? []).filter((r) => r.status === "AMBIGUOUS" || r.status === "NOT_FOUND" || r.status === "EMPTY_NAME" || r.chosen);
  const ignoredRows = (plan?.rows ?? []).filter((r) => r.status === "OUT_OF_SCOPE" || r.status === "DUPLICATE_ROW");
  const conflicts = (plan?.rows ?? []).flatMap((r) =>
    r.status === "MATCHED" && r.employeeId
      ? r.cells.filter((c) => c.kind === "CONFLICT").map((c) => ({ row: r, cell: c, key: conflictKey(r.employeeId!, c.competencyId) }))
      : [],
  );
  const unknownColumns = (plan?.columns ?? []).filter((c) => c.kind === "UNKNOWN" || c.kind === "DUPLICATE");
  const canSave = Boolean(file && plan && !plan.fatal && !loading && plan.changes.length > 0);

  const choose = (rowNumber: number, employeeId: string) =>
    setResolutions((prev) => {
      const employeeChoices = { ...(prev.employeeChoices ?? {}) };
      if (employeeId) employeeChoices[String(rowNumber)] = employeeId;
      else delete employeeChoices[String(rowNumber)];
      return { ...prev, employeeChoices };
    });
  const decide = (keys: string[], decision: "APPLY" | "KEEP") =>
    setResolutions((prev) => {
      const conflictDecisions = { ...(prev.conflictDecisions ?? {}) };
      for (const k of keys) conflictDecisions[k] = decision;
      return { ...prev, conflictDecisions };
    });

  const save = async () => {
    if (!file || !preview) return;
    try {
      const result = await applyCompetencyImport(file, resolutions, preview.fingerprint);
      const parts = [];
      if (result.changed > 0) parts.push(`${result.changed} nível(is) atualizado(s)`);
      if (result.requested > 0) parts.push(`${result.requested} enviado(s) para aprovação`);
      onSaved(parts.length ? `Importação aplicada: ${parts.join(", ")}` : "Nada a alterar");
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) {
        setResolutions((prev) => ({ ...prev })); // refaz a prévia com o estado atual
        throw new Error("Os níveis mudaram desde a prévia. A prévia foi refeita — revise e aplique de novo.");
      }
      throw e;
    }
  };

  return (
    <CompetencyModalFrame
      open={open}
      size="xl"
      testId="competency-import-overlay"
      title="Importar níveis por planilha"
      subtitle="Prévia antes de gravar: nada muda até você aplicar"
      saveLabel="Aplicar importação"
      footerHint={
        plan && !plan.fatal
          ? `${plan.summary.changes} alteração(ões) serão gravadas${plan.summary.pendingRows ? ` · ${plan.summary.pendingRows} linha(s) sem colaborador ficam de fora` : ""}`
          : "Planilha .xlsx com uma linha por colaborador"
      }
      canSave={canSave}
      onSave={save}
      onClose={onClose}
    >
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          data-testid="import-file"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setResolutions({ employeeChoices: {}, conflictDecisions: {} });
            setFile(f);
            e.target.value = "";
          }}
        />
        <button type="button" className={BTN_SECONDARY} onClick={() => inputRef.current?.click()}>
          <FileSpreadsheet className="h-4 w-4" aria-hidden /> {file ? "Trocar planilha" : "Escolher planilha"}
        </button>
        <a className={BTN_GHOST} href={COMPETENCY_IMPORT_TEMPLATE_URL} download data-testid="import-template">
          <Download className="h-3.5 w-3.5" aria-hidden /> Baixar modelo (equipe e níveis atuais)
        </a>
        {file ? <span className="text-sm text-muted-foreground">{file.name}</span> : null}
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Processando" /> : null}
      </div>

      {!file ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Colunas: <strong>Colaborador</strong> (obrigatória), ID (opcional, vem no modelo) e uma coluna por competência.</li>
          <li>Célula em branco não altera nada. Valores: 0 a 4 ou o nome do nível.</li>
          <li>Rebaixar um nível ou mudar um nível vindo de avaliação pede sua confirmação.</li>
          <li>Reimportar o mesmo arquivo não duplica nada.</li>
        </ul>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" data-testid="import-error">
          {error}
        </div>
      ) : null}

      {plan?.fatal ? (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" data-testid="import-fatal">
          {plan.fatal}
        </div>
      ) : null}

      {preview?.alreadyImported ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="import-already">
          Este arquivo já foi aplicado em {new Date(preview.alreadyImported.at).toLocaleString("pt-BR")} (
          {preview.alreadyImported.changedCount} alteração(ões)). Só o que mudou desde então será gravado.
        </div>
      ) : null}

      {plan && !plan.fatal ? (
        <>
          <div className="flex flex-wrap gap-2" data-testid="import-summary">
            <OverlayBadge tone="slate">{plan.summary.rows} linha(s)</OverlayBadge>
            <OverlayBadge tone="emerald">{plan.summary.matchedRows} reconhecida(s)</OverlayBadge>
            <OverlayBadge tone="primary">{plan.summary.changes} alteração(ões)</OverlayBadge>
            <OverlayBadge tone="slate">{plan.summary.unchanged} sem alteração</OverlayBadge>
            <OverlayBadge tone="slate">{plan.summary.empty} em branco</OverlayBadge>
            {plan.summary.conflicts ? <OverlayBadge tone="amber">{plan.summary.conflicts} conflito(s)</OverlayBadge> : null}
            {plan.summary.invalid ? <OverlayBadge tone="rose">{plan.summary.invalid} célula(s) inválida(s)</OverlayBadge> : null}
            {plan.summary.pendingRows ? <OverlayBadge tone="amber">{plan.summary.pendingRows} sem colaborador</OverlayBadge> : null}
            {preview?.requiresApproval.length ? (
              <OverlayBadge tone="violet" testId="import-requires-approval">
                {preview.requiresApproval.length} irão para aprovação
              </OverlayBadge>
            ) : null}
          </div>

          {unknownColumns.length ? (
            <p className="text-sm text-muted-foreground" data-testid="import-unknown-columns">
              Colunas ignoradas (não são competências do catálogo): {unknownColumns.map((c) => `“${c.header}”`).join(", ")}
            </p>
          ) : null}

          {pendingRows.length ? (
            <section aria-label="Conciliação de colaboradores" data-testid="import-reconcile">
              <h4 className="mb-1.5 text-xs font-semibold">Conciliação de colaboradores</h4>
              <ul className="divide-y divide-border/70 rounded-lg border border-border">
                {pendingRows.map((r) => {
                  const options = r.status === "AMBIGUOUS" || (r.chosen && r.candidates.length) ? r.candidates : preview?.assignable ?? [];
                  return (
                    <li key={r.rowNumber} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span>
                        <span className="text-muted-foreground">Linha {r.rowNumber}:</span> <strong>{r.sheetName || "—"}</strong>{" "}
                        <span className={cn("text-xs", r.status === "MATCHED" ? "text-emerald-700" : "text-amber-700")}>
                          {r.chosen ? "Associado" : STATUS_LABEL[r.status]}
                        </span>
                      </span>
                      <OverlaySelect
                        aria-label={`Colaborador da linha ${r.rowNumber}`}
                        className="max-w-xs"
                        value={resolutions.employeeChoices?.[String(r.rowNumber)] ?? ""}
                        onChange={(e) => choose(r.rowNumber, e.target.value)}
                      >
                        <option value="">Deixar de fora</option>
                        {options.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </OverlaySelect>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {conflicts.length ? (
            <section aria-label="Conflitos" data-testid="import-conflicts">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-semibold">Conflitos — padrão: manter o nível atual</h4>
                <span className="inline-flex gap-1">
                  <button type="button" className={BTN_GHOST} onClick={() => decide(conflicts.map((c) => c.key), "APPLY")}>
                    Aplicar todos
                  </button>
                  <button type="button" className={BTN_GHOST} onClick={() => decide(conflicts.map((c) => c.key), "KEEP")}>
                    Manter todos
                  </button>
                </span>
              </div>
              <ul className="divide-y divide-border/70 rounded-lg border border-border">
                {conflicts.map(({ row, cell, key }) => {
                  const apply = resolutions.conflictDecisions?.[key] === "APPLY";
                  return (
                    <li key={key} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0">
                        <strong>{row.employeeName}</strong> · {compName.get(cell.competencyId)}
                        <span className="block text-xs text-muted-foreground">
                          {cell.conflictReason === "DOWNGRADE" ? "Rebaixa o nível atual" : "O nível atual veio de avaliação formal"}
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <LevelChip level={cell.current} /> → <LevelChip level={cell.value ?? 0} />
                        <label className="ml-2 inline-flex items-center gap-1.5 text-xs">
                          <input type="checkbox" checked={apply} onChange={() => decide([key], apply ? "KEEP" : "APPLY")} />
                          Aplicar
                        </label>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {plan.changes.length ? (
            <section aria-label="Alterações" data-testid="import-changes">
              <h4 className="mb-1.5 text-xs font-semibold">Alterações que serão gravadas</h4>
              <ul className="max-h-64 divide-y divide-border/70 overflow-y-auto rounded-lg border border-border">
                {plan.changes.slice(0, SHOW_CHANGES).map((c) => (
                  <li key={conflictKey(c.employeeId, c.competencyId)} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                    <span>
                      {nameById.get(c.employeeId) ?? "—"} · {compName.get(c.competencyId)}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      {preview?.requiresApproval.includes(conflictKey(c.employeeId, c.competencyId)) ? (
                        <span className="text-[11px] font-semibold text-violet-700">requer aprovação</span>
                      ) : null}
                      <LevelChip level={c.from} /> → <LevelChip level={c.to} />
                    </span>
                  </li>
                ))}
              </ul>
              {plan.changes.length > SHOW_CHANGES ? (
                <p className="mt-1 text-xs text-muted-foreground">+{plan.changes.length - SHOW_CHANGES} alteração(ões) não listadas.</p>
              ) : null}
            </section>
          ) : null}

          {ignoredRows.length ? (
            <p className="text-xs text-muted-foreground" data-testid="import-ignored">
              Ignoradas: {ignoredRows.map((r) => `linha ${r.rowNumber} (${STATUS_LABEL[r.status].toLowerCase()})`).join("; ")}
            </p>
          ) : null}
        </>
      ) : null}
    </CompetencyModalFrame>
  );
}
