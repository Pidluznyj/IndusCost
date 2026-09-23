import React from "react";
import { Gift, Lock, Percent, PiggyBank, type LucideIcon } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { HR_EMPLOYEE_BENEFIT_STATUS_LABELS } from "@/src/lib/peopleProfileTypes";
import {
  ProfileRecordActions,
  ProfileState,
  formatProfileDate,
  useProfileRecordActions,
} from "./profileUi";

/**
 * Verba oficial marcada no cadastro (Editar → Referência administrativa). O valor é o do
 * cadastro oficial (PayrollComponent) e vale para todos que têm a verba.
 */
type OfficialBenefitItem = {
  kind: "official";
  id: string;
  name: string;
  typeLabel?: string;
  calculationType?: string;
  isFinancial?: boolean;
  percentage?: number | null;
  amount?: number | null;
};

/** Registro do modelo anterior (HrEmployeeBenefit): só leitura + exclusão. */
type LegacyBenefitItem = {
  kind?: "legacy";
  id: string;
  name: string;
  status: string;
  startDate: string;
  endDate: string | null;
  planName: string | null;
  notes?: string | null;
  amount?: number | null;
  isFinancial?: boolean;
  typeLabel?: string;
};

type BenefitItem = OfficialBenefitItem | LegacyBenefitItem;

function isOfficial(item: BenefitItem): item is OfficialBenefitItem {
  return item.kind === "official";
}

function benefitIcon(typeLabel: string | undefined): LucideIcon {
  if (typeLabel === "Encargo") return Percent;
  if (typeLabel === "Provisão") return PiggyBank;
  return Gift;
}

/** O banco grava ACTIVE/ENDED; o teste por "ativ" cobre registros antigos em português. */
function isActiveStatus(status: string): boolean {
  if (String(status).toUpperCase() === "ACTIVE") return true;
  return /ativ/i.test(status) && !/inativ/i.test(status);
}

function benefitStatusLabel(status: string): string {
  return (HR_EMPLOYEE_BENEFIT_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

function formatBrl(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function RestrictedValue() {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
      <Lock className="h-3.5 w-3.5" aria-hidden />
      Valor restrito ao seu perfil
    </span>
  );
}

function OfficialBenefitCard({
  item,
  canViewValues,
}: {
  item: OfficialBenefitItem;
  canViewValues: boolean;
}) {
  const Icon = benefitIcon(item.typeLabel);
  const isPercentage = item.calculationType === "PERCENTAGE" || item.percentage != null;
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-background px-5 py-4 shadow-sm">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-sm font-semibold text-foreground">{item.name}</span>
          {item.typeLabel ? (
            <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {item.typeLabel}
            </span>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">Valor do cadastro oficial</span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {isPercentage ? (
          <span className="text-[15px] font-bold text-foreground">
            {item.percentage != null
              ? `${item.percentage.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
              : "—"}
            <span className="text-[11px] font-medium text-muted-foreground"> do salário</span>
          </span>
        ) : item.amount != null ? (
          <span className="text-[15px] font-bold text-foreground">
            {formatBrl(item.amount)}
            <span className="text-[11px] font-medium text-muted-foreground">/mês</span>
          </span>
        ) : canViewValues ? (
          <span className="text-xs font-semibold text-muted-foreground">Valor não informado</span>
        ) : (
          <RestrictedValue />
        )}
      </div>
    </div>
  );
}

function LegacyBenefitCard({
  item,
  canViewValues,
  actions,
}: {
  item: LegacyBenefitItem;
  canViewValues: boolean;
  actions?: React.ReactNode;
}) {
  const active = isActiveStatus(item.status);
  const Icon = benefitIcon(item.typeLabel);
  const period = item.endDate
    ? `${formatProfileDate(item.startDate)} — ${formatProfileDate(item.endDate)}`
    : `vigente desde ${formatProfileDate(item.startDate)}`;
  return (
    <div className="flex items-center gap-4 rounded-xl border border-dashed border-border bg-overlay-surface-muted px-5 py-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-muted text-muted-foreground">
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-sm font-semibold text-muted-foreground">{item.name}</span>
          {item.typeLabel ? (
            <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {item.typeLabel}
            </span>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">
          {item.planName ? `${item.planName} · ` : ""}
          {period}
        </span>
        {item.notes ? (
          <span className="text-xs text-muted-foreground whitespace-pre-wrap">{item.notes}</span>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {item.isFinancial ? (
          canViewValues && item.amount != null ? (
            <span className="text-[15px] font-bold text-foreground">
              {formatBrl(item.amount)}
              <span className="text-[11px] font-medium text-muted-foreground">/mês</span>
            </span>
          ) : canViewValues ? (
            <span className="text-xs font-semibold text-muted-foreground">Valor não informado</span>
          ) : (
            <RestrictedValue />
          )
        ) : null}
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-[11px] font-semibold",
            active ? "text-emerald-700" : "text-muted-foreground"
          )}
        >
          <span
            className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-emerald-600" : "bg-muted-foreground")}
          />
          {benefitStatusLabel(item.status)}
        </span>
        {actions}
      </div>
    </div>
  );
}

export function PeopleBenefitsTab({
  items,
  loading,
  error,
  canViewValues,
  employeeId,
  canManage,
  onSaved,
}: {
  items: BenefitItem[] | null;
  loading: boolean;
  error: string | null;
  canViewValues: boolean;
  employeeId?: string;
  canManage?: boolean;
  onSaved?: () => void;
}) {
  const recordActions = useProfileRecordActions(onSaved);
  if (loading) return <ProfileState kind="loading" message="Carregando encargos e benefícios…" />;
  if (error) return <ProfileState kind="error" message={error} />;
  const list = items ?? [];
  const official = list.filter(isOfficial);
  const legacy = list.filter((item): item is LegacyBenefitItem => !isOfficial(item));
  const manageable = Boolean(canManage && employeeId && onSaved);

  return (
    <div className="flex max-w-[880px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-lg font-bold text-foreground">Encargos & benefícios</h3>
        <p className="text-[13px] text-muted-foreground">
          {official.length === 0
            ? "Nenhuma verba do cadastro oficial marcada para este colaborador."
            : `${official.length} verba(s) do cadastro oficial`}
        </p>
      </div>

      {official.length > 0 ? (
        <div className="flex flex-col gap-3">
          {official.map((item) => (
            <div key={item.id}>
              <OfficialBenefitCard item={item} canViewValues={canViewValues} />
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-start gap-2.5 rounded-[10px] border border-primary/15 bg-primary/5 px-4 py-3">
        <p className="text-xs leading-relaxed text-secondary-foreground">
          As verbas vêm do cadastro oficial em Administração → Configurações → Estrutura Operacional
          (Encargos e Benefícios) e são marcadas em Editar colaborador → Referência administrativa. O
          valor é o do cadastro e vale para todos que têm a verba: para alterá-lo, edite a verba no
          cadastro oficial. Elas entram só na referência de custo do colaborador (estimativa de RH e
          rateio de HH quando a fábrica usa salários); não alteram custos de produtos.
        </p>
      </div>

      {legacy.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h4 className="text-sm font-bold text-foreground">Registros do modelo anterior</h4>
            <p className="text-xs text-muted-foreground">
              Benefícios lançados por colaborador antes da unificação com o cadastro oficial. Não
              são mais editáveis; marque a verba correspondente no cadastro e exclua o registro antigo.
            </p>
          </div>
          {legacy.map((item) => (
            <div key={item.id}>
              <LegacyBenefitCard
                item={item}
                canViewValues={canViewValues}
                actions={
                  manageable && employeeId ? (
                    <ProfileRecordActions
                      itemLabel={`benefício ${item.name}`}
                      onDelete={() =>
                        void recordActions.remove(
                          item.id,
                          `/api/employees/${employeeId}/benefits/${item.id}`,
                          `Excluir o registro antigo "${item.name}" deste colaborador?`
                        )
                      }
                      deleting={recordActions.deletingId === item.id}
                      error={recordActions.errorFor(item.id)}
                    />
                  ) : null
                }
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
