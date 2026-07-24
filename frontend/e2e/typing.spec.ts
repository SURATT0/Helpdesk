import { test, expect } from "@playwright/test";
import { login, loginAs } from "./helpers";

// A different ticket from the other chat specs (also assigned to demo agent Dana
// Reyes). Running in parallel, sharing a ticket would let another spec's comment
// clear this one's typing indicator (both agents are the same seeded user), so
// this spec gets its own ticket — SSE fan-out is filtered by ticket id.
const TICKET = 1035;
const REQUESTER_EMAIL = "j.petrov@acme.com";
const chatBox = /Enter to send/;

test("the requester sees a live typing indicator while the agent types", async ({
  browser,
}) => {
  const agentCtx = await browser.newContext();
  const requesterCtx = await browser.newContext();
  try {
    const agentPage = await agentCtx.newPage();
    const requesterPage = await requesterCtx.newPage();

    await login(agentPage); // Dana Reyes (agent)
    await loginAs(requesterPage, REQUESTER_EMAIL); // Marcus Chen (requester)

    await agentPage.goto(`/tickets/${TICKET}`);

    // The requester must be subscribed before the agent types (the typing signal
    // is only delivered to already-open streams).
    const streamRequested = requesterPage.waitForRequest((r) =>
      r.url().includes(`/tickets/${TICKET}/comments/stream`),
    );
    await requesterPage.goto(`/tickets/${TICKET}`);
    await expect(agentPage.getByPlaceholder(chatBox)).toBeVisible();
    await streamRequested;
    await requesterPage.waitForTimeout(3000);

    // Agent types char-by-char (fires the throttled "typing" ping) but does not send.
    await agentPage
      .getByPlaceholder(chatBox)
      .pressSequentially("drafting a reply", { delay: 60 });

    // The requester's page shows a live indicator naming the agent.
    await expect(requesterPage.getByText(/Dana Reyes is typing/)).toBeVisible();
  } finally {
    await agentCtx.close();
    await requesterCtx.close();
  }
});
