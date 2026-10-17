import { asNumber, asString, parseJson, parseObject } from "@paperclipai/adapter-utils/server-utils";

const CONVERSATION_ID_RE = /(?:conversation|session)(?:[\s_]+id)?["':\s]+([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i;

function extractUsageFromRecord(
  usageRaw: unknown,
  target: { inputTokens: number; cachedInputTokens: number; outputTokens: number },
) {
  const usage = parseObject(usageRaw);
  if (Object.keys(usage).length === 0) return;

  const input = asNumber(usage.input_tokens, asNumber(usage.inputTokens, 0));
  const cached = asNumber(
    usage.cache_read_tokens,
    asNumber(usage.cached_input_tokens, asNumber(usage.cachedInputTokens, 0)),
  );
  const output = asNumber(usage.output_tokens, asNumber(usage.outputTokens, 0));
  const thinking = asNumber(usage.thinking_tokens, asNumber(usage.thinkingTokens, 0));

  if (input > 0 || cached > 0 || output > 0 || thinking > 0) {
    target.inputTokens = Math.max(0, input - cached);
    target.cachedInputTokens = cached;
    target.outputTokens = output + thinking;
  }
}

export function parseAntigravityOutput(stdout: string, stderr: string) {
  let sessionId: string | null = null;
  const messages: string[] = [];
  const streamDeltas: string[] = [];
  let finalResultResponse: string | null = null;
  let errorMessage: string | null = null;
  let costUsd: number | null = null;
  const usage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
  };

  // Extract session/conversation ID from explicit patterns in stdout/stderr
  const combinedText = `${stdout}\n${stderr}`;
  const conversationMatch = combinedText.match(CONVERSATION_ID_RE);
  if (conversationMatch && conversationMatch[1]) {
    sessionId = conversationMatch[1];
  }

  // Parse stdout lines
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    // Check if the line is JSON
    if (line.startsWith("{") && line.endsWith("}")) {
      const event = parseJson(line);
      if (event) {
        const directSessionId =
          asString(event.conversation_id, "").trim() ||
          asString(event.sessionId, "").trim() ||
          asString(event.session_id, "").trim();
        if (directSessionId) {
          sessionId = directSessionId;
        }

        const eventKind = asString(event.event, "").trim().toLowerCase();
        if (eventKind === "init") {
          continue;
        }
        if (eventKind === "step_update") {
          const stepUpdate = parseObject(event.step_update);
          const stepSessionId = asString(stepUpdate.conversation_id, "").trim();
          if (stepSessionId) sessionId = stepSessionId;
          const stepType = asString(stepUpdate.step_type, "").trim().toLowerCase();
          if (stepType === "agent_response") {
            const delta = asString(stepUpdate.text_delta, "");
            if (delta) streamDeltas.push(delta);
          }
          if (stepUpdate.usage) {
            extractUsageFromRecord(stepUpdate.usage, usage);
          }
          continue;
        }
        if (eventKind === "result") {
          const resultObj = parseObject(event.result);
          const resultSessionId = asString(resultObj.conversation_id, "").trim();
          if (resultSessionId) sessionId = resultSessionId;
          const responseText = asString(resultObj.response, "").trim();
          if (responseText) {
            finalResultResponse = responseText;
          }
          const status = asString(resultObj.status, "").trim().toUpperCase();
          if (status && status !== "SUCCESS") {
            errorMessage = asString(resultObj.error ?? resultObj.message ?? `Antigravity run status: ${status}`, errorMessage ?? "");
          }
          if (resultObj.usage) {
            extractUsageFromRecord(resultObj.usage, usage);
          }
          if (typeof resultObj.cost_usd === "number" && Number.isFinite(resultObj.cost_usd)) {
            costUsd = resultObj.cost_usd;
          }
          continue;
        }

        const type = asString(event.type, "").trim().toLowerCase();
        if (type === "error" || type === "stderr") {
          errorMessage = asString(event.message ?? event.error ?? event.text, errorMessage ?? "");
        } else if (type === "assistant" || type === "text") {
          const text = asString(event.text ?? event.content ?? event.message, "");
          if (text) messages.push(text);
        }
        if (event.usage) {
          extractUsageFromRecord(event.usage, usage);
        }
        continue;
      }
    }

    // Accumulate non-JSON text lines as part of the summary
    messages.push(line);
  }

  // If we have an exit error or stderr contains error indications
  if (!errorMessage) {
    const stderrLines = stderr
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.toLowerCase().includes("error") || l.toLowerCase().includes("failed"));
    if (stderrLines.length > 0) {
      errorMessage = stderrLines[0];
    }
  }

  const summary =
    finalResultResponse ??
    (streamDeltas.length > 0 ? streamDeltas.join("").trim() : messages.join("\n").trim());

  return {
    sessionId,
    summary,
    usage,
    costUsd,
    errorMessage: errorMessage || null,
  };
}

export function isAntigravityUnknownSessionError(stdout: string, stderr: string): boolean {
  const haystack = `${stdout}\n${stderr}`.toLowerCase();
  return (
    haystack.includes("unknown conversation") ||
    haystack.includes("conversation not found") ||
    haystack.includes("unknown session") ||
    haystack.includes("session not found") ||
    haystack.includes("failed to resume") ||
    haystack.includes("cannot resume")
  );
}

export function describeAntigravityFailure(stdout: string, stderr: string): string | null {
  const { errorMessage } = parseAntigravityOutput(stdout, stderr);
  if (errorMessage) {
    return `Antigravity CLI failed: ${errorMessage}`;
  }
  const firstStderr = stderr.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (firstStderr) {
    return `Antigravity CLI failed: ${firstStderr}`;
  }
  return "Antigravity CLI failed with non-zero exit code";
}

const ANTIGRAVITY_AUTH_REQUIRED_RE = /(?:not\s+logged\s+in|please\s+log\s+in|login\s+required|requires\s+login|unauthorized|authentication\s+required|api[_ ]?key\s+(?:required|missing|invalid)|invalid\s+credentials|run\s+`?agy\s+login`?\s+first)/i;

export function detectAntigravityAuthRequired(input: {
  stdout: string;
  stderr: string;
}): { requiresAuth: boolean } {
  const combined = `${input.stdout}\n${input.stderr}`;
  const requiresAuth = ANTIGRAVITY_AUTH_REQUIRED_RE.test(combined);
  return { requiresAuth };
}

export function isAntigravityTurnLimitResult(
  stdout: string,
  stderr: string,
  exitCode?: number | null,
): boolean {
  if (exitCode === 53) return true;
  const combined = `${stdout}\n${stderr}`.toLowerCase();
  return (
    combined.includes("turn_limit") ||
    combined.includes("max_turns") ||
    combined.includes("max_turns_exhausted") ||
    combined.includes("turn_limit_exhausted")
  );
}

/**
 * Matches Antigravity CLI quota / rate-limit errors that are transient and
 * should be retried automatically after a back-off (individual quota, API
 * quota, resource exhaustion, 429 / 503 upstream responses).
 *
 * Examples emitted by agy:
 *   "Individual quota reached. Contact your administrator to enable overages. Resets in 4h3m21s."
 *   "quota exceeded"
 *   "resource_exhausted"
 *   "rate limit"
 *   "429 Too Many Requests"
 */
const ANTIGRAVITY_QUOTA_RE =
  /(?:individual\s+quota\s+reached|quota\s+(?:reached|exceeded|exhausted)|resource[_\s]exhausted|rate[-\s]?limit(?:ed)?|too\s+many\s+requests|\b429\b|service\s+unavailable|\b503\b|overages\s+(?:not\s+)?enabled|resets?\s+in\s+\d)/i;

/**
 * Parses a human-readable duration string produced by agy such as
 * "4h3m21s", "2h30m", "45m", "90s" into milliseconds.
 * Returns null if the string cannot be parsed.
 */
export function parseAgyResetDurationMs(raw: string): number | null {
  // Match optional hours, minutes, seconds, e.g. "4h3m21s", "30m", "90s", "2h30m"
  const match = raw.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  if (!match) return null;
  const hours = parseInt(match[1] ?? "0", 10);
  const minutes = parseInt(match[2] ?? "0", 10);
  const seconds = parseInt(match[3] ?? "0", 10);
  const totalMs = (hours * 3600 + minutes * 60 + seconds) * 1000;
  return totalMs > 0 ? totalMs : null;
}

export function detectAntigravityQuotaExhausted(input: {
  stdout: string;
  stderr: string;
}): { exhausted: boolean; resetHint: string | null; retryNotBefore: string | null } {
  const combined = `${input.stdout}\n${input.stderr}`;
  const exhausted = ANTIGRAVITY_QUOTA_RE.test(combined);

  if (!exhausted) return { exhausted: false, resetHint: null, retryNotBefore: null };

  // Try to extract "Resets in Xh Ym Zs" from the output
  const resetMatch = combined.match(/resets?\s+in\s+([\dhms\s]+)/i);
  const resetHint = resetMatch ? `Resets in ${resetMatch[1].trim()}` : null;

  let retryNotBefore: string | null = null;
  if (resetMatch) {
    const durationMs = parseAgyResetDurationMs(resetMatch[1].trim());
    if (durationMs !== null) {
      // Add a small buffer (60s) so the retry lands safely after the quota window resets
      retryNotBefore = new Date(Date.now() + durationMs + 60_000).toISOString();
    }
  }

  return { exhausted, resetHint, retryNotBefore };
}
