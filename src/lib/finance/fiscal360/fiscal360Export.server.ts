/**
 * Inteligência Fiscal 360° — exportação XLSX/CSV a partir das tabelas materializadas.
 * Percorre páginas internas (sem limite silencioso). Acima de FISCAL360_EXPORT_MAX_ROWS a exportação
 * é recusada com 413 e o usuário deve filtrar — nunca um arquivo truncado sem aviso.
 * Cada linha traz a FONTE do valor e a versão de regra/materialização.
 */
import * as XLSX from "xlsx";
import type { PrismaClient } from "@prisma/client";
import {
  FISCAL360_CHECK_LABELS,
  FISCAL360_EVIDENCE_LABELS,
  FISCAL360_OPERATION_LABELS,
  FISCAL360_PAYMENT_STATUS_LABELS,
  fiscal360CompanyLabel,
  type Fiscal360OperationClass,
  type Fiscal360PaymentStatus,
} from "./fiscal360Constants.js";
import {
  Fiscal360InputError,
  listFiscal360ApTitles,
  listFiscal360Documents,
  listFiscal360Issues,
  listFiscal360Payments,
  listFiscal360Reconciliation,
} from "./fiscal360QueryService.server.js";
import type { Fiscal360Filters } from "./fiscal360Types.js";

export const FISCAL360_EXPORT_DATASETS = ["payments", "documents", "reconciliation", "issues", "ap-titles"] as const;
export type Fiscal360ExportDataset = (typeof FISCAL360_EXPORT_DATASETS)[number];
export const FISCAL360_EXPORT_MAX_ROWS = 50_000;
const PAGE = 200;

type Sheet = { headers: string[]; rows: Array<Array<string | number | null>> };

async function collect<T>(fetchPage: (page: number) => Promise<{ rows: T[]; total: number }>): Promise<T[]> {
  const first = await fetchPage(1);
  if (first.total > FISCAL360_EXPORT_MAX_ROWS) {
    throw Object.assign(new Fiscal360InputError(`Exportação com ${first.total} linhas excede o limite de ${FISCAL360_EXPORT_MAX_ROWS}. Refine os filtros.`), { status: 413 });
  }
  const out = [...first.rows];
  const pages = Math.ceil(first.total / PAGE);
  for (let p = 2; p <= pages; p += 1) out.push(...(await fetchPage(p)).rows);
  return out;
}

export async function buildFiscal360ExportSheet(db: PrismaClient, dataset: Fiscal360ExportDataset, f: Fiscal360Filters): Promise<Sheet> {
  if (dataset === "payments") {
    const rows = await collect((page) => listFiscal360Payments(db, f, { page, pageSize: PAGE }));
    return {
      headers: ["Tributo", "Empresa", "Competência", "Âncora", "Guia", "Código receita", "Título AP (Nomus)", "Vencimento", "Valor devido", "Valor pago", "Saldo", "Data pagamento", "Fonte da data", "Conta", "Situação", "Evidência", "Vínculo", "Fonte do pago", "Conta no total pago", "Motivo revisão", "Materializado em"],
      rows: rows.map((r) => [
        r.taxType,
        fiscal360CompanyLabel(r.companyCnpj),
        r.competenceMonth,
        r.anchorKey,
        r.guideNumber,
        r.revenueCode,
        r.apExternalId,
        r.dueDate,
        r.amountDue,
        r.paidAmount,
        r.openBalance,
        r.paidAt,
        r.paidAtSource,
        r.paymentAccount,
        FISCAL360_PAYMENT_STATUS_LABELS[r.effectiveStatus as Fiscal360PaymentStatus] ?? r.effectiveStatus,
        FISCAL360_EVIDENCE_LABELS[r.evidenceLevel] ?? r.evidenceLevel,
        r.linkState,
        r.paidSource === "AP_LINK" ? "NomusAccountsPayable (vinculado à guia)" : r.paidSource === "GUIDE_MANUAL" ? "FiscalPaymentGuide.amountPaid (declarado)" : r.paidSource === "AP_TITLE" ? "NomusAccountsPayable (título sem guia)" : "—",
        r.countsInPaidTotals ? "Sim" : "Não (em revisão)",
        r.reviewReason,
        r.materializedAt,
      ]),
    };
  }
  if (dataset === "documents") {
    const rows = await collect((page) => listFiscal360Documents(db, f, { page, pageSize: PAGE }));
    const taxCols = ["ICMS", "ICMS_ST", "ICMS_DESON", "FCP", "IPI", "PIS", "COFINS", "ISS", "IBS", "CBS"];
    return {
      headers: ["NF-e", "Série", "Chave", "Emitente", "Destinatário", "Emissão", "Competência", "Natureza", "Situação", "Classificação", "Faturamento oficial", "Receita oficial", "vNF", ...taxCols.map((t) => `${t} (XML)`), "Status XML", "Fonte"],
      rows: rows.map((r) => [
        r.numero,
        r.serie,
        r.chave,
        fiscal360CompanyLabel(r.companyCnpj),
        r.recipientCnpj,
        r.issueDate,
        r.competenceMonth,
        r.natOp,
        r.fiscalStatus,
        FISCAL360_OPERATION_LABELS[r.operationClass as Fiscal360OperationClass] ?? r.operationClass,
        r.isOfficialBilling ? "Sim" : "Não",
        r.officialRevenueAmount,
        r.vNF,
        ...taxCols.map((t) => r.taxes.find((x) => x.taxType === t)?.amount ?? null),
        r.xmlStatus,
        "NomusNfe + NomusNfeFiscalSummary (XML persistido)",
      ]),
    };
  }
  if (dataset === "reconciliation") {
    const rows = await collect((page) => listFiscal360Reconciliation(db, f, { page, pageSize: PAGE }, null));
    return {
      headers: ["Empresa", "Competência", "Tributo", "Checagem", "Situação", "Sujeito", "Relacionado", "Esperado", "Encontrado", "Diferença", "Mensagem", "Calculado em"],
      rows: rows.map((r) => [fiscal360CompanyLabel(r.companyCnpj), r.competenceMonth, r.taxType, FISCAL360_CHECK_LABELS[r.checkType] ?? r.checkType, r.status, r.subjectId, r.relatedId, r.expectedAmount, r.actualAmount, r.difference, r.message, r.computedAt]),
    };
  }
  if (dataset === "ap-titles") {
    const rows = await collect((page) => listFiscal360ApTitles(db, f, { page, pageSize: PAGE }, null));
    return {
      headers: ["Título AP (Nomus)", "Empresa", "Favorecido", "Descrição", "Classificação Nomus", "Vencimento", "Competência", "Valor", "Pago", "Saldo", "Situação", "Classificação fiscal", "Tributo", "Sugerido", "Confiança", "Regra", "Guia vinculada", "Fonte"],
      rows: rows.map((r) => [r.apExternalId, fiscal360CompanyLabel(r.companyCnpj), r.personName, r.description, r.nomusClassification, r.dueDate, r.competenceMonth, r.amountOriginal, r.amountPaid, r.balance, r.effectiveStatus, r.classificationStatus, r.taxType, r.suggestedTaxType, r.classificationConfidence, r.classificationRule, r.claimedByGuideId, "NomusAccountsPayable (espelho Nomus)"]),
    };
  }
  const rows = await collect((page) => listFiscal360Issues(db, f, { page, pageSize: PAGE }, { issueType: null, issueStatus: "OPEN" }));
  return {
    headers: ["Tipo", "Severidade", "Entidade", "Identificador", "Empresa", "Competência", "Tributo", "Mensagem", "Detectado em", "Última detecção"],
    rows: rows.map((r) => [r.issueType, r.severity, r.entityType, r.entityId, fiscal360CompanyLabel(r.companyCnpj), r.competenceMonth, r.taxType, r.message, r.firstDetectedAt, r.lastDetectedAt]),
  };
}

export function fiscal360SheetToXlsx(sheet: Sheet, f: Fiscal360Filters, dataset: string): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([sheet.headers, ...sheet.rows]), "Dados");
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Inteligência Fiscal 360° — exportação"],
      ["Conjunto", dataset],
      ["Empresa", f.companyCnpj ? fiscal360CompanyLabel(f.companyCnpj) : "Grupo consolidado"],
      ["Competências", `${f.fromMonth} a ${f.toMonth}`],
      ["Base", f.basis === "CASH" ? "Data do pagamento" : "Competência fiscal"],
      ["Tributo", f.taxType ?? "Todos"],
      ["Gerado em", new Date().toISOString()],
      ["Origem", "Tabelas materializadas Fiscal* (sem recálculo das fontes)"],
    ]),
    "Filtros"
  );
  return Buffer.from(XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer);
}

function csvCell(value: string | number | null): string {
  if (value == null) return "";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(".", ",");
  const s = String(value);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function fiscal360SheetToCsv(sheet: Sheet): string {
  return `﻿${[sheet.headers, ...sheet.rows].map((r) => r.map(csvCell).join(";")).join("\r\n")}`;
}
