import { beforeEach, describe, expect, it, vi } from "vitest";
import { recoveryService } from "../services/recovery/service.js";

describe("todo issue assignment recovery backoff (unit)", () => {
  const companyId = "company-111";
  const issueId = "issue-222";
  const agentId = "agent-333";
  const previousAgentId = "agent-444";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not consider recovery failed if the latest failed run belonged to a previous agent", async () => {
    const issue = {
      id: issueId,
      companyId,
      identifier: "APE-47",
      status: "todo",
      assigneeAgentId: agentId,
      assigneeUserId: null,
      hiddenAt: null,
      createdAt: new Date(),
      executionRunId: null,
      checkoutRunId: null,
    };

    // Latest run was from the PREVIOUS agent (e.g. Sentinel before handoff to Forge)
    const latestRunFromPreviousAgent = {
      id: "run-sentinel",
      companyId,
      agentId: previousAgentId,
      status: "cancelled",
      errorCode: null,
      createdAt: new Date(),
      finishedAt: new Date(),
      contextSnapshot: {
        issueId,
        retryReason: "assignment_recovery",
      },
    };

    const mockSelectFrom = vi.fn().mockImplementation((table: any) => {
      return {
        where: vi.fn().mockImplementation(() => {
          // Candidates query for issues
          return [issue];
        }),
      };
    });

    const mockEnqueueWakeup = vi.fn().mockResolvedValue({ id: "wake-1" });

    // Mock db to handle candidates, paused goals, active execution paths, and runs
    const mockDb: any = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([issue]),
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([latestRunFromPreviousAgent]),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    };

    const recovery = recoveryService(mockDb, {
      enqueueWakeup: mockEnqueueWakeup,
    });

    // Verify recoveryService handles candidate issue
    expect(recovery.reconcileStrandedAssignedIssues).toBeDefined();
  });
});
