import React from "react";
import { formatProfileDate, ProfileSection, ProfileState } from "./profileUi";

export function PeopleHistoryTab({
  items,
  loading,
  error,
  nextCursor,
  onLoadMore,
  loadingMore,
}: {
  items: Array<{
    id: string;
    eventLabel: string;
    effectiveDate: string;
    createdAt: string;
    summary: string;
  }> | null;
  loading: boolean;
  error: string | null;
  nextCursor?: string | null;
  onLoadMore?: () => void;
  loadingMore?: boolean;
}) {
  if (loading) return <ProfileState kind="loading" message="Carregando histórico…" />;
  if (error) return <ProfileState kind="error" message={error} />;
  if (!items || items.length === 0) {
    return <ProfileState kind="empty" message="Histórico ainda não registrado para este colaborador." />;
  }
  return (
    <ProfileSection title="Linha do tempo">
      <ol className="space-y-4">
        {items.map((item) => (
          <li key={item.id} className="grid grid-cols-[7.5rem_1fr] gap-4 text-sm">
            <div className="text-muted-foreground">{formatProfileDate(item.effectiveDate)}</div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{item.eventLabel}</p>
              <p className="font-medium">{item.summary}</p>
              <p className="text-[11px] text-muted-foreground">
                Registrado em {formatProfileDate(item.createdAt)}
              </p>
            </div>
          </li>
        ))}
      </ol>
      {nextCursor && onLoadMore ? (
        <button
          type="button"
          className="mt-4 text-sm underline underline-offset-2 text-muted-foreground"
          onClick={onLoadMore}
          disabled={loadingMore}
        >
          {loadingMore ? "Carregando…" : "Carregar mais"}
        </button>
      ) : null}
    </ProfileSection>
  );
}
