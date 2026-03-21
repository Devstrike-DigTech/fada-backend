import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class EventBusService {
  private readonly logger = new Logger(EventBusService.name);

  constructor(private readonly emitter: EventEmitter2) {}

  emit<T>(event: string, payload: T): void {
    this.logger.debug(`Emitting event: ${event}`);
    this.emitter.emit(event, payload);
  }

  async emitAsync<T>(event: string, payload: T): Promise<void> {
    this.logger.debug(`Emitting async event: ${event}`);
    await this.emitter.emitAsync(event, payload);
  }
}
