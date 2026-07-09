/**
 * Servidor: confiabilidade sugerida e override manual de cotações.
 */

import type { PrismaClient } from "@prisma/client";
import {
  buildMaterialMarketQuoteReliabilityAuditDetails,
  computeQuoteSuggestedReliabilityFromAttachments,
  fromPrismaMaterialMarketQuoteReliabilityLevel,
  MaterialMarketQuoteReliabilityValidationError,
  parseMaterialMarketQuoteReliabilityLevel,
  toPrismaMaterialMarketQuoteReliabilityLevel,
  type MaterialMarketQuoteReliabilityLevel,
} from "./materialMarketQuoteReliability.js";

export { MaterialMarketQuoteReliabilityValidationError };

export async function refreshMaterialMarketQuoteReliabilitySuggestion(
  prisma: PrismaClient,
  quoteId: string
): Promise<void> {
  const quote = await prisma.materialMarketQuote.findUnique({
    where: { id: quoteId },
    select: {
      id: true,
      exchangeOrigin: true,
      reliabilityOverrideReason: true,
    },
  });
  if (!quote) return;

  const attachments = await prisma.materialMarketQuoteAttachment.findMany({
    where: { quoteId },
    select: { attachmentType: true, suggestedReliabilityLevel: true },
  });

  const suggested = computeQuoteSuggestedReliabilityFromAttachments(attachments, {
    exchangeOrigin: quote.exchangeOrigin,
  });
  const prismaSuggested = toPrismaMaterialMarketQuoteReliabilityLevel(suggested);
  if (prismaSuggested == null) {
    throw new MaterialMarketQuoteReliabilityValidationError(
      "Não foi possível calcular a confiabilidade sugerida da cotação."
    );
  }
  const hasOverride = Boolean(quote.reliabilityOverrideReason?.trim());

  await prisma.materialMarketQuote.update({
    where: { id: quoteId },
    data: {
      reliabilitySuggestedLevel: prismaSuggested,
      suggestedReliabilityLevel: prismaSuggested,
      ...(hasOverride
        ? {}
        : {
            reliabilityLevel: prismaSuggested,
          }),
    },
  });
}

export async function initializeMaterialMarketQuoteReliability(
  prisma: PrismaClient,
  quoteId: string
): Promise<void> {
  await refreshMaterialMarketQuoteReliabilitySuggestion(prisma, quoteId);
}

export async function overrideMaterialMarketQuoteReliability(
  prisma: PrismaClient,
  input: {
    materialId: string;
    quoteId: string;
    level: MaterialMarketQuoteReliabilityLevel;
    justification: string;
    userId: string;
  }
): Promise<{
  before: MaterialMarketQuoteReliabilityLevel | null;
  after: MaterialMarketQuoteReliabilityLevel;
}> {
  const quote = await prisma.materialMarketQuote.findFirst({
    where: { id: input.quoteId, materialId: input.materialId },
    select: {
      id: true,
      reliabilityLevel: true,
      suggestedReliabilityLevel: true,
      reliabilitySuggestedLevel: true,
    },
  });
  if (!quote) {
    throw new Error("QUOTE_NOT_FOUND");
  }

  const before =
    fromPrismaMaterialMarketQuoteReliabilityLevel(quote.reliabilityLevel) ??
    fromPrismaMaterialMarketQuoteReliabilityLevel(quote.suggestedReliabilityLevel);
  const prismaLevel = toPrismaMaterialMarketQuoteReliabilityLevel(input.level);
  if (prismaLevel == null) {
    throw new MaterialMarketQuoteReliabilityValidationError(
      "Nível de confiabilidade inválido para gravação."
    );
  }
  const now = new Date();

  await prisma.$transaction([
    prisma.materialMarketQuote.update({
      where: { id: quote.id },
      data: {
        reliabilityLevel: prismaLevel,
        reliabilityOverrideReason: input.justification,
        reliabilitySetBy: input.userId,
        reliabilitySetAt: now,
        updatedBy: input.userId,
      },
    }),
    prisma.materialMarketQuoteAuditLog.create({
      data: {
        quoteId: quote.id,
        entityType: "MaterialMarketQuote",
        entityId: quote.id,
        action: "RELIABILITY_CHANGED",
        details: buildMaterialMarketQuoteReliabilityAuditDetails({
          before,
          after: input.level,
          justification: input.justification,
        }),
        userId: input.userId,
      },
    }),
  ]);

  return { before, after: input.level };
}
