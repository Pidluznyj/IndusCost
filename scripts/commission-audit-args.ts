export function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

export function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

export function parseYearPeriod(): { from: Date; to: Date; label: string } {
  const fromArg = parseArg("from");
  const toArg = parseArg("to");
  const yearArg = parseArg("year");
  const monthArg = parseArg("month");

  if (fromArg && toArg) {
    const from = new Date(`${fromArg}T00:00:00`);
    const to = new Date(`${toArg}T23:59:59.999`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new Error("Datas inválidas em --from ou --to. Use YYYY-MM-DD.");
    }
    return { from, to, label: `${fromArg} a ${toArg}` };
  }

  const year = yearArg ? Number(yearArg) : 2026;
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    throw new Error("Ano inválido em --year.");
  }

  if (monthArg) {
    const month = Number(monthArg);
    if (!Number.isFinite(month) || month < 1 || month > 12) {
      throw new Error("Mês inválido em --month (1-12).");
    }
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0, 23, 59, 59, 999);
    const mm = String(month).padStart(2, "0");
    return { from, to, label: `${mm}/${year}` };
  }

  const from = new Date(year, 0, 1);
  const to = new Date(year, 11, 31, 23, 59, 59, 999);
  return { from, to, label: `ano ${year}` };
}

export function requireDatabaseUrl(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error(
      "DATABASE_URL não configurada. Configure .env ou variável de ambiente antes de executar a auditoria."
    );
  }
}

/** Aviso padrão para scripts legados de custo/preço/comissão fora do motor trace. */
export const TRACE_LEGACY_SCRIPT_WARNING =
  "LEGACY MODE — não usar como fonte oficial de pagamento/preço/custo.";

export function warnTraceLegacyMode(context: string, officialHint?: string): void {
  console.warn(`⚠ ${TRACE_LEGACY_SCRIPT_WARNING} (${context})`);
  if (officialHint) console.warn(`  Fonte oficial: ${officialHint}`);
}
