/**
 * Curvas e variantes no espírito Emil Kowalski (animations.dev / design-eng):
 * - ease-out forte (nunca ease-in em UI)
 * - entradas com scale ≥ 0.95 + opacity (nunca scale 0)
 * - UI ≤ ~300ms; stagger 30–60ms
 * - só transform/opacity
 */

/** Strong ease-out — feedback imediato */
export const EMIL_EASE_OUT = [0.23, 1, 0.32, 1] as const;

/** Ease-in-out forte — morph / movimento on-screen */
export const EMIL_EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;

/** Drawer / overlay (Ionic-like) */
export const EMIL_EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

export const EMIL_DURATION = {
  press: 0.14,
  tooltip: 0.15,
  popover: 0.18,
  overlay: 0.22,
  board: 0.24,
} as const;

export const emilOverlayEnter = {
  opacity: 0,
  scale: 0.97,
  y: 10,
} as const;

export const emilOverlayRest = {
  opacity: 1,
  scale: 1,
  y: 0,
} as const;

export const emilOverlayExit = {
  opacity: 0,
  scale: 0.98,
  y: 6,
} as const;

export const emilColumnVariants = {
  hidden: { opacity: 0, y: 10, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1 },
} as const;

export const emilCardVariants = {
  hidden: { opacity: 0, y: 8, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 4, scale: 0.98 },
} as const;

export const emilStaggerContainer = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.045,
      delayChildren: 0.04,
    },
  },
} as const;

export const emilCardListStagger = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.035,
      delayChildren: 0.02,
    },
  },
} as const;
