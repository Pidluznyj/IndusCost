export type {
  WikiAlert,
  WikiAlertType,
  WikiBadge,
  WikiFlowStep,
  WikiGlossaryTerm,
  WikiModuleCard,
  SystemGuideEntry,
  SystemGuideSection,
} from "@/src/lib/systemGuide/types";

export { SYSTEM_GUIDE_SECTIONS } from "@/src/lib/systemGuide/sections";
export { SYSTEM_WIKI_GLOSSARY } from "@/src/lib/systemGuide/glossary";
export {
  SYSTEM_WIKI_MAIN_FLOWS,
  SYSTEM_WIKI_MODULE_CARDS,
  SYSTEM_WIKI_QUICK_START,
} from "@/src/lib/systemGuide/flows";

export const SYSTEM_GUIDE_MAINTENANCE_HINT =
  "Alterações de funcionalidade devem refletir em src/lib/systemGuide/ (Wiki do Sistema).";
