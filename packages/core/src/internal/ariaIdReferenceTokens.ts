const ASCII_WHITESPACE = /[\t\n\f\r ]/;
const TOKEN_SEPARATOR = /[\t\n\f\r ]+/;

function assertIdReferenceToken(token: string): string {
  if (token.length === 0 || ASCII_WHITESPACE.test(token)) {
    throw new Error("ARIA ID reference must be one non-empty token");
  }
  return token;
}

function tokens(value: string | undefined): string[] {
  if (value === undefined) return [];
  const trimmed = value.trim();
  return trimmed === "" ? [] : trimmed.split(TOKEN_SEPARATOR);
}

function uniqueTokens(value: string | undefined): string[] {
  const result: string[] = [];
  for (const token of tokens(value)) {
    if (!result.includes(token)) result.push(token);
  }
  return result;
}

function publish(
  element: HTMLElement,
  attribute: "aria-describedby",
  nextTokens: readonly string[],
): void {
  if (nextTokens.length === 0) {
    if (element.hasAttribute(attribute)) element.removeAttribute(attribute);
    return;
  }

  const next = nextTokens.join(" ");
  if (element.getAttribute(attribute) !== next) {
    element.setAttribute(attribute, next);
  }
}

function publishRawOwnedValue(
  element: HTMLElement,
  value: string | undefined,
): void {
  if (value === undefined || value.trim() === "") {
    if (element.hasAttribute("aria-describedby")) {
      element.removeAttribute("aria-describedby");
    }
    return;
  }
  if (element.getAttribute("aria-describedby") !== value) {
    element.setAttribute("aria-describedby", value);
  }
}

/**
 * Append one exact token and report whether this call added it.
 *
 * The boolean lets the caller remove only a relationship it actually created.
 */
export function addAriaDescribedByToken(
  element: HTMLElement,
  token: string,
): boolean {
  const ownedToken = assertIdReferenceToken(token);
  const currentValue =
    element.getAttribute("aria-describedby") ?? undefined;
  const current = tokens(currentValue);
  if (current.includes(ownedToken)) return false;
  const existing = currentValue?.trim();
  element.setAttribute(
    "aria-describedby",
    existing === undefined || existing === ""
      ? ownedToken
      : `${existing} ${ownedToken}`,
  );
  return true;
}

/** Remove one exact token while preserving every other token and its order. */
export function removeAriaDescribedByToken(
  element: HTMLElement,
  token: string,
): void {
  const ownedToken = assertIdReferenceToken(token);
  const currentValue =
    element.getAttribute("aria-describedby") ?? undefined;
  if (currentValue === undefined) return;

  if (currentValue.endsWith(ownedToken)) {
    const tokenStart = currentValue.length - ownedToken.length;
    const prefix = currentValue.slice(0, tokenStart);
    if (
      tokenStart === 0 ||
      ASCII_WHITESPACE.test(currentValue[tokenStart - 1]!)
    ) {
      if (!tokens(prefix).includes(ownedToken)) {
        publishRawOwnedValue(
          element,
          prefix.trimEnd() || undefined,
        );
        return;
      }
    }
  }

  const current = tokens(currentValue);
  let write = 0;
  for (let read = 0; read < current.length; read += 1) {
    const currentToken = current[read]!;
    if (currentToken === ownedToken) continue;
    current[write] = currentToken;
    write += 1;
  }
  if (write === current.length) return;
  current.length = write;
  publish(element, "aria-describedby", current);
}

/**
 * Replace only the caller-owned token set.
 *
 * Unowned tokens already on the element are retained in their existing order.
 * New owned tokens are appended once in the order supplied by `nextOwned`.
 */
export function replaceOwnedAriaDescribedByTokens(
  element: HTMLElement,
  previousOwned: string | undefined,
  nextOwned: string | undefined,
): void {
  if (previousOwned === nextOwned) return;

  const currentValue =
    element.getAttribute("aria-describedby") ?? undefined;
  if (
    currentValue === previousOwned ||
    (currentValue === undefined && previousOwned === undefined)
  ) {
    publishRawOwnedValue(element, nextOwned);
    return;
  }

  const previous = uniqueTokens(previousOwned);
  const next = uniqueTokens(nextOwned);
  const current = tokens(currentValue);
  const result: string[] = [];
  let insertionIndex = -1;

  for (const token of current) {
    if (previous.includes(token)) {
      if (insertionIndex < 0) insertionIndex = result.length;
    } else {
      result.push(token);
    }
  }

  if (insertionIndex < 0) insertionIndex = result.length;
  let offset = 0;
  for (const token of next) {
    if (!result.includes(token)) {
      result.splice(insertionIndex + offset, 0, token);
      offset += 1;
    }
  }

  publish(element, "aria-describedby", result);
}
