import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  CurrentUserData,
} from '@common/decorators/current-user.decorator';
import { Roles, UserRole } from '@common/decorators/roles.decorator';
import { ReservationQueryDto } from '@modules/reservation/dto/reservation-query.dto';
import { CustomerProfileService } from './customer-profile.service';
import { CustomerHistoryService } from './customer-history.service';
import { UpdateCustomerProfileDto } from './dto/profile.dto';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';
import { RepeatSearchDto, SearchHistoryQueryDto } from './dto/history.dto';

@ApiTags('Customer')
@ApiBearerAuth('access-token')
@Roles(UserRole.CUSTOMER)
@Controller({ path: 'customer', version: '1' })
export class CustomerController {
  constructor(
    private readonly profile: CustomerProfileService,
    private readonly history: CustomerHistoryService,
  ) {}

  // ─── Profile ─────────────────────────────────────────────────────────────────

  @Get('profile')
  @ApiOperation({ summary: 'My profile with completion status' })
  getProfile(@CurrentUser() user: CurrentUserData) {
    return this.profile.getProfile(user.sub);
  }

  @Get('profile/details')
  @ApiOperation({
    summary: 'Profile Details screen: profile, addresses and activity counts',
  })
  getProfileDetails(@CurrentUser() user: CurrentUserData) {
    return this.profile.getProfileDetails(user.sub);
  }

  @Put('profile')
  @ApiOperation({
    summary: 'Update name, phone, gender, date of birth',
    description:
      'Email changes go through the auth module (OTP). Avatar uploads use PATCH /users/me/avatar.',
  })
  updateProfile(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpdateCustomerProfileDto,
  ) {
    return this.profile.updateProfile(user.sub, dto);
  }

  // ─── Addresses ───────────────────────────────────────────────────────────────

  @Get('addresses')
  @ApiOperation({ summary: 'My saved addresses (default first)' })
  listAddresses(@CurrentUser() user: CurrentUserData) {
    return this.profile.listAddresses(user.sub);
  }

  @Post('addresses')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add an address (first one becomes default)' })
  addAddress(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateAddressDto,
  ) {
    return this.profile.addAddress(user.sub, dto);
  }

  @Put('addresses/:id')
  @ApiOperation({ summary: 'Update an address' })
  updateAddress(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.profile.updateAddress(user.sub, id, dto);
  }

  @Delete('addresses/:id')
  @ApiOperation({ summary: 'Remove an address' })
  removeAddress(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.profile.removeAddress(user.sub, id);
  }

  // ─── Search history ──────────────────────────────────────────────────────────

  @Get('history/searches')
  @ApiOperation({ summary: 'Past searches, newest first' })
  listSearches(
    @CurrentUser() user: CurrentUserData,
    @Query() query: SearchHistoryQueryDto,
  ) {
    return this.history.listSearches(user.sub, query);
  }

  @Delete('history/searches')
  @ApiOperation({ summary: 'Clear all search history' })
  clearSearches(@CurrentUser() user: CurrentUserData) {
    return this.history.clearSearches(user.sub);
  }

  @Delete('history/searches/:id')
  @ApiOperation({ summary: 'Remove one search from history' })
  removeSearch(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.history.removeSearch(user.sub, id);
  }

  @Post('history/searches/:id/repeat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Repeat a past search with the current location' })
  repeatSearch(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: RepeatSearchDto,
  ) {
    return this.history.repeatSearch(user.sub, id, dto);
  }

  // ─── Reservation history ─────────────────────────────────────────────────────

  @Get('history/reservations')
  @ApiOperation({
    summary:
      'My reservations with status (same shape as GET /reservations/mine)',
  })
  listReservations(
    @CurrentUser() user: CurrentUserData,
    @Query() query: ReservationQueryDto,
  ) {
    return this.history.listReservations(user.sub, query);
  }
}
