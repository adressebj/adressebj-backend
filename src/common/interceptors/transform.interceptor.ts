import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  data: T;
  meta: { timestamp: string };
}

/**
 * Enveloppe toute réponse réussie en `{ data, meta: { timestamp } }`.
 * Convention de réponse API — cf. CdC backend §4.
 */
@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data: T) => ({
        data,
        meta: { timestamp: new Date().toISOString() },
      })),
    );
  }
}
