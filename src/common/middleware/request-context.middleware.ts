import { Logger } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { redactUrl } from '@common/security/redact';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;
const QUIET_PATHS = /\/health(\/|$)/;
const logger = new Logger('HTTP');

/**
 * Gives every request an id (honouring a well-formed incoming x-request-id),
 * echoes it on the response, and writes one scrubbed access-log line when the
 * response finishes. Bodies are never logged here.
 */
export function requestContext(opts: { log: boolean }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.headers['x-request-id'];
    const id =
      typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)
        ? incoming
        : randomUUID();
    req.headers['x-request-id'] = id;
    res.setHeader('x-request-id', id);

    if (!opts.log || QUIET_PATHS.test(req.path)) return next();

    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const user =
        (req as Request & { user?: { sub?: string } }).user?.sub ?? '-';
      const line = `${req.method} ${redactUrl(req.originalUrl)} ${res.statusCode} ${ms.toFixed(0)}ms user=${user} id=${id}`;
      if (res.statusCode >= 500) logger.error(line);
      else if (res.statusCode >= 400) logger.warn(line);
      else logger.log(line);
    });
    next();
  };
}
