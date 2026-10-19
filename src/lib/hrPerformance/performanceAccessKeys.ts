/** Recursos do catálogo. Resultado, calibração, homologação e conduta não herdam o atalho de editor de RH. */
export const PERFORMANCE_RESOURCE_KEYS = {
  module: "admin.employees.performance",
  tracking: "admin.employees.performance.tracking",
  cycles: "admin.employees.performance.cycles",
  models: "admin.employees.performance.models",
  results: "admin.employees.performance.results",
  calibration: "admin.employees.performance.calibration",
  homologation: "admin.employees.performance.homologation",
  reports: "admin.employees.performance.reports",
  invites: "admin.employees.performance.invites",
  conduct: "admin.employees.performance.conduct",
} as const;

export const PERFORMANCE_LEGACY_KEYS = {
  view: "employees.performance.view",
  evaluate: "employees.performance.evaluate",
  manage: "employees.performance.manage",
  tracking: "employees.performance.tracking",
  trackingExport: "employees.performance.tracking.export",
  cycles: "employees.performance.cycles.manage",
  models: "employees.performance.models.manage",
  results: "employees.performance.results",
  calibrationView: "employees.performance.calibration.view",
  calibrate: "employees.performance.calibrate",
  homologate: "employees.performance.homologate.manage",
  report: "employees.performance.report",
  invites: "employees.performance.invites",
  conduct: "employees.performance.conduct",
} as const;
