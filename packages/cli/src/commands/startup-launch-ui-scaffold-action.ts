import { requireRbacPermission } from "../cli-rbac.js";

export interface StartupLaunchUiTestScaffoldCommandOptions {
  cwd?: string;
  url?: string;
  testPath?: string;
  flow?: string;
  expectText: string[];
  actor: string;
}

export async function runStartupLaunchUiTestScaffoldCommand(
  options: StartupLaunchUiTestScaffoldCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "evidence.write",
    action: "generate startup UI test scaffold"
  });

  const { formatStartupUiTestScaffold, generateStartupUiTestScaffold } =
    await import("../startup-ui-test-scaffold.js");
  const result = await generateStartupUiTestScaffold({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.url === undefined ? {} : { url: options.url }),
    ...(options.testPath === undefined ? {} : { testPath: options.testPath }),
    ...(options.flow === undefined ? {} : { flow: options.flow }),
    expectText: options.expectText
  });

  console.log(formatStartupUiTestScaffold(result));
}
