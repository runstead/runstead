export type CodexDirectToolName =
  | "list_files"
  | "search_text"
  | "read_file"
  | "read_many_files"
  | "file_info"
  | "tree"
  | "package_scripts"
  | "apply_patch"
  | "run_verifier"
  | "write_file"
  | "run_command"
  | "git_status"
  | "git_diff"
  | "git_log"
  | "git_show"
  | "diff_summary"
  | "read_evidence"
  | "workspace_facts";

export interface CodexDirectToolCall {
  id: string;
  name: CodexDirectToolName;
  arguments: Record<string, unknown>;
}
