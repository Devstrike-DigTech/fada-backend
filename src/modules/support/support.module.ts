import { Module } from '@nestjs/common';
import { ContentModule } from '@modules/content/content.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [ContentModule], // contact details are an editable content page
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
