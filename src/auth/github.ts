/**
 * The GitHub side of sign-in: GitHub is only the identity step. We ask for no
 * scopes, read the user's login once, and keep nothing of GitHub's token.
 */

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";

export interface GitHubApp {
  clientId: string;
  clientSecret: string;
  /** This Worker's `/callback`, exactly as registered on the GitHub OAuth app. */
  callbackUrl: string;
}

export interface GitHubUser {
  id: number;
  login: string;
}

/** Where to send the browser to sign in with GitHub. */
export function authorizeUrl(app: GitHubApp, state: string, codeChallenge: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", app.clientId);
  url.searchParams.set("redirect_uri", app.callbackUrl);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("allow_signup", "false");
  return url.toString();
}

/** Exchanges GitHub's code for the signed-in user. */
export async function signedInUser(app: GitHubApp, code: string, codeVerifier: string): Promise<GitHubUser> {
  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code,
      redirect_uri: app.callbackUrl,
      code_verifier: codeVerifier,
    }),
  });
  throwIfRestricted(tokenResponse);
  // GitHub reports a bad code with 200 and an `error` field.
  const token = (await tokenResponse.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!tokenResponse.ok || !token.access_token) {
    throw new GitHubError(`GitHub refused the sign-in code (${token.error ?? tokenResponse.status})`);
  }

  const userResponse = await fetch(USER_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token.access_token}`,
      "User-Agent": "ai-running-coach",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  throwIfRestricted(userResponse);
  if (!userResponse.ok) {
    throw new GitHubError(`GitHub didn't return the signed-in user (${userResponse.status})`);
  }
  const user = (await userResponse.json()) as Partial<GitHubUser>;
  if (typeof user.id !== "number" || typeof user.login !== "string") {
    throw new GitHubError("GitHub returned a user without an id or login");
  }
  return { id: user.id, login: user.login };
}

/** PKCE (RFC 7636): a fresh verifier and its S256 challenge. */
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * GitHub sometimes blocks one of Cloudflare's shared outbound IPs for a few
 * minutes ("Access to this site has been restricted"), whoever's traffic
 * caused it. Only sign-in talks to GitHub, so it means trying again later.
 */
function throwIfRestricted(response: Response): void {
  if (response.status !== 429) return;
  const seconds = Number(response.headers.get("Retry-After"));
  throw new GitHubUnavailable(Number.isFinite(seconds) && seconds > 0 ? seconds : 300);
}

export class GitHubError extends Error {}

/** GitHub is temporarily refusing requests from this Worker. */
export class GitHubUnavailable extends GitHubError {
  constructor(readonly retryAfterSeconds: number) {
    const minutes = Math.ceil(retryAfterSeconds / 60);
    super(
      "GitHub is temporarily refusing requests from Cloudflare's network, which this server runs on. " +
        `It happens now and then and isn't about your account: try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    );
  }
}
