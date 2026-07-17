/**
 * DS-03.9 — Loader Prisma read-only da situação financeira do Documento de Saída.
 * Não altera CR, NF, documento nem pedido.
 */

import type { PrismaClient } from "@prisma/client";
import { NOMUS_STOCK_DOCUMENT_TIPO_SAIDA } from "@/src/lib/output-documents/auditOutputDocumentsDb.js";
import {
  resolveOutputDocumentFinancialStatus,
  type OutputDocumentFinancialStatusResult,
} from "@/src/lib/output-documents/outputDocumentFinancialStatusResolver.js";

type PrismaLike = Pick<
  PrismaClient,
  "nomusStockDocument" | "nomusNfe" | "nomusAccountsReceivable"
>;

export type LoadOutputDocumentFinancialStatusOptions = {
  onlySaida?: boolean;
  referenceDate?: Date;
  /** Previsão do pedido (opcional; nunca inventa parcelas). */
  orderForecastValue?: unknown;
};

/**
 * Carrega evidências oficiais do stage/NF/CR e resolve a situação financeira.
 */
export async function loadOutputDocumentFinancialStatus(
  prisma: PrismaLike,
  stockDocumentExternalId: number,
  options: LoadOutputDocumentFinancialStatusOptions = {}
): Promise<OutputDocumentFinancialStatusResult | null> {
  const onlySaida = options.onlySaida !== false;
  const doc = await prisma.nomusStockDocument.findFirst({
    where: {
      externalId: stockDocumentExternalId,
      ...(onlySaida
        ? { tipoDocumentoEstoque: NOMUS_STOCK_DOCUMENT_TIPO_SAIDA }
        : {}),
    },
    select: {
      externalId: true,
      idNfe: true,
      isCancelled: true,
      paymentTermsRaw: true,
      totalValue: true,
    },
  });
  if (!doc) return null;

  const idNfe = doc.idNfe;
  const [nfe, receivables] = await Promise.all([
    idNfe != null
      ? prisma.nomusNfe.findUnique({
          where: { externalId: idNfe },
          select: {
            externalId: true,
            status: true,
            valorLiquido: true,
            xmlVNF: true,
          },
        })
      : Promise.resolve(null),
    idNfe != null
      ? prisma.nomusAccountsReceivable.findMany({
          where: { sourceInvoiceId: idNfe },
          select: {
            id: true,
            externalId: true,
            sourceInvoiceId: true,
            amountReceivable: true,
            amountReceived: true,
            balanceReceivable: true,
            dueDate: true,
            settlementDate: true,
            status: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const nfeValue = nfe?.xmlVNF ?? nfe?.valorLiquido ?? null;

  return resolveOutputDocumentFinancialStatus({
    stockDocumentExternalId: doc.externalId,
    idNfe: doc.idNfe,
    isCancelled: doc.isCancelled,
    paymentTermsRaw: doc.paymentTermsRaw,
    documentTotalValue: doc.totalValue,
    nfeValue,
    nfeStatus: nfe?.status ?? null,
    receivables: receivables.map((r) => ({
      id: r.id,
      externalId: r.externalId,
      sourceInvoiceId: r.sourceInvoiceId,
      amountReceivable: r.amountReceivable,
      amountReceived: r.amountReceived,
      balanceReceivable: r.balanceReceivable,
      dueDate: r.dueDate,
      settlementDate: r.settlementDate,
      status: r.status,
    })),
    orderForecastValue: options.orderForecastValue,
    referenceDate: options.referenceDate,
  });
}
