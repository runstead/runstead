export async function resolveGitHubAuthToken(options: {
  cwd?: string;
  githubApp?: boolean;
  installationId?: string;
}): Promise<string | undefined> {
  if (options.githubApp !== true) {
    return undefined;
  }

  const { createGitHubAppInstallationTokenFromConfig } =
    await import("./github-app.js");
  const result = await createGitHubAppInstallationTokenFromConfig({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.installationId === undefined
      ? {}
      : { installationId: options.installationId })
  });

  return result.token;
}
