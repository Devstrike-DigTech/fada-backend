import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AddAlternativeDto {
  @ApiProperty({
    example: '3f6c1e2a-9b7d-4c1e-8a2b-1234567890ab',
    description: 'ID of the alternative drug (must be in your own inventory)',
  })
  // Without a validator the global whitelist pipe rejected this field outright
  @IsUUID()
  alternativeDrugId: string;
}
