import { MAX_NAME_LENGTH, MAX_WORD_LENGTH } from "../../shared/validationConstants.cjs";

export function nameTooLongError() {
  return { error: `Name too long (max ${MAX_NAME_LENGTH} chars)` };
}

export function wordTooLongError() {
  return { error: `Word too long (max ${MAX_WORD_LENGTH} chars)` };
}
