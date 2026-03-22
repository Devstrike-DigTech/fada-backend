import { ApiProperty } from '@nestjs/swagger';

export class GuestTokenResponseDto {
  @ApiProperty({ description: 'Opaque guest token to include in x-guest-token header' })
  guestToken: string;

  @ApiProperty({ description: 'Remaining free searches for this guest session' })
  remainingSearches: number;

  @ApiProperty({ description: 'TTL in seconds for this guest token' })
  expiresInSeconds: number;
}
