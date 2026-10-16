/** Recursos do catálogo. Conduta não herda o atalho de editor de RH. */
export const PERFORMANCE_RESOURCE_KEYS = {
  module: "admin.employees.performance",
  calibration: "admin.employees.performance.calibration",
  reports: "admin.employees.performance.reports",
  invites: "admin.employees.performance.invites",
  conduct: "admin.employees.performance.conduct",
} as const;

export const PERFORMANCE_LEGACY_KEYS = {
  view: "employees.performance.view",
  evaluate: "employees.performance.evaluate",
  manage: "employees.performance.manage",
  calibrate: "employees.performance.calibrate",
  report: "employees.performance.report",
  invites: "employees.performance.invites",
  conduct: "employees.performance.conduct",
} as const;
