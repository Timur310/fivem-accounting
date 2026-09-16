import { Router, type IRouter, type RouterOptions } from 'express';

/**
 * A Router whose handlers may be `async`.
 *
 * Express 4 calls a handler and ignores what it returns. A synchronous throw
 * it catches and passes to the error handler; a rejected promise it never sees
 * at all. So an `async` handler that throws — and nearly every handler in this
 * app is async — rejects into nothing: `errorHandler` never runs, no response
 * is ever written, and the caller waits until it gives up. The server logs an
 * unhandled rejection with no request attached to it.
 *
 * That is not an edge case here. `schema.parse(req.body)` guards almost every
 * write in the app and throws a `ZodError` on bad input, which `errorHandler`
 * already knows how to turn into a 400 — it simply was never reached. A
 * mistyped amount answered with a spinner that spins forever.
 *
 * This wraps every handler as it is registered, so a rejection goes to `next`
 * like a throw always did. Three properties worth keeping in mind:
 *
 * - **Arity is preserved.** Express tells an error handler from an ordinary
 *   one by counting declared parameters, so a four-argument handler has to
 *   stay four arguments after wrapping or it silently stops being one.
 * - **Sub-routers pass through untouched.** A router is itself a function and
 *   would otherwise be wrapped as a handler, which works but hides its stack
 *   from anything that walks it.
 * - **The return value is handed back unchanged**, because Express uses it
 *   nowhere and something else might.
 *
 * Express 5 does this itself. Until this app moves, every route file builds
 * its router here rather than from `express` directly, and the choice is one
 * import rather than a rule everybody has to remember at every handler.
 */

type AnyHandler = (...args: never[]) => unknown;

/** Is this a Router rather than a plain handler? Routers carry their stack. */
function isRouter(value: unknown): boolean {
  return typeof value === 'function' && 'stack' in (value as object);
}

function wrap(fn: AnyHandler): AnyHandler {
  const forward = (result: unknown, next: unknown) => {
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      void (result as Promise<unknown>).catch((err: unknown) => {
        (next as (err: unknown) => void)(err);
      });
    }
    return result;
  };

  // Written out rather than built from `fn.length`, because the parameter
  // count is the whole point and a generic `(...args)` wrapper reports zero.
  if (fn.length === 4) {
    return function wrapped(this: unknown, err: never, req: never, res: never, next: never) {
      return forward((fn as (...a: unknown[]) => unknown).call(this, err, req, res, next), next);
    } as AnyHandler;
  }

  return function wrapped(this: unknown, req: never, res: never, next: never) {
    return forward((fn as (...a: unknown[]) => unknown).call(this, req, res, next), next);
  } as AnyHandler;
}

const METHODS = [
  'use', 'all', 'get', 'post', 'put', 'patch', 'delete', 'head', 'options',
] as const;

/**
 * Drop-in replacement for `express.Router()`.
 *
 * Takes the same options and returns the same type, so a route file changes
 * one import and nothing else.
 */
export function asyncRouter(options?: RouterOptions): IRouter {
  const router = Router(options);

  for (const method of METHODS) {
    const original = (router[method] as (...args: unknown[]) => unknown).bind(router);
    (router as unknown as Record<string, unknown>)[method] = (...args: unknown[]) =>
      original(...args.map((arg) =>
        typeof arg === 'function' && !isRouter(arg) ? wrap(arg as AnyHandler) : arg));
  }

  return router;
}
