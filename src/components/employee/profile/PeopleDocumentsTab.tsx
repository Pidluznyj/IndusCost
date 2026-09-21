import React, { useState } from "react";
import {
  formatProfileDate,
  ProfileRecordActions,
  ProfileSection,
  ProfileState,
  useProfileRecordActions,
} from "./profileUi";
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
    issuedAt?: string | null;
    expiresAt?: string | null;
    notes?: string | null;
  }> | null;
  loading: boolean;
  error: string | null;
  employeeId?: string;
  canManage?: boolean;
  onSaved?: () => void;
}) {
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const actions = useProfileRecordActions(onSaved);
  if (loading) return <ProfileState kind="loading" message="Carregando documentos…" />;
  if (error) return <ProfileState kind="error" message={error} />;
  const manageable = Boolean(canManage && employeeId && onSaved);
  return (
    <div>
      {!items || items.length === 0 ? (
        <ProfileState kind="empty" message="Nenhum documento anexado." />
      ) : (
        <ProfileSection title="Documentos">
          <ul className="space-y-2">
            {items.map((doc) => {
              if (manageable && employeeId && actions.editingId === doc.id) {
                return (
                  <li key={doc.id} className="py-2">
                    <DocumentsManageForm
                      employeeId={employeeId}
                      record={doc}
                      onSaved={actions.finishEdit}
                      onCancel={actions.cancelEdit}
                    />
                  </li>
                );
              }
              return (
                <li key={doc.id} className="flex items-start justify-between gap-3 text-sm border-b border-border/70 py-2">
                  <div className="min-w-0">
                    <p className="font-medium">{doc.displayName}</p>
                    <p className="text-muted-foreground">
                      {doc.documentType} · {formatProfileDate(doc.createdAt)}
                    </p>
                    {doc.issuedAt || doc.expiresAt ? (
                      <p className="text-muted-foreground">
                        {doc.issuedAt ? `Emissão: ${formatProfileDate(doc.issuedAt)}` : ""}
                        {doc.issuedAt && doc.expiresAt ? " · " : ""}
                        {doc.expiresAt ? `Validade: ${formatProfileDate(doc.expiresAt)}` : ""}
                      </p>
                    ) : null}
                    {doc.notes ? (
                      <p className="text-muted-foreground whitespace-pre-wrap">{doc.notes}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <button
                      type="button"
                      className="text-sm underline underline-offset-2"
                      aria-label={`Baixar ${doc.displayName}`}
                      onClick={() => {
                        setDownloadError(null);
                        void downloadEmployeeDocument(doc.downloadUrl, doc.displayName).catch((err) => {
                          setDownloadError(err instanceof Error ? err.message : "Falha no download.");
                        });
                      }}
                    >
                      Baixar
                    </button>
                    {manageable && employeeId ? (
                      <ProfileRecordActions
                        itemLabel={`documento ${doc.displayName}`}
                        onEdit={() => actions.startEdit(doc.id)}
                        onDelete={() =>
                          void actions.remove(
                            doc.id,
                            `/api/employees/${employeeId}/documents/${doc.id}`,
                            `Excluir o documento "${doc.displayName}"? O arquivo anexado também é removido.`
                          )
                        }
                        deleting={actions.deletingId === doc.id}
                        error={actions.errorFor(doc.id)}
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
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
