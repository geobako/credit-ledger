import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { CURRENCIES, Currency } from '../common/money/money';

const MINOR_UNITS = /^[1-9]\d{0,14}$/;

export class AuthorizeDto {
  @ApiProperty({
    example: 'visa:4f1c2b9e7d7a4c1e',
    description: "Network's transaction id (idempotency key)",
  })
  @Matches(/^[A-Za-z0-9_.:-]{8,64}$/)
  networkTransactionId!: string;

  @ApiProperty({ example: 'tok_…' })
  @Matches(/^tok_[0-9a-f]{32}$/)
  cardToken!: string;

  @ApiProperty({ example: '1250', description: 'Minor units (cents)' })
  @Matches(MINOR_UNITS, { message: 'amount must be a positive integer string of minor units' })
  amount!: string;

  @ApiProperty({ enum: CURRENCIES })
  @IsIn(CURRENCIES)
  currency!: Currency;

  @ApiProperty({ example: 'Blue Bottle Coffee' })
  @IsString()
  @Length(1, 120)
  merchantName!: string;

  @ApiProperty({ example: '5814', required: false })
  @IsOptional()
  @Matches(/^\d{4}$/)
  merchantCategoryCode?: string;
}

export class CaptureDto {
  @ApiProperty({ required: false, description: 'Defaults to the full authorized amount' })
  @IsOptional()
  @Matches(MINOR_UNITS)
  amount?: string;
}
