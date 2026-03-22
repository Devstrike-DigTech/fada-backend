import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export enum StaffRole {
  OPERATOR = 'operator',
  STAFF = 'staff',
}

export class InviteStaffDto {
  @ApiProperty({ example: 'Emeka' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  firstName: string;

  @ApiProperty({ example: 'Okonkwo' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  lastName: string;

  @ApiProperty({ example: 'emeka@rxplus.ng' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ enum: StaffRole, example: StaffRole.OPERATOR })
  @IsEnum(StaffRole)
  role: StaffRole;

  @ApiPropertyOptional({
    description: 'Assign to a specific branch (defaults to pharmacy-wide)',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    description: 'Optional personal message to include in the invite email',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  message?: string;
}
