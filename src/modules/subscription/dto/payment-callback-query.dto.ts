import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/** Paystack appends `reference` (and `trxref`); Flutterwave appends `tx_ref` + `status`. */
export class PaymentCallbackQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  trxref?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tx_ref?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  transaction_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;
}
