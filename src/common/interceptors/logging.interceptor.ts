import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Paths whose request bodies must NEVER be logged (tokens, passwords, PINs).
const SENSITIVE_PATHS = ['/auth/', '/users/set-pin', '/users/verify', '/users/check-phone'];

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, ip } = request;
    const userAgent = request.get('user-agent') ?? '';
    const now = Date.now();

    // Never log request bodies in production or on sensitive paths.
    const isSensitive = SENSITIVE_PATHS.some((p) => url.includes(p));
    const bodyLog =
      IS_PRODUCTION || isSensitive ? '[body suppressed]' : JSON.stringify(body);

    this.logger.log(`→ ${method} ${url} - ${ip} - ${userAgent} - ${bodyLog}`);

    return next.handle().pipe(
      tap({
        next: (_data) => {
          const { statusCode } = context.switchToHttp().getResponse();
          this.logger.log(`← ${method} ${url} - ${statusCode} - ${Date.now() - now}ms`);
        },
        error: (error: Error) => {
          this.logger.error(
            `✗ ${method} ${url} - ${error.message} - ${Date.now() - now}ms`,
          );
        },
      }),
    );
  }
}
