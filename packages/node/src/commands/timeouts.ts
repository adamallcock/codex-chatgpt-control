export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), Math.max(0, timeoutMs));
      })
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function localGuardTimeout(timeoutMs: number | undefined, capMs: number): number {
  return Math.max(1, Math.min(timeoutMs ?? capMs, capMs));
}
