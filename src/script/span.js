export function createPosition(index, line, column) {
  return { index, line, column };
}

export function createSpan(start, end) {
  return { start, end };
}

export function cloneSpan(span) {
  return {
    start: { ...span.start },
    end: { ...span.end },
  };
}

export function mergeSpans(first, second) {
  if (!first) return cloneSpan(second);
  if (!second) return cloneSpan(first);
  return createSpan(first.start, second.end);
}

export function emptySpan() {
  return createSpan(createPosition(0, 1, 1), createPosition(0, 1, 1));
}
