import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { CURRENCIES, Currency } from '../common/money/money';

export class CreateDepositDto {
  @ApiProperty({ description: 'Amount in minor units (cents), as a string', example: '50000' })
  @Matches(/^[1-9]\d{0,14}$/, {
    message: 'amount must be a positive integer string of minor units',
  })
  amount!: string;

  @ApiProperty({ enum: CURRENCIES, default: 'USD', required: false })
  @IsOptional()
  @IsIn(CURRENCIES)
  currency?: Currency;
}
