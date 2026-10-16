import pc from "picocolors";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function printAntigravityStreamEvent(raw: string, _debug: boolean): void {
  const line = raw.trim();
  if (!line) return;

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    // Treat plain text line as stdout and print it
    console.log(line);
    return;
  }

  const eventKind = asString(parsed.event).trim().toLowerCase();
  if (eventKind === "init") {
    const sessionId = asString(parsed.conversation_id ?? parsed.sessionId ?? parsed.session_id);
    console.log(pc.blue(`Antigravity CLI init (session: ${sessionId})`));
    return;
  }
  if (eventKind === "step_update") {
    const stepUpdate = asRecord(parsed.step_update);
    if (!stepUpdate) return;
    const stepType = asString(stepUpdate.step_type).trim().toLowerCase();
    const delta = asString(stepUpdate.text_delta).trim();
    if (stepType === "agent_response" && delta) {
      console.log(pc.green(`assistant: ${delta}`));
    }
    return;
  }
  if (eventKind === "result") {
    const resultObj = asRecord(parsed.result);
    if (!resultObj) return;
    const status = asString(resultObj.status).trim().toUpperCase();
    if (status && status !== "SUCCESS") {
      console.log(pc.red(`error: ${asString(resultObj.error ?? resultObj.message ?? status)}`));
    }
    return;
  }

  const type = asString(parsed.type).trim().toLowerCase();

  if (type === "system") {
    const subtype = asString(parsed.subtype);
    if (subtype === "init") {
      const sessionId = asString(parsed.sessionId ?? parsed.session_id);
      console.log(pc.blue(`Antigravity CLI init (session: ${sessionId})`));
      return;
    }
    console.log(pc.blue(`system: ${asString(parsed.message ?? parsed.text ?? line)}`));
    return;
  }

  if (type === "error" || type === "stderr") {
    console.log(pc.red(`error: ${asString(parsed.message ?? parsed.error ?? line)}`));
    return;
  }

  if (type === "assistant" || type === "text") {
    console.log(pc.green(`assistant: ${asString(parsed.text ?? parsed.content ?? parsed.message ?? line)}`));
    return;
  }

  if (type === "user") {
    console.log(pc.gray(`user: ${asString(parsed.text ?? parsed.content ?? parsed.message ?? line)}`));
    return;
  }

  if (type === "thinking") {
    console.log(pc.gray(`thinking: ${asString(parsed.text ?? line)}`));
    return;
  }

  if (type === "tool_call") {
    console.log(pc.yellow(`tool_call: ${asString(parsed.name ?? parsed.tool ?? "tool")}`));
    return;
  }

  if (type === "tool_result" || type === "tool_response") {
    const isError = parsed.isError === true || parsed.is_error === true;
    console.log((isError ? pc.red : pc.cyan)(`tool_result${isError ? " (error)" : ""}`));
    return;
  }

  console.log(line);
}
