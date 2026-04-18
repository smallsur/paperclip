import { Router } from "express";
import { z } from "zod";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents } from "@paperclipai/db";
import { CONFERENCE_ROOM_ORIGIN_KIND } from "@paperclipai/shared";
import { forbidden, notFound, unprocessable } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import {
  heartbeatService,
  issueService,
  logActivity,
} from "../services/index.js";
import { logger } from "../middleware/logger.js";

const createConferenceRoomChatSchema = z.object({
  targetAgentId: z.string().uuid().optional().nullable(),
  initialBody: z.string().trim().min(1).optional(),
});

async function resolveConferenceRoomTarget(db: Db, companyId: string, targetAgentId?: string | null) {
  if (targetAgentId) {
    const target = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, targetAgentId), eq(agents.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!target) throw notFound("Conference room target agent not found");
    if (target.role !== "ceo") throw unprocessable("Conference Room currently supports CEO chats only");
    if (target.status === "terminated") throw unprocessable("Conference Room target agent is terminated");
    return target;
  }

  const rootCeo = await db
    .select()
    .from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.role, "ceo"), isNull(agents.reportsTo), ne(agents.status, "terminated")))
    .orderBy(asc(agents.createdAt), asc(agents.id))
    .limit(1)
    .then((rows) => rows[0] ?? null);
  if (rootCeo) return rootCeo;

  return db
    .select()
    .from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.role, "ceo"), ne(agents.status, "terminated")))
    .orderBy(asc(agents.createdAt), asc(agents.id))
    .limit(1)
    .then((rows) => rows[0] ?? null);
}

export function conferenceRoomRoutes(db: Db) {
  const router = Router();
  const issues = issueService(db);
  const heartbeat = heartbeatService(db);

  router.get("/companies/:companyId/conference-room/target", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const target = await resolveConferenceRoomTarget(db, companyId);
    res.json({ target: target ?? null, label: target ? "CEO" : null });
  });

  router.get("/companies/:companyId/conference-room/chats", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const target = await resolveConferenceRoomTarget(
      db,
      companyId,
      typeof req.query.targetAgentId === "string" ? req.query.targetAgentId : null,
    );
    if (!target) {
      res.json([]);
      return;
    }

    const chats = await issues.list(companyId, {
      originKind: CONFERENCE_ROOM_ORIGIN_KIND,
      originId: target.id,
      limit: typeof req.query.limit === "string" ? Number(req.query.limit) : undefined,
    });
    const rows = await Promise.all(
      chats.map(async (chat) => {
        const latestComment = await issues.listComments(chat.id, { order: "desc", limit: 1 });
        return {
          ...chat,
          latestComment: latestComment[0] ?? null,
        };
      }),
    );
    res.json(rows);
  });

  router.post(
    "/companies/:companyId/conference-room/chats",
    validate(createConferenceRoomChatSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      if (req.actor.type === "agent") {
        throw forbidden("Conference Room chats must be created by the board");
      }

      const target = await resolveConferenceRoomTarget(db, companyId, req.body.targetAgentId);
      if (!target) {
        res.status(404).json({ error: "CEO agent not found" });
        return;
      }

      const actor = getActorInfo(req);
      const initialBody = typeof req.body.initialBody === "string" ? req.body.initialBody.trim() : "";
      const issue = await issues.create(companyId, {
        title: "New chat",
        description: null,
        status: initialBody ? "todo" : "backlog",
        priority: "medium",
        assigneeAgentId: target.id,
        originKind: CONFERENCE_ROOM_ORIGIN_KIND,
        originId: target.id,
        createdByAgentId: actor.agentId,
        createdByUserId: actor.actorType === "user" ? actor.actorId : null,
      });

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "issue.created",
        entityType: "issue",
        entityId: issue.id,
        details: {
          title: issue.title,
          identifier: issue.identifier,
          originKind: CONFERENCE_ROOM_ORIGIN_KIND,
          originId: target.id,
        },
      });

      let comment = null;
      if (initialBody) {
        comment = await issues.addComment(issue.id, initialBody, {
          userId: actor.actorType === "user" ? actor.actorId : undefined,
          runId: actor.runId,
        });

        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "issue.comment_added",
          entityType: "issue",
          entityId: issue.id,
          details: {
            commentId: comment.id,
            bodySnippet: comment.body.slice(0, 120),
            identifier: issue.identifier,
            issueTitle: issue.title,
            originKind: CONFERENCE_ROOM_ORIGIN_KIND,
          },
        });

        void heartbeat
          .wakeup(target.id, {
            source: "automation",
            triggerDetail: "system",
            reason: "issue_commented",
            payload: {
              issueId: issue.id,
              commentId: comment.id,
              mutation: "conference_room_comment",
            },
            requestedByActorType: actor.actorType,
            requestedByActorId: actor.actorId,
            contextSnapshot: {
              issueId: issue.id,
              taskId: issue.id,
              commentId: comment.id,
              wakeCommentId: comment.id,
              wakeReason: "issue_commented",
              source: "conference_room.comment",
              conferenceRoom: {
                targetAgentId: target.id,
                targetLabel: "CEO",
              },
            },
          })
          .catch((err) =>
            logger.warn({ err, issueId: issue.id, agentId: target.id }, "failed to wake conference room target"),
          );
      }

      res.status(201).json({ issue, comment, target, label: "CEO" });
    },
  );

  return router;
}
