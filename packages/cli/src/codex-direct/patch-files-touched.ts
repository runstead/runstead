import { inferWorkspacePatchTouchedFiles } from "../codex-direct-native-tools.js";

export function codexDirectPatchFilesTouched(input: {
  patch?: string;
  replacements?: {
    path: string;
    search: string;
    replace: string;
    replaceAll?: boolean;
  }[];
}): string[] {
  return inferWorkspacePatchTouchedFiles(input);
}
