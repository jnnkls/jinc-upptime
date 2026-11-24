import { bindings, defineConfig, triggers } from "cf/config";

import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

// GitHub drops most of its own "*/5" schedules under load (3-4 runs/day observed),
// so this Worker fires Upptime's Uptime CI via repository_dispatch every 5 minutes.
export default defineConfig({
  worker: {
    name: "jinc-upptime-trigger",
    entrypoint,
    compatibilityDate: "2026-11-01",
    workersDev: false, // no public HTTP endpoint, cron only
    observability: { enabled: true },
    triggers: [triggers.scheduled({ schedule: "*/5 * * * *" })],
    env: {
      // fine-grained PAT, only jnnkls/jinc-upptime, Contents: write (op://Infrastruktur/GitHub PAT upptime/token)
      GH_TOKEN: bindings.secret(),
    },
  },
});
