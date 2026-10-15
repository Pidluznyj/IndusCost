import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download, ExternalLink, Loader2, Stamp } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatDocumentDateTime, type ProjectDocumentType } from "@/src/lib/projectsDocumentHeader";
import { getProjectIntakeFormFullPath, getProjectIntakeFormPath } from "@/src/lib/projectsIntakeForm";
import { PROJECT_CLIENT_REPORT_PATH, PROJECT_EXECUTIVE_REPORT_PATH } from "@/src/lib/projectsNavigation";
import {
  PROJECT_DOCUMENT_ISSUED_PARAM,
  type ProjectIssuedDocumentSummary,
} from "@/src/components/projects/documents/useProjectDocument";
import { downloadIssuedProjectSpreadsheet } from "@/src/components/projects/documents/projectSpreadsheetDownload";

type Props = { projectId: string; canManage: boolean };

function documentPath(projectId: string, type: ProjectDocumentType): string | null {
  switch (type) {
    case "QUICK_FORM":
      return getProjectIntakeFormPath(projectId);
    case "FULL_FORM":
      return getProjectIntakeFormFullPath(projectId);
    case "EXECUTIVE_REPORT":
      return PROJECT_EXECUTIVE_REPORT_PATH(projectId);
    case "CLIENT_PROPOSAL":
      return PROJECT_CLIENT_REPORT_PATH(projectId);
    default:
      return null;
  }
}

/** Histórico de emissões dos cinco documentos (somente leitura; emissões são imutáveis). */
export function ProjectIssuedDocumentsPanel({ projectId, canManage }: Props) {
  const [rows, setRows] = useState<ProjectIssuedDocumentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchJsonOk<{ rows: ProjectIssuedDocumentSummary[] }>(`/api/projects/${projectId}/documents/issued`);
      setRows(res.rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar documentos emitidos.");
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const issueSpreadsheet = async () => {
    setBusy("issue");
    setError(null);
    try {
      const res = await fetchJsonOk<{ issued: ProjectIssuedDocumentSummary }>(
        `/api/projects/${projectId}/documents/planilha/issue`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
      );
      await downloadIssuedProjectSpreadsheet(projectId, res.issued.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao emitir a planilha.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-5" data-testid="project-issued-documents">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h5 className="font-semibold">Documentos emitidos</h5>
          <p className="text-xs text-muted-foreground">
            Cada emissão guarda o conteúdo exato, número, revisão e código de verificação. Revisões novas não alteram as anteriores.
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => void issueSpreadsheet()}
            disabled={busy != null}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            {busy === "issue" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stamp className="h-4 w-4" />}
            Emitir planilha do projeto
          </button>
        ) : null}
      </div>
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      {rows == null ? (
        <p className="mt-3 text-sm text-muted-foreground">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nenhum documento emitido ainda.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3">Documento</th>
                <th className="py-2 pr-3">Número</th>
                <th className="py-2 pr-3">Emissão</th>
                <th className="py-2 pr-3">Valores</th>
                <th className="py-2 pr-3">Verificação</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const path = documentPath(projectId, r.documentType);
                return (
                  <tr key={r.id} className="border-b border-border/60">
                    <td className="py-2 pr-3">{r.documentTitle}</td>
                    <td className="whitespace-nowrap py-2 pr-3 font-medium">{r.documentNumber}</td>
                    <td className="py-2 pr-3 text-xs">
                      {formatDocumentDateTime(r.issuedAt)}
                      <br />
                      <span className="text-muted-foreground">{r.issuedByName}</span>
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {r.valueSource === "SAVED_PRICING"
                        ? `Precificação salva${r.pricingSavedAt ? ` (${formatDocumentDateTime(r.pricingSavedAt)})` : ""}`
                        : "Sem precificação salva"}
                      {r.pricingStale ? <span className="ml-1 text-red-700">· divergente na emissão</span> : null}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{r.payloadSha256.slice(0, 16)}</td>
                    <td className="py-2 text-right">
                      {r.documentType === "SPREADSHEET" ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          onClick={() => void downloadIssuedProjectSpreadsheet(projectId, r.id)}
                        >
                          <Download className="h-3.5 w-3.5" /> Baixar
                        </button>
                      ) : path ? (
                        <Link
                          to={`${path}?${PROJECT_DOCUMENT_ISSUED_PARAM}=${r.id}`}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <ExternalLink className="h-3.5 w-3.5" /> Abrir
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
