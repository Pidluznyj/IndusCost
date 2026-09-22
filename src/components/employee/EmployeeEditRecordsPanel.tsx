import React, { useCallback, useEffect, useState } from "react";
import type {
  PeopleProfileCapabilities,
  PeopleProfileSummaryDto,
} from "@/src/lib/peopleProfileTypes";
import { ProfileHttpError, profileFetchJson } from "./profile/profileClient";
import { ProfileState, formatPercent, formatProfileDate } from "./profile/profileUi";
import { PeopleCareerTab } from "./profile/PeopleCareerTab";
import { PeopleCompensationTab } from "./profile/PeopleCompensationTab";
import { PeopleBenefitsTab } from "./profile/PeopleBenefitsTab";
import { PeopleAbsencesTab } from "./profile/PeopleAbsencesTab";
import { PeopleDocumentsTab } from "./profile/PeopleDocumentsTab";
import { PeopleEmergencyTab } from "./profile/PeopleEmergencyTab";
import { PeopleEpiTab } from "./profile/PeopleEpiTab";
import { PeopleNotesTab } from "./profile/PeopleNotesTab";

/**
 * Registros da ficha (carreira, reajustes, benefícios…) dentro do "Editar colaborador".
 * Fica FORA do <form> do cadastro: cada registro tem seu próprio formulário e é gravado na hora,
 * pelas mesmas rotas e capacidades da ficha funcional.
 */
export type EmployeeEditRecordsTabId =
  | "career"
  | "compensation"
  | "benefits"
  | "absences"
  | "documents"
  | "emergency"
  | "epi"
  | "notes";

type CapabilityFlag = Exclude<keyof PeopleProfileCapabilities, "accessScope">;

const RECORDS_TAB_CONFIG: Record<
  EmployeeEditRecordsTabId,
  { path: string; view: CapabilityFlag; manage: CapabilityFlag }
> = {
  career: { path: "career", view: "canViewCareer", manage: "canManageCareer" },
  compensation: {
    path: "compensation",
    view: "canViewCompensationEvents",
    manage: "canManageCompensation",
  },
  benefits: { path: "benefits", view: "canViewBenefits", manage: "canManageBenefits" },
  absences: { path: "absences", view: "canViewAbsences", manage: "canManageAbsences" },
  documents: { path: "documents", view: "canViewDocuments", manage: "canManageDocuments" },
  emergency: { path: "emergency", view: "canViewEmergency", manage: "canManageEmergency" },
  epi: { path: "epi", view: "canViewEpi", manage: "canManageEpi" },
  notes: { path: "notes", view: "canViewNotes", manage: "canManageNotes" },
};

/** `key` diz a que colaborador/guia o erro pertence — erro de outra guia nunca aparece nesta. */
type LoadError = { key: string; message: string; status: number | null };

function toLoadError(key: string, err: unknown, fallback: string): LoadError {
  return {
    key,
    message: err instanceof Error ? err.message : fallback,
    status: err instanceof ProfileHttpError ? err.status : null,
  };
}

function itemsOf(body: unknown): never[] | null {
  return body && typeof body === "object" && "items" in (body as object)
    ? ((body as { items: never[] }).items ?? [])
    : null;
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex w-fit items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
    >
      Tentar novamente
    </button>
  );
}

function RecordsKpi({
  label,
  date,
  accent,
  detail,
  since,
  hint,
}: {
  label: string;
  date: string | null;
  accent?: string | null;
  detail?: string | null;
  since?: string | null;
  hint: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-[10px] border border-border bg-overlay-surface-muted px-4 py-3">
      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </span>
      <span className="text-[15px] font-semibold text-foreground">
        {formatProfileDate(date)}
        {accent ? <span className="ml-1.5 text-xs font-bold text-emerald-700">{accent}</span> : null}
      </span>
      {detail || since ? (
        <span className="text-[11px] text-muted-foreground">
          {[detail, since ? `há ${since}` : null].filter(Boolean).join(" · ")}
        </span>
      ) : null}
      <span className="text-[11px] text-muted-foreground">{hint}</span>
    </div>
  );
}

export function EmployeeEditRecordsPanel({
  employeeId,
  tab,
  onChanged,
}: {
  employeeId: string;
  tab: EmployeeEditRecordsTabId;
  onChanged?: () => void;
}) {
  const [summary, setSummary] = useState<{ employeeId: string; dto: PeopleProfileSummaryDto } | null>(
    null
  );
  const [summaryError, setSummaryError] = useState<LoadError | null>(null);
  const [tabData, setTabData] = useState<{ key: string; body: unknown } | null>(null);
  const [tabError, setTabError] = useState<LoadError | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const config = RECORDS_TAB_CONFIG[tab];
  const dataKey = `${employeeId}:${tab}`;

  // Resumo: capacidades do usuário + indicadores (última promoção / último reajuste).
  useEffect(() => {
    const ac = new AbortController();
    profileFetchJson(`/api/employees/${employeeId}/profile`, { signal: ac.signal })
      .then((body) => {
        if (ac.signal.aborted) return;
        setSummary({ employeeId, dto: body as PeopleProfileSummaryDto });
        setSummaryError(null);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setSummaryError(
          toLoadError(employeeId, err, "Não foi possível carregar os registros do colaborador.")
        );
      });
    return () => ac.abort();
  }, [employeeId, reloadToken]);

  // Registros da guia; no recarregamento após gravar, a lista atual fica na tela até a nova chegar.
  useEffect(() => {
    const ac = new AbortController();
    const requestedKey = `${employeeId}:${tab}`;
    profileFetchJson(`/api/employees/${employeeId}/${RECORDS_TAB_CONFIG[tab].path}`, {
      signal: ac.signal,
    })
      .then((body) => {
        if (ac.signal.aborted) return;
        setTabData({ key: requestedKey, body });
        setTabError(null);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setTabError(toLoadError(requestedKey, err, "Erro ao carregar os registros."));
      });
    return () => ac.abort();
  }, [employeeId, tab, reloadToken]);

  const handleSaved = useCallback(() => {
    setReloadToken((token) => token + 1);
    onChanged?.();
  }, [onChanged]);

  // Falha de rede/servidor: limpa os erros e refaz as duas cargas (resumo + guia).
  const retry = useCallback(() => {
    setSummaryError(null);
    setTabError(null);
    setReloadToken((token) => token + 1);
  }, []);

  const currentSummary = summary && summary.employeeId === employeeId ? summary.dto : null;
  const hasData = tabData != null && tabData.key === dataKey;
  const body = hasData ? tabData.body : null;
  const currentSummaryError =
    summaryError && summaryError.key === employeeId ? summaryError : null;
  const currentTabError = tabError && tabError.key === dataKey ? tabError : null;

  if (!currentSummary) {
    if (currentSummaryError) {
      return (
        <div className="flex flex-col gap-3">
          <ProfileState
            kind={currentSummaryError.status === 403 ? "forbidden" : "error"}
            message={currentSummaryError.message}
          />
          {currentSummaryError.status !== 403 ? <RetryButton onClick={retry} /> : null}
        </div>
      );
    }
    return <ProfileState kind="loading" message="Carregando registros…" />;
  }

  const caps = currentSummary.capabilities;
  if (!caps[config.view] || currentTabError?.status === 403) {
    return (
      <ProfileState
        kind="forbidden"
        message={currentTabError?.status === 403 ? currentTabError.message : "🔒 Informação restrita"}
      />
    );
  }

  const canManage = Boolean(caps[config.manage]);
  const canViewValues = Boolean(caps.canViewCompensationValues);
  // Sem lista e sem erro desta guia = ainda carregando (vale também no render da troca de guia).
  const loading = !hasData && !currentTabError;
  // Falha ao recarregar com a lista já na tela: mantém a lista e avisa acima dela.
  const blockingError = currentTabError && !hasData ? currentTabError.message : null;
  const reloadError = currentTabError && hasData ? currentTabError.message : null;
  const { kpis } = currentSummary;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        {canManage
          ? "Estes registros são gravados na hora, de forma independente do botão “Salvar alterações”."
          : "Seu perfil permite apenas consultar estes registros."}
      </p>

      {tab === "career" ? (
        <RecordsKpi
          label="Última promoção"
          date={kpis.lastPromotionDate}
          detail={kpis.lastPromotionLabel}
          since={kpis.timeSinceLastPromotionLabel}
          hint="Vem do registro de promoção mais recente. Para cadastrar uma promoção que já aconteceu, registre a movimentação abaixo marcando “Registro histórico”."
        />
      ) : null}
      {tab === "compensation" ? (
        <RecordsKpi
          label="Último reajuste"
          date={kpis.lastAdjustmentDate}
          accent={
            kpis.lastAdjustmentPercentage != null ? formatPercent(kpis.lastAdjustmentPercentage) : null
          }
          detail={kpis.lastAdjustmentTypeLabel}
          since={kpis.timeSinceLastAdjustmentLabel}
          hint="Vem do reajuste com a vigência mais recente. Para cadastrar um reajuste que já aconteceu, registre-o abaixo marcando “Registro histórico”; para corrigir, use Editar no registro."
        />
      ) : null}

      {reloadError ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-destructive">
            {reloadError}
          </p>
          <RetryButton onClick={retry} />
        </div>
      ) : null}
      {blockingError ? <RetryButton onClick={retry} /> : null}

      <div key={dataKey}>
        {tab === "career" ? (
          <PeopleCareerTab
            items={itemsOf(body)}
            loading={loading}
            error={blockingError}
            employeeId={employeeId}
            canManage={canManage}
            onSaved={handleSaved}
          />
        ) : null}
        {tab === "compensation" ? (
          <PeopleCompensationTab
            data={(body as { currentSalary?: number | null; items?: never[] }) ?? null}
            loading={loading}
            error={blockingError}
            canViewValues={canViewValues}
            employeeId={employeeId}
            canManage={canManage}
            onSaved={handleSaved}
          />
        ) : null}
        {tab === "benefits" ? (
          <PeopleBenefitsTab
            items={itemsOf(body)}
            loading={loading}
            error={blockingError}
            canViewValues={canViewValues}
            employeeId={employeeId}
            canManage={canManage}
            onSaved={handleSaved}
          />
        ) : null}
        {tab === "absences" ? (
          <PeopleAbsencesTab
            items={itemsOf(body)}
            loading={loading}
            error={blockingError}
            employeeId={employeeId}
            canManage={canManage}
            onSaved={handleSaved}
          />
        ) : null}
        {tab === "documents" ? (
          <PeopleDocumentsTab
            items={itemsOf(body)}
            loading={loading}
            error={blockingError}
            employeeId={employeeId}
            canManage={canManage}
            onSaved={handleSaved}
          />
        ) : null}
        {tab === "emergency" ? (
          <PeopleEmergencyTab
            data={(body as { redacted?: boolean; contacts?: never[] }) ?? null}
            loading={loading}
            error={blockingError}
            employeeId={employeeId}
            canManage={canManage}
            onSaved={handleSaved}
            hidePrimary
          />
        ) : null}
        {tab === "epi" ? (
          <PeopleEpiTab
            data={(body as { sizes?: Record<string, string | null>; deliveries?: never[] }) ?? null}
            loading={loading}
            error={blockingError}
            employeeId={employeeId}
            canManage={canManage}
            onSaved={handleSaved}
            hideSizes
          />
        ) : null}
        {tab === "notes" ? (
          <PeopleNotesTab
            data={(body as { notes?: never[] }) ?? null}
            loading={loading}
            error={blockingError}
            employeeId={employeeId}
            canManage={canManage}
            canRestricted={Boolean(caps.canViewRestrictedNotes)}
            onSaved={handleSaved}
            hideLegacy
          />
        ) : null}
      </div>
    </div>
  );
}
