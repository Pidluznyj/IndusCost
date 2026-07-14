import React from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { PrintHeader } from "@/src/components/print/PrintHeader";
import { PrintSection } from "@/src/components/print/PrintSection";
import { PrintDocumentShell } from "@/src/components/print/PrintDocumentShell";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import type { ServiceTerminationPrintModel } from "@/src/lib/suppliers/supplierServiceTerminationPrint";

function money(n: number): string {
  return formatFinanceCurrency(n);
}

function SignatureBlock({
  title,
  lines,
}: {
  title: string;
  lines: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="rounded border border-slate-300 p-3 text-[11px]">
      <p className="font-bold uppercase tracking-wide text-slate-700">{title}</p>
      <div className="mt-2 space-y-1">
        {lines.map((l) => (
          <p key={l.label}>
            <span className="font-semibold text-slate-600">{l.label}: </span>
            {l.value}
          </p>
        ))}
      </div>
      <div className="mt-8 border-t border-slate-400 pt-1 text-center text-[10px] text-slate-500">
        Assinatura / Data
      </div>
    </div>
  );
}

/**
 * Termo de Distrato — layout contratual no padrão PrintHeader do IndusCost.
 */
export function SupplierServiceTerminationPrintDocument({
  model,
  branding,
  issuedAt,
  emitterName,
}: {
  model: ServiceTerminationPrintModel;
  branding: BrandingSettingsDTO;
  issuedAt: string;
  emitterName?: string | null;
}) {
  return (
    <PrintDocumentShell
      rootId="supplier-service-termination-print-root"
      className="service-termination-print-document sales-order-print-document proposal-compact-document proposal-print-sheet relative mx-auto w-full max-w-[210mm] border border-slate-300 bg-white text-slate-800 shadow-sm print:max-w-none print:border-0 print:shadow-none"
    >
      {model.watermarkText ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden"
        >
          <p className="rotate-[-28deg] text-center text-3xl font-black uppercase tracking-wider text-slate-300/70 md:text-4xl print:text-slate-400/60">
            {model.watermarkText}
          </p>
        </div>
      ) : null}

      <div className="proposal-print-document-inner relative z-10 p-4 text-xs leading-snug md:p-5 md:text-[13px] print:p-3">
        <h1 className="sr-only">{model.documentTitle}</h1>

        <PrintHeader
          branding={branding}
          documentTitle="TERMO DE DISTRATO"
          documentHighlight={model.documentHighlight}
          subtitle="Acerto financeiro e quitação de contrato de prestação de serviços"
          metaLines={[
            { label: "Nº documento", value: model.documentCode },
            { label: "Versão", value: String(model.documentVersion) },
            { label: "Status", value: model.statusLabel },
            { label: "Emitido em", value: issuedAt },
            { label: "Emitido por", value: emitterName?.trim() || model.issuedBy },
            { label: "Local", value: model.signaturePlace },
          ]}
          className="proposal-compact-header proposal-print-section"
        />

        <p className="mt-4 text-center text-sm font-bold uppercase leading-tight tracking-wide text-slate-900">
          Termo de Distrato, Acerto Financeiro e Quitação
          <br />
          de Contrato de Prestação de Serviços
        </p>

        <PrintSection
          title="Identificação das partes"
          className="proposal-compact-section proposal-print-section mt-4"
        >
          <div className="mt-2 space-y-3 border-y border-slate-200 py-2 text-[11px] sm:text-xs">
            <p>
              <span className="font-bold">CONTRATANTE: </span>
              {model.contractingPartyName}, inscrita no CNPJ sob nº{" "}
              {model.contractingPartyDocument}, neste ato representada por{" "}
              {model.contractingPartyRepName}, {model.contractingPartyRepRole}.
            </p>
            <p>
              <span className="font-bold">CONTRATADA: </span>
              {model.contractedPartyName}, inscrita no CNPJ sob nº{" "}
              {model.contractedPartyDocument}, neste ato representada por{" "}
              {model.contractedPartyRepName}, CPF nº {model.contractedPartyRepDocument}.
            </p>
          </div>
        </PrintSection>

        <PrintSection
          title="Cláusula 1 — Do encerramento"
          className="proposal-compact-section proposal-print-section mt-3"
        >
          <p className="mt-2 text-[11px] sm:text-xs">
            As partes resolvem encerrar, na modalidade {model.modalityLabel}, com efeitos a
            partir de {model.periodLabel.split(" a ")[1] || "—"}, o Contrato de Prestação de
            Serviços {model.originalContractReference}, firmado em{" "}
            {model.originalContractDateLabel}, cujo objeto consistia na prestação dos serviços
            de {model.contractedServiceDescription}. Período abrangido: {model.periodLabel}.
            {model.terminationReason
              ? ` Motivo: ${model.terminationReason}.`
              : ""}
          </p>
        </PrintSection>

        <PrintSection
          title="Cláusula 2 — Do acerto financeiro"
          className="proposal-compact-section proposal-print-section mt-3 print-section--flow"
        >
          <p className="mt-2 text-[11px] sm:text-xs">
            Em razão do encerramento contratual, as partes reconhecem os valores discriminados
            no quadro abaixo, calculados conforme os critérios contratuais e negociais
            registrados no sistema.
          </p>
          {model.proportionalCompensationJustification ? (
            <p className="mt-1 text-[10px] text-slate-600">
              Base da compensação contratual proporcional:{" "}
              {model.proportionalCompensationJustification}
            </p>
          ) : null}
          {model.extraServicesDescription ? (
            <p className="mt-1 text-[10px] text-slate-600">
              Saldo adicional: {model.extraServicesDescription}
            </p>
          ) : null}
          <table className="print-table mt-2 w-full border-collapse text-[11px]">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-300 px-2 py-1 text-left">Verba</th>
                <th className="border border-slate-300 px-2 py-1 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {model.settlementRows.map((row) => (
                <tr key={row.label} className={row.emphasize ? "font-bold" : undefined}>
                  <td className="border border-slate-300 px-2 py-1">{row.label}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right tabular-nums">
                    {money(row.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-sm font-bold">
            VALOR LÍQUIDO DO ACERTO CONTRATUAL: {money(model.totalTerminationAmount)}
          </p>
          {model.isPaidAndSettled ? (
            <p className="mt-1 text-sm font-bold uppercase text-emerald-800">PAGO E QUITADO</p>
          ) : null}
        </PrintSection>

        <PrintSection
          title="Cláusula 3 — Das comissões"
          className="proposal-compact-section proposal-print-section mt-3"
        >
          <p className="mt-2 text-[11px] sm:text-xs">{model.commissionClause}</p>
        </PrintSection>

        <PrintSection
          title="Anexo I — Comissões comerciais apuradas"
          className="proposal-compact-section proposal-print-section mt-3 print-section--flow"
        >
          {model.commissionRows.length === 0 ? (
            <p className="mt-2 text-[11px] text-slate-600">
              Nenhuma comissão discriminada neste instrumento.
            </p>
          ) : (
            <table className="print-table mt-2 w-full border-collapse text-[10px]">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-1 py-1 text-left">Pedido</th>
                  <th className="border border-slate-300 px-1 py-1 text-left">
                    Cliente / referência
                  </th>
                  <th className="border border-slate-300 px-1 py-1 text-left">Pessoa</th>
                  <th className="border border-slate-300 px-1 py-1 text-left">Origem</th>
                  <th className="border border-slate-300 px-1 py-1 text-left">Situação</th>
                  <th className="border border-slate-300 px-1 py-1 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {model.commissionRows.map((row, idx) => (
                  <tr key={`${row.orderCode}-${idx}`}>
                    <td className="border border-slate-300 px-1 py-1">{row.orderCode}</td>
                    <td className="border border-slate-300 px-1 py-1">{row.description}</td>
                    <td className="border border-slate-300 px-1 py-1">{row.personName}</td>
                    <td className="border border-slate-300 px-1 py-1">{row.source}</td>
                    <td className="border border-slate-300 px-1 py-1">{row.statusLabel}</td>
                    <td className="border border-slate-300 px-1 py-1 text-right tabular-nums">
                      {money(row.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </PrintSection>

        <PrintSection
          title="Cláusula 4 — Do pagamento"
          className="proposal-compact-section proposal-print-section mt-3"
        >
          <p className="mt-2 text-[11px] sm:text-xs">{model.paymentClause}</p>
          <div className="mt-2 grid gap-1 text-[11px] sm:grid-cols-2">
            <p>
              <span className="font-semibold">Data prevista: </span>
              {model.paymentDueDateLabel}
            </p>
            <p>
              <span className="font-semibold">Data efetiva: </span>
              {model.paymentEffectiveDateLabel}
            </p>
            <p>
              <span className="font-semibold">Forma: </span>
              {model.paymentMethod}
            </p>
            <p>
              <span className="font-semibold">Identificação: </span>
              {model.paymentTransactionId}
            </p>
          </div>
        </PrintSection>

        <PrintSection
          title="Cláusula 5 — Da quitação"
          className="proposal-compact-section proposal-print-section mt-3"
        >
          <p className="mt-2 text-[11px] sm:text-xs">
            {model.quitacaoClause ||
              "A quitação financeira somente será válida após confirmação integral do pagamento e assinatura das partes."}
          </p>
        </PrintSection>

        <PrintSection
          title="Cláusula 6 — Das obrigações pendentes"
          className="proposal-compact-section proposal-print-section mt-3"
        >
          <p className="mt-2 text-[11px] sm:text-xs">{model.pendingObligationsClause}</p>
        </PrintSection>

        <PrintSection
          title="Cláusula 7 — Da livre manifestação"
          className="proposal-compact-section proposal-print-section mt-3"
        >
          <p className="mt-2 text-[11px] sm:text-xs">{model.freeManifestationClause}</p>
          <p className="mt-2 text-[11px] sm:text-xs">
            E, por estarem de acordo, as partes assinam o presente instrumento em conjunto com
            duas testemunhas.
          </p>
          {model.contractualNotes ? (
            <p className="mt-2 text-[10px] text-slate-600">
              Observações contratuais: {model.contractualNotes}
            </p>
          ) : null}
        </PrintSection>

        <PrintSection
          title="Assinaturas"
          className="proposal-compact-section proposal-print-section mt-4 print-section--flow"
        >
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <SignatureBlock
              title="CONTRATANTE"
              lines={[
                { label: "Razão social", value: model.contractingPartyName },
                { label: "Representante", value: model.contractingPartyRepName },
                { label: "CPF", value: model.contractingPartyRepDocument },
                { label: "Cargo", value: model.contractingPartyRepRole },
              ]}
            />
            <SignatureBlock
              title="CONTRATADA"
              lines={[
                { label: "Razão social", value: model.contractedPartyName },
                { label: "Representante", value: model.contractedPartyRepName },
                { label: "CPF", value: model.contractedPartyRepDocument },
              ]}
            />
            <SignatureBlock
              title="TESTEMUNHA 1"
              lines={[
                { label: "Nome", value: model.witness1Name },
                { label: "CPF", value: model.witness1Document },
              ]}
            />
            <SignatureBlock
              title="TESTEMUNHA 2"
              lines={[
                { label: "Nome", value: model.witness2Name },
                { label: "CPF", value: model.witness2Document },
              ]}
            />
          </div>
        </PrintSection>

        <footer className="mt-6 border-t border-slate-300 pt-2 text-[10px] leading-snug text-slate-600">
          <p>{model.footerNote}</p>
          <p className="mt-1">
            Código: {model.documentCode} · Versão: {model.documentVersion} · Integridade:{" "}
            {model.integrityCode} · Emissão: {issuedAt} · Emissor:{" "}
            {emitterName?.trim() || model.issuedBy}
          </p>
        </footer>
      </div>
    </PrintDocumentShell>
  );
}
