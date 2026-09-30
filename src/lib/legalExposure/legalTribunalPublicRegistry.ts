/**
 * Registry de consultas públicas oficiais por tribunal/sistema.
 * Sem scraping e sem contornar CAPTCHA.
 */

function cnjDigits(value: string): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 20 ? digits : null;
}

function formatCnj(value: string): string {
  const digits = cnjDigits(value) ?? String(value ?? "").replace(/\D/g, "");
  if (digits.length !== 20) return String(value ?? "").trim() || "—";
  return `${digits.slice(0, 7)}-${digits.slice(7, 9)}.${digits.slice(9, 13)}.${digits.slice(13, 14)}.${digits.slice(14, 16)}.${digits.slice(16)}`;
}

export const TRIBUNAL_PUBLIC_MANUAL_ACCESS = "TRIBUNAL_PUBLIC_REQUIRES_MANUAL_ACCESS";

export const TRIBUNAL_PUBLIC_CAPABILITIES = [
  "PARTIES",
  "MOVEMENTS",
  "ATTORNEYS",
  "HEARINGS",
  "CLAIM_VALUE",
  "SUBJECTS",
  "STATUS",
] as const;
export type TribunalPublicCapability = (typeof TRIBUNAL_PUBLIC_CAPABILITIES)[number];

export type TribunalPublicAdapterId = "TRT9_PJE" | "TJPR_PJE" | "TJPR_PROJUDI" | "TJPR_CIVEL";

export type TribunalPublicAdapter = {
  id: TribunalPublicAdapterId;
  tribunal: string;
  system: string;
  label: string;
  officialHomeUrl: string;
  capabilities: TribunalPublicCapability[];
  automated: false;
  reason: typeof TRIBUNAL_PUBLIC_MANUAL_ACCESS;
  buildUrl: (processNumber: string) => string;
};

function withCnj(home: string, processNumber: string): string {
  const formatted = formatCnj(cnjDigits(processNumber) ?? processNumber);
  const url = new URL(home);
  url.searchParams.set("numeroProcesso", formatted);
  return url.toString();
}

const TRT9_PJE: TribunalPublicAdapter = {
  id: "TRT9_PJE",
  tribunal: "TRT9",
  system: "PJe",
  label: "TRT9 · consulta pública PJe",
  officialHomeUrl: "https://pje.trt9.jus.br/consultaprocessual/home",
  capabilities: ["PARTIES", "MOVEMENTS", "ATTORNEYS", "HEARINGS", "STATUS"],
  automated: false,
  reason: TRIBUNAL_PUBLIC_MANUAL_ACCESS,
  buildUrl: (processNumber) => withCnj("https://pje.trt9.jus.br/consultaprocessual/home", processNumber),
};

const TJPR_PJE: TribunalPublicAdapter = {
  id: "TJPR_PJE",
  tribunal: "TJPR",
  system: "PJe",
  label: "TJPR · consulta pública PJe",
  officialHomeUrl: "https://pje.tjpr.jus.br/pje/ConsultaPublica/listView.seam",
  capabilities: ["PARTIES", "MOVEMENTS", "ATTORNEYS", "SUBJECTS", "STATUS"],
  automated: false,
  reason: TRIBUNAL_PUBLIC_MANUAL_ACCESS,
  buildUrl: (processNumber) => withCnj("https://pje.tjpr.jus.br/pje/ConsultaPublica/listView.seam", processNumber),
};

const TJPR_PROJUDI: TribunalPublicAdapter = {
  id: "TJPR_PROJUDI",
  tribunal: "TJPR",
  system: "Projudi",
  label: "TJPR · consulta pública Projudi",
  officialHomeUrl: "https://projudi.tjpr.jus.br/projudi/",
  capabilities: ["PARTIES", "MOVEMENTS", "ATTORNEYS", "CLAIM_VALUE", "SUBJECTS", "STATUS"],
  automated: false,
  reason: TRIBUNAL_PUBLIC_MANUAL_ACCESS,
  buildUrl: (processNumber) => withCnj("https://projudi.tjpr.jus.br/projudi/", processNumber),
};

const TJPR_CIVEL: TribunalPublicAdapter = {
  id: "TJPR_CIVEL",
  tribunal: "TJPR",
  system: "consulta cível",
  label: "TJPR · consulta processual cível",
  officialHomeUrl: "https://portal.tjpr.jus.br/informacoes-a-comunidade/consulta-processual/",
  capabilities: ["PARTIES", "MOVEMENTS", "ATTORNEYS", "SUBJECTS", "STATUS"],
  automated: false,
  reason: TRIBUNAL_PUBLIC_MANUAL_ACCESS,
  buildUrl: (processNumber) =>
    withCnj("https://portal.tjpr.jus.br/informacoes-a-comunidade/consulta-processual/", processNumber),
};

const ADAPTERS: TribunalPublicAdapter[] = [TRT9_PJE, TJPR_PJE, TJPR_PROJUDI, TJPR_CIVEL];

export function justiceSegmentFromCnj(processNumber: string): { justice: string; tribunal: string } | null {
  const digits = cnjDigits(processNumber);
  if (!digits || digits.length !== 20) return null;
  return { justice: digits.slice(13, 14), tribunal: digits.slice(14, 16) };
}

export function inferTribunalAlias(processNumber: string, hinted?: string | null): string | null {
  const hint = hinted?.trim().toUpperCase() ?? "";
  if (hint.includes("TRT9") || hint === "TRT-9") return "TRT9";
  if (hint.includes("TJPR") || hint.includes("PR")) return "TJPR";
  const seg = justiceSegmentFromCnj(processNumber);
  if (!seg) return hint || null;
  if (seg.justice === "5" && seg.tribunal === "09") return "TRT9";
  if (seg.justice === "8" && seg.tribunal === "16") return "TJPR";
  return hint || null;
}

export function resolveTribunalPublicAdapter(input: {
  processNumber: string;
  tribunal?: string | null;
  system?: string | null;
}): TribunalPublicAdapter | null {
  const tribunal = inferTribunalAlias(input.processNumber, input.tribunal);
  const system = (input.system ?? "").toUpperCase();
  if (tribunal === "TRT9") return TRT9_PJE;
  if (tribunal === "TJPR") {
    if (system.includes("PROJUDI")) return TJPR_PROJUDI;
    if (system.includes("PJE")) return TJPR_PJE;
    return TJPR_CIVEL;
  }
  return null;
}

export function listTribunalPublicAdapters(): TribunalPublicAdapter[] {
  return [...ADAPTERS];
}

export function tribunalPublicLookup(input: {
  processNumber: string;
  tribunal?: string | null;
  system?: string | null;
}): {
  adapter: TribunalPublicAdapter | null;
  publicUrl: string | null;
  capabilities: TribunalPublicCapability[];
  automated: boolean;
  errorCode: typeof TRIBUNAL_PUBLIC_MANUAL_ACCESS | "TRIBUNAL_PUBLIC_ADAPTER_MISSING";
} {
  const adapter = resolveTribunalPublicAdapter(input);
  if (!adapter) {
    return {
      adapter: null,
      publicUrl: null,
      capabilities: [],
      automated: false,
      errorCode: "TRIBUNAL_PUBLIC_ADAPTER_MISSING",
    };
  }
  return {
    adapter,
    publicUrl: adapter.buildUrl(input.processNumber),
    capabilities: adapter.capabilities,
    automated: false,
    errorCode: TRIBUNAL_PUBLIC_MANUAL_ACCESS,
  };
}
