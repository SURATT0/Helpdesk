import { test, expect } from "@playwright/test";
import { login, loginAs } from "./helpers";

// Ticket #1042 is seeded with Dana Reyes (agent) as assignee and Marcus Chen
// (requester) as the requester, so both may view it.
const TICKET = 1042;
const REQUESTER_EMAIL = "marcus.chen@acme.com";
const chatBox = /Enter to send/;

test("a chat message sent by the agent appears on the requester's screen in real time (SSE)", async ({
  browser,
}) => {
  // Two independent sessions (separate in-memory tokens) viewing the same ticket.
  const agentCtx = await browser.newContext();
  const requesterCtx = await browser.newContext();
  try {
    const agentPage = await agentCtx.newPage();
    const requesterPage = await requesterCtx.newPage();

    await login(agentPage); // demo agent (Dana Reyes)
    await loginAs(requesterPage, REQUESTER_EMAIL); // requester (Marcus Chen)

    await agentPage.goto(`/tickets/${TICKET}`);

    // The requester must have an OPEN SSE subscription before the agent sends —
    // the stream only pushes *new* comments, so a message sent before the server
    // registers this subscriber would be missed entirely (not just delayed).
    // Wait for the stream request to be issued, then settle to cover the initial
    // token-bootstrap 401 → reconnect and the server-side listener registration.
    const streamRequested = requesterPage.waitForRequest((r) =>
      r.url().includes(`/tickets/${TICKET}/comments/stream`),
    );
    await requesterPage.goto(`/tickets/${TICKET}`);
    await expect(agentPage.getByPlaceholder(chatBox)).toBeVisible();
    await expect(requesterPage.getByPlaceholder(chatBox)).toBeVisible();
    await streamRequested;
    await requesterPage.waitForTimeout(3000);

    // The requester must NOT already see the message we're about to send.
    const message = `realtime probe ${Date.now()}`;
    await expect(requesterPage.getByText(message)).toHaveCount(0);

    // Agent sends a chat message (Chat tab is the default; Enter submits).
    const composer = agentPage.getByPlaceholder(chatBox);
    await composer.fill(message);
    await composer.press("Enter");

    // It shows on the sender's own thread…
    await expect(agentPage.getByText(message)).toBeVisible();
    // …and arrives on the requester's open page with no reload, pushed over the
    // SSE comment stream (expect's 10s timeout covers connect + delivery).
    await expect(requesterPage.getByText(message)).toBeVisible();
  } finally {
    await agentCtx.close();
    await requesterCtx.close();
  }
});
