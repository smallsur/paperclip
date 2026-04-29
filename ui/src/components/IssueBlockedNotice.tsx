import type { IssueBlockerAttention, IssueRelationIssueSummary } from "@paperclipai/shared";
import { AlertTriangle } from "lucide-react";
import { createIssueDetailPath } from "../lib/issueDetailBreadcrumb";
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

export function IssueBlockedNotice({
  issueStatus,
  blockers,
  blockerAttention,
  ownerAgentName,
  ownerUserName,
}: {
  issueStatus?: string;
  blockers: IssueRelationIssueSummary[];
  blockerAttention?: IssueBlockerAttention | null;
  ownerAgentName?: string | null;
  ownerUserName?: string | null;
}) {
  const isRecoveryNeeded = blockerAttention?.state === "recovery_needed"
    && blockerAttention.reason !== null
    && RECOVERY_REASONS.has(blockerAttention.reason);
  if (blockers.length === 0 && issueStatus !== "blocked" && !isRecoveryNeeded) return null;

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
  // Leaf-level surface: the issue itself is the invalid leaf. We render the
  // rose notice without any blocker chips, using the leaf-perspective copy.
  const isLeafSurface = isRecoveryNeeded && issueStatus !== "blocked";

  const containerClass = isRecoveryNeeded
    ? "mb-3 rounded-md border border-rose-300/70 bg-rose-50/90 px-3 py-2.5 text-sm text-rose-950 shadow-sm dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100"
    : "mb-3 rounded-md border border-amber-300/70 bg-amber-50/90 px-3 py-2.5 text-sm text-amber-950 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100";
  const iconClass = isRecoveryNeeded
    ? "mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-300"
    : "mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300";
  const subRowLabelClass = isRecoveryNeeded
    ? "text-xs font-medium text-rose-800 dark:text-rose-200"
    : "text-xs font-medium text-amber-800 dark:text-amber-200";

  const renderBlockerChip = (blocker: IssueRelationIssueSummary, variant: "amber" | "rose" = "amber") => {
    const issuePathId = blocker.identifier ?? blocker.id;
    const chipClass = variant === "rose"
      ? "inline-flex max-w-full items-center gap-1 rounded-md border border-rose-300/70 bg-background/80 px-2 py-1 font-mono text-xs text-rose-950 transition-colors hover:border-rose-500 hover:bg-rose-100 hover:underline dark:border-rose-500/40 dark:bg-background/40 dark:text-rose-100 dark:hover:bg-rose-500/15"
      : "inline-flex max-w-full items-center gap-1 rounded-md border border-amber-300/70 bg-background/80 px-2 py-1 font-mono text-xs text-amber-950 transition-colors hover:border-amber-500 hover:bg-amber-100 hover:underline dark:border-amber-500/40 dark:bg-background/40 dark:text-amber-100 dark:hover:bg-amber-500/15";
    const labelClass = variant === "rose"
      ? "max-w-[18rem] truncate font-sans text-[11px] text-rose-800 dark:text-rose-200"
      : "max-w-[18rem] truncate font-sans text-[11px] text-amber-800 dark:text-amber-200";
    return (
      <IssueLinkQuicklook
        key={blocker.id}
        issuePathId={issuePathId}
        to={createIssueDetailPath(issuePathId)}
        className={chipClass}
      >
        <span>{blocker.identifier ?? blocker.id.slice(0, 8)}</span>
        <span className={labelClass}>{blocker.title}</span>
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

  return (
    <div
      data-blocker-attention-state={blockerAttention?.state}
      data-blocker-attention-reason={blockerAttention?.reason ?? undefined}
      className={containerClass}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className={iconClass} />
        <div className="min-w-0 space-y-1.5">
          <p className="leading-5">
            {isRecoveryNeeded
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
          {!isRecoveryNeeded && blockers.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {blockers.map((blocker) => renderBlockerChip(blocker, "amber"))}
            </div>
          ) : null}
          {isRecoveryNeeded && !isLeafSurface && recoveryLeafBlockers.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className={subRowLabelClass}>Liveness break at</span>
              {recoveryLeafBlockers.map((blocker) => renderBlockerChip(blocker, "rose"))}
            </div>
          ) : null}
          {!isRecoveryNeeded && showStalledRow ? (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className={subRowLabelClass}>Stalled in review</span>
              {stalledLeafBlockers.map((blocker) => renderBlockerChip(blocker, "amber"))}
            </div>
          ) : !isRecoveryNeeded && terminalBlockers.length > 0 ? (
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
