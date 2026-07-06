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

import type { SystemGuideSection } from "@/src/lib/systemGuide/types";
import { SYSTEM_GUIDE_SECTIONS as BASE_SECTIONS } from "@/src/lib/systemGuide/sections";
import { SYSTEM_GUIDE_SECTION_EXTENSIONS } from "@/src/lib/systemGuide/sectionsExtended";

function mergeGuideSections(
  base: SystemGuideSection[],
  extensions: Record<string, import("@/src/lib/systemGuide/types").SystemGuideEntry[]>
): SystemGuideSection[] {
  return base.map((section) => {
    const extra = extensions[section.anchor];
    if (!extra?.length) return section;
    return { ...section, entries: [...section.entries, ...extra] };
  });
}

export const SYSTEM_GUIDE_SECTIONS = mergeGuideSections(
  BASE_SECTIONS,
  SYSTEM_GUIDE_SECTION_EXTENSIONS
);
export { SYSTEM_WIKI_GLOSSARY } from "@/src/lib/systemGuide/glossary";
export {
  SYSTEM_WIKI_MAIN_FLOWS,
  SYSTEM_WIKI_MODULE_CARDS,
  SYSTEM_WIKI_QUICK_START,
} from "@/src/lib/systemGuide/flows";

export const SYSTEM_GUIDE_MAINTENANCE_HINT =
  "Alterações de funcionalidade devem refletir em src/lib/systemGuide/ (Wiki do Sistema).";
