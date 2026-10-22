/**
 * Radar de Relacionamentos. Compara cadastro e QSA já persistidos.
 * Não confirma identidade pelo nome, não calcula saldo e não consulta bureau.
 * A prioridade só ordena a fila. Não autoriza vínculo nem crédito.
 */

import { createHash } from "node:crypto";
import { isValidCnpj, normalizeCnpj } from "@/src/lib/companyCnpjFormat.js";
import { corporateAddressKey, corporateNameKey } from "./corporateRelation.js";

export const CORPORATE_RADAR_GENERIC_CARDINALITY = 8;
export const CORPORATE_RADAR_PAIRS_PER_KEY = 25;
export const CORPORATE_RADAR_ROOT_LIMIT = 40;

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "outlook.com.br",
  "hotmail.com",
  "hotmail.com.br",
  "live.com",
  "yahoo.com",
  "yahoo.com.br",
  "icloud.com",
  "me.com",
  "bol.com.br",
  "uol.com.br",
  "terra.com.br",
  "globo.com",
  "ig.com.br",
  "msn.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
]);

const GENERIC_EMAIL_LOCALS = new Set([
  "contato",
  "comercial",
  "financeiro",
  "fiscal",
  "contador",
  "contabilidade",
  "contabil",
  "escritorio",
  "atendimento",
  "admin",
  "administracao",
  "info",
  "sac",
  "nfe",
  "noreply",
  "naoresponda",
  "vendas",
  "compras",
  "rh",
  "dp",
]);

export type CorporateRadarPatternCode =
  | "REL-01"
  | "REL-02"
  | "REL-03"
  | "REL-04"
  | "REL-05"
  | "REL-06"
  | "REL-07"
  | "REL-08"
  | "REL-09"
  | "REL-10";

export type CorporateRadarClassification =
  | "FORMAL"
  | "HIGH_REVIEW"
  | "REVIEW"
  | "COMPLEMENTARY"
  | "NONE"
  | "REJECTED"
  | "CLOSED";

export type RadarPhoneKind = "COMMERCIAL" | "PERSONAL" | "ACCOUNTING" | "UNKNOWN";

export type RadarParty = {
  customerId: string;
  cnpj: string;
  companyName: string;
  phone?: string | null;
  phoneKind?: RadarPhoneKind | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  segment?: string | null;
  cnae?: string | null;
  restricted?: boolean;
  updatedAt?: Date | null;
};

export type RadarMembership = {
  subjectCustomerId: string;
  nameKey?: string | null;
  displayName?: string | null;
  identityKey?: string | null;
  memberCnpj?: string | null;
  source?: string | null;
  consultedAt?: string | null;
};

export type RadarPattern = {
  code: CorporateRadarPatternCode;
  evidence: string;
  source: string;
  independent: boolean;
  office: boolean;
};

export type RadarCorrelation = {
  pairKey: string;
  customerId: string;
  relatedCustomerId: string;
  patterns: RadarPattern[];
  classification: CorporateRadarClassification;
  direction: "SYMMETRIC" | "PARTICIPATION";
  priorityRank: number;
  priorityReasons: string[];
  fingerprint: string;
  evidenceSummary: string;
  propagationEligible: boolean;
  review: boolean;
};

export type RadarScanResult = {
  examined: number;
  correlations: RadarCorrelation[];
  reviewQueue: RadarCorrelation[];
  formal: RadarCorrelation[];
  genericKeysSkipped: number;
  overflowKeys: number;
  durationMs: number;
};

export function cnpjRoot(value: string | null | undefined): string | null {
  const digits = normalizeCnpj(value);
  if (!isValidCnpj(digits)) return null;
  return digits.slice(0, 8);
}

export function cnpjBranch(value: string | null | undefined): string | null {
  const digits = normalizeCnpj(value);
  if (!isValidCnpj(digits)) return null;
  return digits.slice(8, 12);
}

export function isMatrizCnpj(value: string | null | undefined): boolean {
  return cnpjBranch(value) === "0001";
}

export function sameRootPeers(
  subject: { customerId: string; cnpj: string },
  peers: readonly { customerId: string; cnpj: string }[]
): string[] {
  const root = cnpjRoot(subject.cnpj);
  const own = normalizeCnpj(subject.cnpj);
  if (!root) return [];
  const ids: string[] = [];
  for (const peer of peers) {
    if (peer.customerId === subject.customerId) continue;
    const digits = normalizeCnpj(peer.cnpj);
    if (digits === own) continue;
    if (cnpjRoot(digits) !== root) continue;
    if (!ids.includes(peer.customerId)) ids.push(peer.customerId);
    if (ids.length >= CORPORATE_RADAR_ROOT_LIMIT) break;
  }
  return ids;
}

export function normalizeBrazilPhone(value: string | null | undefined): string | null {
  let digits = String(value ?? "").replace(/\D/g, "");
  digits = digits.replace(/^0+/, "");
  if (digits.startsWith("55") && digits.length >= 12) digits = digits.slice(2);
  if (digits.length !== 10 && digits.length !== 11) return null;
  if (/^(\d)\1+$/.test(digits)) return null;
  if (/^(800|300|500|900)/.test(digits)) return null;
  const subscriber = digits.slice(2);
  if (/^(\d)\1+$/.test(subscriber)) return null;
  return digits;
}

export type RadarEmailClass = "ABSENT" | "PUBLIC" | "GENERIC" | "CORPORATE";

export function classifyCorporateEmail(value: string | null | undefined): {
  email: string | null;
  domain: string | null;
  emailClass: RadarEmailClass;
} {
  const email = String(value ?? "").trim().toLowerCase();
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@") || email.length < 6) {
    return { email: null, domain: null, emailClass: "ABSENT" };
  }
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!domain.includes(".") || local.includes(" ")) return { email: null, domain: null, emailClass: "ABSENT" };
  if (PUBLIC_EMAIL_DOMAINS.has(domain)) return { email, domain, emailClass: "PUBLIC" };
  const localWord = local.replace(/[^a-z0-9]/g, "");
  if (GENERIC_EMAIL_LOCALS.has(localWord) || localWord.includes("contab") || localWord.includes("contador")) {
    return { email, domain, emailClass: "GENERIC" };
  }
  return { email, domain, emailClass: "CORPORATE" };
}

export function corporateRadarPairKey(leftId: string, rightId: string): string {
  return [leftId, rightId].sort().join(":");
}

export function correlateCorporatePair(input: {
  left: RadarParty;
  right: RadarParty;
  memberships: readonly RadarMembership[];
  now?: Date;
  addressGeneric?: boolean;
  rejectedFingerprint?: string | null;
  closed?: boolean;
}): RadarCorrelation {
  const now = input.now ?? new Date();
  const patterns: RadarPattern[] = [];
  const leftRoot = cnpjRoot(input.left.cnpj);
  const rightRoot = cnpjRoot(input.right.cnpj);
  const leftDigits = normalizeCnpj(input.left.cnpj);
  const rightDigits = normalizeCnpj(input.right.cnpj);
  if (leftRoot && leftRoot === rightRoot && leftDigits !== rightDigits) {
    patterns.push({
      code: "REL-01",
      evidence: `Raiz ${leftRoot}. Matriz e filial não são cadastros duplicados.`,
      source: "CADASTRO",
      independent: true,
      office: false,
    });
  }
  const leftMembers = input.memberships.filter((row) => row.subjectCustomerId === input.left.customerId);
  const rightMembers = input.memberships.filter((row) => row.subjectCustomerId === input.right.customerId);
  const sharedIdentity = sharedValue(
    leftMembers.map((row) => row.identityKey),
    rightMembers.map((row) => row.identityKey)
  );
  if (sharedIdentity) {
    patterns.push({
      code: "REL-02",
      evidence: "Identificador societário conferido nas duas consultas. O documento não é exibido.",
      source: leftMembers.find((row) => row.identityKey === sharedIdentity)?.source ?? "QSA",
      independent: true,
      office: false,
    });
  }
  const leftListsRight = leftMembers.some((row) => row.memberCnpj && normalizeCnpj(row.memberCnpj) === rightDigits);
  const rightListsLeft = rightMembers.some((row) => row.memberCnpj && normalizeCnpj(row.memberCnpj) === leftDigits);
  const sharedPartner = sharedValue(
    leftMembers.map((row) => (row.memberCnpj ? normalizeCnpj(row.memberCnpj) : null)),
    rightMembers.map((row) => (row.memberCnpj ? normalizeCnpj(row.memberCnpj) : null))
  );
  if (leftListsRight || rightListsLeft || (sharedPartner && sharedPartner !== leftDigits && sharedPartner !== rightDigits)) {
    patterns.push({
      code: "REL-03",
      evidence: leftListsRight || rightListsLeft ? "CNPJ de sócio PJ no QSA." : `Sócio PJ ${sharedPartner}.`,
      source: "QSA",
      independent: true,
      office: false,
    });
  }
  const sharedName = sharedNamed(leftMembers, rightMembers);
  if (sharedName && sharedName.tokens >= 2 && !sharedIdentity && !sharedPartner) {
    patterns.push({
      code: "REL-04",
      evidence: `Nome coincidente: ${sharedName.label}. Não comprova identidade.`,
      source: sharedName.source,
      independent: true,
      office: false,
    });
  } else if (sharedSurname(leftMembers, rightMembers) && !sharedName) {
    patterns.push({
      code: "REL-10",
      evidence: "Sobrenome igual, sem nome completo coincidente.",
      source: "QSA",
      independent: false,
      office: false,
    });
  }
  const address = corporateAddressKey(input.left);
  const sameAddress = Boolean(address && address === corporateAddressKey(input.right));
  const zip = zipKey(input.left.zipCode);
  const sameZip = Boolean(zip && zip === zipKey(input.right.zipCode));
  const phone = normalizeBrazilPhone(input.left.phone);
  const samePhone = Boolean(phone && phone === normalizeBrazilPhone(input.right.phone));
  const leftEmail = classifyCorporateEmail(input.left.email);
  const rightEmail = classifyCorporateEmail(input.right.email);
  const sameEmail = Boolean(leftEmail.email && leftEmail.email === rightEmail.email);
  const sameDomain = Boolean(
    leftEmail.domain &&
      leftEmail.emailClass === "CORPORATE" &&
      rightEmail.emailClass === "CORPORATE" &&
      leftEmail.domain === rightEmail.domain
  );
  const office =
    input.left.phoneKind === "ACCOUNTING" ||
    input.right.phoneKind === "ACCOUNTING" ||
    leftEmail.emailClass === "GENERIC" ||
    rightEmail.emailClass === "GENERIC" ||
    input.addressGeneric === true;
  if (sameAddress) {
    patterns.push({
      code: "REL-05",
      evidence: "Endereço fiscal completo coincidente.",
      source: "CADASTRO",
      independent: !office,
      office,
    });
  } else if (sameZip) {
    patterns.push({
      code: "REL-09",
      evidence: "CEP coincidente com endereço diferente.",
      source: "CADASTRO",
      independent: false,
      office: false,
    });
  }
  if (samePhone) {
    const accounting = input.left.phoneKind === "ACCOUNTING" || input.right.phoneKind === "ACCOUNTING";
    patterns.push({
      code: "REL-06",
      evidence: accounting ? "Telefone de escritório." : `Telefone terminado em ${phone!.slice(-4)}.`,
      source: "CADASTRO",
      independent: !accounting && !office,
      office: accounting || office,
    });
  }
  if (sameEmail && leftEmail.emailClass === "CORPORATE") {
    patterns.push({
      code: "REL-07",
      evidence: "E-mail corporativo específico coincidente.",
      source: "CADASTRO",
      independent: !office,
      office,
    });
  } else if (sameEmail && leftEmail.emailClass === "PUBLIC") {
    patterns.push({
      code: "REL-10",
      evidence: "Mesmo endereço em provedor público. Não indica grupo.",
      source: "CADASTRO",
      independent: false,
      office: false,
    });
  } else if (sameDomain && !sameEmail) {
    patterns.push({
      code: "REL-08",
      evidence: `Domínio ${leftEmail.domain}.`,
      source: "CADASTRO",
      independent: false,
      office: false,
    });
  }
  if (
    input.left.cnae &&
    input.right.cnae &&
    input.left.cnae === input.right.cnae &&
    !patterns.some((pattern) => pattern.code === "REL-10")
  ) {
    patterns.push({
      code: "REL-10",
      evidence: "Mesmo CNAE.",
      source: "CADASTRO",
      independent: false,
      office: false,
    });
  }
  const independent = patterns.filter((pattern) => pattern.independent);
  const formal = independent.some((pattern) => pattern.code === "REL-01" || pattern.code === "REL-02" || pattern.code === "REL-03");
  const societal = independent.some((pattern) => pattern.code === "REL-04");
  const fingerprint = radarFingerprint(patterns);
  let classification: CorporateRadarClassification = "NONE";
  if (input.closed) classification = "CLOSED";
  else if (input.rejectedFingerprint && input.rejectedFingerprint === fingerprint) classification = "REJECTED";
  else if (formal) classification = "FORMAL";
  else if (societal && independent.length >= 2) classification = "HIGH_REVIEW";
  else if (independent.length >= 2) classification = "HIGH_REVIEW";
  else if (independent.length === 1) classification = "REVIEW";
  else if (patterns.some((pattern) => pattern.office || pattern.code === "REL-08")) classification = "COMPLEMENTARY";
  const restricted = input.left.restricted === true || input.right.restricted === true;
  const priorityReasons: string[] = [];
  let priorityRank = 5;
  if (classification === "REJECTED" || classification === "CLOSED" || classification === "NONE") priorityRank = 5;
  else if (restricted && (formal || societal)) {
    priorityRank = 1;
    priorityReasons.push("Empresa com restrição já conhecida e evidência societária.");
  } else if (formal || societal) {
    priorityRank = 2;
    priorityReasons.push(formal ? "Relação formal verificável." : "Nome completo de sócio para revisão.");
  } else if (independent.length >= 2) {
    priorityRank = 3;
    priorityReasons.push("Mais de um indício independente.");
  } else if (classification === "REVIEW") {
    priorityRank = 4;
    priorityReasons.push("Um indício cadastral para revisão.");
  } else {
    priorityReasons.push("Indício complementar. Não confirma grupo.");
  }
  if (patterns.some((pattern) => pattern.office)) {
    priorityReasons.push("Contatos de escritório contam como um único indício, não como várias provas.");
  }
  const [customerId, relatedCustomerId] = [input.left.customerId, input.right.customerId].sort();
  return {
    pairKey: corporateRadarPairKey(input.left.customerId, input.right.customerId),
    customerId,
    relatedCustomerId,
    patterns,
    classification,
    direction: leftListsRight !== rightListsLeft ? "PARTICIPATION" : "SYMMETRIC",
    priorityRank,
    priorityReasons,
    fingerprint,
    evidenceSummary: patterns.map((pattern) => `${pattern.code} ${pattern.evidence}`).join(" · ") || "Sem evidência relevante.",
    propagationEligible: classification === "FORMAL",
    review: classification === "HIGH_REVIEW" || classification === "REVIEW",
    ...(now ? {} : {}),
  };
}

export function scanCorporateRadar(input: {
  parties: readonly RadarParty[];
  memberships?: readonly RadarMembership[];
  seeds?: readonly string[];
  rejected?: readonly { pairKey: string; fingerprint: string }[];
  closedPairKeys?: readonly string[];
  now?: Date;
  genericCardinality?: number;
  maxPairsPerKey?: number;
}): RadarScanResult {
  const started = Date.now();
  const memberships = input.memberships ?? [];
  const genericCardinality = input.genericCardinality ?? CORPORATE_RADAR_GENERIC_CARDINALITY;
  const maxPairs = input.maxPairsPerKey ?? CORPORATE_RADAR_PAIRS_PER_KEY;
  const byId = new Map(input.parties.map((party) => [party.customerId, party]));
  const buckets = new Map<string, string[]>();
  const add = (kind: string, key: string | null, customerId: string, generic: boolean) => {
    if (!key) return;
    const bucketKey = `${kind}:${key}`;
    const bucket = buckets.get(bucketKey) ?? [];
    if (!bucket.includes(customerId)) bucket.push(customerId);
    buckets.set(bucketKey, bucket);
    if (generic) genericKinds.add(bucketKey);
  };
  const genericKinds = new Set<string>();
  for (const party of input.parties) {
    add("root", cnpjRoot(party.cnpj), party.customerId, false);
    const email = classifyCorporateEmail(party.email);
    add("phone", normalizeBrazilPhone(party.phone), party.customerId, true);
    if (email.emailClass === "CORPORATE") add("email", email.email, party.customerId, true);
    if (email.emailClass === "CORPORATE") add("domain", email.domain, party.customerId, true);
    add("address", corporateAddressKey(party), party.customerId, true);
  }
  for (const row of memberships) {
    if (!byId.has(row.subjectCustomerId)) continue;
    add("identity", row.identityKey ?? null, row.subjectCustomerId, false);
    add("partner", row.memberCnpj ? normalizeCnpj(row.memberCnpj) : null, row.subjectCustomerId, false);
    const name = row.nameKey ?? null;
    if (name && name.split(" ").length >= 2) add("name", name, row.subjectCustomerId, true);
  }
  const addressCounts = new Map<string, number>();
  for (const [key, ids] of buckets) {
    if (key.startsWith("address:")) addressCounts.set(key.slice("address:".length), ids.length);
  }
  const rejected = new Map((input.rejected ?? []).map((row) => [row.pairKey, row.fingerprint]));
  const closed = new Set(input.closedPairKeys ?? []);
  const seeds = input.seeds ? new Set(input.seeds) : null;
  const seen = new Set<string>();
  const correlations: RadarCorrelation[] = [];
  let genericKeysSkipped = 0;
  let overflowKeys = 0;
  for (const [key, ids] of buckets) {
    if (ids.length < 2) continue;
    const generic = genericKinds.has(key);
    if (generic && ids.length > genericCardinality) {
      genericKeysSkipped += 1;
      continue;
    }
    const slice = ids.slice(0, generic ? maxPairs : CORPORATE_RADAR_ROOT_LIMIT);
    if (ids.length > slice.length) overflowKeys += 1;
    for (let leftIndex = 0; leftIndex < slice.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < slice.length; rightIndex += 1) {
        const leftId = slice[leftIndex]!;
        const rightId = slice[rightIndex]!;
        if (seeds && !seeds.has(leftId) && !seeds.has(rightId)) continue;
        const pairKey = corporateRadarPairKey(leftId, rightId);
        if (seen.has(pairKey)) continue;
        const left = byId.get(leftId);
        const right = byId.get(rightId);
        if (!left || !right) continue;
        seen.add(pairKey);
        const address = corporateAddressKey(left);
        const correlation = correlateCorporatePair({
          left,
          right,
          memberships,
          now: input.now,
          addressGeneric: address != null && (addressCounts.get(address) ?? 0) > genericCardinality,
          rejectedFingerprint: rejected.get(pairKey) ?? null,
          closed: closed.has(pairKey),
        });
        if (correlation.classification === "NONE") continue;
        correlations.push(correlation);
      }
    }
  }
  const reviewQueue = correlations
    .filter((row) => row.review)
    .sort((left, right) => left.priorityRank - right.priorityRank || left.pairKey.localeCompare(right.pairKey));
  return {
    examined: seeds ? seeds.size : input.parties.length,
    correlations,
    reviewQueue,
    formal: correlations.filter((row) => row.propagationEligible),
    genericKeysSkipped,
    overflowKeys,
    durationMs: Date.now() - started,
  };
}

export function radarProfileVersion(party: RadarParty): string {
  const email = classifyCorporateEmail(party.email);
  return createHash("sha256")
    .update(
      JSON.stringify({
        root: cnpjRoot(party.cnpj),
        phone: normalizeBrazilPhone(party.phone),
        email: email.emailClass === "CORPORATE" ? email.email : null,
        domain: email.emailClass === "CORPORATE" ? email.domain : null,
        address: corporateAddressKey(party),
      })
    )
    .digest("hex");
}

function radarFingerprint(patterns: readonly RadarPattern[]): string {
  const body = patterns
    .map((pattern) => `${pattern.code}|${pattern.independent ? "1" : "0"}|${pattern.evidence}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(body).digest("hex");
}

function sharedValue(left: readonly (string | null | undefined)[], right: readonly (string | null | undefined)[]): string | null {
  const rights = new Set(right.filter((value): value is string => Boolean(value)));
  for (const value of left) {
    if (value && rights.has(value)) return value;
  }
  return null;
}

function sharedNamed(
  left: readonly RadarMembership[],
  right: readonly RadarMembership[]
): { label: string; source: string; tokens: number } | null {
  for (const row of left) {
    if (!row.nameKey || row.nameKey.split(" ").length < 2) continue;
    const peer = right.find((item) => item.nameKey === row.nameKey);
    if (!peer) continue;
    return { label: row.displayName?.trim() || row.nameKey, source: row.source ?? "QSA", tokens: row.nameKey.split(" ").length };
  }
  return null;
}

function sharedSurname(left: readonly RadarMembership[], right: readonly RadarMembership[]): boolean {
  const last = (value: string | null | undefined) => {
    const parts = (value ?? "").split(" ").filter(Boolean);
    return parts.length >= 2 ? parts[parts.length - 1] : null;
  };
  const rights = new Set(right.map((row) => last(row.nameKey)).filter((value): value is string => Boolean(value)));
  return left.some((row) => {
    const token = last(row.nameKey);
    return Boolean(token && token.length >= 4 && rights.has(token) && !right.some((peer) => peer.nameKey === row.nameKey));
  });
}

function zipKey(value: string | null | undefined): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 8 ? digits : null;
}
