import { beforeEach, describe, expect, it, vi } from "vitest";
import { recoveryService } from "../services/recovery/service.js";

const mockTestEnvironment = vi.fn();
const mockPublishLiveEvent = vi.hoisted(() => vi.fn());
const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: mockPublishLiveEvent,
  subscribeCompanyLiveEvents: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  logActivity: mockLogActivity,
}));

vi.mock("../adapters/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../adapters/index.js")>();
  return {
    ...actual,
    requireServerAdapter: (type: string) => {
      if (type === "gemini_local" || type === "codex_local") {
        return {
          testEnvironment: mockTestEnvironment,
        };
      }
      return actual.requireServerAdapter(type);
    },
  };
});

describe("agent error recovery reconciliation (unit)", () => {
  const companyId = "company-111";
  const agentId = "agent-222";
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reconciles agent in error to idle after cool-down when environment test passes", async () => {
    const errorAgent = {
      id: agentId,
      companyId,
      name: "Forge",
      role: "engineer",
      status: "error",
      lifecycleState: "ready",
      archivedAt: null,
      updatedAt: tenMinutesAgo,
      adapterType: "gemini_local",
      adapterConfig: {},
    };

    const mockSelectFrom = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([errorAgent]),
    });

    const mockUpdateWhere = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ ...errorAgent, status: "idle", errorReason: null }]),
    });

    const mockUpdateSet = vi.fn().mockReturnValue({
      where: mockUpdateWhere,
    });

    const mockDb: any = {
      select: vi.fn().mockReturnValue({ from: mockSelectFrom }),
      update: vi.fn().mockReturnValue({ set: mockUpdateSet }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "act-1" }]),
        }),
      }),
    };

    mockTestEnvironment.mockResolvedValueOnce({
      adapterType: "gemini_local",
      status: "pass",
      checks: [{ code: "ok", level: "info", message: "Environment healthy" }],
    });

    const recovery = recoveryService(mockDb, { enqueueWakeup: vi.fn() });
    const result = await recovery.reconcileAgentsInError({ coolDownMs: 5 * 60 * 1000 });

    expect(result.recovered).toBe(1);
    expect(result.agentIds).toContain(agentId);

    // Verify adapter environment check was performed
    expect(mockTestEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        adapterType: "gemini_local",
      }),
    );

    // Verify agent status updated to idle
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "idle",
        pauseReason: null,
        pausedAt: null,
        errorReason: null,
      }),
    );

    // Verify live event was published
    expect(mockPublishLiveEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        type: "agent.status",
        payload: expect.objectContaining({
          agentId,
          status: "idle",
          previousStatus: "error",
        }),
      }),
    );
  });

  it("skips agent if cool-down period has not yet elapsed", async () => {
    // Agent was updated 1 minute ago, coolDownMs is 5 minutes
    // In SQL the query filters by `or(isNull(agents.updatedAt), lte(agents.updatedAt, cutoff))`
    // If cool-down has not elapsed, the DB select returns empty array
    const mockSelectFrom = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    });

    const mockDb: any = {
      select: vi.fn().mockReturnValue({ from: mockSelectFrom }),
      update: vi.fn(),
    };

    const recovery = recoveryService(mockDb, { enqueueWakeup: vi.fn() });
    const result = await recovery.reconcileAgentsInError({ coolDownMs: 5 * 60 * 1000 });

    expect(result.recovered).toBe(0);
    expect(mockTestEnvironment).not.toHaveBeenCalled();
    expect(mockPublishLiveEvent).not.toHaveBeenCalled();
  });

  it("leaves agent in error if environment test returns fail status", async () => {
    const errorAgent = {
      id: agentId,
      companyId,
      name: "Forge",
      role: "engineer",
      status: "error",
      lifecycleState: "ready",
      archivedAt: null,
      updatedAt: tenMinutesAgo,
      adapterType: "gemini_local",
      adapterConfig: {},
    };

    const mockSelectFrom = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([errorAgent]),
    });

    const mockDb: any = {
      select: vi.fn().mockReturnValue({ from: mockSelectFrom }),
      update: vi.fn(),
    };

    mockTestEnvironment.mockResolvedValueOnce({
      adapterType: "gemini_local",
      status: "fail",
      checks: [{ code: "quota", level: "error", message: "Quota exhausted" }],
    });

    const recovery = recoveryService(mockDb, { enqueueWakeup: vi.fn() });
    const result = await recovery.reconcileAgentsInError({ coolDownMs: 5 * 60 * 1000 });

    expect(result.recovered).toBe(0);
    expect(result.stillFailing).toBe(1);
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockPublishLiveEvent).not.toHaveBeenCalled();
  });
});
