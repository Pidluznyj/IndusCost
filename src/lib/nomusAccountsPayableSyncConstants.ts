export const NOMUS_AP_SYNC_TARGET = "accounts-payable" as const;

export const NOMUS_AP_SYNC_LOCK_FILE =
  process.env.NOMUS_AP_SYNC_LOCK_FILE || "/tmp/induscost-nomus-accounts-payable.lock";
