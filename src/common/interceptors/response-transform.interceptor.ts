import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Request } from 'express';

export interface ApiResponse<T> {
  success: true;
  statusCode: number;
  data: T;
  message?: string;
  meta?: PaginationMeta;
  timestamp: string;
  requestId?: string;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// Shape emitted by service/controller when pagination info is present
export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
  message?: string;
}

function isPaginatedResult<T>(value: unknown): value is PaginatedResult<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    'meta' in value &&
    Array.isArray((value as PaginatedResult<T>).data)
  );
}

@Injectable()
export class ResponseTransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T>> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<{ statusCode: number }>();
    const requestId = request.headers['x-request-id'] as string | undefined;

    return next.handle().pipe(
      map((data) => {
        const statusCode = response.statusCode;

        if (isPaginatedResult(data)) {
          return {
            success: true as const,
            statusCode,
            data: data.data as unknown as T,
            meta: data.meta,
            ...(data.message && { message: data.message }),
            timestamp: new Date().toISOString(),
            ...(requestId && { requestId }),
          };
        }

        // Check if the controller returned { data, message } shape
        if (
          typeof data === 'object' &&
          data !== null &&
          'data' in data &&
          'message' in data &&
          !('meta' in data)
        ) {
          const shaped = data as { data: T; message: string };
          return {
            success: true as const,
            statusCode,
            data: shaped.data,
            message: shaped.message,
            timestamp: new Date().toISOString(),
            ...(requestId && { requestId }),
          };
        }

        return {
          success: true as const,
          statusCode,
          data,
          timestamp: new Date().toISOString(),
          ...(requestId && { requestId }),
        };
      }),
    );
  }
}
