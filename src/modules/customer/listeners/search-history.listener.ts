import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EVENTS, SearchPerformedPayload } from '@common/types/events.types';
import { CustomerHistoryService } from '../customer-history.service';

/**
 * Turns `search.performed` events into customer (and guest) search history.
 * SearchModule stays a pure read-model; it never writes history itself.
 */
@Injectable()
export class SearchHistoryListener {
  private readonly logger = new Logger(SearchHistoryListener.name);

  constructor(private readonly history: CustomerHistoryService) {}

  @OnEvent(EVENTS.SEARCH.PERFORMED, { async: true })
  async onSearchPerformed(payload: SearchPerformedPayload): Promise<void> {
    try {
      await this.history.recordSearch(payload);
    } catch (err) {
      this.logger.error('Failed to record search history', err as Error);
    }
  }
}
