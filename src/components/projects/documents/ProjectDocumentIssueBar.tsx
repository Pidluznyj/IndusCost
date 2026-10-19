import React from "react";
import { BadgeCheck, FileClock, Loader2, ShieldAlert, Stamp } from "lucide-react";
import { formatDocumentDateTime } from "@/src/lib/projectsDocumentHeader";
import type { ProjectDocumentState } from "@/src/components/projects/documents/useProjectDocument";

type Props = {
  state: ProjectDocumentState<unknown>;
  canIssue: boolean;
  /** Ex.: "Salve as quantidades antes de emitir." */
  disabledReason?: string | null;
};

/** Barra de tela (não imprime): prévia × emissão, revisões anteriores e botão Emitir. */
export function ProjectDocumentIssueBar({ state, canIssue, disabledReason }: Props) {
  const { issued, revisions, blockers, issuing, issueError, issueBlockers, integrityVerified } = state;
  const nextRevision = (revisions[0]?.revision ?? 0) + 1;
  const allBlockers = issued ? [] : [...new Set([...blockers, ...issueBlockers])];
  const issueDisabled = issuing || allBlockers.length > 0 || !!disabledReason;
  return (
    <div
      className="no-print project-document-issue-bar mx-auto mb-4 w-full max-w-[1180px] rounded-xl border border-border bg-white px-4 py-3 text-sm print:hidden"
      data-testid="project-document-issue-bar"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {issued ? (
            integrityVerified === false ? (
              <ShieldAlert className="h-5 w-5 text-red-600" />
            ) : (
              <BadgeCheck className="h-5 w-5 text-emerald-600" />
            )
          ) : (
            <FileClock className="h-5 w-5 text-amber-600" />
          )}
          <div>
            {issued ? (
              <>
                <p className="font-semibold">
                  {issued.documentNumber} · revisão {issued.revision}
                </p>
                <p className="text-xs text-muted-foreground">
                  Emitido em {formatDocumentDateTime(issued.issuedAt)} por {issued.issuedByName}
                  {integrityVerified === false
                    ? " · ATENÇÃO: conteúdo não confere com o hash gravado"
                    : " · conteúdo íntegro (hash conferido)"}
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold">Prévia — ainda não emitida</p>
                <p className="text-xs text-muted-foreground">
                  Valores da precificação salva. A emissão congela este conteúdo como revisão {nextRevision}.
                </p>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {revisions.length > 0 ? (
            <select
              aria-label="Revisões emitidas"
              className="rounded-lg border border-border bg-white px-2 py-1.5 text-sm"
              value={issued?.id ?? ""}
              onChange={(e) => state.openRevision(e.target.value || null)}
              data-testid="project-document-revisions"
            >
              <option value="">Prévia atual</option>
              {revisions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.documentNumber} — {formatDocumentDateTime(r.issuedAt)}
                </option>
              ))}
            </select>
          ) : null}
          {!issued && canIssue ? (
            <button
              type="button"
              onClick={() => void state.issue()}
              disabled={issueDisabled}
              title={disabledReason ?? (allBlockers.length ? "Resolva os impedimentos para emitir." : undefined)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              data-testid="project-document-issue"
            >
              {issuing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stamp className="h-4 w-4" />}
              Emitir revisão {nextRevision}
            </button>
          ) : null}
        </div>
      </div>
      {disabledReason && !issued ? <p className="mt-2 text-xs text-amber-800">{disabledReason}</p> : null}
      {issueError ? <p className="mt-2 text-xs text-red-700">{issueError}</p> : null}
      {allBlockers.length > 0 ? (
        <ul className="mt-2 ml-4 list-disc text-xs text-red-800" data-testid="project-document-blockers">
          {allBlockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
