import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { redact, redactUrl } from '@common/security/redact';

interface ErrorResponse {
  success: false;
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
  details?: Record<string, unknown>;
  requestId?: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let message: string | string[];
    let error: string;
    let details: Record<string, unknown> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        error = exception.name;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const responseObj = exceptionResponse as {
          message?: string | string[];
          error?: string;
          details?: Record<string, unknown>;
        };
        message = responseObj.message ?? exception.message;
        error = responseObj.error ?? exception.name;
        // Structured context a client can act on (e.g. the duplicate's id)
        if (responseObj.details && typeof responseObj.details === 'object') {
          details = responseObj.details;
        }
      } else {
        message = exception.message;
        error = exception.name;
      }
    } else if (this.isClientHttpError(exception)) {
      // body-parser errors (payload too large, malformed JSON, bad charset) are
      // client mistakes with a status of their own, not server failures
      status = exception.status;
      error =
        exception.type === 'entity.too.large'
          ? 'PayloadTooLarge'
          : 'BadRequest';
      message =
        exception.type === 'entity.too.large'
          ? 'Request body is too large'
          : exception.type === 'entity.parse.failed'
            ? 'Malformed JSON body'
            : 'Invalid request body';
    } else if (exception instanceof Error) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'An unexpected error occurred';
      error = 'InternalServerError';

      // Log full stack trace for unexpected errors
      this.logger.error(
        `Unhandled exception: ${exception.message}`,
        exception.stack,
      );
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'An unexpected error occurred';
      error = 'InternalServerError';

      this.logger.error('Unknown exception type thrown', String(exception));
    }

    const requestId = request.headers['x-request-id'] as string | undefined;

    const safeUrl = redactUrl(request.originalUrl ?? request.url);
    const errorBody: ErrorResponse = {
      success: false,
      statusCode: status,
      error,
      message,
      path: safeUrl,
      timestamp: new Date().toISOString(),
      ...(details && { details }),
      ...(requestId && { requestId }),
    };

    // Log 5xx errors
    if (status >= 500) {
      this.logger.error(
        `[${request.method}] ${safeUrl} → ${status} id=${requestId ?? '-'}`,
        JSON.stringify({ ...errorBody, body: redact(request.body) }),
      );
    } else if (status >= 400) {
      this.logger.warn(
        `[${request.method}] ${safeUrl} → ${status}: ${JSON.stringify(message)}`,
      );
    }

    response.status(status).json(errorBody);
  }

  private isClientHttpError(
    e: unknown,
  ): e is { status: number; type?: string } {
    if (typeof e !== 'object' || e === null) return false;
    const status = (e as { status?: unknown }).status;
    const type = (e as { type?: unknown }).type;
    return (
      typeof status === 'number' &&
      status >= 400 &&
      status < 500 &&
      typeof type === 'string'
    );
  }
}
