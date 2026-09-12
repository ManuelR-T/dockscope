import type { Request, Response } from 'express';
import { isDockscopeError } from '../core/errors.js';
import { errorHttpStatus } from '../core/errorStatus.js';

/** One HTTP translation for every application error; unexpected failures remain private. */
export function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>,
  logger: Pick<Console, 'error'> = console,
) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      await handler(req, res);
    } catch (error) {
      const classified = isDockscopeError(error) ? error : undefined;
      const status = errorHttpStatus(classified?.category ?? 'internal');
      if (status >= 500) {
        logger.error('DockScope request failed', error);
      }
      if (res.headersSent) {
        res.end();
        return;
      }
      const internal = !classified || classified.category === 'internal';
      res.status(status).json({
        error: internal ? 'Internal server error' : classified.message,
        code: internal ? 'INTERNAL_ERROR' : classified.code,
      });
    }
  };
}
