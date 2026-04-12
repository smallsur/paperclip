import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { projects } from "./projects.js";
import { issues } from "./issues.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { memoryBindings } from "./memory_bindings.js";
import { memoryOperations } from "./memory_operations.js";
import type { MemorySourceKind } from "@paperclipai/shared";

export const memoryLocalRecords = pgTable(
  "memory_local_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    bindingId: uuid("binding_id").notNull().references(() => memoryBindings.id, { onDelete: "cascade" }),
    providerKey: text("provider_key").notNull(),
    scopeAgentId: uuid("scope_agent_id").references(() => agents.id),
    scopeProjectId: uuid("scope_project_id").references(() => projects.id),
    scopeIssueId: uuid("scope_issue_id").references(() => issues.id),
    scopeRunId: uuid("scope_run_id").references(() => heartbeatRuns.id),
    scopeSubjectId: text("scope_subject_id"),
    sourceKind: text("source_kind").$type<MemorySourceKind>(),
    sourceIssueId: uuid("source_issue_id").references(() => issues.id),
    sourceCommentId: uuid("source_comment_id"),
    sourceDocumentKey: text("source_document_key"),
    sourceRunId: uuid("source_run_id").references(() => heartbeatRuns.id),
    sourceActivityId: uuid("source_activity_id"),
    sourceExternalRef: text("source_external_ref"),
    title: text("title"),
    content: text("content").notNull(),
    summary: text("summary"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdByOperationId: uuid("created_by_operation_id").references(() => memoryOperations.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyBindingCreatedIdx: index("memory_local_records_company_binding_created_idx").on(
      table.companyId,
      table.bindingId,
      table.createdAt,
    ),
    companyAgentCreatedIdx: index("memory_local_records_company_agent_created_idx").on(
      table.companyId,
      table.scopeAgentId,
      table.createdAt,
    ),
    companyIssueCreatedIdx: index("memory_local_records_company_issue_created_idx").on(
      table.companyId,
      table.scopeIssueId,
      table.createdAt,
    ),
    contentSearchIdx: index("memory_local_records_fts_idx").using(
      "gin",
      sql`to_tsvector('english', coalesce(${table.title}, '') || ' ' || ${table.content})`,
    ),
  }),
);
