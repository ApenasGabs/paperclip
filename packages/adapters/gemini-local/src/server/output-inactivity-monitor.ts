import { parseJson } from "@paperclipai/adapter-utils/server-utils";

export const DEFAULT_GEMINI_OUTPUT_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
export const GEMINI_OUTPUT_INACTIVITY_MONITOR_SIGTERM_GRACE_MS = 5_000;

export type GeminiOutputInactivityMonitorResolution =
  | { mode: "default"; timeoutMs: number }
  | { mode: "configured"; timeoutMs: number }
  | { mode: "disabled"; reason: "explicit_null" }
  | { mode: "default"; timeoutMs: number; reason: "non_positive" };

/**
 * Resolve the inactivity monitor timeout from raw adapter config.
 *
 * - `null`         → disabled (explicit escape hatch).
 * - missing/`undefined` → default 30m.
 * - number > 0     → configured value.
 * - number ≤ 0     → default 30m (and a `non_positive` note for logging).
 */
export function resolveGeminiInactivityTimeout(rawValue: unknown): GeminiOutputInactivityMonitorResolution {
  if (rawValue === null) return { mode: "disabled", reason: "explicit_null" };
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    if (rawValue > 0) return { mode: "configured", timeoutMs: rawValue };
    return { mode: "default", timeoutMs: DEFAULT_GEMINI_OUTPUT_INACTIVITY_TIMEOUT_MS, reason: "non_positive" };
  }
  return { mode: "default", timeoutMs: DEFAULT_GEMINI_OUTPUT_INACTIVITY_TIMEOUT_MS };
}

export interface GeminiOutputInactivityMonitorState {
  fired: boolean;
  spawnedAt: number;
  lastEventAt: number;
  firedAt: number | null;
  outputChunkCount: number;
  outputBytes: number;
  parsedEventCount: number;
  processActivityCount: number;
}

export interface GeminiOutputInactivityMonitorOptions {
  timeoutMs: number;
  onFire: (state: GeminiOutputInactivityMonitorState) => void;
  now?: () => number;
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /**
   * Per-line predicate. When omitted, any line that successfully parses as
   * JSON via the Gemini parser or has non-empty content counts as an event.
   */
  isHeartbeatLine?: (line: string) => boolean;
}

export interface GeminiOutputInactivityMonitorHandle {
  noteOutputChunk(stream: "stdout" | "stderr", chunk: string): void;
  noteProcessActivity(): void;
  /** Returns the current state without stopping the timer. */
  state(): GeminiOutputInactivityMonitorState;
  /** Cancels any pending timer and returns the final state. */
  stop(): GeminiOutputInactivityMonitorState;
}

function defaultIsHeartbeatLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return parseJson(trimmed) !== null;
}

export function createGeminiOutputInactivityMonitor(
  options: GeminiOutputInactivityMonitorOptions,
): GeminiOutputInactivityMonitorHandle {
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const isHeartbeatLine = options.isHeartbeatLine ?? defaultIsHeartbeatLine;
  const timeoutMs = options.timeoutMs;

  if (!(timeoutMs > 0)) {
    throw new Error(`createGeminiOutputInactivityMonitor requires timeoutMs > 0 (got ${timeoutMs})`);
  }

  const spawnedAt = now();
  const state: GeminiOutputInactivityMonitorState = {
    fired: false,
    spawnedAt,
    lastEventAt: spawnedAt,
    firedAt: null,
    outputChunkCount: 0,
    outputBytes: 0,
    parsedEventCount: 0,
    processActivityCount: 0,
  };
  let timerHandle: unknown = null;
  let stopped = false;

  const fire = () => {
    if (state.fired || stopped) return;
    state.fired = true;
    state.firedAt = now();
    timerHandle = null;
    options.onFire({ ...state });
  };

  const arm = () => {
    if (stopped || state.fired) return;
    if (timerHandle != null) clearTimer(timerHandle);
    timerHandle = setTimer(fire, timeoutMs);
  };

  arm();

  return {
    noteOutputChunk(stream: "stdout" | "stderr", chunk: string) {
      if (stopped || state.fired || chunk.length === 0) return;
      state.outputChunkCount += 1;
      state.outputBytes += Buffer.byteLength(chunk, "utf8");
      if (stream === "stdout") {
        for (const rawLine of chunk.split(/\r?\n/)) {
          if (isHeartbeatLine(rawLine)) {
            state.parsedEventCount += 1;
          }
        }
      }
      state.lastEventAt = now();
      arm();
    },
    noteProcessActivity() {
      if (stopped || state.fired) return;
      state.processActivityCount += 1;
      state.lastEventAt = now();
      arm();
    },
    state() {
      return { ...state };
    },
    stop() {
      stopped = true;
      if (timerHandle != null) {
        clearTimer(timerHandle);
        timerHandle = null;
      }
      return { ...state };
    },
  };
}

/**
 * Format the inactivity monitor error message in the canonical
 * `monitor: no gemini activity (output or process) for {N}m {S}s` shape.
 */
export function formatGeminiOutputInactivityMonitorErrorMessage(elapsedMs: number): string {
  const total = Math.max(0, Math.round(elapsedMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `monitor: no gemini activity (output or process) for ${minutes}m ${seconds}s`;
}
