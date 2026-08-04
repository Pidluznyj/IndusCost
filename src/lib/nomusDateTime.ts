/**
 * Parser explícito do formato de data/hora do Nomus: `DD/MM/YYYY HH:mm:ss`.
 *
 * POR QUE ISTO EXISTE
 * O sync tentava `new Date(raw)` antes de qualquer regex. Para string com
 * barras, o parser implícito do JavaScript aplica o formato AMERICANO
 * (MM/DD/YYYY): `new Date("03/08/2026")` devolve 8 de MARÇO, não 3 de agosto.
 * Como esse caminho retornava cedo, o regex brasileiro que existia logo abaixo
 * era código morto. Foi assim que a CP 01350 (aberta em 03/08/2026) foi gravada
 * como 2026-03-08.
 *
 * O segundo defeito estava no próprio ramo "correto": ele montava a data com
 * `Date.UTC(...)`, gravando meia-noite UTC. Em America/Sao_Paulo (UTC-3) isso
 * exibe o DIA ANTERIOR às 21h — a data civil andava um dia para trás. Aqui a
 * data é montada no fuso operacional do servidor, que é o mesmo critério já
 * usado por `civilDateToLocalDate` em `financeCivilDate.ts` e o que produziu os
 * valores `-03:00` observados no banco.
 *
 * REGRA: nada de `new Date(string)` com string brasileira. Só componentes
 * validados um a um.
 */

export type NomusDateTimeParseResult =
  | { ok: true; value: Date }
  | { ok: false; reason: string };

/**
 * Type guards explícitos.
 *
 * O `tsconfig` do projeto não habilita `strict`, e sem `strictNullChecks` o
 * TypeScript não estreita união discriminada por `if (!r.ok)`. Guards nomeados
 * funcionam em qualquer configuração e deixam o call site legível.
 */
export function isNomusDateTimeSuccess(
  result: NomusDateTimeParseResult
): result is Extract<NomusDateTimeParseResult, { ok: true }> {
  return result.ok === true;
}

export function isNomusDateTimeFailure(
  result: NomusDateTimeParseResult
): result is Extract<NomusDateTimeParseResult, { ok: false }> {
  return result.ok === false;
}

/** `DD/MM/YYYY` com hora opcional `HH:mm` ou `HH:mm:ss`. */
const NOMUS_DATETIME_RE =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

function daysInMonth(year: number, month: number): number {
  // Dia 0 do mês seguinte = último dia do mês corrente.
  return new Date(year, month, 0).getDate();
}

/**
 * Converte `DD/MM/YYYY HH:mm:ss` do Nomus em `Date` no fuso operacional.
 *
 * Devolve diagnóstico legível em vez de `null` mudo — data inválida na origem
 * precisa aparecer no relatório do sync, não sumir.
 */
export function parseNomusBrazilianDateTime(
  input: unknown
): NomusDateTimeParseResult {
  if (input instanceof Date) {
    return Number.isNaN(input.getTime())
      ? { ok: false, reason: "Date inválido recebido" }
      : { ok: true, value: input };
  }
  if (typeof input !== "string") {
    return { ok: false, reason: `esperado texto, recebido ${typeof input}` };
  }

  const raw = input.trim();
  if (!raw) return { ok: false, reason: "vazio" };

  const m = NOMUS_DATETIME_RE.exec(raw);
  if (!m) {
    return {
      ok: false,
      reason: `fora do formato DD/MM/YYYY [HH:mm[:ss]]: "${raw}"`,
    };
  }

  const day = Number.parseInt(m[1]!, 10);
  const month = Number.parseInt(m[2]!, 10);
  const year = Number.parseInt(m[3]!, 10);
  const hour = Number.parseInt(m[4] ?? "0", 10);
  const minute = Number.parseInt(m[5] ?? "0", 10);
  const second = Number.parseInt(m[6] ?? "0", 10);

  if (year < 1900 || year > 2999) {
    return { ok: false, reason: `ano fora do intervalo plausível: ${year}` };
  }
  if (month < 1 || month > 12) {
    return { ok: false, reason: `mês inválido: ${month}` };
  }
  const maxDay = daysInMonth(year, month);
  if (day < 1 || day > maxDay) {
    return {
      ok: false,
      reason: `dia inválido para ${String(month).padStart(2, "0")}/${year}: ${day} (máximo ${maxDay})`,
    };
  }
  if (hour > 23) return { ok: false, reason: `hora inválida: ${hour}` };
  if (minute > 59) return { ok: false, reason: `minuto inválido: ${minute}` };
  if (second > 59) return { ok: false, reason: `segundo inválido: ${second}` };

  // Fuso operacional (local do servidor), NÃO Date.UTC — meia-noite UTC
  // exibiria o dia anterior em UTC-3.
  const value = new Date(year, month - 1, day, hour, minute, second, 0);
  if (Number.isNaN(value.getTime())) {
    return { ok: false, reason: `data não representável: "${raw}"` };
  }
  return { ok: true, value };
}

/** Versão tolerante para call sites que só querem o valor. Não engole erro: use o Result quando precisar do motivo. */
export function parseNomusBrazilianDateTimeOrNull(input: unknown): Date | null {
  const result = parseNomusBrazilianDateTime(input);
  return result.ok ? result.value : null;
}

/** Chave civil `YYYY-MM-DD` no fuso operacional — para comparação e exibição. */
export function nomusDateTimeToCivilKey(value: Date): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
