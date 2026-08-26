import React from "react";
import { formatProfileDate, ProfileSection, ProfileState } from "./profileUi";

export function PeopleDocumentsTab({
  items,
  loading,
  error,
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
}) {
  if (loading) return <ProfileState kind="loading" message="Carregando documentos…" />;
  if (error) return <ProfileState kind="error" message={error} />;
  if (!items || items.length === 0) {
    return <ProfileState kind="empty" message="Nenhum documento anexado." />;
  }
  return (
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
            <a className="text-sm underline underline-offset-2" href={doc.downloadUrl}>
              Baixar
            </a>
          </li>
        ))}
      </ul>
    </ProfileSection>
  );
}
