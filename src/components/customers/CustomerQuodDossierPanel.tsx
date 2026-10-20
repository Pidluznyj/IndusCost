import React, { useCallback, useEffect, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
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
}: {
  customerId: string | null;
  companyName: string;
  cnpj: string;
  cadastralScore: string;
  cadastralVerdict?: string | null;
  creditLabel: string;
  isSuperAdmin: boolean;
  requestedBy: string;
}) {
  const [status, setStatus] = useState<PackagePayload | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [showQuod, setShowQuod] = useState(false);
  const [showIeptb, setShowIeptb] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!isSuperAdmin || !customerId) return;
    const payload = await fetchJsonOk<PackagePayload>(`/api/customers/${customerId}/credit-intelligence-package`);
    setStatus(payload);
  }, [customerId, isSuperAdmin]);

  useEffect(() => {
    void load().catch(() => setStatus(null));
  }, [load]);

  const quodState = isSuperAdmin ? status?.quod.state ?? "NOT_CONSULTED" : "RESTRICTED";
  const ieptbState = isSuperAdmin ? status?.ieptb.state ?? "NOT_CONSULTED" : "RESTRICTED";
  const quodScore = isSuperAdmin && status?.quod.state === "VALID" ? status.quod.consultation?.score ?? null : null;
  const ieptb = status?.ieptb.consultation ?? null;

  async function confirmPaid() {
    if (!customerId || submitting) return;
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
      setMessage(error instanceof Error ? error.message : "A análise completa não foi concluída.");
    } finally {
      setSubmitting(false);
    }
  }

  const ieptbLabel =
    !isSuperAdmin
      ? "Restrito"
      : ieptbState === "VALID"
        ? ieptb?.confirmedProtest
          ? "Ocorrência encontrada"
          : ieptb?.confirmedClear
            ? "Sem ocorrência"
            : "Informação indisponível ou incompleta"
        : ieptbState === "NOT_CONSULTED"
          ? "Não consultado"
          : ieptbState;

  return (
    <div className="space-y-3">
      <CreditExternalDimensions
        creditLabel={creditLabel}
        cadastralScore={cadastralScore}
        quodScore={quodState === "RESTRICTED" ? "Restrito" : quodScore == null ? "Não consultado" : String(quodScore)}
        quodState={quodState}
        ieptbLabel={ieptbLabel}
        ieptbState={ieptbState}
      />
      {isSuperAdmin && customerId ? (
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
          canQuery={status?.quote.totalCents !== 0 || status?.complete !== true}
          onViewQuod={() => setShowQuod(true)}
          onViewIeptb={() => setShowIeptb(true)}
          onRequestPackage={() => {
            setForceRefresh(false);
            setConfirming(true);
          }}
          onForceRefresh={() => {
            setForceRefresh(true);
            setConfirming(true);
          }}
        />
      ) : null}
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
      {confirming && status ? (
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
