import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';
import { BillingInterval } from '@prisma/client';

export class SubscribeDto {
  @ApiProperty({
    example: 'katara',
    description: 'Plan id or slug (sokka | toph | katara | zuko | aang)',
  })
  @IsString()
  @IsNotEmpty()
  plan: string;

  @ApiPropertyOptional({
    enum: ['monthly', 'quarterly', 'annually'],
    default: 'monthly',
  })
  @IsOptional()
  @IsEnum(['monthly', 'quarterly', 'annually'])
  billingInterval?: BillingInterval = 'monthly';

  @ApiPropertyOptional({
    enum: ['paystack', 'flutterwave'],
    description: 'Override the default payment provider',
  })
  @IsOptional()
  @IsIn(['paystack', 'flutterwave'])
  provider?: 'paystack' | 'flutterwave';

  @ApiPropertyOptional({
    example: 'XMAS25',
    description: 'Promo code. Seasonal auto-apply promotions need no code.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  promoCode?: string;
}
