/**
 * Extrai fatos EXPRESSOS do teor DJEN. Sem interpretação jurídica.
 */

import type { LegalCasePole, NormalizedAttorney, NormalizedHearing, NormalizedParty } from "./legalExposureContracts.js";

const ACTIVE_LABEL = /\b(RECLAMANTE|REQUERENTE|EXEQUENTE|AUTORA|AUTOR)\b/;
const PASSIVE_LABEL = /\b(RECLAMAD[OA]|REQUERID[OA]|EXECUTAD[OA]|R[EÉ]U|R[EÉ])\b/;
const HEARING_LABEL =
  /AUDI[EÊ]NCIA(?:\s+(?:INICIAL|UNA|DE\s+CONCILIA[CÇ][AÃ]O|DE\s+INSTRU[CÇ][AÃ]O|UNA))?/i;
const BR_DATETIME = /(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s*(?:[àa]s|:)?\s*(\d{1,2})[h:](\d{2}))?/i;
const OAB = /\bOAB\s*\/?\s*([A-Z]{2})\s*n[ºo°.]?\s*(\d{2,7})\b|\b(\d{2,7})\s*\/\s*([A-Z]{2})\b/i;
const URL = /https?:\/\/[^\s<>"']+/gi;

export function sanitizeOfficialPublicationText(value: string | null | undefined): string | null {
  const raw = String(value ?? "");
  if (!raw.trim()) return null;
  const withoutScripts = raw.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ");
  const hrefs = [...withoutScripts.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)].map((row) => row[1]!);
  const withBreaks = withoutScripts.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n");
  const withoutTags = withBreaks.replace(/<[^>]+>/g, " ");
  const decoded = withoutTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  const collapsed = decoded.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!collapsed && hrefs.length === 0) return null;
  const withLinks = [collapsed, ...hrefs].filter(Boolean).join("\n").trim();
  if (!withLinks) return null;
  return withLinks.slice(0, 50_000);
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function brDateToIso(day: string, month: string, year: string, hour?: string, minute?: string): string | null {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const hh = hour != null ? Number(hour) : 0;
  const mm = minute != null ? Number(minute) : 0;
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00.000-03:00`;
  const time = Date.parse(iso);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function nameAfterLabel(line: string, label: RegExp): string | null {
  const folded = fold(line);
  const match = folded.match(label);
  if (!match || match.index == null) return null;
  const after = line.slice(match.index + match[0].length).replace(/^[\s:.\-–—]+/, "").trim();
  const cut = after.split(/\s{2,}|\s+[-–—]\s+|,\s+OAB|\s+OAB\b/i)[0]?.trim() ?? "";
  if (cut.length < 3 || cut.length > 180) return null;
  if (/^(DE|DA|DO|PARA|NO|NA)$/i.test(cut)) return null;
  return cut;
}

export type ParsedDjenPublication = {
  parties: NormalizedParty[];
  attorneys: NormalizedAttorney[];
  hearings: NormalizedHearing[];
  filedAt: string | null;
  judge: string | null;
  officialLinks: string[];
  mentionsDecision: boolean;
};

export function parseDjenPublicationText(value: string | null | undefined): ParsedDjenPublication {
  const text = sanitizeOfficialPublicationText(value) ?? "";
  const folded = fold(text);
  const parties: NormalizedParty[] = [];
  const seenParty = new Set<string>();
  const attorneys: NormalizedAttorney[] = [];
  const hearings: NormalizedHearing[] = [];
  const officialLinks = [...new Set(text.match(URL) ?? [])];

  for (const line of text.split(/\n|(?=\b(?:AUTOR|AUTORA|RECLAMANTE|RECLAMAD|R[EÉ]U|REQUERENTE|REQUERID|EXEQUENTE|EXECUTAD)\b)/i)) {
    const active = ACTIVE_LABEL.test(fold(line));
    const passive = PASSIVE_LABEL.test(fold(line));
    const pole: LegalCasePole | null = active && !passive ? "ACTIVE" : passive && !active ? "PASSIVE" : null;
    if (!pole) continue;
    const name = nameAfterLabel(line, pole === "ACTIVE" ? ACTIVE_LABEL : PASSIVE_LABEL);
    if (!name) continue;
    const key = `${pole}:${fold(name)}`;
    if (seenParty.has(key)) continue;
    seenParty.add(key);
    parties.push({
      name,
      document: null,
      partyType: pole === "ACTIVE" ? "RECLAMANTE" : "RECLAMADO",
      personType: "UNKNOWN",
      pole,
    });
  }

  const oabMatch = text.match(OAB);
  if (oabMatch) {
    const oabState = (oabMatch[1] ?? oabMatch[4] ?? "").toUpperCase() || null;
    const oabNumber = oabMatch[2] ?? oabMatch[3] ?? null;
    const before = text.slice(0, oabMatch.index ?? 0);
    const nameGuess = before.split(/\n|,|;/).map((part) => part.trim()).filter((part) => part.length > 3).at(-1) ?? null;
    attorneys.push({
      name: nameGuess || "Advogado",
      document: null,
      oabNumber,
      oabState,
      representedPartyName: null,
      representedPartyDocument: null,
    });
  }

  const hearingMatch = folded.match(HEARING_LABEL);
  if (hearingMatch) {
    const around = text.slice(Math.max(0, (hearingMatch.index ?? 0) - 20), (hearingMatch.index ?? 0) + 160);
    const dateMatch = around.match(BR_DATETIME);
    const scheduledAt = dateMatch
      ? brDateToIso(dateMatch[1]!, dateMatch[2]!, dateMatch[3]!, dateMatch[4], dateMatch[5])
      : null;
    if (scheduledAt) {
      hearings.push({
        type: hearingMatch[0].replace(/\s+/g, " ").trim(),
        scheduledAt,
        status: null,
        courtUnit: null,
      });
    }
  }

  let filedAt: string | null = null;
  if (/\bDISTRIBU[IÍ]D[OA]\b/.test(folded) || /\bDISTRIBUICAO\b/.test(folded)) {
    const dist = text.match(new RegExp(`(?:DISTRIBU[IÍ]D[OA]|DISTRIBUI[CÇ][AÃ]O)[^\\d]{0,40}${BR_DATETIME.source}`, "i"));
    if (dist) filedAt = brDateToIso(dist[1]!, dist[2]!, dist[3]!, dist[4], dist[5]);
  }

  const judgeLine = text.match(/\b(?:JUIZ[A]?|MAGISTRADO[A]?)[:\s]+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-Za-zÁÉÍÓÚÂÊÔÃÕÇáéíóúâêôãõç' ]{4,80})/);
  return {
    parties,
    attorneys,
    hearings,
    filedAt,
    judge: judgeLine?.[1]?.trim() ?? null,
    officialLinks,
    mentionsDecision: /\b(SENTENCA|ACORDAO|DESPACHO|DECISAO)\b/.test(folded),
  };
}

export function poleFromDjenLabel(value: unknown): LegalCasePole {
  const folded = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
  if (!folded) return "UNKNOWN";
  if (ACTIVE_LABEL.test(folded) || folded.includes("ATIVO") || folded === "AT" || folded === "A") return "ACTIVE";
  if (PASSIVE_LABEL.test(folded) || folded.includes("PASSIVO") || folded === "PA" || folded === "P") return "PASSIVE";
  if (folded.includes("TERCEIR")) return "THIRD_PARTY";
  return "UNKNOWN";
}
