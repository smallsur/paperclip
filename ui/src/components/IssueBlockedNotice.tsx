import type {
  Approval,
  AskUserQuestionsInteraction,
  AskUserQuestionsPayload,
  IssueBlockerAttention,
  IssueRelationIssueSummary,
  IssueThreadInteraction,
  RequestConfirmationInteraction,
  SuggestTasksInteraction,
} from "@paperclipai/shared";
import { AlertTriangle, Hourglass } from "lucide-react";
import { createIssueDetailPath } from "../lib/issueDetailBreadcrumb";
import { formatAssigneeUserLabel } from "../lib/assignees";
import { IssueLinkQuicklook } from "./IssueLinkQuicklook";
import { Identity } from "./Identity";

type RecoveryReason =
  | "productive_run_stopped"
  | "continuation_exhausted"
  | "continuation_suppressed";

const RECOVERY_REASONS: ReadonlySet<string> = new Set<RecoveryReason>([
  "productive_run_stopped",
  "continuation_exhausted",
  "continuation_suppressed",
]);

const NEXT_ACTION_VERB: Record<NonNullable<IssueBlockerAttention["nextActionHint"]>, string> = {
  wake_to_continue: "Wake to continue",
  needs_human_review: "Needs human review",
  create_recovery_issue: "Create recovery issue",
  reassign: "Reassign",
};

type WaitingActionableInteraction =
  | RequestConfirmationInteraction
  | AskUserQuestionsInteraction
  | SuggestTasksInteraction;

const WAITING_INTERACTION_KINDS: ReadonlySet<string> = new Set([
  "request_confirmation",
  "ask_user_questions",
  "suggest_tasks",
]);

function isWaitingActionableInteraction(
  interaction: IssueThreadInteraction,
): interaction is WaitingActionableInteraction {
  return WAITING_INTERACTION_KINDS.has(interaction.kind);
}

function pickLatestPendingInteraction(
  interactions: IssueThreadInteraction[] | null | undefined,
): WaitingActionableInteraction | null {
  if (!interactions || interactions.length === 0) return null;
  let best: WaitingActionableInteraction | null = null;
  let bestTime = -Infinity;
  for (const interaction of interactions) {
    if (interaction.status !== "pending") continue;
    if (!isWaitingActionableInteraction(interaction)) continue;
    const time = new Date(interaction.createdAt as string | Date).getTime();
    if (Number.isFinite(time) && time > bestTime) {
      bestTime = time;
      best = interaction;
    }
  }
  return best;
}

function pickLatestPendingApproval(approvals: Approval[] | null | undefined): Approval | null {
  if (!approvals || approvals.length === 0) return null;
  let best: Approval | null = null;
  let bestTime = -Infinity;
  for (const approval of approvals) {
    if (approval.status !== "pending") continue;
    const time = new Date(approval.createdAt as string | Date).getTime();
    if (Number.isFinite(time) && time > bestTime) {
      bestTime = time;
      best = approval;
    }
  }
  return best;
}

export function IssueBlockedNotice({
  issueId,
  issueIdentifier,
  issueStatus,
  blockers,
  blockerAttention,
  ownerAgentName,
  ownerUserName,
  interactions,
  approvals,
  agentMap,
  userLabelMap,
  currentUserId,
}: {
  issueId?: string | null;
  issueIdentifier?: string | null;
  issueStatus?: string;
  blockers: IssueRelationIssueSummary[];
  blockerAttention?: IssueBlockerAttention | null;
  ownerAgentName?: string | null;
  ownerUserName?: string | null;
  interactions?: IssueThreadInteraction[] | null;
  approvals?: Approval[] | null;
  agentMap?: ReadonlyMap<string, { name: string }> | null;
  userLabelMap?: ReadonlyMap<string, string> | null;
  currentUserId?: string | null;
}) {
  const isRecoveryNeeded = blockerAttention?.state === "recovery_needed"
    && blockerAttention.reason !== null
    && RECOVERY_REASONS.has(blockerAttention.reason);
  const isExplicitWaiting = blockerAttention?.state === "covered"
    && blockerAttention.reason === "explicit_waiting";
  if (
    blockers.length === 0
    && issueStatus !== "blocked"
    && !isRecoveryNeeded
    && !isExplicitWaiting
  ) return null;

  const blockerLabel = blockers.length === 1 ? "the linked issue" : "the linked issues";
  const terminalBlockers = blockers
    .flatMap((blocker) => blocker.terminalBlockers ?? [])
    .filter((blocker, index, all) => all.findIndex((candidate) => candidate.id === blocker.id) === index);

  const isStalled = blockerAttention?.state === "stalled";
  const stalledLeafIdentifier =
    blockerAttention?.sampleStalledBlockerIdentifier ?? blockerAttention?.sampleBlockerIdentifier ?? null;
  const stalledLeafBlockers = (() => {
    const candidates: IssueRelationIssueSummary[] = [];
    for (const blocker of [...blockers, ...terminalBlockers]) {
      if (blocker.status !== "in_review") continue;
      if (candidates.some((existing) => existing.id === blocker.id)) continue;
      candidates.push(blocker);
    }
    if (stalledLeafIdentifier) {
      const preferred = candidates.find(
        (blocker) => (blocker.identifier ?? blocker.id) === stalledLeafIdentifier,
      );
      if (preferred) {
        return [preferred, ...candidates.filter((blocker) => blocker.id !== preferred.id)];
      }
    }
    return candidates;
  })();
  const showStalledRow = isStalled && stalledLeafBlockers.length > 0;

  const recoveryLeafIdentifier = isRecoveryNeeded ? blockerAttention?.sampleBlockerIdentifier ?? null : null;
  const recoveryLeafBlockers = (() => {
    if (!isRecoveryNeeded) return [] as IssueRelationIssueSummary[];
    const candidates: IssueRelationIssueSummary[] = [];
    for (const blocker of [...blockers, ...terminalBlockers]) {
      if (blocker.status === "done" || blocker.status === "cancelled") continue;
      if (candidates.some((existing) => existing.id === blocker.id)) continue;
      candidates.push(blocker);
    }
    if (recoveryLeafIdentifier) {
      const preferred = candidates.find(
        (blocker) => (blocker.identifier ?? blocker.id) === recoveryLeafIdentifier,
      );
      if (preferred) {
        return [preferred, ...candidates.filter((blocker) => blocker.id !== preferred.id)];
      }
    }
    return candidates;
  })();
  const isLeafSurface = isRecoveryNeeded && issueStatus !== "blocked";

  // Explicit-wait wins over rose only when state is actually "covered". The
  // server already gates these so they cannot co-occur on the same issue (rose
  // wins on tie via the precedence: recovery_needed first, then explicit
  // waiting), but check explicitly per the spec.
  const showExplicitWaiting = isExplicitWaiting && !isRecoveryNeeded;
  const waitLeafIdentifier = showExplicitWaiting
    ? blockerAttention?.sampleBlockerIdentifier ?? null
    : null;
  const isWaitChain = showExplicitWaiting
    && waitLeafIdentifier !== null
    && issueIdentifier != null
    && waitLeafIdentifier !== issueIdentifier;
  const waitLeafBlockers = (() => {
    if (!showExplicitWaiting || !isWaitChain) return [] as IssueRelationIssueSummary[];
    const candidates: IssueRelationIssueSummary[] = [];
    for (const blocker of [...blockers, ...terminalBlockers]) {
      if (blocker.status === "done" || blocker.status === "cancelled") continue;
      if (candidates.some((existing) => existing.id === blocker.id)) continue;
      candidates.push(blocker);
    }
    if (waitLeafIdentifier) {
      const preferred = candidates.find(
        (blocker) => (blocker.identifier ?? blocker.id) === waitLeafIdentifier,
      );
      if (preferred) {
        return [preferred, ...candidates.filter((blocker) => blocker.id !== preferred.id)];
      }
    }
    return candidates;
  })();

  const containerClass = showExplicitWaiting
    ? "mb-3 rounded-md border border-sky-300/70 bg-sky-50/90 px-3 py-2.5 text-sm text-sky-950 shadow-sm dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-100"
    : isRecoveryNeeded
      ? "mb-3 rounded-md border border-rose-300/70 bg-rose-50/90 px-3 py-2.5 text-sm text-rose-950 shadow-sm dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100"
      : "mb-3 rounded-md border border-amber-300/70 bg-amber-50/90 px-3 py-2.5 text-sm text-amber-950 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100";
  const iconClass = showExplicitWaiting
    ? "mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-300"
    : isRecoveryNeeded
      ? "mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-300"
      : "mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300";
  const subRowLabelClass = showExplicitWaiting
    ? "text-xs font-medium text-sky-800 dark:text-sky-200"
    : isRecoveryNeeded
      ? "text-xs font-medium text-rose-800 dark:text-rose-200"
      : "text-xs font-medium text-amber-800 dark:text-amber-200";

  const renderBlockerChip = (
    blocker: IssueRelationIssueSummary,
    variant: "amber" | "rose" | "sky" = "amber",
  ) => {
    const issuePathId = blocker.identifier ?? blocker.id;
    const chipClassByVariant: Record<typeof variant, string> = {
      amber: "inline-flex max-w-full items-center gap-1 rounded-md border border-amber-300/70 bg-background/80 px-2 py-1 font-mono text-xs text-amber-950 transition-colors hover:border-amber-500 hover:bg-amber-100 hover:underline dark:border-amber-500/40 dark:bg-background/40 dark:text-amber-100 dark:hover:bg-amber-500/15",
      rose: "inline-flex max-w-full items-center gap-1 rounded-md border border-rose-300/70 bg-background/80 px-2 py-1 font-mono text-xs text-rose-950 transition-colors hover:border-rose-500 hover:bg-rose-100 hover:underline dark:border-rose-500/40 dark:bg-background/40 dark:text-rose-100 dark:hover:bg-rose-500/15",
      sky: "inline-flex max-w-full items-center gap-1 rounded-md border border-sky-300/70 bg-background/80 px-2 py-1 font-mono text-xs text-sky-950 transition-colors hover:border-sky-500 hover:bg-sky-100 hover:underline dark:border-sky-500/40 dark:bg-background/40 dark:text-sky-100 dark:hover:bg-sky-500/15",
    };
    const labelClassByVariant: Record<typeof variant, string> = {
      amber: "max-w-[18rem] truncate font-sans text-[11px] text-amber-800 dark:text-amber-200",
      rose: "max-w-[18rem] truncate font-sans text-[11px] text-rose-800 dark:text-rose-200",
      sky: "max-w-[18rem] truncate font-sans text-[11px] text-sky-800 dark:text-sky-200",
    };
    return (
      <IssueLinkQuicklook
        key={blocker.id}
        issuePathId={issuePathId}
        to={createIssueDetailPath(issuePathId)}
        className={chipClassByVariant[variant]}
      >
        <span>{blocker.identifier ?? blocker.id.slice(0, 8)}</span>
        <span className={labelClassByVariant[variant]}>{blocker.title}</span>
      </IssueLinkQuicklook>
    );
  };

  const recoveryParentCopy = (reason: RecoveryReason, leafIdent: string) => {
    const leafChip = <span className="font-mono text-xs">[{leafIdent}]</span>;
    if (reason === "productive_run_stopped") {
      return (
        <>Work on this issue is <strong>paused at a liveness break in {leafChip}</strong>. The last run was productive but exited without queueing the next step, so nothing will resume on its own.</>
      );
    }
    if (reason === "continuation_exhausted") {
      return (
        <>Work on this issue is <strong>stuck at {leafChip}</strong>. Automatic continuation has been used up, so a human or recovery issue is needed before it moves again.</>
      );
    }
    return (
      <>Work on this issue is <strong>stuck at {leafChip}</strong> because automatic continuation was held back. It needs review before resuming.</>
    );
  };

  const recoveryLeafCopy = (reason: RecoveryReason) => {
    if (reason === "productive_run_stopped") {
      return (
        <>This issue had a <strong>productive run that exited without queueing a continuation</strong>. It is non-terminal with no live action path.</>
      );
    }
    if (reason === "continuation_exhausted") {
      return (
        <>This issue's <strong>automatic continuation has been exhausted</strong>. It is non-terminal with no live action path.</>
      );
    }
    return (
      <>This issue's <strong>automatic continuation was suppressed</strong> and it is non-terminal with no live action path.</>
    );
  };

  // ----- Explicit waiting helpers -----

  const ownerLabel = (() => {
    const owner = blockerAttention?.nextActionOwner ?? null;
    if (!owner) return "the next reviewer";
    if (owner.type === "user") {
      if (!owner.userId) return "the board";
      const resolved = formatAssigneeUserLabel(owner.userId, currentUserId ?? null, userLabelMap ?? undefined);
      if (resolved) return resolved;
      return ownerUserName ?? "the user";
    }
    if (owner.type === "agent") {
      if (owner.agentId && agentMap) {
        const agent = agentMap.get(owner.agentId);
        if (agent?.name) return agent.name;
      }
      return ownerAgentName ?? "the agent";
    }
    return "the next reviewer";
  })();

  const pendingInteraction = showExplicitWaiting && !isWaitChain
    ? pickLatestPendingInteraction(interactions ?? null)
    : null;
  const pendingApproval = showExplicitWaiting && !pendingInteraction && !isWaitChain
    ? pickLatestPendingApproval(approvals ?? null)
    : null;

  const isPlanConfirmation = (interaction: WaitingActionableInteraction): boolean => {
    if (interaction.kind !== "request_confirmation") return false;
    const target = interaction.payload?.target ?? null;
    if (!target) return false;
    if (target.type === "issue_document") return target.key === "plan";
    return false;
  };

  const explicitWaitingHeadline = (() => {
    if (!showExplicitWaiting) return null;
    if (isWaitChain) {
      return <>Waiting on {ownerLabel} downstream.</>;
    }
    if (pendingInteraction) {
      if (pendingInteraction.kind === "request_confirmation") {
        if (isPlanConfirmation(pendingInteraction)) {
          return <>Waiting on board confirmation.</>;
        }
        return <>Waiting on confirmation.</>;
      }
      if (pendingInteraction.kind === "ask_user_questions") {
        return <>Waiting on user response.</>;
      }
      if (pendingInteraction.kind === "suggest_tasks") {
        return <>Waiting on task selection.</>;
      }
    }
    if (pendingApproval) {
      return <>Waiting on board approval.</>;
    }
    return <>Waiting on {ownerLabel}.</>;
  })();

  const explicitWaitingBody = (() => {
    if (!showExplicitWaiting) return null;
    if (isWaitChain) {
      const leafChip = waitLeafIdentifier
        ? <span className="font-mono text-xs">[{waitLeafIdentifier}]</span>
        : null;
      return leafChip
        ? <>Work on this issue is paused while {ownerLabel} responds in {leafChip}. Nothing here will resume until that is resolved.</>
        : <>Work on this issue is paused while {ownerLabel} responds downstream. Nothing here will resume until that is resolved.</>;
    }
    if (pendingInteraction) {
      if (pendingInteraction.kind === "request_confirmation") {
        if (isPlanConfirmation(pendingInteraction)) {
          return <>Paperclip drafted a plan and asked the board to accept or reject it. Nothing will run until that's resolved.</>;
        }
        return <>Paperclip is waiting on {ownerLabel} to accept or reject.</>;
      }
      if (pendingInteraction.kind === "ask_user_questions") {
        const payload = pendingInteraction.payload as AskUserQuestionsPayload;
        const count = payload?.questions?.length ?? 0;
        const noun = count === 1 ? "question" : "questions";
        if (count > 0) {
          return <>Paperclip asked {ownerLabel} {count} {noun} before continuing.</>;
        }
        return <>Paperclip asked {ownerLabel} for a response before continuing.</>;
      }
      if (pendingInteraction.kind === "suggest_tasks") {
        const count = pendingInteraction.payload?.tasks?.length ?? 0;
        if (count > 0) {
          return <>Paperclip suggested {count} {count === 1 ? "task" : "tasks"}; pick which to create.</>;
        }
        return <>Paperclip suggested tasks for {ownerLabel} to pick which to create.</>;
      }
    }
    if (pendingApproval) {
      return <>A board approval is open against this issue.</>;
    }
    return <>This issue is on hold pending a human decision.</>;
  })();

  const explicitWaitingTargetLabel = (() => {
    if (!pendingInteraction) {
      if (pendingApproval) {
        const id = pendingApproval.id;
        return `Approval ${id.slice(0, 8)}`;
      }
      return null;
    }
    if (pendingInteraction.kind === "request_confirmation") {
      const target = pendingInteraction.payload?.target ?? null;
      if (target?.type === "issue_document" && target.key === "plan") {
        const revLabel = target.revisionNumber != null ? `r${target.revisionNumber}` : "latest";
        return `Plan revision ${revLabel}`;
      }
      if (target?.label) return target.label;
      if (target?.type === "custom" && target.key) return target.key;
      return "Confirmation";
    }
    if (pendingInteraction.kind === "ask_user_questions") {
      const payload = pendingInteraction.payload as AskUserQuestionsPayload;
      const count = payload?.questions?.length ?? 0;
      if (count === 0) return "Questions";
      return `${count} ${count === 1 ? "question" : "questions"}`;
    }
    if (pendingInteraction.kind === "suggest_tasks") {
      const count = pendingInteraction.payload?.tasks?.length ?? 0;
      if (count === 0) return "Suggested tasks";
      return `${count} suggested ${count === 1 ? "task" : "tasks"}`;
    }
    return null;
  })();

  const explicitWaitingResumeLabel = (() => {
    if (pendingInteraction) {
      const policy = pendingInteraction.continuationPolicy ?? "none";
      if (policy === "wake_assignee" || policy === "wake_assignee_on_accept") {
        if (pendingInteraction.kind === "request_confirmation") {
          return `Resumes when ${ownerLabel} accepts. Rejection returns to the assignee with reason.`;
        }
        if (pendingInteraction.kind === "ask_user_questions") {
          return `Resumes when ${ownerLabel} answers.`;
        }
        if (pendingInteraction.kind === "suggest_tasks") {
          return `Resumes when ${ownerLabel} picks tasks to create.`;
        }
      }
      return "Does not auto-resume — assignee must restart.";
    }
    if (pendingApproval) {
      return "Resumes on approval decision.";
    }
    return null;
  })();

  const explicitWaitingPills = (() => {
    if (!showExplicitWaiting) return null;
    const pillClass =
      "inline-flex max-w-full items-center gap-1 rounded-md border border-sky-300/70 bg-white/80 px-1.5 py-0.5 text-[11px] font-medium text-sky-900 dark:border-sky-500/40 dark:bg-background/40 dark:text-sky-100";
    const labelClass =
      "shrink-0 text-[10px] uppercase tracking-wide text-sky-700/80 dark:text-sky-300/80";
    const valueClass = "min-w-0 break-words";
    const pills: React.ReactNode[] = [];
    if (explicitWaitingTargetLabel) {
      pills.push(
        <span key="target" className={pillClass}>
          <span className={labelClass}>Target</span>
          <span className={valueClass}>{explicitWaitingTargetLabel}</span>
        </span>,
      );
    }
    pills.push(
      <span key="owner" className={pillClass}>
        <span className={labelClass}>Owner</span>
        <span className={valueClass}>{ownerLabel}</span>
      </span>,
    );
    if (explicitWaitingResumeLabel) {
      pills.push(
        <span key="resume" className={pillClass} title={explicitWaitingResumeLabel}>
          <span className={labelClass}>Resume</span>
          <span className={valueClass}>{explicitWaitingResumeLabel}</span>
        </span>,
      );
    }
    return <div className="flex flex-wrap items-center gap-1.5 pt-0.5">{pills}</div>;
  })();

  const explicitWaitingJumpAnchor = (() => {
    if (!showExplicitWaiting) return null;
    let anchorId: string | null = null;
    let label: string | null = null;
    if (pendingInteraction) {
      anchorId = `issue-thread-interaction-${pendingInteraction.id}`;
      if (pendingInteraction.kind === "request_confirmation") label = "Jump to confirmation";
      else if (pendingInteraction.kind === "ask_user_questions") label = "Jump to questions";
      else if (pendingInteraction.kind === "suggest_tasks") label = "Jump to suggestions";
    } else if (pendingApproval) {
      anchorId = `issue-approval-${pendingApproval.id}`;
      label = "Jump to approval";
    }
    if (!anchorId || !label) return null;
    return (
      <a
        href={`#${anchorId}`}
        className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:underline dark:text-sky-300"
      >
        {label} ↓
      </a>
    );
  })();

  const ownerPill = (() => {
    if (!isRecoveryNeeded) return null;
    const owner = blockerAttention?.nextActionOwner ?? null;
    const hint = blockerAttention?.nextActionHint ?? null;
    const verb = hint ? NEXT_ACTION_VERB[hint] : null;
    let ownerNode: React.ReactNode = "No one assigned";
    if (owner?.type === "agent" && owner.agentId) {
      ownerNode = (
        <Identity name={ownerAgentName ?? "Agent"} size="xs" />
      );
    } else if (owner?.type === "user" && owner.userId) {
      ownerNode = (
        <Identity name={ownerUserName ?? "User"} size="xs" />
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs text-rose-900 dark:text-rose-100">
        {verb ? (
          <>
            <span>Next action:</span>
            <span className="font-medium">{verb}</span>
            <span aria-hidden>·</span>
          </>
        ) : null}
        <span>Owner:</span>
        <span className="font-medium">{ownerNode}</span>
      </div>
    );
  })();

  void issueId; // currently unused; reserved for future deep-anchor wiring

  return (
    <div
      data-blocker-attention-state={blockerAttention?.state}
      data-blocker-attention-reason={blockerAttention?.reason ?? undefined}
      className={containerClass}
    >
      <div className="flex items-start gap-2">
        {showExplicitWaiting ? (
          <Hourglass className={iconClass} aria-hidden />
        ) : (
          <AlertTriangle className={iconClass} />
        )}
        <div className="min-w-0 space-y-1.5">
          <p className="leading-5">
            {showExplicitWaiting ? (
              <>
                <strong>{explicitWaitingHeadline}</strong>
                {explicitWaitingBody ? <> {explicitWaitingBody}</> : null}
              </>
            ) : isRecoveryNeeded
              ? isLeafSurface
                ? recoveryLeafCopy(blockerAttention!.reason as RecoveryReason)
                : recoveryParentCopy(
                    blockerAttention!.reason as RecoveryReason,
                    recoveryLeafIdentifier ?? "linked issue",
                  )
              : blockers.length > 0
                ? isStalled
                  ? stalledLeafBlockers.length > 1
                    ? <>Work on this issue is blocked by {blockerLabel}, but the chain is stalled in review without a clear next step. Resolve the stalled reviews below or remove them as blockers.</>
                    : <>Work on this issue is blocked by {blockerLabel}, but the chain is stalled in review without a clear next step. Resolve the stalled review below or remove it as a blocker.</>
                  : <>Work on this issue is blocked by {blockerLabel} until {blockers.length === 1 ? "it is" : "they are"} complete. Comments still wake the assignee for questions or triage.</>
                : <>Work on this issue is blocked until it is moved back to todo. Comments still wake the assignee for questions or triage.</>}
          </p>
          {showExplicitWaiting ? (
            <>
              {explicitWaitingPills}
              {isWaitChain && waitLeafBlockers.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className={subRowLabelClass}>Waiting at</span>
                  {waitLeafBlockers.map((blocker) => renderBlockerChip(blocker, "sky"))}
                </div>
              ) : null}
              {explicitWaitingJumpAnchor}
            </>
          ) : null}
          {!showExplicitWaiting && !isRecoveryNeeded && blockers.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {blockers.map((blocker) => renderBlockerChip(blocker, "amber"))}
            </div>
          ) : null}
          {!showExplicitWaiting && isRecoveryNeeded && !isLeafSurface && recoveryLeafBlockers.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className={subRowLabelClass}>Liveness break at</span>
              {recoveryLeafBlockers.map((blocker) => renderBlockerChip(blocker, "rose"))}
            </div>
          ) : null}
          {!showExplicitWaiting && !isRecoveryNeeded && showStalledRow ? (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className={subRowLabelClass}>Stalled in review</span>
              {stalledLeafBlockers.map((blocker) => renderBlockerChip(blocker, "amber"))}
            </div>
          ) : !showExplicitWaiting && !isRecoveryNeeded && terminalBlockers.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className={subRowLabelClass}>Ultimately waiting on</span>
              {terminalBlockers.map((blocker) => renderBlockerChip(blocker, "amber"))}
            </div>
          ) : null}
          {ownerPill}
        </div>
      </div>
    </div>
  );
}
