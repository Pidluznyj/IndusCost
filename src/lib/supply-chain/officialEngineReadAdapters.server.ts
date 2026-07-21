/**
 * Adaptadores read-only — reexporta a fábrica de provedores (OP-04).
 * Preferir `createOfficialDataProviders` em código novo.
 */

export {
  createOfficialDataProviders,
  createOfficialEngineReadAdapters,
  type OfficialDataProviderPrisma,
} from "./officialDataProviders.server.js";
