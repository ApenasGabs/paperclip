import http from "node:http";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishLiveEvent } from "../services/live-events.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const otherCompanyId = "22222222-2222-4222-8222-222222222222";

const mockCompanyService = vi.hoisted(() => ({
  list: vi.fn(),
  stats: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  remove: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  list: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  ensureMembership: vi.fn(),
  ensureRoleDefaultGrants: vi.fn(),
}));

const mockBudgetService = vi.hoisted(() => ({
  upsertPolicy: vi.fn(),
}));

const mockCompanyPortabilityService = vi.hoisted(() => ({
  exportBundle: vi.fn(),
  previewExport: vi.fn(),
  previewImport: vi.fn(),
  importBundle: vi.fn(),
}));

const mockCompanyArtifactsService = vi.hoisted(() => ({
  list: vi.fn(),
}));

const mockFeedbackService = vi.hoisted(() => ({
  listFeedbackTraces: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

function registerCompanyRouteMocks() {
  vi.doMock("../services/index.js", () => ({
    accessService: () => mockAccessService,
    agentService: () => mockAgentService,
    budgetService: () => mockBudgetService,
    companyArtifactsService: () => mockCompanyArtifactsService,
    companyPortabilityService: () => mockCompanyPortabilityService,
    companyService: () => mockCompanyService,
    feedbackService: () => mockFeedbackService,
    logActivity: mockLogActivity,
  }));
}

let appCounter = 0;
async function createApp(actor: Record<string, unknown>) {
  registerCompanyRouteMocks();
  appCounter += 1;
  const routeModulePath = `../routes/companies.js?events-test-${appCounter}`;
  const middlewareModulePath = `../middleware/index.js?events-test-${appCounter}`;
  const [{ companyRoutes }, { errorHandler }] = await Promise.all([
    import(routeModulePath) as Promise<typeof import("../routes/companies.js")>,
    import(middlewareModulePath) as Promise<typeof import("../middleware/index.js")>,
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api/companies", companyRoutes({} as any));
  app.use(errorHandler);
  return app;
}

function mockCompany(id: string) {
  return {
    id,
    name: "Test Company",
    description: null,
    status: "active",
    issuePrefix: "TST",
    issueCounter: 1,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    requireBoardApprovalForNewAgents: false,
    feedbackDataSharingEnabled: false,
    logoAssetId: null,
    logoUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("GET /api/companies/:companyId/events SSE stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompanyService.getById.mockImplementation(async (id: string) => {
      if (id === companyId) return mockCompany(companyId);
      return null;
    });
  });

  it("streams SSE headers and initial connected event for authorized board actor", async () => {
    const app = await createApp({
      type: "board",
      source: "session",
      userId: "user-1",
      companyIds: [companyId],
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    const response = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const clientReq = http.get(`http://127.0.0.1:${port}/api/companies/${companyId}/events`, (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk.toString();
          if (body.includes("event: connected")) {
            clientReq.destroy();
            server.close(() => {
              resolve({
                status: res.statusCode ?? 0,
                headers: res.headers,
                body,
              });
            });
          }
        });
      });
      clientReq.on("error", (err) => {
        server.close(() => reject(err));
      });
    });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["cache-control"]).toContain("no-cache");
    expect(response.body).toContain("event: connected");
    expect(response.body).toContain(companyId);
  });

  it("broadcasts published live events to the SSE subscriber", async () => {
    const app = await createApp({
      type: "board",
      source: "session",
      userId: "user-1",
      companyIds: [companyId],
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    const response = await new Promise<string>((resolve, reject) => {
      let published = false;
      const clientReq = http.get(`http://127.0.0.1:${port}/api/companies/${companyId}/events`, (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk.toString();
          if (body.includes("event: connected") && !published) {
            published = true;
            publishLiveEvent({
              companyId,
              type: "agent.status",
              payload: { agentId: "agent-test", status: "idle", previousStatus: "error" },
            });
          }
          if (body.includes("event: agent.status")) {
            clientReq.destroy();
            server.close(() => resolve(body));
          }
        });
      });
      clientReq.on("error", (err) => {
        server.close(() => reject(err));
      });
    });

    expect(response).toContain("event: agent.status");
    expect(response).toContain('"status":"idle"');
    expect(response).toContain('"previousStatus":"error"');
  });

  it("allows viewer membership role read-only access to event stream", async () => {
    const app = await createApp({
      type: "board",
      source: "session",
      userId: "viewer-user",
      companyIds: [companyId],
      memberships: [
        {
          companyId,
          membershipRole: "viewer",
          status: "active",
        },
      ],
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    const status = await new Promise<number>((resolve, reject) => {
      const clientReq = http.get(`http://127.0.0.1:${port}/api/companies/${companyId}/events`, (res) => {
        res.on("data", () => {
          clientReq.destroy();
          server.close(() => resolve(res.statusCode ?? 0));
        });
      });
      clientReq.on("error", (err) => {
        server.close(() => reject(err));
      });
    });

    expect(status).toBe(200);
  });

  it("rejects unauthorized agent key from another company", async () => {
    const app = await createApp({
      type: "agent",
      source: "agent_key",
      agentId: "foreign-agent",
      companyId: otherCompanyId,
    });

    const res = await request(app).get(`/api/companies/${companyId}/events`);
    expect(res.status).toBe(403);
  });

  it("returns 404 if company does not exist", async () => {
    const app = await createApp({
      type: "board",
      source: "session",
      userId: "user-1",
      companyIds: [otherCompanyId],
    });

    const res = await request(app).get(`/api/companies/${otherCompanyId}/events`);
    expect(res.status).toBe(404);
  });
});
