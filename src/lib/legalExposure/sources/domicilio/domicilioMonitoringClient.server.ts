/**
 * Cliente read-only do Domicílio, por conta institucional.
 * Só identifica a instituição e lista comunicações. Não abre documento,
 * não registra leitura e não chama nenhuma outra rota.
 */

import type { LegalQueryOutcome } from "../../legalExposureContracts.js";
import type { LegalHttpResult } from "../../legalExposureHttp.js";
import type { DomicilioAccount, DomicilioEndpoints } from "./domicilioAccounts.js";
import { fetchDomicilioAccessToken, invalidateDomicilioToken } from "./domicilioAuth.server.js";
import {
  DOMICILIO_COMMUNICATIONS_PATH,
  DOMICILIO_IDENTITY_PATH,
  DOMICILIO_STATUS_CIENTE_ALL,
  type DomicilioCommunicationQuery,
  type DomicilioInstitution,
} from "./domicilioContracts.js";
import { domicilioRequest, type DomicilioHttpDeps } from "./domicilioHttp.server.js";
import {
  mapDomicilioCommunicationPage,
  mapDomicilioInstitutions,
  selectDomicilioInstitution,
  type DomicilioMappedPage,
} from "./domicilioMapper.js";

export type DomicilioClientContext = {
  account: DomicilioAccount;
  endpoints: DomicilioEndpoints;
  deps: DomicilioHttpDeps;
};

export type DomicilioFailure = {
  ok: false;
  outcome: Exclude<LegalQueryOutcome, "SUCCESS" | "PARTIAL" | "NO_RESULTS">;
  errorMessageSanitized: string;
  retryAfterSeconds: number | null;
  /** Falso quando a falha foi antes de qualquer chamada (ex.: conta sem token). */
  externalCall: boolean;
};

function failureFrom(result: LegalHttpResult, fallback: string): DomicilioFailure {
  const outcome = result.outcome === "SUCCESS" || result.outcome === "PARTIAL" || result.outcome === "NO_RESULTS"
    ? "INVALID_RESPONSE"
    : result.outcome;
  return {
    ok: false,
    outcome,
    errorMessageSanitized: result.errorMessageSanitized ?? fallback,
    retryAfterSeconds: result.retryAfterSeconds,
    externalCall: true,
  };
}

/** GET autenticado. Token recusado (expirado/revogado) é renovado uma única vez. */
async function authorizedGet(
  context: DomicilioClientContext,
  input: { operation: "fetchInstitutionIdentity" | "listCommunications"; url: string; tenantId?: string }
): Promise<LegalHttpResult | DomicilioFailure> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await fetchDomicilioAccessToken(context);
    if (token.ok === false) {
      return {
        ok: false,
        outcome: "AUTH_ERROR",
        errorMessageSanitized: token.errorMessageSanitized,
        retryAfterSeconds: null,
        externalCall: true,
      };
    }
    const result = await domicilioRequest({
      deps: context.deps,
      accountKey: context.account.key,
      operation: input.operation,
      url: input.url,
      tokenUrl: context.endpoints.tokenUrl,
      baseUrl: context.endpoints.baseUrl,
      method: "GET",
      headers: {
        Authorization: `Bearer ${token.token.accessToken}`,
        "On-behalf-Of": context.account.onBehalfOf,
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      },
    });
    if (result.outcome !== "AUTH_ERROR" || attempt > 0) return result;
    invalidateDomicilioToken(context.account);
  }
  return {
    ok: false,
    outcome: "AUTH_ERROR",
    errorMessageSanitized: "Credencial recusada pelo Domicílio.",
    retryAfterSeconds: null,
    externalCall: true,
  };
}

/** Confere que a credencial pertence ao CNPJ da conta e devolve o tenant do CNJ. */
export async function fetchDomicilioInstitution(
  context: DomicilioClientContext
): Promise<{ ok: true; institution: DomicilioInstitution } | DomicilioFailure> {
  const result = await authorizedGet(context, {
    operation: "fetchInstitutionIdentity",
    url: `${context.endpoints.baseUrl}${DOMICILIO_IDENTITY_PATH}`,
  });
  if ("ok" in result) return result;
  if (result.outcome !== "SUCCESS") return failureFrom(result, "Falha na identificação da instituição.");
  const institution = selectDomicilioInstitution(mapDomicilioInstitutions(result.body), context.account);
  if (!institution) {
    return {
      ok: false,
      outcome: "AUTH_ERROR",
      errorMessageSanitized: "A credencial não corresponde ao CNPJ ou ao tenant configurado para esta empresa.",
      retryAfterSeconds: null,
      externalCall: true,
    };
  }
  return { ok: true, institution };
}

export async function listDomicilioCommunicationsPage(
  context: DomicilioClientContext,
  tenantId: string,
  query: DomicilioCommunicationQuery
): Promise<{ ok: true; mapped: DomicilioMappedPage } | DomicilioFailure> {
  const params = new URLSearchParams({ statusCiente: DOMICILIO_STATUS_CIENTE_ALL });
  if (query.numeroProcesso) {
    params.set("numeroProcesso", query.numeroProcesso);
  } else if (query.dataInicio && query.dataFim) {
    params.set("dataInicio", query.dataInicio);
    params.set("dataFim", query.dataFim);
  } else {
    return {
      ok: false,
      outcome: "CONFIGURATION_ERROR",
      errorMessageSanitized: "A listagem exige período ou número de processo.",
      retryAfterSeconds: null,
      externalCall: false,
    };
  }
  params.set("page", String(query.page));
  params.set("size", String(query.size));
  const result = await authorizedGet(context, {
    operation: "listCommunications",
    url: `${context.endpoints.baseUrl}${DOMICILIO_COMMUNICATIONS_PATH}?${params.toString()}`,
    tenantId,
  });
  if ("ok" in result) return result;
  if (result.outcome !== "SUCCESS") return failureFrom(result, "Falha na listagem de comunicações.");
  const mapped = mapDomicilioCommunicationPage(result.body, { accountCnpj: context.account.cnpj, tenantId });
  if (!mapped.page) {
    return {
      ok: false,
      outcome: "INVALID_RESPONSE",
      errorMessageSanitized: "Resposta do Domicílio fora do contrato esperado.",
      retryAfterSeconds: null,
      externalCall: true,
    };
  }
  return { ok: true, mapped };
}
