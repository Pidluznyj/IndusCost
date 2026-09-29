/**
 * Saúde local das flags. Não consulta banco remoto nem fontes externas.
 */

import { publicSourceConfiguration } from "../src/lib/legalExposure/legalExposureFeatureFlags.js";
import { RECOMMENDED_SYNC_SCHEDULE } from "../src/lib/legalExposure/legalExposureHealth.js";

console.log(
  JSON.stringify(
    {
      configuration: publicSourceConfiguration(),
      scheduleMinutes: RECOMMENDED_SYNC_SCHEDULE,
      externalCall: false,
    },
    null,
    2
  )
);
