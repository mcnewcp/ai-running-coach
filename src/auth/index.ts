import {
  AuthorizationError,
  authorizationErrorRedirect,
  CimdFetchError,
  OAuthProvider,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { authorizeUrl, GitHubError, GitHubUnavailable, pkcePair, signedInUser, type GitHubApp } from "./github";
import { consentPage, errorPage } from "./pages";

/**
 * OAuth in front of the MCP API. This Worker is the OAuth authorization server
 * for MCP clients (claude.ai and friends) and signs people in with GitHub.
 * Only GitHub users on the allowlist (`ALLOWED_GITHUB_USERS`) get a token, and
 * every MCP request checks the allowlist again, so removing someone cuts off
 * the tokens they already hold.
 *
 * Routes: `/mcp` (protected), `/authorize` (consent, then GitHub), `/callback`
 * (back from GitHub), and the provider's own `/token`, `/register` and
 * `/.well-known/*` discovery documents.
 */
export function withGitHubOAuth(api: ExportedHandlerWithFetch): ExportedHandlerWithFetch {
  // The token audience is this Worker's own `/mcp` URL, so it depends on the
  // hostname. Cloudflare only routes this Worker's hostnames here.
  const providers = new Map<string, OAuthProvider<Env>>();
  const providerFor = (origin: string) => {
    let provider = providers.get(origin);
    if (!provider) {
      provider = createProvider(origin, api);
      providers.set(origin, provider);
    }
    return provider;
  };
  return {
    fetch(request, env, ctx) {
      return providerFor(new URL(request.url).origin).fetch(request, env, ctx);
    },
  };
}

type ExportedHandlerWithFetch = Required<Pick<ExportedHandler<Env>, "fetch">>;

/** What a token carries, from sign-in to every MCP request. */
interface AuthProps {
  login: string;
}

/** The env handlers see under the provider, which adds its helpers. */
type AuthEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

const NINETY_DAYS = 90 * 24 * 60 * 60;

function createProvider(origin: string, api: ExportedHandlerWithFetch): OAuthProvider<Env> {
  return new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler: {
      fetch(request, env, ctx) {
        const props = ctx.props as Partial<AuthProps> | undefined;
        if (!props?.login || !isAllowed(env.ALLOWED_GITHUB_USERS, props.login)) {
          return new Response("This GitHub user is no longer allowed.", { status: 403 });
        }
        return api.fetch(request, env, ctx);
      },
    },
    defaultHandler: { fetch: (request, env) => signIn(request, env as AuthEnv) },
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    clientIdMetadataDocumentEnabled: true,
    resourceMetadata: { resource: `${origin}/mcp`, resource_name: "AI Running Coach" },
    // A connection lasts while it's used: each refresh pushes expiry out, so
    // only 90 quiet days (an off-season, say) mean connecting again.
    refreshTokenIdleTTL: NINETY_DAYS,
  });
}

/** Whether a GitHub login is on the comma-separated allowlist. Logins are case-insensitive. */
export function isAllowed(allowlist: string, login: string): boolean {
  return allowlist
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(login.toLowerCase());
}

async function signIn(request: Request, env: AuthEnv): Promise<Response> {
  const { pathname } = new URL(request.url);
  try {
    if (pathname === "/authorize" && request.method === "GET") return await showConsent(request, env);
    if (pathname === "/authorize" && request.method === "POST") return await decide(request, env);
    if (pathname === "/callback" && request.method === "GET") return await finishSignIn(request, env);
  } catch (error) {
    // Redirect back to the client only when the library validated where to.
    if (error instanceof AuthorizationError && error.redirectTo) return redirect(error.redirectTo);
    if (error instanceof AuthorizationError) return errorPage(error.description, 400);
    if (error instanceof CimdFetchError) return errorPage("This app couldn't be verified.", 400);
    if (error instanceof GitHubUnavailable) {
      console.warn(`GitHub refused the token exchange with 429 (Retry-After ${error.retryAfterSeconds}s)`);
      return errorPage(error.message, 503, { "Retry-After": String(error.retryAfterSeconds) });
    }
    if (error instanceof GitHubError) return errorPage(error.message, 502);
    throw error;
  }
  return new Response("Not found", { status: 404 });
}

/** GET /authorize: ask before handing the browser to GitHub (MCP confused-deputy guidance). */
async function showConsent(request: Request, env: AuthEnv): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const authRequest = await oauth.parseAuthRequest(request);
  const details = await oauth.describeConsent(authRequest);
  const consent = await oauth.beginConsent(authRequest);
  consent.headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(consentPage(details, consent.handle), { headers: consent.headers });
}

/** POST /authorize: denied goes back to the client; approved goes to GitHub. */
async function decide(request: Request, env: AuthEnv): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const form = await request.formData();
  const handle = String(form.get("handle") ?? "");
  if (form.get("decision") !== "approve") {
    const denied = await oauth.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }
  const github = gitHubApp(request, env);
  if (!github) return errorPage("Sign-in isn't configured: the GitHub OAuth app secrets are missing.", 500);

  const approved = await oauth.approveConsent(request, handle);
  const pkce = await pkcePair();
  const { state, headers } = await oauth.beginUpstream(approved.request, {
    data: { verifier: pkce.verifier } satisfies UpstreamData,
    headers: approved.headers,
  });
  headers.set("Location", authorizeUrl(github, state, pkce.challenge));
  return new Response(null, { status: 302, headers });
}

interface UpstreamData {
  verifier: string;
}

/** GET /callback: back from GitHub. Only allowlisted users get a grant. */
async function finishSignIn(request: Request, env: AuthEnv): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const { request: original, data, headers } = await oauth.finishUpstream<UpstreamData>(request);
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  if (params.get("error") || !code) {
    headers.set("Location", authorizationErrorRedirect(original, "access_denied", "GitHub sign-in didn't complete"));
    return new Response(null, { status: 302, headers });
  }
  const github = gitHubApp(request, env);
  if (!github) return errorPage("Sign-in isn't configured: the GitHub OAuth app secrets are missing.", 500);

  const user = await signedInUser(github, code, data.verifier);
  if (!isAllowed(env.ALLOWED_GITHUB_USERS, user.login)) {
    console.warn(`Refused sign-in from GitHub user ${user.login}: not on the allowlist`);
    const description = `GitHub user ${user.login} isn't allowed to use this server`;
    headers.set("Location", authorizationErrorRedirect(original, "access_denied", description));
    return new Response(null, { status: 302, headers });
  }

  const { redirectTo } = await oauth.completeAuthorization({
    request: original,
    userId: String(user.id),
    metadata: { login: user.login },
    scope: original.scope,
    props: { login: user.login } satisfies AuthProps,
  });
  headers.set("Location", redirectTo);
  return new Response(null, { status: 302, headers });
}

function gitHubApp(request: Request, env: Env): GitHubApp | undefined {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return undefined;
  return {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    callbackUrl: `${new URL(request.url).origin}/callback`,
  };
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}
