import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './passwords';

export class LoginDto {
  @ApiProperty({ example: 'alice@acme.test' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'acme-demo-password' })
  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password!: string;
}

export class RegisterDto {
  @ApiProperty({ example: 'carol@acme.test' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'Carol Customer' })
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, {
    message: `password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters`,
  })
  password!: string;
}
