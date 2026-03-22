import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';
import { BatchUploadProcessor } from '@jobs/inventory/batch-upload.processor';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  imports: [
    // QueueModule is @Global and exports BullModule — we still need to
    // reference the specific queue here so @InjectQueue() can resolve it.
    BullModule.registerQueue({ name: QUEUE_NAMES.INVENTORY_BATCH_UPLOAD }),
  ],
  controllers: [InventoryController],
  providers: [
    InventoryService,
    BatchUploadProcessor,
  ],
  exports: [InventoryService],
})
export class InventoryModule {}
