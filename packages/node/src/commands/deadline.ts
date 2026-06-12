export type Deadline = {
  startedAtMs: number;
  timeoutMs: number;
  expiresAtMs: number;
};

export function createDeadline(timeoutMs: number, startedAtMs = Date.now()): Deadline {
  const safeTimeoutMs = Math.max(0, timeoutMs);
  return {
    startedAtMs,
    timeoutMs: safeTimeoutMs,
    expiresAtMs: startedAtMs + safeTimeoutMs,
  };
}

export function remainingMs(deadline: Deadline, nowMs = Date.now()): number {
  return Math.max(0, deadline.expiresAtMs - nowMs);
}

export function childTimeoutMs(deadline: Deadline, capMs: number, nowMs = Date.now()): number {
  return Math.max(0, Math.min(Math.max(0, capMs), remainingMs(deadline, nowMs)));
}
