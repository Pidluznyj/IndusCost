import "dotenv/config";
import {
  applyCommercialOwnerInactivity,
  formatPortfolioInactivityPreview,
  previewCommercialOwnerInactivity,
} from "../src/lib/commercial/customerCommercialOwnerInactivity.server.ts";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const preview = args.has("--preview") || !apply;
const confirm = args.has("--confirm=APPLY_OWNER_INACTIVITY");

async function main() {
  const now = new Date();
  if (preview && !apply) {
    const result = await previewCommercialOwnerInactivity(now);
    console.log(formatPortfolioInactivityPreview(result));
    return;
  }
  if (apply) {
    if (!confirm) {
      console.error(
        "Apply recusado. Use: npm run crm:owner-inactivity:apply -- --confirm=APPLY_OWNER_INACTIVITY"
      );
      process.exitCode = 2;
      return;
    }
    const result = await applyCommercialOwnerInactivity(now);
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
