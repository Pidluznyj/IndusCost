import React, { useCallback, useEffect, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import { generateIdempotencyKey, SecureRandomUnavailableError } from "@/src/lib/quodDossier/idempotencyKey";
import type { QuodSections } from "@/src/lib/quodDossier/parse";
import {
  QuodDossierReport,
  QuodIntelligenceHeader,
  QuodPaidConsultationDialog,
  QuodSuperAdminPanel,
  quodExternalState,
  type QuodHeaderState,
} from "./QuodDossierSection";
import { QuodDossierPrintReport } from "./QuodDossierPrintReport";

type StatusPayload = {
  priceLabel: string;
  state: QuodHeaderState;
  consultation: {
    id: string;
    score: number | null;
    restrictionCount: number | null;
    consultedAt: string | null;
    validUntil: string | null;
    sections: QuodSections | null;
    partners: Array<{ name: string | null; role: string | null; share: number | null; document: string | null }>;
    companyName: string;
    cnpj: string;
    requestedByUserId: string;
  } | null;
};

export function CustomerQuodDossierPanel({
  customerId,
  companyName,
  cnpj,
  cadastralScore,
  cadastralVerdict,
  creditLabel,
  isSuperAdmin,
  requestedBy,
}: {
  customerId: string | null;
  companyName: string;
  cnpj: string;
  cadastralScore: string;
  cadastralVerdict: string | null;
  creditLabel: string;
  isSuperAdmin: boolean;
  requestedBy: string;
}) {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!isSuperAdmin || !customerId) return;
    const payload = await fetchJsonOk<StatusPayload>(`/api/customers/${customerId}/quod-dossier`);
    setStatus(payload);
  }, [customerId, isSuperAdmin]);

  useEffect(() => {
    void load().catch(() => setStatus(null));
  }, [load]);

  const externalState = quodExternalState(isSuperAdmin, status?.state ?? null);
  const score = isSuperAdmin && status?.state === "VALID" ? status.consultation?.score ?? null : null;

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
      await fetchJsonOk(`/api/customers/${customerId}/quod-dossier`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true, idempotencyKey }),
      });
      setConfirming(false);
      setShowReport(true);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "A consulta paga não foi concluída.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <QuodIntelligenceHeader
        cadastralScore={cadastralScore}
        cadastralVerdict={cadastralVerdict}
        externalScore={score}
        externalState={externalState}
        creditLabel={creditLabel}
      />
      {isSuperAdmin && customerId ? (
        <QuodSuperAdminPanel
          state={status?.state ?? "NOT_CONSULTED"}
          consultedAt={status?.consultation?.consultedAt ?? null}
          validUntil={status?.consultation?.validUntil ?? null}
          score={status?.consultation?.score ?? null}
          restrictionCount={status?.consultation?.restrictionCount ?? null}
          priceLabel={status?.priceLabel ?? "—"}
          canQuery={status?.state !== "VALID" && status?.state !== "IN_PROGRESS"}
          onView={() => setShowReport(true)}
          onRequestPaid={() => setConfirming(true)}
          report={
            showReport && status?.consultation?.sections ? (
              <>
                <QuodDossierReport sections={status.consultation.sections} partners={status.consultation.partners ?? []} />
                <QuodDossierPrintReport
                  reportId={status.consultation.id}
                  companyName={status.consultation.companyName || companyName}
                  cnpj={status.consultation.cnpj || cnpj}
                  consultedAt={status.consultation.consultedAt}
                  requestedBy={status.consultation.requestedByUserId || requestedBy}
                  sections={status.consultation.sections}
                />
                <button type="button" className="mt-2 rounded border px-3 py-1.5 text-xs print:hidden" onClick={() => window.print()}>
                  Emitir PDF
                </button>
              </>
            ) : null
          }
        />
      ) : null}
      {message ? <p className="text-sm text-red-700">{message}</p> : null}
      {confirming ? (
        <QuodPaidConsultationDialog
          companyName={companyName}
          cnpj={cnpj}
          priceLabel={status?.priceLabel ?? "—"}
          requestedBy={requestedBy}
          requestedAt={new Date().toLocaleString("pt-BR")}
          previousLabel={
            status?.consultation?.consultedAt
              ? `Consulta anterior em ${new Date(status.consultation.consultedAt).toLocaleString("pt-BR")}, válida até ${status.consultation.validUntil ? new Date(status.consultation.validUntil).toLocaleString("pt-BR") : "—"}. Atualizar gera nova consulta paga.`
              : null
          }
          submitting={submitting}
          onCancel={() => { if (!submitting) setConfirming(false); }}
          onConfirm={() => void confirmPaid()}
        />
      ) : null}
    </div>
  );
}
