import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { IssueChatThread } from "@/components/IssueChatThread";
import { IssueThreadInteractionCard } from "@/components/IssueThreadInteractionCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  acceptedSuggestedTasksInteraction,
  answeredAskUserQuestionsInteraction,
  issueThreadInteractionComments,
  issueThreadInteractionEvents,
  issueThreadInteractionFixtureMeta,
  issueThreadInteractionLiveRuns,
  issueThreadInteractionTranscriptsByRunId,
  mixedIssueThreadInteractions,
  pendingAskUserQuestionsInteraction,
  pendingSuggestedTasksInteraction,
  rejectedSuggestedTasksInteraction,
} from "@/fixtures/issueThreadInteractionFixtures";
import type {
  AskUserQuestionsAnswer,
  AskUserQuestionsInteraction,
  SuggestTasksInteraction,
} from "@/lib/issue-thread-interactions";
import { storybookAgentMap } from "../fixtures/paperclipData";

const boardUserLabels = new Map<string, string>([
  [issueThreadInteractionFixtureMeta.currentUserId, "Riley Board"],
  ["user-product", "Mara Product"],
]);

function StoryFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="paperclip-story">
      <main className="paperclip-story__inner space-y-6">{children}</main>
    </div>
  );
}

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="paperclip-story__frame overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <div className="paperclip-story__label">{eyebrow}</div>
          <h2 className="mt-1 text-xl font-semibold">{title}</h2>
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function ScenarioCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function InteractiveSuggestedTasksCard() {
  const [interaction, setInteraction] = useState<SuggestTasksInteraction>(
    pendingSuggestedTasksInteraction,
  );

  return (
    <IssueThreadInteractionCard
      interaction={interaction}
      agentMap={storybookAgentMap}
      currentUserId={issueThreadInteractionFixtureMeta.currentUserId}
      userLabelMap={boardUserLabels}
      onAcceptInteraction={(_interaction, selectedClientKeys) =>
        setInteraction({
          ...acceptedSuggestedTasksInteraction,
          result: {
            version: 1,
            createdTasks: (acceptedSuggestedTasksInteraction.result?.createdTasks ?? []).filter((task) =>
              selectedClientKeys?.includes(task.clientKey) ?? true),
            skippedClientKeys: pendingSuggestedTasksInteraction.payload.tasks
              .map((task) => task.clientKey)
              .filter((clientKey) => !(selectedClientKeys?.includes(clientKey) ?? true)),
          },
        })}
      onRejectInteraction={(_interaction, reason) =>
        setInteraction({
          ...rejectedSuggestedTasksInteraction,
          result: {
            version: 1,
            ...(rejectedSuggestedTasksInteraction.result ?? {}),
            rejectionReason:
              reason
              || rejectedSuggestedTasksInteraction.result?.rejectionReason
              || null,
          },
        })}
    />
  );
}

function buildAnsweredInteraction(
  answers: AskUserQuestionsAnswer[],
): AskUserQuestionsInteraction {
  const labels = pendingAskUserQuestionsInteraction.payload.questions.flatMap((question) => {
    const answer = answers.find((entry) => entry.questionId === question.id);
    if (!answer) return [];
    return question.options
      .filter((option) => answer.optionIds.includes(option.id))
      .map((option) => option.label);
  });

  return {
    ...answeredAskUserQuestionsInteraction,
    result: {
      version: 1,
      answers,
      summaryMarkdown: labels.map((label) => `- ${label}`).join("\n"),
    },
  };
}

function InteractiveAskUserQuestionsCard() {
  const [interaction, setInteraction] = useState<AskUserQuestionsInteraction>(
    pendingAskUserQuestionsInteraction,
  );

  return (
    <IssueThreadInteractionCard
      interaction={interaction}
      agentMap={storybookAgentMap}
      currentUserId={issueThreadInteractionFixtureMeta.currentUserId}
      userLabelMap={boardUserLabels}
      onSubmitInteractionAnswers={(_interaction, answers) =>
        setInteraction(buildAnsweredInteraction(answers))}
    />
  );
}

const meta = {
  title: "Chat & Comments/Issue Thread Interactions",
  parameters: {
    docs: {
      description: {
        component:
          "Prototype-only interaction cards for `suggest_tasks` and `ask_user_questions`, shown both in isolation and inside the real `IssueChatThread` feed.",
      },
    },
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const SuggestedTasksPending: Story = {
  render: () => (
    <StoryFrame>
      <ScenarioCard
        title="Pending suggested tasks"
        description="Draft issues are selectable before they become real issues."
      >
        <InteractiveSuggestedTasksCard />
      </ScenarioCard>
    </StoryFrame>
  ),
};

export const SuggestedTasksAccepted: Story = {
  render: () => (
    <StoryFrame>
      <ScenarioCard
        title="Accepted suggested tasks"
        description="Created issues are linked back to their original draft rows."
      >
        <IssueThreadInteractionCard
          interaction={acceptedSuggestedTasksInteraction}
          agentMap={storybookAgentMap}
          currentUserId={issueThreadInteractionFixtureMeta.currentUserId}
          userLabelMap={boardUserLabels}
        />
      </ScenarioCard>
    </StoryFrame>
  ),
};

export const SuggestedTasksRejected: Story = {
  render: () => (
    <StoryFrame>
      <ScenarioCard
        title="Rejected suggested tasks"
        description="The declined draft stays visible with its rejection note."
      >
        <IssueThreadInteractionCard
          interaction={rejectedSuggestedTasksInteraction}
          agentMap={storybookAgentMap}
          currentUserId={issueThreadInteractionFixtureMeta.currentUserId}
          userLabelMap={boardUserLabels}
        />
      </ScenarioCard>
    </StoryFrame>
  ),
};

export const AskUserQuestionsPending: Story = {
  render: () => (
    <StoryFrame>
      <ScenarioCard
        title="Pending question form"
        description="Single- and multi-select questions remain local until submitted."
      >
        <InteractiveAskUserQuestionsCard />
      </ScenarioCard>
    </StoryFrame>
  ),
};

export const AskUserQuestionsAnswered: Story = {
  render: () => (
    <StoryFrame>
      <ScenarioCard
        title="Answered question form"
        description="Selected answers and the submitted summary remain attached to the thread."
      >
        <IssueThreadInteractionCard
          interaction={answeredAskUserQuestionsInteraction}
          agentMap={storybookAgentMap}
          currentUserId={issueThreadInteractionFixtureMeta.currentUserId}
          userLabelMap={boardUserLabels}
        />
      </ScenarioCard>
    </StoryFrame>
  ),
};

export const ReviewSurface: Story = {
  render: () => (
    <StoryFrame>
      <section className="paperclip-story__frame p-6">
        <div className="paperclip-story__label">Thread interactions</div>
        <div className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          This prototype keeps the whole system non-persistent while pressure-testing the two planned
          interaction kinds directly inside the issue chat surface. The card language leans closer to
          annotated review sheets than generic admin widgets so the objects feel like first-class work
          artifacts in the thread.
        </div>
      </section>

      <Section eyebrow="Suggested Tasks" title="Pending, accepted, and rejected task-tree cards">
        <div className="grid gap-6 xl:grid-cols-3">
          <ScenarioCard
            title="Pending"
            description="The draft tree stays editable and non-persistent until someone accepts or rejects it."
          >
            <InteractiveSuggestedTasksCard />
          </ScenarioCard>
          <ScenarioCard
            title="Accepted"
            description="Accepted state resolves to created issue links while keeping the original suggestion visible in-thread."
          >
            <IssueThreadInteractionCard
              interaction={acceptedSuggestedTasksInteraction}
              agentMap={storybookAgentMap}
              currentUserId={issueThreadInteractionFixtureMeta.currentUserId}
              userLabelMap={boardUserLabels}
            />
          </ScenarioCard>
          <ScenarioCard
            title="Rejected"
            description="The rejection reason remains attached to the artifact so future reviewers can see why the draft was declined."
          >
            <IssueThreadInteractionCard
              interaction={rejectedSuggestedTasksInteraction}
              agentMap={storybookAgentMap}
              currentUserId={issueThreadInteractionFixtureMeta.currentUserId}
              userLabelMap={boardUserLabels}
            />
          </ScenarioCard>
        </div>
      </Section>

      <Section eyebrow="Ask User Questions" title="Pending multi-question form and answered summary">
        <div className="grid gap-6 xl:grid-cols-2">
          <ScenarioCard
            title="Pending"
            description="Answers stay local across the whole form and only wake the assignee once after final submit."
          >
            <InteractiveAskUserQuestionsCard />
          </ScenarioCard>
          <ScenarioCard
            title="Answered"
            description="The answered state keeps the exact choices visible and adds a compact summary note for later review."
          >
            <IssueThreadInteractionCard
              interaction={answeredAskUserQuestionsInteraction}
              agentMap={storybookAgentMap}
              currentUserId={issueThreadInteractionFixtureMeta.currentUserId}
              userLabelMap={boardUserLabels}
            />
          </ScenarioCard>
        </div>
      </Section>

      <Section eyebrow="Mixed Feed" title="Interaction cards in the real issue thread">
        <ScenarioCard
          title="IssueChatThread composition"
          description="Comments, timeline events, accepted task suggestions, a pending question form, and an active run share the same feed without persistence work."
        >
          <div className="overflow-hidden rounded-[32px] border border-border/70 bg-[linear-gradient(135deg,rgba(14,165,233,0.08),transparent_28%),linear-gradient(180deg,rgba(245,158,11,0.08),transparent_42%),var(--background)] p-5 shadow-[0_30px_80px_rgba(15,23,42,0.10)]">
            <IssueChatThread
              comments={issueThreadInteractionComments}
              interactions={mixedIssueThreadInteractions}
              timelineEvents={issueThreadInteractionEvents}
              liveRuns={issueThreadInteractionLiveRuns}
              transcriptsByRunId={issueThreadInteractionTranscriptsByRunId}
              hasOutputForRun={(runId) => runId === "run-thread-live"}
              companyId={issueThreadInteractionFixtureMeta.companyId}
              projectId={issueThreadInteractionFixtureMeta.projectId}
              currentUserId={issueThreadInteractionFixtureMeta.currentUserId}
              userLabelMap={boardUserLabels}
              agentMap={storybookAgentMap}
              onAdd={async () => {}}
              showComposer={false}
            />
          </div>
        </ScenarioCard>
      </Section>
    </StoryFrame>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Covers the prototype states called out in [PAP-1709](/PAP/issues/PAP-1709): suggested-task previews, collapsed descendants, rejection reasons, multi-question answers, and a mixed issue thread.",
      },
    },
  },
};
