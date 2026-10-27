import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length } from 'class-validator';

export class DemoLoginDto {
  @ApiProperty({ example: 'alice@acme.test' })
  @IsEmail()
  email!: string;
}

export class RegisterDto {
  @ApiProperty({ example: 'carol@acme.test' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Carol Customer' })
  @IsString()
  @Length(1, 120)
  name!: string;
}
