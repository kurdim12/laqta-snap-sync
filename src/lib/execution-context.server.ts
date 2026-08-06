export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

const contexts = new WeakMap<Request, ExecutionContextLike>();

export function bindExecutionContext(request: Request, context: unknown): void {
  const candidate = context as Partial<ExecutionContextLike> | null;
  if (candidate && typeof candidate.waitUntil === "function") {
    contexts.set(request, candidate as ExecutionContextLike);
  }
}

export function executionContextFor(request: Request): ExecutionContextLike | null {
  return contexts.get(request) ?? null;
}