export type KbArticle = {
  id: string;
  title: string;
  category: string;
  tags: string[];
  readMin: number;
  updatedAt: string; // ISO date
  excerpt: string;
  /** Markdown-lite body: "## " headings, "- " bullets, blank line = new block. */
  body: string;
};

/**
 * Curated knowledge-base articles. KB has no domain DB table (it isn't part of
 * the ticket schema), so it lives as a static, versioned dataset served by the
 * kb module — same shape a CMS-backed store would return.
 */
export const KB_ARTICLES: KbArticle[] = [
  {
    id: "KB-042",
    title: "Fix repeated Outlook password prompts (modern auth)",
    category: "Email",
    tags: ["outlook", "password", "email", "auth"],
    readMin: 2,
    updatedAt: "2026-06-28",
    excerpt:
      "Outlook keeps asking for your password after a mailbox migration — clear the cached credential and let modern auth re-issue a token.",
    body: `Outlook can get stuck prompting for a password when a stale credential lingers after a mailbox move to modern authentication.

## Symptoms
- A password window appears every few minutes
- Entering the correct password does not stop the prompts
- Webmail (OWA) works fine in a browser

## Fix
- Close Outlook completely
- Open Control Panel → Credential Manager → Windows Credentials
- Remove every entry that starts with "MicrosoftOffice" or "MS.Outlook"
- Reopen Outlook and sign in once with your work account
- Approve the multi-factor prompt on your phone

## Still prompting?
Create a ticket with the Email category and attach a screenshot of the prompt — an agent can reset your token server-side.`,
  },
  {
    id: "KB-017",
    title: "Reset your corporate email password",
    category: "Access",
    tags: ["password", "email", "reset", "access"],
    readMin: 1,
    updatedAt: "2026-05-14",
    excerpt:
      "Self-service steps to reset the password for your Acme account from the identity portal.",
    body: `You can reset your own password without contacting the help desk.

## Steps
- Go to id.acme.com/reset
- Enter your work email address
- Choose a verification method (authenticator app or SMS)
- Enter the code and set a new password

## Password rules
- At least 12 characters
- A mix of upper, lower, number, and symbol
- Cannot reuse your last 5 passwords

If you no longer have access to your verification method, raise a ticket under Access and a manager will verify your identity.`,
  },
  {
    id: "KB-118",
    title: "VPN 4.2 keepalive bug — rollback steps",
    category: "Network",
    tags: ["vpn", "network", "connectivity"],
    readMin: 3,
    updatedAt: "2026-07-02",
    excerpt:
      "VPN client 4.2 drops idle tunnels every ~10 minutes. Roll back to 4.1.6 until the fix ships.",
    body: `A regression in VPN client 4.2 tears down idle tunnels roughly every ten minutes, forcing a reconnect.

## Workaround
- Open the VPN client → About and confirm you are on 4.2.x
- Download 4.1.6 from software.acme.com/vpn
- Disconnect any active session
- Uninstall 4.2, reboot, then install 4.1.6
- Reconnect and confirm the tunnel stays up

## Notes
- A patched 4.3 is expected next sprint
- Do not change MTU settings manually — that is unrelated and can break split tunneling`,
  },
  {
    id: "KB-091",
    title: "Request software from the self-service catalog",
    category: "Software",
    tags: ["software", "install", "license", "catalog"],
    readMin: 2,
    updatedAt: "2026-06-10",
    excerpt:
      "Approved apps install on demand from Company Portal — no admin rights or ticket required.",
    body: `Most standard applications can be installed instantly without a ticket.

## Install an app
- Open Company Portal from the Start menu
- Search for the app (e.g. "Figma", "Node.js LTS")
- Click Install — it runs with the right license automatically

## If the app isn't listed
- Some tools need a paid license or manager approval
- Raise a ticket under Software with the app name and a business justification
- Approvals usually complete within one business day`,
  },
  {
    id: "KB-063",
    title: "Set up a new laptop for a joiner",
    category: "Hardware",
    tags: ["hardware", "laptop", "onboarding", "setup"],
    readMin: 4,
    updatedAt: "2026-06-19",
    excerpt:
      "Checklist for imaging and handing over a standard-issue laptop to a new team member.",
    body: `Use this checklist when preparing a device for a new joiner.

## Before day one
- Confirm the hardware order and asset tag
- Image the device with the current Windows baseline
- Enrol it in device management (MDM)

## Handover
- Sign the asset into the joiner's name in the inventory
- Walk through first sign-in and multi-factor enrolment
- Verify VPN, email, and printing work

## After handover
- File a ticket under Hardware only if a component is faulty
- Recycle packaging per the green-IT policy`,
  },
  {
    id: "KB-055",
    title: "Unlock a locked account after failed sign-ins",
    category: "Accounts",
    tags: ["account", "lockout", "access", "signin"],
    readMin: 1,
    updatedAt: "2026-05-30",
    excerpt:
      "Accounts lock for 15 minutes after 5 failed attempts. Here's how to unlock sooner.",
    body: `Your account locks automatically after five failed sign-in attempts to protect against brute-force attacks.

## Options
- Wait 15 minutes — the lock clears on its own
- Or reset your password (see KB-017) which unlocks immediately

## Prevent repeat lockouts
- Update saved passwords in your phone and browser after any reset
- Remove old Wi-Fi or email profiles that still use the previous password

If the account re-locks within minutes of unlocking, a device is retrying with a stale credential — raise a ticket under Accounts so an agent can find the source.`,
  },
];
