import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  memoryBindings,
  memoryBindingTargets,
  memoryExtractionJobs,
  memoryLocalRecords,
  memoryOperations,
} from "@paperclipai/db";
import type {
  MemoryBinding,
  MemoryBindingTarget,
  MemoryCapture,
  MemoryCaptureResult,
  MemoryExtractionJob,
  MemoryForget,
  MemoryForgetResult,
  MemoryListExtractionJobsQuery,
  MemoryListOperationsQuery,
  MemoryListRecordsQuery,
  MemoryOperation,
  MemoryProviderDescriptor,
  MemoryQuery,
  MemoryQueryResult,
  MemoryRecord,
  MemoryResolvedBinding,
  MemoryScope,
  MemorySourceRef,
  MemoryUsage,
} from "@paperclipai/shared";
import { createMemoryBindingSchema, updateMemoryBindingSchema } from "@paperclipai/shared";
import { z } from "zod";
import { conflict, notFound, unprocessable } from "../errors.js";
import { costService } from "./costs.js";

type ActorInfo = {
  actorType: "agent" | "user" | "system";
  actorId: string;
  agentId: string | null;
  userId: string | null;
  runId: string | null;
};

type BindingRow = typeof memoryBindings.$inferSelect;
type TargetRow = typeof memoryBindingTargets.$inferSelect;
type OperationRow = typeof memoryOperations.$inferSelect;
type RecordRow = typeof memoryLocalRecords.$inferSelect;
type ExtractionJobRow = typeof memoryExtractionJobs.$inferSelect;

const LOCAL_BASIC_PROVIDER_KEY = "local_basic";

const localBasicConfigSchema = z
  .object({
    enablePreRunHydrate: z.boolean().optional().default(true),
    enablePostRunCapture: z.boolean().optional().default(true),
    enableIssueCommentCapture: z.boolean().optional().default(false),
    enableIssueDocumentCapture: z.boolean().optional().default(true),
    maxHydrateSnippets: z.number().int().positive().max(10).optional().default(5),
  })
  .strict();

type LocalBasicConfig = z.infer<typeof localBasicConfigSchema>;

const LOCAL_BASIC_PROVIDER: MemoryProviderDescriptor = {
  key: LOCAL_BASIC_PROVIDER_KEY,
  displayName: "Local basic",
  description: "Deterministic local memory backed by Postgres full-text search.",
  kind: "builtin",
  pluginId: null,
  capabilities: {
    browse: true,
    correction: false,
    asyncIngestion: false,
    providerManagedExtraction: false,
  },
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      enablePreRunHydrate: { type: "boolean", default: true },
      enablePostRunCapture: { type: "boolean", default: true },
      enableIssueCommentCapture: { type: "boolean", default: false },
      enableIssueDocumentCapture: { type: "boolean", default: true },
      maxHydrateSnippets: { type: "integer", minimum: 1, maximum: 10, default: 5 },
    },
  },
};

function parseLocalBasicConfig(config: Record<string, unknown> | null | undefined): LocalBasicConfig {
  return localBasicConfigSchema.parse(config ?? {});
}

function scopeFromRow(row: {
  scopeAgentId: string | null;
  scopeProjectId: string | null;
  scopeIssueId: string | null;
  scopeRunId: string | null;
  scopeSubjectId: string | null;
}): MemoryScope {
  return {
    agentId: row.scopeAgentId,
    projectId: row.scopeProjectId,
    issueId: row.scopeIssueId,
    runId: row.scopeRunId,
    subjectId: row.scopeSubjectId,
  };
}

function sourceFromRow(row: {
  sourceKind: MemorySourceRef["kind"] | null;
  sourceIssueId: string | null;
  sourceCommentId: string | null;
  sourceDocumentKey: string | null;
  sourceRunId: string | null;
  sourceActivityId: string | null;
  sourceExternalRef: string | null;
}): MemorySourceRef | null {
  if (!row.sourceKind) return null;
  return {
    kind: row.sourceKind,
    issueId: row.sourceIssueId,
    commentId: row.sourceCommentId,
    documentKey: row.sourceDocumentKey,
    runId: row.sourceRunId,
    activityId: row.sourceActivityId,
    externalRef: row.sourceExternalRef,
  };
}

function normalizeUsage(input: unknown): MemoryUsage[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null)
    .map((value) => ({
      provider: typeof value.provider === "string" ? value.provider : "unknown",
      model: typeof value.model === "string" ? value.model : null,
      inputTokens: typeof value.inputTokens === "number" ? value.inputTokens : 0,
      outputTokens: typeof value.outputTokens === "number" ? value.outputTokens : 0,
      embeddingTokens: typeof value.embeddingTokens === "number" ? value.embeddingTokens : 0,
      costCents: typeof value.costCents === "number" ? value.costCents : 0,
      latencyMs: typeof value.latencyMs === "number" ? value.latencyMs : null,
      details:
        typeof value.details === "object" && value.details !== null && !Array.isArray(value.details)
          ? (value.details as Record<string, unknown>)
          : null,
    }));
}

function mapBinding(row: BindingRow): MemoryBinding {
  return {
    id: row.id,
    companyId: row.companyId,
    key: row.key,
    name: row.name ?? null,
    providerKey: row.providerKey,
    config: row.config ?? {},
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapTarget(row: TargetRow): MemoryBindingTarget {
  return {
    id: row.id,
    companyId: row.companyId,
    bindingId: row.bindingId,
    targetType: row.targetType,
    targetId: row.targetId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapOperation(row: OperationRow): MemoryOperation {
  return {
    id: row.id,
    companyId: row.companyId,
    bindingId: row.bindingId,
    providerKey: row.providerKey,
    operationType: row.operationType,
    triggerKind: row.triggerKind,
    hookKind: row.hookKind ?? null,
    status: row.status,
    actorType: row.actorType as MemoryOperation["actorType"],
    actorId: row.actorId,
    agentId: row.agentId ?? null,
    userId: row.userId ?? null,
    scope: scopeFromRow(row),
    source: sourceFromRow(row),
    queryText: row.queryText ?? null,
    recordCount: row.recordCount,
    requestJson:
      typeof row.requestJson === "object" && row.requestJson !== null && !Array.isArray(row.requestJson)
        ? (row.requestJson as Record<string, unknown>)
        : null,
    resultJson:
      typeof row.resultJson === "object" && row.resultJson !== null && !Array.isArray(row.resultJson)
        ? (row.resultJson as Record<string, unknown>)
        : null,
    usage: normalizeUsage(row.usageJson),
    error: row.error ?? null,
    costEventId: row.costEventId ?? null,
    financeEventId: row.financeEventId ?? null,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
  };
}

function mapRecord(row: RecordRow): MemoryRecord {
  return {
    id: row.id,
    companyId: row.companyId,
    bindingId: row.bindingId,
    providerKey: row.providerKey,
    scope: scopeFromRow(row),
    source: sourceFromRow(row),
    title: row.title ?? null,
    content: row.content,
    summary: row.summary ?? null,
    metadata: row.metadata ?? {},
    createdByOperationId: row.createdByOperationId ?? null,
    deletedAt: row.deletedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapExtractionJob(row: ExtractionJobRow): MemoryExtractionJob {
  return {
    id: row.id,
    companyId: row.companyId,
    bindingId: row.bindingId,
    providerKey: row.providerKey,
    operationId: row.operationId ?? null,
    status: row.status,
    providerJobId: row.providerJobId ?? null,
    source: sourceFromRow(row),
    resultJson:
      typeof row.resultJson === "object" && row.resultJson !== null && !Array.isArray(row.resultJson)
        ? (row.resultJson as Record<string, unknown>)
        : null,
    error: row.error ?? null,
    startedAt: row.startedAt ?? null,
    completedAt: row.completedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function buildScopeConditions(companyId: string, bindingId: string, scope: MemoryScope) {
  const conditions = [
    eq(memoryLocalRecords.companyId, companyId),
    eq(memoryLocalRecords.bindingId, bindingId),
    isNull(memoryLocalRecords.deletedAt),
  ];
  if (scope.agentId) {
    conditions.push(or(isNull(memoryLocalRecords.scopeAgentId), eq(memoryLocalRecords.scopeAgentId, scope.agentId))!);
  }
  if (scope.projectId) {
    conditions.push(or(isNull(memoryLocalRecords.scopeProjectId), eq(memoryLocalRecords.scopeProjectId, scope.projectId))!);
  }
  if (scope.issueId) {
    conditions.push(or(isNull(memoryLocalRecords.scopeIssueId), eq(memoryLocalRecords.scopeIssueId, scope.issueId))!);
  }
  if (scope.runId) {
    conditions.push(or(isNull(memoryLocalRecords.scopeRunId), eq(memoryLocalRecords.scopeRunId, scope.runId))!);
  }
  if (scope.subjectId) {
    conditions.push(or(isNull(memoryLocalRecords.scopeSubjectId), eq(memoryLocalRecords.scopeSubjectId, scope.subjectId))!);
  }
  return conditions;
}

async function createDirectCostEvent(
  db: Db,
  companyId: string,
  actor: ActorInfo,
  scope: MemoryScope,
  usage: MemoryUsage[],
): Promise<string | null> {
  const costCents = usage.reduce((sum, entry) => sum + entry.costCents, 0);
  if (costCents <= 0) return null;
  const agentId = actor.agentId ?? scope.agentId ?? null;
  if (!agentId) return null;
  const first = usage[0] ?? null;
  const event = await costService(db).createEvent(companyId, {
    agentId,
    issueId: scope.issueId ?? null,
    projectId: scope.projectId ?? null,
    goalId: null,
    heartbeatRunId: scope.runId ?? actor.runId ?? null,
    billingCode: null,
    provider: first?.provider ?? "memory",
    biller: first?.provider ?? "memory",
    billingType: "metered_api",
    model: first?.model ?? "memory",
    inputTokens: usage.reduce((sum, entry) => sum + entry.inputTokens + entry.embeddingTokens, 0),
    outputTokens: usage.reduce((sum, entry) => sum + entry.outputTokens, 0),
    cachedInputTokens: 0,
    costCents,
    occurredAt: new Date(),
  });
  return event.id;
}

export function memoryService(db: Db) {
  async function getBindingOrThrow(bindingId: string) {
    const binding = await db
      .select()
      .from(memoryBindings)
      .where(eq(memoryBindings.id, bindingId))
      .then((rows) => rows[0] ?? null);
    if (!binding) throw notFound("Memory binding not found");
    return binding;
  }

  async function validateProviderConfig(providerKey: string, config: Record<string, unknown>) {
    if (providerKey !== LOCAL_BASIC_PROVIDER_KEY) {
      throw unprocessable(`Unknown memory provider: ${providerKey}`);
    }
    return parseLocalBasicConfig(config);
  }

  async function resolveBindingInternal(companyId: string, scope: MemoryScope, bindingKey?: string | null) {
    if (bindingKey) {
      const binding = await db
        .select()
        .from(memoryBindings)
        .where(and(eq(memoryBindings.companyId, companyId), eq(memoryBindings.key, bindingKey)))
        .then((rows) => rows[0] ?? null);
      if (!binding) throw notFound("Memory binding not found");
      return {
        targetType: null,
        targetId: null,
        binding,
      };
    }

    const agentId = scope.agentId ?? null;
    if (agentId) {
      const target = await db
        .select({
          target: memoryBindingTargets,
          binding: memoryBindings,
        })
        .from(memoryBindingTargets)
        .innerJoin(memoryBindings, eq(memoryBindingTargets.bindingId, memoryBindings.id))
        .where(
          and(
            eq(memoryBindingTargets.companyId, companyId),
            eq(memoryBindingTargets.targetType, "agent"),
            eq(memoryBindingTargets.targetId, agentId),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (target) {
        return {
          targetType: target.target.targetType,
          targetId: target.target.targetId,
          binding: target.binding,
        };
      }
    }

    const target = await db
      .select({
        target: memoryBindingTargets,
        binding: memoryBindings,
      })
      .from(memoryBindingTargets)
      .innerJoin(memoryBindings, eq(memoryBindingTargets.bindingId, memoryBindings.id))
      .where(
        and(
          eq(memoryBindingTargets.companyId, companyId),
          eq(memoryBindingTargets.targetType, "company"),
          eq(memoryBindingTargets.targetId, companyId),
        ),
      )
      .then((rows) => rows[0] ?? null);

    return target
      ? {
          targetType: target.target.targetType,
          targetId: target.target.targetId,
          binding: target.binding,
        }
      : {
          targetType: null,
          targetId: null,
          binding: null,
        };
  }

  async function queryLocalBasic(
    binding: BindingRow,
    scope: MemoryScope,
    query: string,
    topK: number,
  ) {
    const rankExpr = sql<number>`
      ts_rank_cd(
        to_tsvector('english', coalesce(${memoryLocalRecords.title}, '') || ' ' || ${memoryLocalRecords.content}),
        websearch_to_tsquery('english', ${query})
      )
    `;
    const rows = await db
      .select()
      .from(memoryLocalRecords)
      .where(
        and(
          ...buildScopeConditions(binding.companyId, binding.id, scope),
          sql`to_tsvector('english', coalesce(${memoryLocalRecords.title}, '') || ' ' || ${memoryLocalRecords.content}) @@ websearch_to_tsquery('english', ${query})`,
        ),
      )
      .orderBy(desc(rankExpr), desc(memoryLocalRecords.createdAt))
      .limit(topK);

    return rows.map((row) => mapRecord(row));
  }

  async function captureLocalBasic(
    binding: BindingRow,
    scope: MemoryScope,
    source: MemorySourceRef,
    input: {
      title?: string | null;
      content: string;
      summary?: string | null;
      metadata?: Record<string, unknown>;
    },
    operationId: string,
  ) {
    const [row] = await db
      .insert(memoryLocalRecords)
      .values({
        id: randomUUID(),
        companyId: binding.companyId,
        bindingId: binding.id,
        providerKey: binding.providerKey,
        scopeAgentId: scope.agentId ?? null,
        scopeProjectId: scope.projectId ?? null,
        scopeIssueId: scope.issueId ?? null,
        scopeRunId: scope.runId ?? null,
        scopeSubjectId: scope.subjectId ?? null,
        sourceKind: source.kind,
        sourceIssueId: source.issueId ?? null,
        sourceCommentId: source.commentId ?? null,
        sourceDocumentKey: source.documentKey ?? null,
        sourceRunId: source.runId ?? null,
        sourceActivityId: source.activityId ?? null,
        sourceExternalRef: source.externalRef ?? null,
        title: input.title ?? null,
        content: input.content,
        summary: input.summary ?? null,
        metadata: input.metadata ?? {},
        createdByOperationId: operationId,
      })
      .returning();

    return [mapRecord(row)];
  }

  async function listLocalBasic(companyId: string, filters: MemoryListRecordsQuery) {
    const conditions = [eq(memoryLocalRecords.companyId, companyId)];
    if (filters.bindingId) conditions.push(eq(memoryLocalRecords.bindingId, filters.bindingId));
    if (filters.agentId) conditions.push(eq(memoryLocalRecords.scopeAgentId, filters.agentId));
    if (filters.issueId) conditions.push(eq(memoryLocalRecords.scopeIssueId, filters.issueId));
    if (filters.runId) conditions.push(eq(memoryLocalRecords.scopeRunId, filters.runId));
    if (filters.sourceKind) conditions.push(eq(memoryLocalRecords.sourceKind, filters.sourceKind));
    if (!filters.includeDeleted) conditions.push(isNull(memoryLocalRecords.deletedAt));

    const rows = await db
      .select()
      .from(memoryLocalRecords)
      .where(and(...conditions))
      .orderBy(desc(memoryLocalRecords.createdAt))
      .limit(filters.limit);
    return rows.map((row) => mapRecord(row));
  }

  async function logOperation(input: {
    id?: string;
    companyId: string;
    binding: BindingRow;
    actor: ActorInfo;
    operationType: MemoryOperation["operationType"];
    triggerKind: MemoryOperation["triggerKind"];
    hookKind?: MemoryOperation["hookKind"];
    scope: MemoryScope;
    source?: MemorySourceRef | null;
    queryText?: string | null;
    requestJson?: Record<string, unknown> | null;
    resultJson?: Record<string, unknown> | null;
    recordCount?: number;
    usage?: MemoryUsage[];
    error?: string | null;
  }) {
    const costEventId = await createDirectCostEvent(
      db,
      input.companyId,
      input.actor,
      input.scope,
      input.usage ?? [],
    );
    const [row] = await db
      .insert(memoryOperations)
      .values({
        id: input.id ?? randomUUID(),
        companyId: input.companyId,
        bindingId: input.binding.id,
        providerKey: input.binding.providerKey,
        operationType: input.operationType,
        triggerKind: input.triggerKind,
        hookKind: input.hookKind ?? null,
        status: input.error ? "failed" : "succeeded",
        actorType: input.actor.actorType,
        actorId: input.actor.actorId,
        agentId: input.actor.agentId ?? null,
        userId: input.actor.userId ?? null,
        scopeAgentId: input.scope.agentId ?? null,
        scopeProjectId: input.scope.projectId ?? null,
        scopeIssueId: input.scope.issueId ?? null,
        scopeRunId: input.scope.runId ?? input.actor.runId ?? null,
        scopeSubjectId: input.scope.subjectId ?? null,
        sourceKind: input.source?.kind ?? null,
        sourceIssueId: input.source?.issueId ?? null,
        sourceCommentId: input.source?.commentId ?? null,
        sourceDocumentKey: input.source?.documentKey ?? null,
        sourceRunId: input.source?.runId ?? null,
        sourceActivityId: input.source?.activityId ?? null,
        sourceExternalRef: input.source?.externalRef ?? null,
        queryText: input.queryText ?? null,
        recordCount: input.recordCount ?? 0,
        requestJson: input.requestJson ?? null,
        resultJson: input.resultJson ?? null,
        usageJson: (input.usage ?? []) as unknown as Array<Record<string, unknown>>,
        error: input.error ?? null,
        costEventId,
        financeEventId: null,
      })
      .returning();
    return mapOperation(row);
  }

  function ensureBindingEnabled(binding: BindingRow | null): BindingRow {
    if (!binding) {
      throw notFound("No memory binding is configured");
    }
    if (!binding.enabled) {
      throw conflict("Resolved memory binding is disabled");
    }
    return binding;
  }

  const service = {
    providers: async () => [LOCAL_BASIC_PROVIDER],

    getBindingById: async (bindingId: string) => {
      const row = await db
        .select()
        .from(memoryBindings)
        .where(eq(memoryBindings.id, bindingId))
        .then((rows) => rows[0] ?? null);
      return row ? mapBinding(row) : null;
    },

    listBindings: async (companyId: string) => {
      const rows = await db
        .select()
        .from(memoryBindings)
        .where(eq(memoryBindings.companyId, companyId))
        .orderBy(memoryBindings.key);
      return rows.map((row) => mapBinding(row));
    },

    listTargets: async (companyId: string) => {
      const rows = await db
        .select()
        .from(memoryBindingTargets)
        .where(eq(memoryBindingTargets.companyId, companyId))
        .orderBy(memoryBindingTargets.targetType, memoryBindingTargets.targetId);
      return rows.map((row) => mapTarget(row));
    },

    createBinding: async (companyId: string, data: unknown) => {
      const parsed = createMemoryBindingSchema.parse(data);
      const normalizedConfig = await validateProviderConfig(parsed.providerKey, parsed.config);
      const existing = await db
        .select({ id: memoryBindings.id })
        .from(memoryBindings)
        .where(and(eq(memoryBindings.companyId, companyId), eq(memoryBindings.key, parsed.key)))
        .then((rows) => rows[0] ?? null);
      if (existing) throw conflict("Memory binding key already exists");

      const [row] = await db
        .insert(memoryBindings)
        .values({
          companyId,
          key: parsed.key,
          name: parsed.name ?? null,
          providerKey: parsed.providerKey,
          config: normalizedConfig,
          enabled: parsed.enabled,
        })
        .returning();
      return mapBinding(row);
    },

    updateBinding: async (bindingId: string, data: unknown) => {
      const parsed = updateMemoryBindingSchema.parse(data);
      const current = await getBindingOrThrow(bindingId);
      const normalizedConfig = parsed.config
        ? await validateProviderConfig(current.providerKey, parsed.config)
        : current.config;
      const [row] = await db
        .update(memoryBindings)
        .set({
          name: parsed.name === undefined ? current.name : parsed.name ?? null,
          config: normalizedConfig,
          enabled: parsed.enabled ?? current.enabled,
          updatedAt: new Date(),
        })
        .where(eq(memoryBindings.id, bindingId))
        .returning();
      return mapBinding(row);
    },

    setCompanyDefault: async (companyId: string, bindingId: string) => {
      const binding = await getBindingOrThrow(bindingId);
      if (binding.companyId !== companyId) throw unprocessable("Binding does not belong to company");
      await db
        .delete(memoryBindingTargets)
        .where(
          and(
            eq(memoryBindingTargets.companyId, companyId),
            eq(memoryBindingTargets.targetType, "company"),
            eq(memoryBindingTargets.targetId, companyId),
          ),
        );
      const [row] = await db
        .insert(memoryBindingTargets)
        .values({
          companyId,
          bindingId,
          targetType: "company",
          targetId: companyId,
        })
        .returning();
      return mapTarget(row);
    },

    setAgentOverride: async (agentId: string, bindingId: string | null) => {
      const agent = await db
        .select()
        .from(agents)
        .where(eq(agents.id, agentId))
        .then((rows) => rows[0] ?? null);
      if (!agent) throw notFound("Agent not found");

      await db
        .delete(memoryBindingTargets)
        .where(
          and(
            eq(memoryBindingTargets.companyId, agent.companyId),
            eq(memoryBindingTargets.targetType, "agent"),
            eq(memoryBindingTargets.targetId, agent.id),
          ),
        );

      if (!bindingId) return null;
      const binding = await getBindingOrThrow(bindingId);
      if (binding.companyId !== agent.companyId) throw unprocessable("Binding does not belong to agent company");

      const [row] = await db
        .insert(memoryBindingTargets)
        .values({
          companyId: agent.companyId,
          bindingId,
          targetType: "agent",
          targetId: agent.id,
        })
        .returning();
      return mapTarget(row);
    },

    resolveBinding: async (companyId: string, scope: MemoryScope): Promise<MemoryResolvedBinding> => {
      const resolved = await resolveBindingInternal(companyId, scope, null);
      return {
        companyId,
        targetType: resolved.targetType,
        targetId: resolved.targetId,
        binding: resolved.binding ? mapBinding(resolved.binding) : null,
      };
    },

    query: async (companyId: string, data: MemoryQuery, actor: ActorInfo, triggerKind: MemoryOperation["triggerKind"] = "manual", hookKind?: MemoryOperation["hookKind"]) => {
      const resolved = await resolveBindingInternal(companyId, data.scope ?? {}, data.bindingKey);
      const binding = ensureBindingEnabled(resolved.binding);
      const config = parseLocalBasicConfig(binding.config);
      const records = await queryLocalBasic(
        binding,
        data.scope ?? {},
        data.query,
        Math.min(data.topK ?? config.maxHydrateSnippets, 25),
      );
      const preamble =
        data.intent === "agent_preamble" && records.length > 0
          ? [
              "Relevant memory:",
              ...records.map((record, index) => {
                const sourceLabel = record.source?.kind ?? "memory";
                const body = (record.summary ?? record.content).replace(/\s+/g, " ").slice(0, 240);
                return `${index + 1}. [${sourceLabel}] ${body}`;
              }),
            ].join("\n")
          : null;
      const operation = await logOperation({
        companyId,
        binding,
        actor,
        operationType: "query",
        triggerKind,
        hookKind,
        scope: data.scope ?? {},
        queryText: data.query,
        requestJson: {
          topK: data.topK ?? null,
          intent: data.intent,
          metadataFilter: data.metadataFilter ?? null,
        },
        resultJson: {
          preamble,
          recordIds: records.map((record) => record.id),
        },
        recordCount: records.length,
      });
      return { operation, records, preamble } satisfies MemoryQueryResult;
    },

    capture: async (companyId: string, data: MemoryCapture, actor: ActorInfo, triggerKind: MemoryOperation["triggerKind"] = "manual", hookKind?: MemoryOperation["hookKind"]) => {
      const resolved = await resolveBindingInternal(companyId, data.scope ?? {}, data.bindingKey);
      const binding = ensureBindingEnabled(resolved.binding);
      const operationId = randomUUID();
      const records = await captureLocalBasic(
        binding,
        data.scope ?? {},
        data.source,
        {
          title: data.title ?? null,
          content: data.content,
          summary: data.summary ?? null,
          metadata: data.metadata ?? {},
        },
        operationId,
      );
      const operation = await logOperation({
        id: operationId,
        companyId,
        binding,
        actor,
        operationType: data.title || data.summary ? "upsert" : "capture",
        triggerKind,
        hookKind,
        scope: data.scope ?? {},
        source: data.source,
        requestJson: {
          title: data.title ?? null,
          metadata: data.metadata ?? {},
        },
        resultJson: {
          recordIds: records.map((record) => record.id),
        },
        recordCount: records.length,
      });
      return { operation, records } satisfies MemoryCaptureResult;
    },

    forget: async (companyId: string, data: MemoryForget, actor: ActorInfo, triggerKind: MemoryOperation["triggerKind"] = "manual") => {
      const rows = await db
        .select()
        .from(memoryLocalRecords)
        .where(and(eq(memoryLocalRecords.companyId, companyId), inArray(memoryLocalRecords.id, data.recordIds)));
      const recordIds = rows.map((row) => row.id);
      if (recordIds.length === 0) {
        throw notFound("Memory records not found");
      }
      const binding = await getBindingOrThrow(rows[0].bindingId);
      await db
        .update(memoryLocalRecords)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(memoryLocalRecords.companyId, companyId), inArray(memoryLocalRecords.id, recordIds)));
      const operation = await logOperation({
        companyId,
        binding,
        actor,
        operationType: "forget",
        triggerKind,
        scope: data.scope ?? {},
        requestJson: { recordIds },
        resultJson: { forgottenRecordIds: recordIds },
        recordCount: recordIds.length,
      });
      return { operation, forgottenRecordIds: recordIds } satisfies MemoryForgetResult;
    },

    listRecords: async (companyId: string, filters: MemoryListRecordsQuery) => listLocalBasic(companyId, filters),

    getRecord: async (companyId: string, recordId: string) => {
      const row = await db
        .select()
        .from(memoryLocalRecords)
        .where(and(eq(memoryLocalRecords.companyId, companyId), eq(memoryLocalRecords.id, recordId)))
        .then((rows) => rows[0] ?? null);
      return row ? mapRecord(row) : null;
    },

    listOperations: async (companyId: string, filters: MemoryListOperationsQuery) => {
      const conditions = [eq(memoryOperations.companyId, companyId)];
      if (filters.bindingId) conditions.push(eq(memoryOperations.bindingId, filters.bindingId));
      if (filters.operationType) conditions.push(eq(memoryOperations.operationType, filters.operationType));
      if (filters.status) conditions.push(eq(memoryOperations.status, filters.status));
      if (filters.hookKind) conditions.push(eq(memoryOperations.hookKind, filters.hookKind));
      if (filters.agentId) conditions.push(eq(memoryOperations.scopeAgentId, filters.agentId));
      if (filters.issueId) conditions.push(eq(memoryOperations.scopeIssueId, filters.issueId));
      if (filters.runId) conditions.push(eq(memoryOperations.scopeRunId, filters.runId));
      const rows = await db
        .select()
        .from(memoryOperations)
        .where(and(...conditions))
        .orderBy(desc(memoryOperations.occurredAt), desc(memoryOperations.createdAt))
        .limit(filters.limit);
      return rows.map((row) => mapOperation(row));
    },

    listExtractionJobs: async (companyId: string, filters: MemoryListExtractionJobsQuery) => {
      const conditions = [eq(memoryExtractionJobs.companyId, companyId)];
      if (filters.bindingId) conditions.push(eq(memoryExtractionJobs.bindingId, filters.bindingId));
      const rows = await db
        .select()
        .from(memoryExtractionJobs)
        .where(and(...conditions))
        .orderBy(desc(memoryExtractionJobs.createdAt))
        .limit(filters.limit);
      return rows.map((row) => mapExtractionJob(row));
    },

    preRunHydrate: async (input: {
      companyId: string;
      agentId: string;
      projectId?: string | null;
      issueId?: string | null;
      runId: string;
      query: string;
    }) => {
      const resolved = await resolveBindingInternal(
        input.companyId,
        {
          agentId: input.agentId,
          projectId: input.projectId ?? null,
          issueId: input.issueId ?? null,
          runId: input.runId,
        },
        null,
      );
      if (!resolved.binding || !resolved.binding.enabled) {
        return null;
      }
      const config = parseLocalBasicConfig(resolved.binding.config);
      if (!config.enablePreRunHydrate) {
        return null;
      }
      const result = await service.query(
        input.companyId,
        {
          scope: {
            agentId: input.agentId,
            projectId: input.projectId ?? null,
            issueId: input.issueId ?? null,
            runId: input.runId,
          },
          query: input.query,
          topK: config.maxHydrateSnippets,
          intent: "agent_preamble",
        },
        {
          actorType: "agent",
          actorId: input.agentId,
          agentId: input.agentId,
          userId: null,
          runId: input.runId,
        },
        "hook",
        "pre_run_hydrate",
      );
      return result.preamble;
    },

    captureRunSummary: async (input: {
      companyId: string;
      agentId: string;
      projectId?: string | null;
      issueId?: string | null;
      runId: string;
      title?: string | null;
      summary: string;
    }) => {
      const resolved = await resolveBindingInternal(
        input.companyId,
        {
          agentId: input.agentId,
          projectId: input.projectId ?? null,
          issueId: input.issueId ?? null,
          runId: input.runId,
        },
        null,
      );
      if (!resolved.binding || !resolved.binding.enabled) {
        return null;
      }
      const config = parseLocalBasicConfig(resolved.binding.config);
      if (!config.enablePostRunCapture) {
        return null;
      }
      return service.capture(
        input.companyId,
        {
          scope: {
            agentId: input.agentId,
            projectId: input.projectId ?? null,
            issueId: input.issueId ?? null,
            runId: input.runId,
          },
          source: {
            kind: "run",
            issueId: input.issueId ?? null,
            runId: input.runId,
          },
          title: input.title ?? "Run summary",
          content: input.summary,
          summary: input.summary,
        },
        {
          actorType: "agent",
          actorId: input.agentId,
          agentId: input.agentId,
          userId: null,
          runId: input.runId,
        },
        "hook",
        "post_run_capture",
      );
    },

    captureIssueComment: async (input: {
      companyId: string;
      issueId: string;
      commentId: string;
      agentId?: string | null;
      projectId?: string | null;
      body: string;
      actor: ActorInfo;
    }) => {
      const resolved = await resolveBindingInternal(
        input.companyId,
        {
          agentId: input.agentId ?? null,
          projectId: input.projectId ?? null,
          issueId: input.issueId,
        },
        null,
      );
      if (!resolved.binding || !resolved.binding.enabled) return null;
      const config = parseLocalBasicConfig(resolved.binding.config);
      if (!config.enableIssueCommentCapture) return null;
      return service.capture(
        input.companyId,
        {
          scope: {
            agentId: input.agentId ?? null,
            projectId: input.projectId ?? null,
            issueId: input.issueId,
          },
          source: {
            kind: "issue_comment",
            issueId: input.issueId,
            commentId: input.commentId,
          },
          title: "Issue comment",
          content: input.body,
          summary: input.body.replace(/\s+/g, " ").slice(0, 240),
        },
        input.actor,
        "hook",
        "issue_comment_capture",
      );
    },

    captureIssueDocument: async (input: {
      companyId: string;
      issueId: string;
      agentId?: string | null;
      projectId?: string | null;
      key: string;
      title?: string | null;
      body: string;
      actor: ActorInfo;
    }) => {
      const resolved = await resolveBindingInternal(
        input.companyId,
        {
          agentId: input.agentId ?? null,
          projectId: input.projectId ?? null,
          issueId: input.issueId,
        },
        null,
      );
      if (!resolved.binding || !resolved.binding.enabled) return null;
      const config = parseLocalBasicConfig(resolved.binding.config);
      if (!config.enableIssueDocumentCapture) return null;
      return service.capture(
        input.companyId,
        {
          scope: {
            agentId: input.agentId ?? null,
            projectId: input.projectId ?? null,
            issueId: input.issueId,
          },
          source: {
            kind: "issue_document",
            issueId: input.issueId,
            documentKey: input.key,
          },
          title: input.title ?? `Issue document: ${input.key}`,
          content: input.body,
          summary: input.body.replace(/\s+/g, " ").slice(0, 240),
        },
        input.actor,
        "hook",
        "issue_document_capture",
      );
    },
  };

  return service;
}
