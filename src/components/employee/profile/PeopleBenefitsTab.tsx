import React from "react";
import { formatProfileDate, ProfileSection, ProfileState } from "./profileUi";

type BenefitItem = {
  id: string;
  name: string;
  status: string;
  startDate: string;
  endDate: string | null;
  planName: string | null;
  amount?: number | null;
  isFinancial?: boolean;
};

export function PeopleBenefitsTab({
  items,
  loading,
  error,
  canViewValues,
}: {
  items: BenefitItem[] | null;
  loading: boolean;
  error: string | null;
  canViewValues: boolean;
}) {
  if (loading) return <ProfileState kind="loading" message="Carregando benefícios…" />;
  if (error) return <ProfileState kind="error" message={error} />;
  if (!items || items.length === 0) {
    return <ProfileState kind="empty" message="Nenhum benefício registrado para este colaborador." />;
  }
  return (
    <ProfileSection title="Benefícios">
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id} className="text-sm border-b border-border/70 pb-3">
            <p className="font-medium">{item.name}</p>
            <p className="text-muted-foreground">
              {item.status} · {formatProfileDate(item.startDate)}
              {item.endDate ? ` — ${formatProfileDate(item.endDate)}` : ""}
            </p>
            {item.planName ? <p>{item.planName}</p> : null}
            {item.isFinancial ? (
              canViewValues && item.amount != null ? (
                <p>{item.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
              ) : (
                <p className="text-muted-foreground">🔒 Informação restrita</p>
              )
            ) : null}
          </li>
        ))}
      </ul>
    </ProfileSection>
  );
}
