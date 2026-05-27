export function parseGitLogOutput(stdout: string): {
  sha: string;
  authorName: string;
  authorEmail: string;
  date: string;
  subject: string;
}[] {
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => {
      const [sha = "", authorName = "", authorEmail = "", date = "", subject = ""] =
        line.split("\u001f");

      return {
        sha,
        authorName,
        authorEmail,
        date,
        subject
      };
    });
}
