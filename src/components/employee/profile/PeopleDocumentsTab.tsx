import React, { useState } from "react";
import { formatProfileDate, ProfileSection, ProfileState } from "./profileUi";
import { DocumentsManageForm } from "./PeopleProfileManageForms";
import { downloadEmployeeDocument } from "./profileClient";

export function PeopleDocumentsTab({
  items,
  loading,
  error,
  employeeId,
  canManage,
  onSaved,
}: {
  items: Array<{
    id: string;
    displayName: string;
    documentType: string;
    createdAt: string;
    downloadUrl: string;
  }> | null;
  loading: boolean;
  error: string | null;
  employeeId?: string;
  canManage?: boolean;
  onSaved?: () => void;
}) {
  const [downloadError, setDownloadError] = useState<string | null>(null);
  if (loading) return <ProfileState kind="loading" message="Carregando documentos…" />;
  if (error) return <ProfileState kind="error" message={error} />;
  return (
    <div>
      {!items || items.length === 0 ? (
        <ProfileState kind="empty" message="Nenhum documento anexado." />
      ) : (
        <ProfileSection title="Documentos">
          <ul className="space-y-2">
            {items.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-3 text-sm border-b border-border/70 py-2">
                <div>
                  <p className="font-medium">{doc.displayName}</p>
                  <p className="text-muted-foreground">
                    {doc.documentType} · {formatProfileDate(doc.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  className="text-sm underline underline-offset-2"
                  onClick={() => {
                    setDownloadError(null);
                    void downloadEmployeeDocument(doc.downloadUrl, doc.displayName).catch((err) => {
                      setDownloadError(err instanceof Error ? err.message : "Falha no download.");
                    });
                  }}
                >
                  Baixar
                </button>
              </li>
            ))}
          </ul>
          {downloadError ? <p className="text-sm text-destructive mt-2">{downloadError}</p> : null}
        </ProfileSection>
      )}
      {canManage && employeeId && onSaved ? (
        <DocumentsManageForm employeeId={employeeId} onSaved={onSaved} />
      ) : null}
    </div>
  );
}
