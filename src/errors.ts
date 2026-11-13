export class MetExploreAuthError extends Error {}
export class MetExploreQuotaError extends Error {}
export class MetExploreApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Translates a raw MetExplore API error status/message into an actionable
 * message for the user, distinguishing the two tokens (app vs. user).
 */
export function toFriendlyAuthMessage(status: number, apiMessage: string): string | undefined {
  if (status !== 401) return undefined;

  const msg = apiMessage.toLowerCase();
  if (msg.includes("app token") || msg.includes("app key")) {
    return (
      "The MetExplore app token (METEXPLORE_APP_KEY) is missing or invalid. " +
      "Check its value in your .env file."
    );
  }
  if (msg.includes("no token") || msg.includes("token not valid") || msg.includes("problem with token")) {
    return (
      "The MetExplore user token is missing, invalid, or expired. " +
      "Check METEXPLORE_USER_TOKEN, or METEXPLORE_USER_LOGIN/METEXPLORE_USER_PASSWORD in .env."
    );
  }
  return `MetExplore authentication error: ${apiMessage}`;
}
