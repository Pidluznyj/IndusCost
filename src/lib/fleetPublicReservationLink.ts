/** Link compartilhável da reserva pública por QR (base URL + path técnico ou slug curto). */

export const FLEET_PUBLIC_RESERVATION_PATH = "/public/fleet/reservation";
export const FLEET_PUBLIC_RESERVATION_INITIAL_STEP = "cpf" as const;
export const FLEET_PUBLIC_RESERVATION_DEFAULT_SLUG = "reservar-carro";

/** Slugs reservados — não podem ser usados como link curto. */
export const FLEET_PUBLIC_RESERVATION_RESERVED_SLUGS = [
  "api",
  "fleet",
  "login",
  "settings",
  "public",
  "proposals",
  "dashboard",
  "employees",
  "go",
] as const;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/;

export function normalizePublicReservationBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function isLocalhostOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * Normaliza slug: minúsculas, sem barras nas pontas, sem barras duplicadas.
 * Aceita `reservar-carro` ou `r/frota`.
 */
export function normalizePublicReservationSlug(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().toLowerCase().replace(/^\/+|\/+$/g, "");
  if (!s) return null;
  s = s.replace(/\/+/g, "/");
  return s || null;
}

export type PublicReservationSlugValidation =
  | { ok: true; slug: string }
  | { ok: false; message: string };

export function validatePublicReservationSlug(
  raw: string | null | undefined
): PublicReservationSlugValidation {
  const slug = normalizePublicReservationSlug(raw);
  if (!slug) {
    return { ok: false, message: "Informe um slug para o link curto (ex.: reservar-carro)." };
  }
  if (slug.length > 80) {
    return { ok: false, message: "Slug excede 80 caracteres." };
  }
  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      message: "Slug inválido. Use apenas letras minúsculas, números, hífen e barra opcional (ex.: r/frota).",
    };
  }
  if (
    FLEET_PUBLIC_RESERVATION_RESERVED_SLUGS.includes(
      slug as (typeof FLEET_PUBLIC_RESERVATION_RESERVED_SLUGS)[number]
    )
  ) {
    return { ok: false, message: `Slug "${slug}" é reservado e não pode ser usado.` };
  }
  const firstSegment = slug.split("/")[0] ?? "";
  if (
    FLEET_PUBLIC_RESERVATION_RESERVED_SLUGS.includes(
      firstSegment as (typeof FLEET_PUBLIC_RESERVATION_RESERVED_SLUGS)[number]
    )
  ) {
    return { ok: false, message: `Segmento "${firstSegment}" é reservado e não pode ser usado no slug.` };
  }
  return { ok: true, slug };
}

export function buildPublicReservationShortPath(slug: string | null | undefined): string | null {
  const normalized = normalizePublicReservationSlug(slug);
  if (!normalized) return null;
  return `/${normalized}`;
}

export function buildPublicReservationShortUrl(
  slug: string | null | undefined,
  baseUrl?: string | null
): string | null {
  const path = buildPublicReservationShortPath(slug);
  if (!path) return null;
  if (!baseUrl?.trim()) return path;
  const base = normalizePublicReservationBaseUrl(baseUrl);
  return `${base}${path}`;
}

/**
 * Resolve a base URL para link/QR compartilhável.
 * Prioridade: FleetSettings.publicReservationBaseUrl → origin da requisição (se não for localhost).
 */
export function resolvePublicReservationBaseUrl(
  settings: Record<string, string>,
  requestOrigin?: string | null
): string | null {
  const configured = settings.publicReservationBaseUrl?.trim();
  if (configured) return normalizePublicReservationBaseUrl(configured);

  const origin = requestOrigin?.trim();
  if (origin && !isLocalhostOrigin(origin)) {
    return normalizePublicReservationBaseUrl(origin);
  }

  return null;
}

export function buildPublicReservationUrl(token: string, baseUrl?: string | null): string {
  const path = `${FLEET_PUBLIC_RESERVATION_PATH}/${token}`;
  if (!baseUrl?.trim()) return path;
  const base = normalizePublicReservationBaseUrl(baseUrl);
  return `${base}${path}`;
}

export function buildPublicReservationTechnicalPath(token: string): string {
  return `${FLEET_PUBLIC_RESERVATION_PATH}/${token}`;
}

export type PublicReservationShareLinks = {
  slug: string | null;
  shortPath: string | null;
  shortUrl: string | null;
  technicalPath: string | null;
  technicalUrl: string | null;
  /** Link preferencial para copiar/QR (curto se slug configurado). */
  shareUrl: string | null;
  sharePath: string | null;
};

export function buildPublicReservationShareLinks(input: {
  token: string | null | undefined;
  baseUrl?: string | null;
  slug?: string | null;
}): PublicReservationShareLinks {
  const token = input.token?.trim() || null;
  const baseUrl = input.baseUrl?.trim() ? normalizePublicReservationBaseUrl(input.baseUrl) : null;
  const slug = normalizePublicReservationSlug(input.slug);

  const technicalPath = token ? buildPublicReservationTechnicalPath(token) : null;
  const technicalUrl = technicalPath && baseUrl ? `${baseUrl}${technicalPath}` : technicalPath;

  const shortPath = slug ? buildPublicReservationShortPath(slug) : null;
  const shortUrl = shortPath && baseUrl ? `${baseUrl}${shortPath}` : shortPath;

  const shareUrl = shortUrl || technicalUrl;
  const sharePath = shortPath || technicalPath;

  return {
    slug,
    shortPath,
    shortUrl,
    technicalPath,
    technicalUrl,
    shareUrl,
    sharePath,
  };
}

export function resolveClientPublicReservationBaseUrl(
  apiBaseUrl: string | null | undefined,
  windowOrigin: string
): string | null {
  if (apiBaseUrl?.trim()) return normalizePublicReservationBaseUrl(apiBaseUrl);
  if (!isLocalhostOrigin(windowOrigin)) return normalizePublicReservationBaseUrl(windowOrigin);
  return null;
}

/** Compara path da requisição com o slug configurado (ex.: /reservar-carro). */
export function publicReservationPathMatchesSlug(
  requestPath: string,
  slug: string | null | undefined
): boolean {
  const normalizedSlug = normalizePublicReservationSlug(slug);
  if (!normalizedSlug) return false;
  const path = requestPath.replace(/\/+$/, "") || "/";
  const expected = `/${normalizedSlug}`;
  return path === expected;
}
