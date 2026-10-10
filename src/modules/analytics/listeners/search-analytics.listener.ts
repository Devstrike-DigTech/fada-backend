import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EVENTS, SearchResultsServedPayload } from '@common/types/events.types';
import { SearchTrackingService } from '../search-tracking.service';

@Injectable()
export class SearchAnalyticsListener {
  private readonly logger = new Logger(SearchAnalyticsListener.name);

  constructor(private readonly tracking: SearchTrackingService) {}

  @OnEvent(EVENTS.SEARCH.RESULTS_SERVED, { async: true })
  async onResultsServed(payload: SearchResultsServedPayload): Promise<void> {
    try {
      await this.tracking.record(payload);
    } catch (err) {
      // Analytics must never affect search
      this.logger.warn(
        `Search analytics not recorded: ${(err as Error).message}`,
      );
    }
  }
}
