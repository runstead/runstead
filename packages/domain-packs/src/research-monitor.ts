import { fileURLToPath } from "node:url";

export function getResearchMonitorPackDir(): string {
  return fileURLToPath(new URL("../packs/research-monitor", import.meta.url));
}
