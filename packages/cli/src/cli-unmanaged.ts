export function requireUnmanagedHelperAcknowledgement(
  options: { unmanaged?: boolean },
  action: string
): void {
  if (options.unmanaged !== true) {
    throw new Error(
      `Refusing to ${action} through an unmanaged helper. Use the governed runtime, or pass --unmanaged to acknowledge this bypass.`
    );
  }
}
