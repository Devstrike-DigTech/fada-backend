import { Controller, Get, Headers, Query } from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { AllowGuest } from '@common/decorators/allow-guest.decorator';
import {
  CurrentUser,
  CurrentUserData,
} from '@common/decorators/current-user.decorator';
import { SearchService } from './search.service';
import { DrugSearchQueryDto } from './dto/drug-search-query.dto';
import { PharmacySearchQueryDto } from './dto/pharmacy-search-query.dto';
import { AilmentSearchQueryDto } from './dto/ailment-search-query.dto';

@ApiTags('Search')
@Controller({ path: 'search', version: '1' })
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  // ─── Drug Search ────────────────────────────────────────────────────────────

  @Get('drugs')
  @AllowGuest()
  @ApiOperation({
    summary: 'Search for drugs near a location',
    description: `
      Finds drugs matching \`q\` at branches within \`radiusKm\` of the supplied coordinates.

      **Geo behaviour**
      - Provide \`latitude\` + \`longitude\` for geo-fenced results sorted by distance.
      - If fewer than 3 results are found the radius is automatically expanded to the
        next step (5 → 10 → 20 → 50 km). The response includes \`expandedRadius\`,
        \`originalRadiusKm\`, and \`finalRadiusKm\` so the client can inform the user.
      - Omit coordinates for a catalogue-wide text search (sorted alphabetically).

      **Guest limits**
      - Guests may see at most 10 results per search and 20 searches per 24 h.
      - Track the guest session across requests by echoing the same \`X-Guest-Token\`
        value (a UUID you generate client-side on first visit).
      - When \`guestLimitReached\` is \`true\` the results are truncated and the user
        should be prompted to sign in.
    `,
  })
  @ApiHeader({
    name: 'x-guest-token',
    required: false,
    description: 'Stable UUID for the guest session (client-generated)',
  })
  @ApiQuery({ name: 'q', description: 'Drug name, generic name, alias or NAFDAC number' })
  @ApiQuery({ name: 'latitude', required: false })
  @ApiQuery({ name: 'longitude', required: false })
  @ApiQuery({ name: 'radiusKm', required: false, description: 'Default 5 km, max 100 km' })
  @ApiQuery({ name: 'prescriptionType', required: false, enum: ['otc', 'prescription_only', 'controlled'] })
  @ApiQuery({ name: 'categoryId', required: false })
  searchDrugs(
    @CurrentUser() user: CurrentUserData | undefined,
    @Headers('x-guest-token') guestToken: string | undefined,
    @Query() query: DrugSearchQueryDto,
  ) {
    return this.searchService.searchDrugs(user?.sub, guestToken, query);
  }

  // ─── Pharmacy Search ────────────────────────────────────────────────────────

  @Get('pharmacies')
  @AllowGuest()
  @ApiOperation({
    summary: 'Search for pharmacies near a location',
    description: `
      Returns verified pharmacies (and a representative branch) within \`radiusKm\`
      of the supplied coordinates, sorted by distance. Auto-expands the radius when
      fewer than 3 results are found.

      Omit coordinates for a text/state/city filtered catalogue search sorted by
      reputation score.
    `,
  })
  @ApiHeader({
    name: 'x-guest-token',
    required: false,
    description: 'Stable UUID for the guest session (client-generated)',
  })
  @ApiQuery({ name: 'q', required: false, description: 'Pharmacy name' })
  @ApiQuery({ name: 'latitude', required: false })
  @ApiQuery({ name: 'longitude', required: false })
  @ApiQuery({ name: 'radiusKm', required: false, description: 'Default 5 km, max 100 km' })
  @ApiQuery({ name: 'state', required: false })
  @ApiQuery({ name: 'city', required: false })
  searchPharmacies(
    @CurrentUser() user: CurrentUserData | undefined,
    @Headers('x-guest-token') guestToken: string | undefined,
    @Query() query: PharmacySearchQueryDto,
  ) {
    return this.searchService.searchPharmacies(user?.sub, guestToken, query);
  }

  // ─── Ailment / Indication Search ────────────────────────────────────────────

  @Get('ailments')
  @AllowGuest()
  @ApiOperation({
    summary: 'Search for drugs by ailment or symptom',
    description: `
      Returns drugs whose indications or ailment tags match \`q\`.
      Results include the branch and pharmacy stocking each drug.

      **Geo behaviour**
      - Provide \`latitude\` + \`longitude\` to sort by distance and restrict to \`radiusKm\`.
      - Auto-expands the radius when fewer than 3 results are found.
      - Omit coordinates for a catalogue-wide search sorted alphabetically.

      **Guest limits**
      - Same 10-result / 20-search-per-day limits as drug search.
    `,
  })
  @ApiHeader({
    name: 'x-guest-token',
    required: false,
    description: 'Stable UUID for the guest session (client-generated)',
  })
  @ApiQuery({ name: 'q', description: 'Ailment or symptom (e.g. "fever", "headache", "malaria")' })
  @ApiQuery({ name: 'latitude', required: false })
  @ApiQuery({ name: 'longitude', required: false })
  @ApiQuery({ name: 'radiusKm', required: false, description: 'Default 5 km, max 100 km' })
  searchAilments(
    @CurrentUser() user: CurrentUserData | undefined,
    @Headers('x-guest-token') guestToken: string | undefined,
    @Query() query: AilmentSearchQueryDto,
  ) {
    return this.searchService.searchAilments(user?.sub, guestToken, query);
  }
}
