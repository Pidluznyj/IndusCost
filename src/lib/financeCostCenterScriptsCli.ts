/** Utilitários compartilhados pelos scripts CLI financeiros (servidor). */

export const FINANCE_CLI_USER = {
  userId: null,
  userName: "finance-cli",
} as const;

export const FINANCE_CLI_LOG_PREFIX = {
  suppliersPreview: "[finance-suppliers-preview]",
  suppliersApply: "[finance-suppliers-apply]",
  classificationPreview: "[finance-cc-classification-preview]",
  classificationApply: "[finance-cc-classification-apply]",
  integrityCheck: "[finance-cc-integrity]",
} as const;

export const FINANCE_CLI_SCRIPT_PATHS = {
  suppliersPreview: "scripts/finance-suppliers-from-ap-preview.ts",
  suppliersApply: "scripts/finance-suppliers-from-ap-apply.ts",
  classificationPreview: "scripts/finance-cost-center-classification-preview.ts",
  classificationApply: "scripts/finance-cost-center-classification-apply.ts",
  integrityCheck: "scripts/finance-cost-center-integrity-check.ts",
} as const;

export function parseConfirmArg(argv: string[]): string | null {
  for (const arg of argv) {
    const match = arg.match(/^--confirm=(.+)$/);
    if (match) return match[1];
  }
  return null;
}

export function parseOutArg(argv: string[]): string | null {
  for (const arg of argv) {
    const match = arg.match(/^--out=(.+)$/);
    if (match) return match[1].trim();
  }
  return null;
}

export function parseFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

export function parseStringArg(argv: string[], key: string): string | undefined {
  const prefix = `--${key}=`;
  for (const arg of argv) {
    if (arg.startsWith(prefix)) {
      const value = arg.slice(prefix.length).trim();
      return value || undefined;
    }
  }
  return undefined;
}

export function requireDatabaseUrl(logPrefix: string): void {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error(`${logPrefix} DATABASE_URL não definida.`);
    process.exit(3);
  }
}

export function formatCliMoney(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function logDryRunApplyRequired(logPrefix: string, confirmationText: string): void {
  console.warn(`${logPrefix} Modo dry-run — nenhuma alteração foi aplicada.`);
  console.warn(
    `${logPrefix} Para aplicar, execute novamente com --confirm="${confirmationText}"`
  );
}

export function scriptTouchesNomusAccountsPayable(source: string): boolean {
  return (
    /\.nomusAccountsPayable\.(update|delete|create|upsert)\b/.test(source) ||
    /nomusAccountsPayable\.updateMany/.test(source) ||
    /nomusAccountsPayable\.deleteMany/.test(source)
  );
}
