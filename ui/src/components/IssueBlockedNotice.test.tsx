// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IssueBlockedNotice } from "./IssueBlockedNotice";

function renderNotice(node: React.ReactNode) {
  const queryClient = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("IssueBlockedNotice", () => {
  it("renders the rose recovery variant with parent-perspective copy and a wake-to-continue verb", () => {
    const html = renderNotice(
      <>
        <IssueBlockedNotice
          issueStatus="blocked"
          blockers={[
            {
              id: "issue-recovery-parent",
              identifier: "PAP-2089",
              title: "Liveness root",
              status: "blocked",
              priority: "medium",
              assigneeAgentId: null,
              assigneeUserId: null,
              terminalBlockers: [
                {
                  id: "issue-recovery-leaf",
                  identifier: "PAP-2642",
                  title: "Implementation phase",
                  status: "in_progress",
                  priority: "medium",
                  assigneeAgentId: "agent-1",
                  assigneeUserId: null,
                },
              ],
            },
          ]}
          blockerAttention={{
            state: "recovery_needed",
            reason: "productive_run_stopped",
            unresolvedBlockerCount: 1,
            coveredBlockerCount: 0,
            stalledBlockerCount: 0,
            attentionBlockerCount: 0,
            sampleBlockerIdentifier: "PAP-2642",
            sampleStalledBlockerIdentifier: null,
            nextActionOwner: { type: "agent", agentId: "agent-1", userId: null },
            nextActionHint: "wake_to_continue",
          }}
          ownerAgentName="CodexCoder"
        />
      </>,
    );

    expect(html).toContain('data-blocker-attention-state="recovery_needed"');
    expect(html).toContain('data-blocker-attention-reason="productive_run_stopped"');
    expect(html).toContain("paused at a liveness break");
    expect(html).toContain("Liveness break at");
    expect(html).toContain("Wake to continue");
    expect(html).toContain("PAP-2642");
    expect(html).toContain("border-rose-300/70");
  });

  it("renders the leaf-perspective copy without blocker chips when the issue itself is the invalid leaf", () => {
    const html = renderNotice(
      <>
        <IssueBlockedNotice
          issueStatus="in_progress"
          blockers={[]}
          blockerAttention={{
            state: "recovery_needed",
            reason: "productive_run_stopped",
            unresolvedBlockerCount: 0,
            coveredBlockerCount: 0,
            stalledBlockerCount: 0,
            attentionBlockerCount: 0,
            sampleBlockerIdentifier: "PAP-2642",
            sampleStalledBlockerIdentifier: null,
            nextActionOwner: { type: "agent", agentId: "agent-1", userId: null },
            nextActionHint: "wake_to_continue",
          }}
          ownerAgentName="CodexCoder"
        />
      </>,
    );

    expect(html).toContain("productive run that exited without queueing a continuation");
    expect(html).not.toContain("Liveness break at");
    expect(html).toContain("Wake to continue");
  });

  it("falls back to amber stalled treatment when state is stalled rather than recovery_needed", () => {
    const html = renderNotice(
      <>
        <IssueBlockedNotice
          issueStatus="blocked"
          blockers={[
            {
              id: "issue-stalled",
              identifier: "PAP-2279",
              title: "Stage gate review",
              status: "in_review",
              priority: "medium",
              assigneeAgentId: "agent-1",
              assigneeUserId: null,
            },
          ]}
          blockerAttention={{
            state: "stalled",
            reason: "stalled_review",
            unresolvedBlockerCount: 1,
            coveredBlockerCount: 0,
            stalledBlockerCount: 1,
            attentionBlockerCount: 0,
            sampleBlockerIdentifier: "PAP-2279",
            sampleStalledBlockerIdentifier: "PAP-2279",
            nextActionOwner: null,
            nextActionHint: null,
          }}
        />
      </>,
    );

    expect(html).toContain("Stalled in review");
    expect(html).not.toContain("Liveness break");
    expect(html).toContain("border-amber-300/70");
  });
});
