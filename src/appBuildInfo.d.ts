import type { AppBuildInfo } from "@/src/lib/appVersionShared";

declare global {
  const __APP_BUILD_INFO__: AppBuildInfo;
}

export {};
