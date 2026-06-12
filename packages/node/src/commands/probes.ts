import { childTimeoutMs, type Deadline } from "./deadline.js";

export type ProbeResult<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; timedOut?: boolean; skipped?: boolean; warnings: string[] };

export type ProbeOptions = {
  timeoutMs: number;
};

export function createSingleFlightProbe<A, T>(
  name: string,
  probe: (arg: A) => Promise<T>
): (arg: A, deadline: Deadline, options: ProbeOptions) => Promise<ProbeResult<T>> {
  let inFlight: Promise<T> | undefined;

  return async (arg: A, deadline: Deadline, options: ProbeOptions): Promise<ProbeResult<T>> => {
    if (inFlight !== undefined) {
      return {
        ok: false,
        skipped: true,
        warnings: [`Skipped ${name} DOM probe because previous browser-side work is still in flight.`]
      };
    }

    const timeoutMs = childTimeoutMs(deadline, options.timeoutMs);
    if (timeoutMs <= 0) {
      return {
        ok: false,
        timedOut: true,
        warnings: [`Skipped ${name} DOM probe because no deadline budget remained.`]
      };
    }

    const current = probe(arg);
    inFlight = current;
    current.finally(() => {
      if (inFlight === current) {
        inFlight = undefined;
      }
    }).catch(() => undefined);

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([
        current,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new ProbeTimeoutError(timeoutMs)), timeoutMs);
        })
      ]);
      return { ok: true, value, warnings: [] };
    } catch (error) {
      if (error instanceof ProbeTimeoutError) {
        return {
          ok: false,
          timedOut: true,
          warnings: [`Timed out waiting ${timeoutMs}ms for ${name} DOM probe; this stopped SDK waiting but did not cancel browser-side work.`]
        };
      }
      return {
        ok: false,
        warnings: [`${name} DOM probe failed: ${error instanceof Error ? error.message : String(error)}`]
      };
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  };
}

class ProbeTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Probe timed out after ${timeoutMs}ms.`);
    this.name = "ProbeTimeoutError";
  }
}
