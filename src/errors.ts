import type { TransportMode } from "./config.js";

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

/** HTTP header carrying the MetExplore user token in HTTP mode. */
export const USER_TOKEN_HEADER = "x-metexplore-token";

/**
 * Translates a raw MetExplore API error status/message into an actionable
 * message for the user, distinguishing the two tokens (app vs. user).
 */
export function toFriendlyAuthMessage(
  status: number,
  apiMessage: string,
  /** Where the credentials come from: the server's .env (stdio) or the X-MetExplore-Token header (http). */
  mode: TransportMode = "stdio",
): string | undefined {
  if (status !== 401) return undefined;

  const msg = apiMessage.toLowerCase();
  if (msg.includes("app token") || msg.includes("app key")) {
    return mode === "stdio"
      ? "The MetExplore app token (METEXPLORE_APP_KEY) is missing or invalid. Check its value in your .env file."
      : "The MetExplore app token configured on this MCP server (METEXPLORE_APP_KEY) is invalid. " +
          "Contact the server administrator.";
  }
  if (msg.includes("no token") || msg.includes("token not valid") || msg.includes("problem with token")) {
    return mode === "stdio"
      ? "The MetExplore user token is missing, invalid, or expired. " +
          "Check METEXPLORE_USER_TOKEN, or METEXPLORE_USER_LOGIN/METEXPLORE_USER_PASSWORD in .env."
      : "The MetExplore user token is missing, invalid, or expired. Send a valid token in the " +
          "X-MetExplore-Token header of your MCP client configuration (or omit the header to " +
          "access public networks only).";
  }
  return `MetExplore authentication error: ${apiMessage}`;
}
