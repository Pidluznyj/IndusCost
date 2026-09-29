/** Chaves do Exposure. O backend é a barreira; o menu não basta. */

export const LEGAL_EXPOSURE_RESOURCES = {
  module: "admin.exposure",
  sources: "admin.exposure.sources",
  sync: "admin.exposure.sync",
  certificates: "admin.exposure.certificates",
  communications: "admin.exposure.communications",
  settings: "admin.exposure.settings",
} as const;

export const LEGAL_EXPOSURE_LEGACY = {
  view: "legal.exposure.view",
  manage: "legal.exposure.manage",
  syncExecute: "legal.exposure.sync.execute",
  sourcesView: "legal.exposure.sources.view",
  sourcesManage: "legal.exposure.sources.manage",
  certificatesView: "legal.exposure.certificates.view",
  certificatesManage: "legal.exposure.certificates.manage",
  communicationsView: "legal.exposure.communications.view",
  settingsView: "legal.exposure.settings.view",
  settingsManage: "legal.exposure.settings.manage",
} as const;

export const LEGAL_EXPOSURE_MENU_PERMISSION = LEGAL_EXPOSURE_LEGACY.view;
