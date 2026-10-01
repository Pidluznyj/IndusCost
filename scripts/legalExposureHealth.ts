/**
 * Saúde local das flags. Não consulta banco remoto nem fontes externas.
 */

import { publicSourceConfiguration } from "../src/lib/legalExposure/legalExposureFeatureFlags.js";
import { LEGAL_EXPOSURE_SOURCE_SCHEDULE } from "../src/lib/legalExposure/legalExposureSourceSchedule.js";
import { LEGAL_EXPOSURE_HEALTH_INTERVAL_MINUTES } from "../src/lib/legalExposure/legalExposureSourceSchedule.js";

console.log(
  JSON.stringify(
    {
      configuration: publicSourceConfiguration(),
      schedule: LEGAL_EXPOSURE_SOURCE_SCHEDULE,
      healthIntervalMinutes: LEGAL_EXPOSURE_HEALTH_INTERVAL_MINUTES,
      externalCall: false,
    },
    null,
    2
  )
);
