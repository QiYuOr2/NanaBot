export class BilibiliApiError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = "BilibiliApiError";
  }
}
