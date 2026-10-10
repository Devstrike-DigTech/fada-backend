import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReservationItemDto {
  @ApiProperty({ description: 'Drug ID to reserve' })
  @IsUUID()
  drugId: string;

  @ApiProperty({ description: 'Quantity to reserve', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateReservationDto {
  @ApiProperty({ description: 'Branch ID to reserve from' })
  @IsUUID()
  branchId: string;

  @ApiProperty({
    description: 'List of drugs and quantities to reserve',
    type: [ReservationItemDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReservationItemDto)
  items: ReservationItemDto[];

  @ApiPropertyOptional({ description: 'Optional notes for the pharmacist' })
  @IsOptional()
  @IsString()
  notes?: string;
}
