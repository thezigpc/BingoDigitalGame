import { ERRORS } from "@bingo/shared";

export type ErrorCode = keyof typeof ERRORS;

/** A rejected intent. Carries a stable code for logs and a message for the player. */
export class GameError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(ERRORS[code]);
  }
}
