import React from "react";
import { formatDocumentDateTime, type ProjectDocumentHeader } from "@/src/lib/projectsDocumentHeader";

type Props = {
  header: ProjectDocumentHeader;
  /** sha256 gravado na emissão (exibe o código de verificação). */
  sha256?: string | null;
  /** Linhas extras na coluna "Documento" (ex.: validade da proposta). */
  extraRows?: Array<{ label: string; value: string }>;
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-1.5 text-[11px] leading-snug">
      <span className="shrink-0 text-slate-500">{label}:</span>
      <span className="min-w-0 break-words font-medium text-slate-900">{value}</span>
    </div>
  );
}

/**
 * Bloco documental comum dos cinco documentos do projeto: emitente (Configurações de Marca),
 * documento/revisão/emissão, cliente, projeto e origem dos valores.
 */
export function ProjectDocumentHeaderBlock({ header, sha256, extraRows = [] }: Props) {
  const issued = header.status === "ISSUED";
  const issuer = header.issuer;
  const reg = header.customer.registry;
  const contact = [issuer.document ? `CNPJ ${issuer.document}` : null, issuer.phone, issuer.email, issuer.website]
    .filter(Boolean)
    .join(" · ");
  const customerPlace = reg ? [reg.city, reg.state].filter(Boolean).join("/") : null;
  return (
    <section className="project-document-header mb-5 break-inside-avoid" data-testid="project-document-header">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-slate-800 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          {issuer.logoDataUrl ? (
            <img src={issuer.logoDataUrl} alt="" className="h-12 w-auto max-w-[140px] object-contain" />
          ) : null}
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900">{issuer.legalName ?? "Emitente não configurado"}</p>
            {issuer.address ? <p className="text-[11px] text-slate-600">{issuer.address}</p> : null}
            {contact ? <p className="text-[11px] text-slate-600">{contact}</p> : null}
          </div>
        </div>
        <div className="text-right">
          <p className="text-base font-bold uppercase tracking-wide text-slate-900">{header.documentTitle}</p>
          <p className="text-xs font-semibold text-amber-700" data-testid="project-document-number">
            {issued ? header.documentNumber : "PRÉVIA — documento não emitido"}
          </p>
          {issued ? <p className="text-[11px] text-slate-600">Revisão {header.revision}</p> : null}
        </div>
      </div>

      {!issued ? (
        <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900">
          Prévia sem valor de emissão: o documento oficial recebe número, revisão e código de verificação ao ser emitido.
        </p>
      ) : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-3 print:grid-cols-3">
        <div className="space-y-0.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Cliente</p>
          <Row label="Nome" value={reg?.companyName ?? header.customer.name} />
          <Row label="CNPJ/CPF" value={header.customer.document ?? "Não informado"} />
          {reg?.address || customerPlace ? (
            <Row label="Endereço" value={[reg?.address, customerPlace, reg?.zipCode].filter(Boolean).join(" — ")} />
          ) : null}
          {reg?.contactName || reg?.email || reg?.phone ? (
            <Row label="Contato" value={[reg?.contactName, reg?.email, reg?.phone].filter(Boolean).join(" · ")} />
          ) : null}
          {header.audience === "INTERNAL" ? (
            <Row label="Cadastro" value={header.customer.linked ? "Vinculado ao cadastro de clientes" : "Sem vínculo com o cadastro"} />
          ) : null}
        </div>
        <div className="space-y-0.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Projeto</p>
          <Row label="Projeto" value={`${header.project.code} — ${header.project.title}`} />
          <Row
            label="Versão"
            value={`${header.project.versionNumber != null ? `v${header.project.versionNumber}` : "—"} · ${header.project.statusLabel}`}
          />
          {header.project.commercialOwner ? <Row label="Resp. comercial" value={header.project.commercialOwner} /> : null}
          {header.audience === "INTERNAL" && header.project.technicalOwner ? (
            <Row label="Resp. técnico" value={header.project.technicalOwner} />
          ) : null}
        </div>
        <div className="space-y-0.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Documento</p>
          <Row label={issued ? "Emitido em" : "Gerado em"} value={formatDocumentDateTime(header.issuedAt)} />
          <Row label={issued ? "Emitido por" : "Gerado por"} value={header.issuedBy.name} />
          <Row
            label="Valores"
            value={`${header.values.modeLabel}${header.values.pricingSavedAt ? ` (${formatDocumentDateTime(header.values.pricingSavedAt)})` : ""}`}
          />
          {extraRows.map((r) => (
            <React.Fragment key={r.label}>
              <Row label={r.label} value={r.value} />
            </React.Fragment>
          ))}
          {issued && sha256 ? <Row label="Verificação" value={<span className="font-mono">{sha256.slice(0, 16)}</span>} /> : null}
        </div>
      </div>

      {header.values.staleReasons.length > 0 ? (
        <div className="mt-3 rounded border border-red-300 bg-red-50 px-2 py-1.5 text-[11px] text-red-900" data-testid="project-document-stale">
          <p className="font-semibold">Atenção: a precificação salva diverge da situação atual do projeto.</p>
          <ul className="ml-4 list-disc">
            {header.values.staleReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {header.warnings.filter((w) => !w.startsWith("A precificação salva diverge")).length > 0 ? (
        <ul className="mt-2 ml-4 list-disc text-[11px] text-amber-800" data-testid="project-document-warnings">
          {header.warnings
            .filter((w) => !w.startsWith("A precificação salva diverge"))
            .map((w) => (
              <li key={w}>{w}</li>
            ))}
        </ul>
      ) : null}
    </section>
  );
}
