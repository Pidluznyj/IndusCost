import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchJsonOk } from "@/src/lib/http";
import {
  PROJECT_DOCUMENT_TYPE_META,
  type ProjectDocumentEnvelope,
  type ProjectDocumentType,
} from "@/src/lib/projectsDocumentHeader";

export type ProjectIssuedDocumentSummary = {
  id: string;
  documentType: ProjectDocumentType;
  documentTitle: string;
  documentNumber: string;
  revision: number;
  versionNumber: number | null;
  valueSource: string;
  pricingSavedAt: string | null;
  pricingStale: boolean;
  issuedAt: string;
  issuedByName: string;
  payloadSha256: string;
};

/** Parâmetro de URL que abre uma emissão específica (revisões anteriores ficam acessíveis). */
export const PROJECT_DOCUMENT_ISSUED_PARAM = "emissao";

export type ProjectDocumentState<T> = {
  envelope: ProjectDocumentEnvelope<T> | null;
  issued: ProjectIssuedDocumentSummary | null;
  integrityVerified: boolean | null;
  revisions: ProjectIssuedDocumentSummary[];
  blockers: string[];
  loading: boolean;
  error: string | null;
  issuing: boolean;
  issueError: string | null;
  issueBlockers: string[];
  issue: () => Promise<void>;
  openRevision: (issuedId: string | null) => void;
  reload: () => Promise<void>;
};

/**
 * Prévia (montada no servidor com a precificação salva) ou emissão congelada de um documento.
 * `?emissao=<id>` abre uma emissão; sem o parâmetro, mostra a prévia atual.
 */
export function useProjectDocument<T>(
  projectId: string | undefined,
  type: ProjectDocumentType,
  enabled = true,
): ProjectDocumentState<T> {
  const [searchParams, setSearchParams] = useSearchParams();
  const issuedId = searchParams.get(PROJECT_DOCUMENT_ISSUED_PARAM);
  const slug = PROJECT_DOCUMENT_TYPE_META[type].slug;
  const [envelope, setEnvelope] = useState<ProjectDocumentEnvelope<T> | null>(null);
  const [issued, setIssued] = useState<ProjectIssuedDocumentSummary | null>(null);
  const [integrityVerified, setIntegrityVerified] = useState<boolean | null>(null);
  const [revisions, setRevisions] = useState<ProjectIssuedDocumentSummary[]>([]);
  const [blockers, setBlockers] = useState<string[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issueBlockers, setIssueBlockers] = useState<string[]>([]);

  const reload = useCallback(async () => {
    if (!projectId || !enabled) return;
    setLoading(true);
    setError(null);
    try {
      const list = await fetchJsonOk<{ rows: ProjectIssuedDocumentSummary[] }>(
        `/api/projects/${projectId}/documents/issued?type=${slug}`,
      );
      setRevisions(list.rows);
      if (issuedId) {
        const doc = await fetchJsonOk<{
          issued: ProjectIssuedDocumentSummary;
          envelope: ProjectDocumentEnvelope<T>;
          integrity: { sha256: string; verified: boolean };
        }>(`/api/projects/${projectId}/documents/issued/${issuedId}`);
        setEnvelope(doc.envelope);
        setIssued(doc.issued);
        setIntegrityVerified(doc.integrity.verified);
        setBlockers([]);
      } else {
        const preview = await fetchJsonOk<{ envelope: ProjectDocumentEnvelope<T>; blockers: string[] }>(
          `/api/projects/${projectId}/documents/${slug}/preview`,
        );
        setEnvelope(preview.envelope);
        setIssued(null);
        setIntegrityVerified(null);
        setBlockers(preview.blockers);
      }
    } catch (e) {
      setEnvelope(null);
      setError(e instanceof Error ? e.message : "Não foi possível carregar o documento.");
    } finally {
      setLoading(false);
    }
  }, [enabled, issuedId, projectId, slug]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openRevision = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (id) next.set(PROJECT_DOCUMENT_ISSUED_PARAM, id);
      else next.delete(PROJECT_DOCUMENT_ISSUED_PARAM);
      setSearchParams(next, { replace: false });
    },
    [searchParams, setSearchParams],
  );

  const issue = useCallback(async () => {
    if (!projectId) return;
    setIssuing(true);
    setIssueError(null);
    setIssueBlockers([]);
    try {
      const res = await fetch(`/api/projects/${projectId}/documents/${slug}/issue`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        blockers?: string[];
        issued?: ProjectIssuedDocumentSummary;
      };
      if (!res.ok || !body.issued) {
        setIssueError(body.error ?? "Não foi possível emitir o documento.");
        setIssueBlockers(body.blockers ?? []);
        return;
      }
      openRevision(body.issued.id);
    } catch {
      setIssueError("Não foi possível emitir o documento.");
    } finally {
      setIssuing(false);
    }
  }, [openRevision, projectId, slug]);

  return {
    envelope,
    issued,
    integrityVerified,
    revisions,
    blockers,
    loading,
    error,
    issuing,
    issueError,
    issueBlockers,
    issue,
    openRevision,
    reload,
  };
}
