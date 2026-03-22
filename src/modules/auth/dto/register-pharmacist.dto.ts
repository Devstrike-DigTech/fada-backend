import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export enum PcnLicenseType {
  PHARMACIST = 'PHARMACIST',
  PHARMACY_TECHNICIAN = 'PHARMACY_TECHNICIAN',
  INTERN = 'INTERN',
}

export class RegisterPharmacistDto {
  @ApiProperty({ example: 'Chidi' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  firstName: string;

  @ApiProperty({ example: 'Okeke' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  lastName: string;

  @ApiProperty({ example: 'chidi@rxpharmacy.ng' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: '+2348098765432' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[0-9]{10,15}$/, {
    message: 'Phone number must be 10–15 digits',
  })
  phone: string;

  @ApiProperty({ example: 'P@ssw0rd!', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/, {
    message:
      'Password must contain uppercase, lowercase, number, and special character',
  })
  password: string;

  @ApiProperty({
    enum: PcnLicenseType,
    example: PcnLicenseType.PHARMACIST,
    description: 'PCN license category',
  })
  @IsEnum(PcnLicenseType)
  licenseType: PcnLicenseType;

  @ApiProperty({
    example: 'PCN-12345',
    description: 'Pharmacists Council of Nigeria license number',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  licenseNumber: string;

  @ApiPropertyOptional({ description: 'Referral code' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  referralCode?: string;
}
