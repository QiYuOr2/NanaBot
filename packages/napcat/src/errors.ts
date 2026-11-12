export class NapcatError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "NapcatError";
  }
}

export function toNapcatError(error: unknown, action: string): NapcatError {
  if (error instanceof NapcatError) return error;
  return new NapcatError(
    `NapCat ${action} 失败：${error instanceof Error ? error.message : String(error)}`,
    { cause: error },
  );
}
