// The OAuth sign-in in front of the MCP API. This is the one place tests go
// through the Worker's entry point with OAuth instead of the test seam in
// mcp.ts: it walks the whole flow an MCP client like claude.ai does, with
// GitHub faked and every user synthetic.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import worker from "../src/index";
import { callTool } from "./mcp";

const ORIGIN = "http://localhost";
const CLIENT_REDIRECT = "https://client.example/callback";

describe("signing in with GitHub", () => {
  it("lets an allowlisted user connect and call tools", async () => {
    const signedIn = await signIn({ login: "synthetic-runner" });
    const { redirect } = signedIn;
    expect(redirect.origin + redirect.pathname).toBe(CLIENT_REDIRECT);
    expect(redirect.searchParams.get("state")).toBe("client-state");
    expect(redirect.searchParams.get("iss")).toBe(ORIGIN);

    const token = await exchangeCode(signedIn);
    const client = await connectWithToken(token);
    const output = await callTool(client, "today", { timezone: "UTC" });
    expect(output).toMatchObject({ timezone: "UTC", timezoneSource: "given" });
  });

  it("matches GitHub logins case-insensitively", async () => {
    const { redirect } = await signIn({ login: "Second-RUNNER" });
    expect(redirect.searchParams.get("code")).toBeTruthy();
  });

  it("refuses a GitHub user who isn't on the allowlist", async () => {
    const { redirect } = await signIn({ login: "synthetic-stranger" });
    expect(redirect.origin + redirect.pathname).toBe(CLIENT_REDIRECT);
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.get("error_description")).toContain("synthetic-stranger");
    expect(redirect.searchParams.get("code")).toBeNull();
  });

  it("goes back to the client without visiting GitHub when consent is denied", async () => {
    const { redirect, githubVisited } = await signIn({ login: "synthetic-runner", decision: "deny" });
    expect(githubVisited).toBe(false);
    expect(redirect.searchParams.get("error")).toBe("access_denied");
  });

  it("asks GitHub for no scopes and uses PKCE", async () => {
    const { githubAuthorize } = await signIn({ login: "synthetic-runner" });
    expect(githubAuthorize?.searchParams.get("client_id")).toBe("synthetic-github-client");
    expect(githubAuthorize?.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/callback`);
    expect(githubAuthorize?.searchParams.has("scope")).toBe(false);
    expect(githubAuthorize?.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("says to try again later when GitHub is temporarily restricting Cloudflare", async () => {
    // GitHub sometimes blocks Cloudflare's shared outbound IPs for a few
    // minutes: 429, "Access to this site has been restricted".
    const page = await signInUntilCallback({ login: "synthetic-runner", github: "restricted" });
    expect(page.status).toBe(503);
    expect(page.headers.get("Retry-After")).toBe("300");
    const html = await page.text();
    expect(html).toContain("temporarily");
    expect(html).toContain("try again in 5 minutes");
  });

  it("cuts off existing tokens when a user is removed from the allowlist", async () => {
    const token = await exchangeCode(await signIn({ login: "synthetic-runner" }));

    const response = await call(new Request(`${ORIGIN}/mcp`, initialize(token)), {
      ALLOWED_GITHUB_USERS: "someone-else",
    });
    expect(response.status).toBe(403);
  });
});

describe("the deployed entry point", () => {
  it("refuses MCP requests without a token and points clients at sign-in", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/mcp`, initialize());
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it("publishes where to sign in", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/.well-known/oauth-authorization-server`);
    const metadata = (await response.json()) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      authorization_endpoint: `${ORIGIN}/authorize`,
      token_endpoint: `${ORIGIN}/token`,
      registration_endpoint: `${ORIGIN}/register`,
    });
  });
});

// --- The flow, as an MCP client and a browser see it ---

interface SignInResult {
  /** Where the browser ends up: the client's redirect URI with a code or an error. */
  redirect: URL;
  githubVisited: boolean;
  githubAuthorize?: URL;
  verifier: string;
  clientId: string;
}

interface SignInOptions {
  login: string;
  decision?: "approve" | "deny";
  /** restricted: GitHub's token endpoint answers 429, as it does when it blocks Cloudflare's IPs. */
  github?: "ok" | "restricted";
}

/** Signs in, expecting to end up back at the client. */
async function signIn(options: SignInOptions): Promise<SignInResult> {
  const result = await walkSignIn(options);
  if (!("callback" in result)) return result;
  const { callback, ...rest } = result;
  expect(callback.status).toBe(302);
  return { ...rest, redirect: new URL(callback.headers.get("Location")!) };
}

/** Signs in as far as the callback from GitHub, and returns what the callback answered. */
async function signInUntilCallback(options: SignInOptions): Promise<Response> {
  const result = await walkSignIn(options);
  if (!("callback" in result)) throw new Error("Sign-in never reached GitHub");
  return result.callback;
}

async function walkSignIn(
  options: SignInOptions,
): Promise<SignInResult | (Omit<SignInResult, "redirect"> & { callback: Response })> {
  fakeGitHub(options.login, options.github ?? "ok");
  const cookies = new CookieJar();

  // The MCP client registers itself, then sends the browser to /authorize.
  const registration = await call(
    jsonRequest(`${ORIGIN}/register`, {
      client_name: "Synthetic client",
      redirect_uris: [CLIENT_REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  );
  expect(registration.status).toBe(201);
  const { client_id: clientId } = (await registration.json()) as { client_id: string };

  const verifier = "synthetic-verifier-".padEnd(64, "x");
  const authorize = new URL(`${ORIGIN}/authorize`);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: CLIENT_REDIRECT,
    state: "client-state",
    code_challenge: await s256(verifier),
    code_challenge_method: "S256",
    resource: `${ORIGIN}/mcp`,
  }).toString();

  // The consent page.
  const consent = await call(new Request(authorize));
  expect(consent.status).toBe(200);
  cookies.take(consent);
  const html = await consent.text();
  expect(html).toContain("Synthetic client");
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1];
  expect(handle).toBeTruthy();

  // The runner decides.
  const decided = await call(
    new Request(`${ORIGIN}/authorize`, {
      method: "POST",
      headers: { Cookie: cookies.header(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ handle: handle!, decision: options.decision ?? "approve" }),
    }),
  );
  expect(decided.status).toBe(302);
  cookies.take(decided);
  const next = new URL(decided.headers.get("Location")!);
  if (next.origin !== "https://github.com") {
    return { redirect: next, githubVisited: false, verifier, clientId };
  }

  // GitHub signs them in and sends them back.
  const callback = new URL(`${ORIGIN}/callback`);
  callback.search = new URLSearchParams({ code: "synthetic-github-code", state: next.searchParams.get("state")! }).toString();
  return {
    callback: await call(new Request(callback, { headers: { Cookie: cookies.header() } })),
    githubVisited: true,
    githubAuthorize: next,
    verifier,
    clientId,
  };
}

/** The MCP client trades its code for an access token. */
async function exchangeCode({ redirect, verifier, clientId }: SignInResult): Promise<string> {
  const response = await call(
    new Request(`${ORIGIN}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: redirect.searchParams.get("code")!,
        redirect_uri: CLIENT_REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
        resource: `${ORIGIN}/mcp`,
      }),
    }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { access_token: string; refresh_token?: string };
  expect(body.refresh_token).toBeTruthy();
  return body.access_token;
}

async function connectWithToken(token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
    fetch: (input, init) => {
      const request = new Request(input, init);
      request.headers.set("Authorization", `Bearer ${token}`);
      return call(request);
    },
  });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(transport);
  onTestFinished(() => client.close());
  return client;
}

// --- Plumbing ---

/** Calls the Worker's entry point, optionally with different settings. */
async function call(request: Request, overrides: { ALLOWED_GITHUB_USERS?: string } = {}): Promise<Response> {
  // Real incoming requests always carry Host; the MCP handler checks it.
  request.headers.set("Host", new URL(request.url).host);
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    request as Request<unknown, IncomingRequestCfProperties>,
    { ...env, ...overrides } as Env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

/** Fakes GitHub's token and user endpoints, signing in as `login`. */
function fakeGitHub(login: string, mode: "ok" | "restricted") {
  const realFetch = globalThis.fetch;
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new Request(input, init).url;
    if (url === "https://github.com/login/oauth/access_token") {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("client_secret")).toBe("synthetic-github-secret");
      expect(body.get("code_verifier")).toBeTruthy();
      if (mode === "restricted") {
        const message = "Access to this site has been restricted. Please wait a few minutes before you try again.";
        return Response.json({ code: "429", message }, { status: 429, headers: { "Retry-After": "300" } });
      }
      return Response.json({ access_token: "synthetic-github-token", token_type: "bearer" });
    }
    if (url === "https://api.github.com/user") {
      return Response.json({ id: 1000 + login.length, login });
    }
    return realFetch(input, init);
  });
  onTestFinished(() => spy.mockRestore());
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function initialize(token?: string): RequestInit {
  return {
    method: "POST",
    headers: {
      Host: "localhost",
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test-client", version: "0.0.0" },
      },
    }),
  };
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Just enough of a browser's cookie handling for the sign-in flow. */
class CookieJar {
  #cookies = new Map<string, string>();

  take(response: Response) {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = cookie.split(";");
      const equals = pair.indexOf("=");
      const name = pair.slice(0, equals).trim();
      const value = pair.slice(equals + 1).trim();
      const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
      if (expired || !value) this.#cookies.delete(name);
      else this.#cookies.set(name, value);
    }
  }

  header(): string {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}
