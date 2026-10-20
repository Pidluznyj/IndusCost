import React from "react";
import { QUOD_DOSSIER_PRODUCT, QUOD_DOSSIER_PROVIDER, QUOD_PROTEST_COVERAGE_NOTE } from "@/src/lib/quodDossier/config";
import type { QuodSections } from "@/src/lib/quodDossier/parse";

export function QuodDossierPrintReport({
  reportId,
  companyName,
  cnpj,
  consultedAt,
  requestedBy,
  sections,
}: {
  reportId: string;
  companyName: string;
  cnpj: string;
  consultedAt: string | null;
  requestedBy: string;
  sections: QuodSections | null;
}) {
  return (
    <article className="quod-dossier-print-report hidden print:block" data-testid="quod-dossier-print" id="quod-dossier-print">
      <header>
        <p>IndusCost</p>
        <h1>Relatório — {QUOD_DOSSIER_PRODUCT}</h1>
        <p>Identificador {reportId}</p>
      </header>
      <p>Cliente: {companyName}</p>
      <p>CNPJ: {cnpj}</p>
      <p>Data da consulta: {consultedAt ?? "—"}</p>
      <p>Usuário solicitante: {requestedBy}</p>
      <p>Fonte: {QUOD_DOSSIER_PROVIDER}</p>
      <p>Score: {sections?.score.value ?? "não informado"}</p>
      <p>{sections?.score.scaleNote}</p>
      <p>Restrições informadas: {sections?.restrictions.total ?? "não quantificado"}</p>
      <p>{QUOD_PROTEST_COVERAGE_NOTE}</p>
    </article>
  );
}
