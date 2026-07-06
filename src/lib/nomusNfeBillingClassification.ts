/**
 * Espelho PURO do enum Prisma `NomusNfeBillingClassification`
 * (prisma/schema.prisma). Os valores são idênticos às strings persistidas no
 * banco, portanto são estruturalmente compatíveis com o enum gerado pelo
 * Prisma — mas este arquivo NÃO importa `@prisma/client`, podendo ser usado
 * com segurança em código alcançável pelo bundle do navegador.
 */
export const NomusNfeBillingClassification = {
  LOGISTICS_NOT_REVENUE: "LOGISTICS_NOT_REVENUE",
  INTERCOMPANY: "INTERCOMPANY",
  MARKET_REVENUE: "MARKET_REVENUE",
} as const;

export type NomusNfeBillingClassification =
  (typeof NomusNfeBillingClassification)[keyof typeof NomusNfeBillingClassification];
