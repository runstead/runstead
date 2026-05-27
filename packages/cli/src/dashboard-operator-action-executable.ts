export function dashboardOperatorActionExecutable(command: string): boolean {
  return (
    /\bapproval\s+approve-and-resume\b/.test(command) ||
    /\brunstead\s+startup\s+ready\b.*\s--resume\s+/.test(command) ||
    /\brunstead\s+startup\s+complete-check\b/.test(command) ||
    /\brunstead\s+startup\s+source\s+plan\b/.test(command) ||
    /\brunstead\s+dashboard\s+build\b/.test(command)
  );
}
