import validationConstants from "../../shared/validationConstants.cjs";

const { MAX_NAME_LENGTH, MAX_WORD_LENGTH } = validationConstants;

export function nameTooLongError() {
  return { error: `Name too long (max ${MAX_NAME_LENGTH} chars)` };
}

export function wordTooLongError() {
  return { error: `Word too long (max ${MAX_WORD_LENGTH} chars)` };
}
