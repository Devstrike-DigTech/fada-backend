import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuthModule } from '@modules/auth/auth.module';
import { SubscriptionModule } from '@modules/subscription/subscription.module';
import { PharmacyController } from './pharmacy.controller';
import { PharmacyService } from './pharmacy.service';

@Module({
  imports: [
    // Use memory storage — files are passed as Buffer to Cloudinary
    MulterModule.register({ storage: memoryStorage() }),
    AuthModule,
    SubscriptionModule, // plan limits (branch count)
  ],
  controllers: [PharmacyController],
  providers: [PharmacyService],
  exports: [PharmacyService],
})
export class PharmacyModule {}
