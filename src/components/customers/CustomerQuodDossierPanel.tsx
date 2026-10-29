import React, { useCallback, useEffect, useState } from "react";
import { paidConsultationMessage } from "@/src/lib/directData/paidConsultationMessages";
import { fetchJsonOk, HttpError } from "@/src/lib/http";
import { formatCreditDateTime } from "@/src/lib/commercial/commercialCreditIntelligenceView";
import type { IeptbSections } from "@/src/lib/ieptbOnline/parse";
import { generateIdempotencyKey, SecureRandomUnavailableError } from "@/src/lib/quodDossier/idempotencyKey";
import type { QuodSections } from "@/src/lib/quodDossier/parse";
import {
  CreditExternalDimensions,
  CreditIntelligenceSourceCards,
  IeptbOnlineReport,
  PackagePaidConsultationDialog,
} from "./CreditIntelligencePackageSection";
import { QuodDossierReport } from "./QuodDossierSection";
import { QuodDossierPrintReport } from "./QuodDossierPrintReport";
import { LikeSerasaActionButton, LikeSerasaSection, useLikeSerasa } from "./LikeSerasaSection";
import type { BureauSnapshot } from "./CreditScoreDashboard";

type QuoteLine = {
  product: string;
  action: "CACHE" | "QUERY" | "SKIP";
  billedCents: number;
  note: string;
};

type PackagePayload = {
  complete: boolean;
  ieptbEnabled: boolean;
  quote: {
    quod: QuoteLine;
    ieptb: QuoteLine;
    totalCents: number;
    totalLabel: string;
  };
  quod: {
    state: string;
    unitPriceCents: number;
    consultation: {
      id: string;
      score: number | null;
      restrictionCount: number | null;
      confirmedRestriction: boolean;
      consultedAt: string | null;
      validUntil: string | null;
      sections: QuodSections | null;
      partners: Array<{ name: string | null; role: string | null; share: number | null; document: string | null }>;
      companyName: string;
      cnpj: string;
      requestedByUserId: string;
    } | null;
  };
  ieptb: {
    state: string;
    unitPriceCents: number;
    consultation: {
      id: string;
      confirmedProtest: boolean;
      confirmedClear: boolean;
      protestCount: number | null;
      totalAmount: number | null;
      states: string[];
      consultedAt: string | null;
      validUntil: string | null;
      sections: IeptbSections | null;
      companyName: string;
      cnpj: string;
    } | null;
  };
};

export function CustomerQuodDossierPanel({
  customerId,
  companyName,
  cnpj,
  cadastralScore,
  creditLabel,
  isSuperAdmin,
  requestedBy,
  onSnapshot,
}: {
  customerId: string | null;
  companyName: string;
  cnpj: string;
  cadastralScore: string;
  cadastralVerdict?: string | null;
  creditLabel: string;
  isSuperAdmin: boolean;
  requestedBy: string;
  /** Resumo das consultas externas para o painel de crédito (score, limite, protestos). */
  onSnapshot?: (snapshot: BureauSnapshot) => void;
}) {
  const [status, setStatus] = useState<PackagePayload | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [showQuod, setShowQuod] = useState(false);
  const [showIeptb, setShowIeptb] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // LIKE SERASA (Boa Vista via Direct Data): consulta paga irmã, com estado, persistência e cobrança próprios.
  const likeSerasa = useLikeSerasa({ customerId, isSuperAdmin });

  const load = useCallback(async () => {
    if (!customerId) return;
    const payload = await fetchJsonOk<PackagePayload>(`/api/customers/${customerId}/credit-intelligence-package`);
    setStatus(payload);
  }, [customerId]);

  useEffect(() => {
    void load().catch(() => setStatus(null));
  }, [load]);

  const quodState = status?.quod.state ?? "NOT_CONSULTED";
  const ieptbState = status?.ieptb.state ?? "NOT_CONSULTED";
  const quodScore = status?.quod.state === "VALID" ? status.quod.consultation?.score ?? null : null;
  const ieptb = status?.ieptb.consultation ?? null;

  async function confirmPaid() {
    if (!customerId || submitting || !isSuperAdmin) return;
    setMessage(null);
    let idempotencyKey: string;
    try {
      idempotencyKey = generateIdempotencyKey();
    } catch (error) {
      setMessage(
        error instanceof SecureRandomUnavailableError
          ? error.message
          : "Não foi possível gerar a chave de idempotência. A consulta paga foi bloqueada."
      );
      return;
    }
    setSubmitting(true);
    try {
      await fetchJsonOk(`/api/customers/${customerId}/credit-intelligence-package`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true, idempotencyKey, forceRefresh }),
      });
      setConfirming(false);
      setForceRefresh(false);
      setShowQuod(true);
      setShowIeptb(true);
      await load();
    } catch (error) {
      if (error instanceof HttpError) {
        const mapped = error.code ? paidConsultationMessage(error.code) : "";
        const raw = error.message.trim();
        setMessage(
          raw && !/^Erro HTTP \d+/.test(raw) ? raw : mapped || "A análise completa não foi concluída."
        );
      } else {
        setMessage(error instanceof Error ? error.message : "A análise completa não foi concluída.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const ieptbLabel =
    ieptbState === "VALID"
      ? ieptb?.confirmedProtest
        ? "Ocorrência encontrada"
        : ieptb?.confirmedClear
          ? "Sem ocorrência"
          : "Informação indisponível ou incompleta"
      : ieptbState === "NOT_CONSULTED"
        ? "Não consultado"
        : ieptbState;

  const lsStatus = likeSerasa.status;
  useEffect(() => {
    if (!onSnapshot) return;
    const bv = lsStatus?.consultation ?? null;
    onSnapshot({
      boaVista: lsStatus
        ? {
            state: lsStatus.state,
            stateLabel: lsStatus.stateLabel,
            simulated: bv?.mode != null && bv.mode !== "LIVE",
            score: bv?.score ?? null,
            scoreRaw: bv?.scoreRaw ?? null,
            scoreClass: bv?.scoreClass ?? null,
            defaultProbability: bv?.defaultProbability ?? null,
            suggestedLimitCents: bv?.suggestedLimitCents ?? null,
            consultedAt: bv?.consultedAt ?? null,
          }
        : null,
      quod: status ? { state: quodState, score: quodScore, consultedAt: status.quod.consultation?.consultedAt ?? null } : null,
      ieptb: status
        ? { state: ieptbState, label: ieptbLabel, count: ieptb?.protestCount ?? null, totalAmount: ieptb?.totalAmount ?? null, consultedAt: ieptb?.consultedAt ?? null }
        : null,
    });
  }, [onSnapshot, lsStatus, status, quodState, quodScore, ieptbState, ieptbLabel, ieptb]);

  return (
    <div className="space-y-3">
      <CreditExternalDimensions
        creditLabel={creditLabel}
        cadastralScore={cadastralScore}
        quodScore={quodScore == null ? "Não consultado" : String(quodScore)}
        quodState={quodState}
        ieptbLabel={ieptbLabel}
        ieptbState={ieptbState}
        ieptbCount={ieptb?.protestCount ?? null}
      />
      {customerId ? (
        <CreditIntelligenceSourceCards
          quodState={status?.quod.state ?? "NOT_CONSULTED"}
          quodScore={status?.quod.consultation?.score ?? null}
          quodAlerts={status?.quod.consultation?.sections?.score.reasons ?? []}
          quodConsultedAt={status?.quod.consultation?.consultedAt ?? null}
          quodValidUntil={status?.quod.consultation?.validUntil ?? null}
          ieptbState={status?.ieptb.state ?? "NOT_CONSULTED"}
          ieptbConfirmed={ieptb?.confirmedProtest === true}
          ieptbClear={ieptb?.confirmedClear === true}
          ieptbCount={ieptb?.protestCount ?? null}
          ieptbTotal={ieptb?.totalAmount ?? null}
          ieptbStates={ieptb?.states ?? []}
          ieptbConsultedAt={ieptb?.consultedAt ?? null}
          ieptbValidUntil={ieptb?.validUntil ?? null}
          complete={status?.complete === true}
          ieptbEnabled={status?.ieptbEnabled === true}
          canConsult={isSuperAdmin}
          canQuery={isSuperAdmin && (status?.quote.totalCents !== 0 || status?.complete !== true)}
          onViewQuod={() => setShowQuod(true)}
          onViewIeptb={() => setShowIeptb(true)}
          onRequestPackage={() => {
            if (!isSuperAdmin) return;
            setForceRefresh(false);
            setConfirming(true);
          }}
          onForceRefresh={() => {
            if (!isSuperAdmin) return;
            setForceRefresh(true);
            setConfirming(true);
          }}
          extraActions={<LikeSerasaActionButton status={likeSerasa.status} canConsult={isSuperAdmin} onRequest={likeSerasa.openConfirm} />}
        />
      ) : null}
      <LikeSerasaSection
        controller={likeSerasa}
        customerId={customerId}
        companyName={companyName}
        cnpj={cnpj}
        requestedBy={requestedBy}
        isSuperAdmin={isSuperAdmin}
        internalCreditLabel={creditLabel}
      />
      {showQuod && status?.quod.consultation?.sections ? (
        <>
          <QuodDossierReport sections={status.quod.consultation.sections} partners={status.quod.consultation.partners ?? []} />
          <QuodDossierPrintReport
            reportId={status.quod.consultation.id}
            companyName={status.quod.consultation.companyName || companyName}
            cnpj={status.quod.consultation.cnpj || cnpj}
            consultedAt={status.quod.consultation.consultedAt}
            requestedBy={status.quod.consultation.requestedByUserId || requestedBy}
            sections={status.quod.consultation.sections}
          />
        </>
      ) : null}
      {showIeptb && status?.ieptb.consultation?.sections ? (
        <IeptbOnlineReport sections={status.ieptb.consultation.sections} />
      ) : null}
      {showQuod || showIeptb ? (
        <button type="button" className="rounded border px-3 py-1.5 text-xs print:hidden" onClick={() => window.print()}>
          Emitir PDF
        </button>
      ) : null}
      {message ? <p className="text-sm text-red-700">{message}</p> : null}
      {confirming && status && isSuperAdmin ? (
        <PackagePaidConsultationDialog
          companyName={companyName}
          cnpj={cnpj}
          requestedBy={requestedBy}
          requestedAt={formatCreditDateTime(new Date().toISOString())}
          quodLine={
            forceRefresh
              ? { ...status.quote.quod, action: "QUERY", billedCents: status.quod.unitPriceCents, note: "Reconsulta antecipada autorizada. Gera nova cobrança." }
              : status.quote.quod
          }
          ieptbLine={
            forceRefresh
              ? { ...status.quote.ieptb, action: "QUERY", billedCents: status.ieptb.unitPriceCents, note: "Reconsulta antecipada autorizada. Gera nova cobrança." }
              : status.quote.ieptb
          }
          totalLabel={
            forceRefresh
              ? ((status.quod.unitPriceCents + status.ieptb.unitPriceCents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
              : status.quote.totalLabel
          }
          forceRefresh={forceRefresh}
          submitting={submitting}
          onCancel={() => {
            if (!submitting) {
              setConfirming(false);
              setForceRefresh(false);
            }
          }}
          onConfirm={() => void confirmPaid()}
        />
      ) : null}
    </div>
  );
}
