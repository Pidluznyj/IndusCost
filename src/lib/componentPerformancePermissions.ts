export const COMPONENT_PERFORMANCE_VIEW_PERMISSIONS = [
  "operations.component-performance.view",
] as const;

export const COMPONENT_PERFORMANCE_EDIT_PERMISSIONS = [
  "operations.component-performance.edit",
] as const;

export const COMPONENT_PERFORMANCE_ACCESS_PERMISSIONS = [
  ...COMPONENT_PERFORMANCE_VIEW_PERMISSIONS,
  ...COMPONENT_PERFORMANCE_EDIT_PERMISSIONS,
  "products.edit",
  "products.view",
] as const;
