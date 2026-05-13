import { fileURLToPath } from "node:url";

export function getEmailFollowupPackDir(): string {
  return fileURLToPath(new URL("../packs/email-followup", import.meta.url));
}
