import { configDefaults, defineConfig } from "vitest/config";

const omitWorkspacesGithubAnnotations = process.env.GITHUB_ACTIONS === "true"
  && process.env.GITHUB_WORKFLOW === "PR"
  && process.env.PAPERCLIP_CI_PROFILE_JOB === "General tests (workspaces-b)";
const profileEnabled = process.env.PAPERCLIP_CI_PROFILE === "true";

export default defineConfig({
  test: {
    ...(omitWorkspacesGithubAnnotations || profileEnabled
      ? { reporters: [
        ...configDefaults.reporters.filter(reporter => !omitWorkspacesGithubAnnotations || reporter !== "github-actions"),
        ...(profileEnabled ? ["./scripts/ci-profile/vitest-reporter.mjs"] : []),
      ] }
      : {}),
    projects: [
      "packages/shared",
      "packages/skills-catalog",
      "packages/db",
      "packages/adapter-utils",
      "packages/adapters/claude-local",
      "packages/adapters/codex-local",
      "packages/adapters/cursor-cloud",
      "packages/adapters/cursor-local",
      "packages/adapters/gemini-local",
      "packages/adapters/grok-local",
      "packages/adapters/hermes",
      "packages/adapters/kimi-local",
      "packages/adapters/openclaw-gateway",
      "packages/adapters/opencode-local",
      "packages/adapters/pi-local",
      "packages/plugins/sdk",
      "packages/plugins/create-paperclip-plugin",
      "packages/plugins/sandbox-providers/daytona",
      "server",
      "ui",
      "cli",
    ],
  },
});
