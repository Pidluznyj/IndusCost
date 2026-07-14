import React from "react";
import {
  SERVICE_TERMINATION_PJ_WARNING,
} from "@/src/lib/suppliers/supplierServiceTerminationDistrato";
import type {
  ServiceTerminationCommissionTreatmentDto,
  ServiceTerminationNoticeOriginDto,
  ServiceTerminationTerminationModalityDto,
} from "@/src/lib/suppliers/supplierServiceTerminationTypes";
import { PRINT_COMPANY_DOC_FALLBACK } from "@/src/lib/printBranding";

export type DistratoFormState = {
  originalContractDate: string;
  originalContractReference: string;
  contractingPartyName: string;
  contractingPartyDocument: string;
  contractingPartyRepName: string;
  contractingPartyRepRole: string;
  contractingPartyRepDocument: string;
  contractedPartyName: string;
  contractedPartyDocument: string;
  contractedPartyRepName: string;
  contractedPartyRepDocument: string;
  contractedServiceDescription: string;
  signaturePlace: string;
  terminationModality: ServiceTerminationTerminationModalityDto | "";
  terminationReason: string;
  paymentDueDate: string;
  paymentMethod: string;
  paymentTransactionId: string;
  paymentEffectiveDate: string;
  paymentConfirmedAmount: string;
  paymentProofWaiverReason: string;
  paymentProofFileName: string;
  commissionTreatment: ServiceTerminationCommissionTreatmentDto | "";
  commissionPendingNotes: string;
  commissionNegotiatedAmount: string;
  commissionNegotiatedOrders: string;
  commissionNegotiatedJustification: string;
  commissionNegotiatedApprover: string;
  noticePenaltyOrigin: ServiceTerminationNoticeOriginDto | "";
  noticePenaltyClauseNumber: string;
  noticePenaltyClauseDescription: string;
  proportionalCompensationJustification: string;
  extraServicesDescription: string;
  otherDiscountsDescription: string;
  contractualNotes: string;
  pendingObligationsNotes: string;
  hasPendingObligations: boolean;
  witness1Name: string;
  witness1Document: string;
  witness2Name: string;
  witness2Document: string;
  contractTypeConfirmedPj: boolean;
};

export const EMPTY_DISTRATO_FORM: DistratoFormState = {
  originalContractDate: "",
  originalContractReference: "",
  contractingPartyName: "Lazarios Koppetel",
  contractingPartyDocument: PRINT_COMPANY_DOC_FALLBACK.taxId,
  contractingPartyRepName: "",
  contractingPartyRepRole: "",
  contractingPartyRepDocument: "",
  contractedPartyName: "",
  contractedPartyDocument: "",
  contractedPartyRepName: "",
  contractedPartyRepDocument: "",
  contractedServiceDescription: "",
  signaturePlace: "Curitiba/PR",
  terminationModality: "MUTUAL_AGREEMENT",
  terminationReason: "",
  paymentDueDate: "",
  paymentMethod: "",
  paymentTransactionId: "",
  paymentEffectiveDate: "",
  paymentConfirmedAmount: "",
  paymentProofWaiverReason: "",
  paymentProofFileName: "",
  commissionTreatment: "",
  commissionPendingNotes: "",
  commissionNegotiatedAmount: "",
  commissionNegotiatedOrders: "",
  commissionNegotiatedJustification: "",
  commissionNegotiatedApprover: "",
  noticePenaltyOrigin: "",
  noticePenaltyClauseNumber: "",
  noticePenaltyClauseDescription: "",
  proportionalCompensationJustification: "",
  extraServicesDescription: "",
  otherDiscountsDescription: "",
  contractualNotes: "",
  pendingObligationsNotes: "",
  hasPendingObligations: false,
  witness1Name: "",
  witness1Document: "",
  witness2Name: "",
  witness2Document: "",
  contractTypeConfirmedPj: false,
};

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`space-y-1 ${className ?? ""}`}>
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const inputCls = "w-full rounded-lg border px-3 py-2 text-sm";

export function SupplierServiceTerminationDistratoFields({
  value,
  onChange,
  disabled,
  documentCode,
  documentVersion,
}: {
  value: DistratoFormState;
  onChange: (patch: Partial<DistratoFormState>) => void;
  disabled?: boolean;
  documentCode?: string | null;
  documentVersion?: number;
}) {
  const set = <K extends keyof DistratoFormState>(key: K, v: DistratoFormState[K]) =>
    onChange({ [key]: v });

  return (
    <section className="space-y-3" data-testid="service-termination-distrato">
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
        Dados do distrato e da quitação
      </h3>
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
        {SERVICE_TERMINATION_PJ_WARNING}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={value.contractTypeConfirmedPj}
          disabled={disabled}
          onChange={(e) => set("contractTypeConfirmedPj", e.target.checked)}
          data-testid="sst-pj-confirm"
        />
        <span>
          Confirmo que este instrumento refere-se exclusivamente a contrato civil de prestação
          de serviços PJ (não CLT).
        </span>
      </label>

      <div className="grid gap-3 sm:grid-cols-3 text-xs">
        <p>
          <span className="font-semibold text-muted-foreground">Nº documento: </span>
          {documentCode || "— (gerado ao salvar)"}
        </p>
        <p>
          <span className="font-semibold text-muted-foreground">Versão: </span>
          {documentVersion ?? 1}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Referência do contrato original">
          <input
            className={inputCls}
            value={value.originalContractReference}
            disabled={disabled}
            onChange={(e) => set("originalContractReference", e.target.value)}
            data-testid="sst-contract-ref"
          />
        </Field>
        <Field label="Data do contrato original">
          <input
            type="date"
            className={inputCls}
            value={value.originalContractDate}
            disabled={disabled}
            onChange={(e) => set("originalContractDate", e.target.value)}
          />
        </Field>
        <Field label="Contratante (razão social)">
          <input
            className={inputCls}
            value={value.contractingPartyName}
            disabled={disabled}
            onChange={(e) => set("contractingPartyName", e.target.value)}
          />
        </Field>
        <Field label="CNPJ da contratante">
          <input
            className={inputCls}
            value={value.contractingPartyDocument}
            disabled={disabled}
            onChange={(e) => set("contractingPartyDocument", e.target.value)}
          />
        </Field>
        <Field label="Representante da contratante">
          <input
            className={inputCls}
            value={value.contractingPartyRepName}
            disabled={disabled}
            onChange={(e) => set("contractingPartyRepName", e.target.value)}
          />
        </Field>
        <Field label="Cargo do representante">
          <input
            className={inputCls}
            value={value.contractingPartyRepRole}
            disabled={disabled}
            onChange={(e) => set("contractingPartyRepRole", e.target.value)}
          />
        </Field>
        <Field label="CPF do representante da contratante">
          <input
            className={inputCls}
            value={value.contractingPartyRepDocument}
            disabled={disabled}
            onChange={(e) => set("contractingPartyRepDocument", e.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field label="Local de assinatura">
          <input
            className={inputCls}
            value={value.signaturePlace}
            disabled={disabled}
            onChange={(e) => set("signaturePlace", e.target.value)}
          />
        </Field>
        <Field label="Contratada (razão social / prestador)">
          <input
            className={inputCls}
            value={value.contractedPartyName}
            disabled={disabled}
            onChange={(e) => set("contractedPartyName", e.target.value)}
          />
        </Field>
        <Field label="CNPJ da contratada">
          <input
            className={inputCls}
            value={value.contractedPartyDocument}
            disabled={disabled}
            onChange={(e) => set("contractedPartyDocument", e.target.value)}
          />
        </Field>
        <Field label="Representante da contratada">
          <input
            className={inputCls}
            value={value.contractedPartyRepName}
            disabled={disabled}
            onChange={(e) => set("contractedPartyRepName", e.target.value)}
          />
        </Field>
        <Field label="CPF do representante da contratada">
          <input
            className={inputCls}
            value={value.contractedPartyRepDocument}
            disabled={disabled}
            onChange={(e) => set("contractedPartyRepDocument", e.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field label="Serviço contratado" className="sm:col-span-2">
          <input
            className={inputCls}
            value={value.contractedServiceDescription}
            disabled={disabled}
            onChange={(e) => set("contractedServiceDescription", e.target.value)}
          />
        </Field>
        <Field label="Modalidade do encerramento">
          <select
            className={inputCls}
            value={value.terminationModality}
            disabled={disabled}
            onChange={(e) =>
              set(
                "terminationModality",
                e.target.value as ServiceTerminationTerminationModalityDto | ""
              )
            }
          >
            <option value="MUTUAL_AGREEMENT">Comum acordo</option>
            <option value="CONTRACTOR_INITIATIVE">Iniciativa da contratante</option>
            <option value="CONTRACTED_INITIATIVE">Iniciativa da contratada</option>
          </select>
        </Field>
        <Field label="Motivo (opcional)">
          <input
            className={inputCls}
            value={value.terminationReason}
            disabled={disabled}
            onChange={(e) => set("terminationReason", e.target.value)}
          />
        </Field>
      </div>

      <h4 className="text-xs font-bold uppercase text-muted-foreground pt-2">
        Origem da compensação de encerramento
      </h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Origem (obrigatória se houver valor)">
          <select
            className={inputCls}
            value={value.noticePenaltyOrigin}
            disabled={disabled}
            onChange={(e) =>
              set("noticePenaltyOrigin", e.target.value as ServiceTerminationNoticeOriginDto | "")
            }
            data-testid="sst-notice-origin"
          >
            <option value="">Selecione…</option>
            <option value="CONTRACT_CLAUSE">Cláusula contratual</option>
            <option value="AGREEMENT">Acordo entre as partes</option>
            <option value="OTHER">Outro fundamento contratual</option>
          </select>
        </Field>
        {value.noticePenaltyOrigin === "CONTRACT_CLAUSE" ? (
          <>
            <Field label="Nº da cláusula">
              <input
                className={inputCls}
                value={value.noticePenaltyClauseNumber}
                disabled={disabled}
                onChange={(e) => set("noticePenaltyClauseNumber", e.target.value)}
              />
            </Field>
            <Field label="Descrição da cláusula" className="sm:col-span-2">
              <input
                className={inputCls}
                value={value.noticePenaltyClauseDescription}
                disabled={disabled}
                onChange={(e) => set("noticePenaltyClauseDescription", e.target.value)}
              />
            </Field>
          </>
        ) : null}
        <Field label="Justificativa da compensação proporcional" className="sm:col-span-2">
          <input
            className={inputCls}
            value={value.proportionalCompensationJustification}
            disabled={disabled}
            onChange={(e) => set("proportionalCompensationJustification", e.target.value)}
          />
        </Field>
        <Field label="Descrição do saldo adicional de serviços" className="sm:col-span-2">
          <input
            className={inputCls}
            value={value.extraServicesDescription}
            disabled={disabled}
            onChange={(e) => set("extraServicesDescription", e.target.value)}
          />
        </Field>
        <Field label="Descrição de deduções (obrigatória se &gt; 0)" className="sm:col-span-2">
          <input
            className={inputCls}
            value={value.otherDiscountsDescription}
            disabled={disabled}
            onChange={(e) => set("otherDiscountsDescription", e.target.value)}
          />
        </Field>
      </div>

      <h4 className="text-xs font-bold uppercase text-muted-foreground pt-2">
        Tratamento obrigatório das comissões
      </h4>
      <div className="grid gap-3 sm:grid-cols-1">
        <Field label="Situação das comissões">
          <select
            className={inputCls}
            value={value.commissionTreatment}
            disabled={disabled}
            onChange={(e) =>
              set(
                "commissionTreatment",
                e.target.value as ServiceTerminationCommissionTreatmentDto | ""
              )
            }
            data-testid="sst-commission-treatment"
          >
            <option value="">Selecione…</option>
            <option value="NONE_PENDING">Não existem comissões pendentes</option>
            <option value="HAS_PENDING">
              Existem comissões pendentes (fora da quitação)
            </option>
            <option value="NEGOTIATED_INCLUDED">Comissões incluídas em valor negociado</option>
          </select>
        </Field>
        {value.commissionTreatment === "HAS_PENDING" ? (
          <Field label="Relação das pendências / anexo">
            <textarea
              className={inputCls}
              rows={2}
              value={value.commissionPendingNotes}
              disabled={disabled}
              onChange={(e) => set("commissionPendingNotes", e.target.value)}
            />
          </Field>
        ) : null}
        {value.commissionTreatment === "NEGOTIATED_INCLUDED" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Valor negociado">
              <input
                type="number"
                className={inputCls}
                value={value.commissionNegotiatedAmount}
                disabled={disabled}
                onChange={(e) => set("commissionNegotiatedAmount", e.target.value)}
              />
            </Field>
            <Field label="Aprovado por">
              <input
                className={inputCls}
                value={value.commissionNegotiatedApprover}
                disabled={disabled}
                onChange={(e) => set("commissionNegotiatedApprover", e.target.value)}
              />
            </Field>
            <Field label="Pedidos abrangidos" className="sm:col-span-2">
              <input
                className={inputCls}
                value={value.commissionNegotiatedOrders}
                disabled={disabled}
                onChange={(e) => set("commissionNegotiatedOrders", e.target.value)}
              />
            </Field>
            <Field label="Justificativa" className="sm:col-span-2">
              <textarea
                className={inputCls}
                rows={2}
                value={value.commissionNegotiatedJustification}
                disabled={disabled}
                onChange={(e) => set("commissionNegotiatedJustification", e.target.value)}
              />
            </Field>
          </div>
        ) : null}
      </div>

      <h4 className="text-xs font-bold uppercase text-muted-foreground pt-2">
        Pagamento e quitação
      </h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Data prevista para pagamento">
          <input
            type="date"
            className={inputCls}
            value={value.paymentDueDate}
            disabled={disabled}
            onChange={(e) => set("paymentDueDate", e.target.value)}
          />
        </Field>
        <Field label="Forma de pagamento">
          <input
            className={inputCls}
            value={value.paymentMethod}
            disabled={disabled}
            onChange={(e) => set("paymentMethod", e.target.value)}
            placeholder="PIX, TED, boleto…"
          />
        </Field>
        <Field label="Identificação da transação">
          <input
            className={inputCls}
            value={value.paymentTransactionId}
            disabled={disabled}
            onChange={(e) => set("paymentTransactionId", e.target.value)}
          />
        </Field>
        <Field label="Data efetiva do pagamento">
          <input
            type="date"
            className={inputCls}
            value={value.paymentEffectiveDate}
            disabled={disabled}
            onChange={(e) => set("paymentEffectiveDate", e.target.value)}
          />
        </Field>
        <Field label="Valor efetivamente pago">
          <input
            type="number"
            className={inputCls}
            value={value.paymentConfirmedAmount}
            disabled={disabled}
            onChange={(e) => set("paymentConfirmedAmount", e.target.value)}
            data-testid="sst-payment-amount"
          />
        </Field>
        <Field label="Comprovante (nome do arquivo / referência)">
          <input
            className={inputCls}
            value={value.paymentProofFileName}
            disabled={disabled}
            onChange={(e) => set("paymentProofFileName", e.target.value)}
            placeholder="Ex.: comprovante-pix.pdf"
          />
        </Field>
        <Field label="Justificativa de dispensa do comprovante" className="sm:col-span-2">
          <input
            className={inputCls}
            value={value.paymentProofWaiverReason}
            disabled={disabled}
            onChange={(e) => set("paymentProofWaiverReason", e.target.value)}
          />
        </Field>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={value.hasPendingObligations}
            disabled={disabled}
            onChange={(e) => set("hasPendingObligations", e.target.checked)}
          />
          <span>Há obrigações pendentes fora da quitação (Anexo II)</span>
        </label>
        {value.hasPendingObligations ? (
          <Field label="Obrigações pendentes" className="sm:col-span-2">
            <textarea
              className={inputCls}
              rows={2}
              value={value.pendingObligationsNotes}
              disabled={disabled}
              onChange={(e) => set("pendingObligationsNotes", e.target.value)}
            />
          </Field>
        ) : null}
        <Field label="Observações contratuais" className="sm:col-span-2">
          <textarea
            className={inputCls}
            rows={2}
            value={value.contractualNotes}
            disabled={disabled}
            onChange={(e) => set("contractualNotes", e.target.value)}
          />
        </Field>
      </div>

      <h4 className="text-xs font-bold uppercase text-muted-foreground pt-2">Testemunhas</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Testemunha 1 — nome">
          <input
            className={inputCls}
            value={value.witness1Name}
            disabled={disabled}
            onChange={(e) => set("witness1Name", e.target.value)}
          />
        </Field>
        <Field label="Testemunha 1 — CPF">
          <input
            className={inputCls}
            value={value.witness1Document}
            disabled={disabled}
            onChange={(e) => set("witness1Document", e.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field label="Testemunha 2 — nome">
          <input
            className={inputCls}
            value={value.witness2Name}
            disabled={disabled}
            onChange={(e) => set("witness2Name", e.target.value)}
          />
        </Field>
        <Field label="Testemunha 2 — CPF">
          <input
            className={inputCls}
            value={value.witness2Document}
            disabled={disabled}
            onChange={(e) => set("witness2Document", e.target.value)}
            autoComplete="off"
          />
        </Field>
      </div>
    </section>
  );
}
