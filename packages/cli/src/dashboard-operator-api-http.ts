export class DashboardOperatorApiHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function dashboardOperatorApiError(
  error: unknown
): DashboardOperatorApiHttpError {
  if (error instanceof DashboardOperatorApiHttpError) {
    return error;
  }

  return new DashboardOperatorApiHttpError(
    500,
    "operator_action_failed",
    error instanceof Error ? error.message : String(error)
  );
}
