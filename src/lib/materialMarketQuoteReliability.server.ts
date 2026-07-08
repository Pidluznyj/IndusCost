/**
 * Servidor: confiabilidade sugerida de cotações.
 */

import type { PrismaClient } from "@prisma/client";
import {
  computeQuoteSuggestedReliabilityFromAttachments,
  toPrismaMaterialMarketQuoteReliabilityLevel,
} from "./materialMarketQuoteReliability.js";

export async function refreshMaterialMarketQuoteReliabilitySuggestion(
  prisma: PrismaClient,
  quoteId: string
): Promise<void> {
  const quote = await prisma.materialMarketQuote.findUnique({
    where: { id: quoteId },
    select: { id: true, exchangeOrigin: true },
  });
  if (!quote) return;

  const attachments = await prisma.materialMarketQuoteAttachment.findMany({
    where: { quoteId },
    select: { attachmentType: true, suggestedReliabilityLevel: true },
  });

  const suggested = computeQuoteSuggestedReliabilityFromAttachments(attachments, {
    exchangeOrigin: quote.exchangeOrigin,
  });
  const suggestedReliabilityLevel = toPrismaMaterialMarketQuoteReliabilityLevel(suggested);

  await prisma.materialMarketQuote.update({
    where: { id: quoteId },
    data: { suggestedReliabilityLevel },
  });
}

export async function initializeMaterialMarketQuoteReliability(
  prisma: PrismaClient,
  quoteId: string
): Promise<void> {
  await refreshMaterialMarketQuoteReliabilitySuggestion(prisma, quoteId);
}
