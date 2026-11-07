import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";

/**
 * The HTML pages the sign-in flow shows. Everything that came from the client
 * (its name, redirect URI) is attacker-chosen, so it is escaped.
 */

/** The consent page: shown before handing the browser to GitHub. */
export function consentPage(details: ConsentDescription, handle: string): string {
  const name = escape(details.clientName);
  const origin = details.clientDomain
    ? `Published by <strong>${escape(details.clientDomain)}</strong>.`
    : "This app registered itself, so its name isn't verified.";
  const loopback = details.redirectIsLoopback
    ? `<p class="warn"><strong>This sends access to an app on your computer.</strong> Continue only if you just started connecting from it.</p>`
    : "";
  return page(
    `Allow ${name}?`,
    `<h1>Allow ${name} to use your AI Running Coach?</h1>
<p>It will be able to read and change your Athlete Record.</p>
<p>${origin} Access will be sent to <strong>${escape(details.redirectHost)}</strong>.</p>
${loopback}
<form method="post">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <button name="decision" value="approve">Continue with GitHub</button>
  <button name="decision" value="deny" class="secondary">Deny</button>
</form>`,
  );
}

/** A dead end in the flow that can't safely redirect back to the client. */
export function errorPage(message: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(page("Can't sign in", `<h1>Can't sign in</h1><p>${escape(message)}</p>`), {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 34rem; margin: 3rem auto; padding: 0 1rem; color: #1b1b1b; background: #fff; }
  h1 { font-size: 1.4rem; }
  .warn { background: #fff4d6; padding: .75rem; border-radius: .5rem; }
  button { font: inherit; padding: .6rem 1rem; border-radius: .5rem; border: 1px solid #1b1b1b; background: #1b1b1b; color: #fff; cursor: pointer; }
  button.secondary { background: transparent; color: inherit; }
  @media (prefers-color-scheme: dark) {
    body { color: #eee; background: #161616; }
    .warn { background: #4a3b10; }
    button { border-color: #eee; background: #eee; color: #161616; }
  }
</style>
${body}
</html>`;
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
