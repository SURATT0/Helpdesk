import type { ITicketSource } from "./source.types";
import { MockSource } from "./sources/mock.source";
import { JiraSource } from "./sources/jira.source";
import { ZendeskSource } from "./sources/zendesk.source";
import { ImapEmailSource } from "./sources/imap-email.source";

/**
 * Central registry of external ticket sources. Adding a provider is a one-line
 * change here plus its adapter file. Order here is the display order in the UI.
 */
const sources: ITicketSource[] = [
  new MockSource(),
  new ImapEmailSource(),
  new JiraSource(),
  new ZendeskSource(),
];

export const sourceRegistry = {
  list(): ITicketSource[] {
    return sources;
  },
  get(id: string): ITicketSource | undefined {
    return sources.find((s) => s.id === id);
  },
};
