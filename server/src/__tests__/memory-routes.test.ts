import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { memoryRoutes } from "../routes/memory.js";

const companyA = "11111111-1111-4111-8111-111111111111";
const companyB = "22222222-2222-4222-8222-222222222222";
const bindingId = "33333333-3333-4333-8333-333333333333";

const mockMemoryService = vi.hoisted(() => ({
  providers: vi.fn(),
  listBindings: vi.fn(),
  listTargets: vi.fn(),
  createBinding: vi.fn(),
  getBindingById: vi.fn(),
  updateBinding: vi.fn(),
  setCompanyDefault: vi.fn(),
  resolveBinding: vi.fn(),
  setAgentOverride: vi.fn(),
  query: vi.fn(),
  capture: vi.fn(),
  forget: vi.fn(),
  listRecords: vi.fn(),
  getRecord: vi.fn(),
  listOperations: vi.fn(),
  listExtractionJobs: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  agentService: () => mockAgentService,
  logActivity: mockLogActivity,
  memoryService: () => mockMemoryService,
}));

function createApp(actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", memoryRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("memory routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMemoryService.getBindingById.mockResolvedValue({
      id: bindingId,
      companyId: companyA,
      key: "primary",
      name: "Primary",
      providerKey: "local_basic",
      config: {},
      enabled: true,
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    });
    mockMemoryService.updateBinding.mockResolvedValue({
      id: bindingId,
      companyId: companyA,
      key: "primary",
      name: "Primary",
      providerKey: "local_basic",
      config: {},
      enabled: false,
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-02T00:00:00.000Z"),
    });
    mockLogActivity.mockResolvedValue(undefined);
  });

  it("blocks binding updates for board users outside the binding company", async () => {
    const app = createApp({
      type: "board",
      userId: "board-user",
      source: "session",
      companyIds: [companyB],
      isInstanceAdmin: false,
    });

    const res = await request(app)
      .patch(`/api/memory/bindings/${bindingId}`)
      .set("Origin", "http://localhost:3100")
      .send({ enabled: false });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "User does not have access to this company" });
    expect(mockMemoryService.getBindingById).toHaveBeenCalledWith(bindingId);
    expect(mockMemoryService.updateBinding).not.toHaveBeenCalled();
  });

  it("allows binding updates when the board user can access the binding company", async () => {
    const app = createApp({
      type: "board",
      userId: "board-user",
      source: "session",
      companyIds: [companyA],
      isInstanceAdmin: false,
    });

    const res = await request(app)
      .patch(`/api/memory/bindings/${bindingId}`)
      .set("Origin", "http://localhost:3100")
      .send({ enabled: false });

    expect(res.status).toBe(200);
    expect(mockMemoryService.getBindingById).toHaveBeenCalledWith(bindingId);
    expect(mockMemoryService.updateBinding).toHaveBeenCalledWith(bindingId, { enabled: false });
    expect(mockLogActivity).toHaveBeenCalledOnce();
  });
});
