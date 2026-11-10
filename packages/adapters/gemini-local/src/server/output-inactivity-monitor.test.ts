import { describe, expect, it } from "vitest";
import {
  GEMINI_OUTPUT_INACTIVITY_MONITOR_SIGTERM_GRACE_MS,
  DEFAULT_GEMINI_OUTPUT_INACTIVITY_TIMEOUT_MS,
  createGeminiOutputInactivityMonitor,
  formatGeminiOutputInactivityMonitorErrorMessage,
  resolveGeminiInactivityTimeout,
} from "./output-inactivity-monitor.js";

class FakeClock {
  private nowMs = 0;
  private nextHandle = 1;
  private timers = new Map<number, { fireAt: number; cb: () => void }>();

  now(): number {
    return this.nowMs;
  }

  setTimer(cb: () => void, ms: number): number {
    const handle = this.nextHandle++;
    this.timers.set(handle, { fireAt: this.nowMs + ms, cb });
    return handle;
  }

  clearTimer(handle: unknown): void {
    if (typeof handle === "number") this.timers.delete(handle);
  }

  advance(ms: number): void {
    const targetMs = this.nowMs + ms;
    while (true) {
      let nextHandle: number | null = null;
      let nextTimer: { fireAt: number; cb: () => void } | null = null;
      for (const [h, timer] of this.timers) {
        if (timer.fireAt <= targetMs && (!nextTimer || timer.fireAt < nextTimer.fireAt)) {
          nextHandle = h;
          nextTimer = timer;
        }
      }
      if (!nextTimer || nextHandle == null) break;
      this.timers.delete(nextHandle);
      this.nowMs = nextTimer.fireAt;
      nextTimer.cb();
    }
    this.nowMs = targetMs;
  }

  pendingTimerCount(): number {
    return this.timers.size;
  }
}

describe("resolveGeminiInactivityTimeout", () => {
  it("defaults to 30 minutes", () => {
    expect(DEFAULT_GEMINI_OUTPUT_INACTIVITY_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });

  it("uses default when value is unset", () => {
    expect(resolveGeminiInactivityTimeout(undefined)).toEqual({
      mode: "default",
      timeoutMs: DEFAULT_GEMINI_OUTPUT_INACTIVITY_TIMEOUT_MS,
    });
  });

  it("treats explicit null as disabled", () => {
    expect(resolveGeminiInactivityTimeout(null)).toEqual({
      mode: "disabled",
      reason: "explicit_null",
    });
  });

  it("returns configured value for positive numbers", () => {
    expect(resolveGeminiInactivityTimeout(12_000)).toEqual({
      mode: "configured",
      timeoutMs: 12_000,
    });
  });

  it("falls back to default for non-positive numbers", () => {
    expect(resolveGeminiInactivityTimeout(0)).toEqual({
      mode: "default",
      timeoutMs: DEFAULT_GEMINI_OUTPUT_INACTIVITY_TIMEOUT_MS,
      reason: "non_positive",
    });
    expect(resolveGeminiInactivityTimeout(-100)).toEqual({
      mode: "default",
      timeoutMs: DEFAULT_GEMINI_OUTPUT_INACTIVITY_TIMEOUT_MS,
      reason: "non_positive",
    });
  });

  it("falls back to default for non-number, non-null values", () => {
    expect(resolveGeminiInactivityTimeout("420000")).toEqual({
      mode: "default",
      timeoutMs: DEFAULT_GEMINI_OUTPUT_INACTIVITY_TIMEOUT_MS,
    });
  });
});

describe("formatGeminiOutputInactivityMonitorErrorMessage", () => {
  it("formats minutes and seconds", () => {
    expect(formatGeminiOutputInactivityMonitorErrorMessage(0)).toBe(
      "monitor: no gemini activity (output or process) for 0m 0s",
    );
    expect(formatGeminiOutputInactivityMonitorErrorMessage(7 * 60 * 1000)).toBe(
      "monitor: no gemini activity (output or process) for 7m 0s",
    );
    expect(formatGeminiOutputInactivityMonitorErrorMessage(7 * 60 * 1000 + 12_000)).toBe(
      "monitor: no gemini activity (output or process) for 7m 12s",
    );
    expect(formatGeminiOutputInactivityMonitorErrorMessage(45_000)).toBe(
      "monitor: no gemini activity (output or process) for 0m 45s",
    );
  });
});

describe("createGeminiOutputInactivityMonitor (fires when silent)", () => {
  it("fires after timeoutMs when child emits one event then goes silent", () => {
    const clock = new FakeClock();
    const fires: Array<{ elapsed: number; parsedEventCount: number }> = [];
    const monitor = createGeminiOutputInactivityMonitor({
      timeoutMs: 7 * 60 * 1000,
      now: () => clock.now(),
      setTimer: (cb, ms) => clock.setTimer(cb, ms),
      clearTimer: (handle) => clock.clearTimer(handle),
      onFire: (state) => {
        fires.push({
          elapsed: (state.firedAt ?? 0) - state.lastEventAt,
          parsedEventCount: state.parsedEventCount,
        });
      },
    });

    clock.advance(60_000);
    monitor.noteOutputChunk("stdout", '{"type":"message","text":"hello"}\n');
    clock.advance(7 * 60 * 1000 - 1_000);
    expect(fires).toHaveLength(0);

    clock.advance(1_000);
    expect(fires).toHaveLength(1);
    expect(fires[0]?.elapsed).toBe(7 * 60 * 1000);
    expect(fires[0]?.parsedEventCount).toBe(1);
    expect(clock.pendingTimerCount()).toBe(0);
  });

  it("only fires once even if more silence elapses after firing", () => {
    const clock = new FakeClock();
    let fireCount = 0;
    const monitor = createGeminiOutputInactivityMonitor({
      timeoutMs: 5_000,
      now: () => clock.now(),
      setTimer: (cb, ms) => clock.setTimer(cb, ms),
      clearTimer: (handle) => clock.clearTimer(handle),
      onFire: () => {
        fireCount += 1;
      },
    });

    clock.advance(5_000);
    expect(fireCount).toBe(1);
    clock.advance(10_000);
    expect(fireCount).toBe(1);
    monitor.noteOutputChunk("stdout", '{"text":"late"}\n');
    clock.advance(10_000);
    expect(fireCount).toBe(1);
  });

  it("resets on non-JSON stdout bytes", () => {
    const clock = new FakeClock();
    let fired = false;
    const monitor = createGeminiOutputInactivityMonitor({
      timeoutMs: 10_000,
      now: () => clock.now(),
      setTimer: (cb, ms) => clock.setTimer(cb, ms),
      clearTimer: (handle) => clock.clearTimer(handle),
      onFire: () => {
        fired = true;
      },
    });

    clock.advance(8_000);
    expect(fired).toBe(false);
    monitor.noteOutputChunk("stdout", "building...\n");
    clock.advance(8_000);
    expect(fired).toBe(false);
    clock.advance(2_000);
    expect(fired).toBe(true);
  });

  it("resets on process activity without output", () => {
    const clock = new FakeClock();
    let fired = false;
    const monitor = createGeminiOutputInactivityMonitor({
      timeoutMs: 10_000,
      now: () => clock.now(),
      setTimer: (cb, ms) => clock.setTimer(cb, ms),
      clearTimer: (handle) => clock.clearTimer(handle),
      onFire: () => {
        fired = true;
      },
    });

    clock.advance(8_000);
    expect(fired).toBe(false);
    monitor.noteProcessActivity();
    clock.advance(8_000);
    expect(fired).toBe(false);
    clock.advance(2_000);
    expect(fired).toBe(true);
  });
});

describe("createGeminiOutputInactivityMonitor (does not fire when active)", () => {
  it("keeps process alive while stdout and stderr bytes continue", () => {
    const clock = new FakeClock();
    let fired = false;
    const monitor = createGeminiOutputInactivityMonitor({
      timeoutMs: 10_000,
      now: () => clock.now(),
      setTimer: (cb, ms) => clock.setTimer(cb, ms),
      clearTimer: (handle) => clock.clearTimer(handle),
      onFire: () => {
        fired = true;
      },
    });

    for (let i = 0; i < 5; i++) {
      clock.advance(6_000);
      monitor.noteOutputChunk(i % 2 === 0 ? "stdout" : "stderr", `tick ${i}\n`);
    }
    expect(fired).toBe(false);
    const stoppedState = monitor.stop();
    expect(stoppedState.fired).toBe(false);
    expect(stoppedState.outputChunkCount).toBe(5);
  });
});

describe("GEMINI_OUTPUT_INACTIVITY_MONITOR_SIGTERM_GRACE_MS", () => {
  it("matches the 5-second grace window", () => {
    expect(GEMINI_OUTPUT_INACTIVITY_MONITOR_SIGTERM_GRACE_MS).toBe(5_000);
  });
});
