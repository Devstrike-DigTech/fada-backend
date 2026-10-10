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

export class ChangePlanDto {
  @ApiProperty({ example: 'zuko', description: 'Target plan id or slug' })
  @IsString()
  @IsNotEmpty()
  plan: string;

  @ApiPropertyOptional({
    enum: ['monthly', 'quarterly', 'annually'],
    description:
      'New billing interval. Defaults to the current one; a different interval takes effect at the next renewal.',
  })
  @IsOptional()
  @IsEnum(['monthly', 'quarterly', 'annually'])
  billingInterval?: BillingInterval;

  @ApiPropertyOptional({ enum: ['paystack', 'flutterwave'] })
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
