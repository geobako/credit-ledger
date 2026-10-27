import { Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal } from '../auth/decorators';
import { Principal } from '../auth/principal';
import { CardsService } from './cards.service';

@ApiTags('cards')
@ApiBearerAuth()
@Controller('cards/:cardId')
export class CardsController {
  constructor(private readonly cards: CardsService) {}

  @Post('freeze')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Freeze a card: new purchases are declined (captures of earlier holds still settle)',
  })
  freeze(@CurrentPrincipal() principal: Principal, @Param('cardId', ParseUUIDPipe) cardId: string) {
    return this.cards.freeze(principal, cardId);
  }

  @Post('unfreeze')
  @HttpCode(200)
  @ApiOperation({ summary: 'Unfreeze a card' })
  unfreeze(
    @CurrentPrincipal() principal: Principal,
    @Param('cardId', ParseUUIDPipe) cardId: string,
  ) {
    return this.cards.unfreeze(principal, cardId);
  }
}
