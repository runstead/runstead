export function requireSecretPrintAcknowledgement(
  options: { printSecret?: boolean },
  secretName: string
): void {
  if (options.printSecret !== true) {
    throw new Error(
      `Refusing to print ${secretName}. Pass --print-secret to acknowledge stdout will contain a credential.`
    );
  }
}
