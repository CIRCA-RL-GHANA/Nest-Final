import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Payload for registering a user's payment account with a facilitator. */
export class RegisterFacilitatorAccountDto {
  /**
   * Which facilitator provider to register with.
   * If omitted the server selects the preferred provider for the user's country.
   */
  @ApiPropertyOptional({
    enum: ['flutterwave', 'paystack', 'mtn_momo', 'mpesa', 'wise', 'stripe', 'mock'],
    description: 'Payment provider to register with',
    example: 'mtn_momo',
  })
  @IsOptional()
  @IsIn(['flutterwave', 'paystack', 'mtn_momo', 'mpesa', 'wise', 'stripe', 'mock'])
  provider?: 'flutterwave' | 'paystack' | 'mtn_momo' | 'mpesa' | 'wise' | 'stripe' | 'mock';

  /**
   * ISO 3166-1 alpha-2 country code for the user's jurisdiction.
   * Used to select the preferred provider when `provider` is not specified.
   */
  @ApiPropertyOptional({ example: 'GH', description: 'ISO 3166-1 alpha-2 country code' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(2)
  countryCode?: string;

  /** User's email address (used for recipient creation metadata). */
  @ApiProperty({ example: 'user@genieinprompt.app' })
  @IsEmail()
  email: string;

  // ── Bank account fields (Paystack, Flutterwave, Wise, Stripe) ──────────────────

  /** Bank / IBAN account number. Required for Paystack, Flutterwave, Wise, Stripe. */
  @ApiPropertyOptional({ example: '0690000031' })
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(34)  // IBAN max length
  accountNumber?: string;

  /**
   * Bank code, sort code, routing number, or SWIFT/BIC.
   * Required for Paystack (CBN code) and Flutterwave transfers.
   * Also used by Wise (sort code / SWIFT) and Stripe (routing number).
   */
  @ApiPropertyOptional({
    example: '044',
    description: 'CBN bank code (Nigeria), GH bank code, sort code, routing number, or SWIFT/BIC',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(11)
  bankCode?: string;

  /**
   * Sort code / routing number / SWIFT for Wise and Stripe.
   * Separate from `bankCode` to avoid ambiguity for international transfers.
   */
  @ApiPropertyOptional({ example: '20-00-00', description: 'Sort code / Routing / SWIFT for Wise or Stripe' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(15)
  routingCode?: string;

  /** Account holder name. Used by Paystack, Wise, and Stripe. */
  @ApiPropertyOptional({ example: 'Jane Doe' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  accountName?: string;

  /**
   * ISO 4217 currency code for the account (Wise only).
   * Wise supports multi-currency accounts; specify the target currency.
   */
  @ApiPropertyOptional({ example: 'GHS', description: 'ISO 4217 account currency (Wise)' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currency?: string;

  /**
   * Recipient account type (Paystack only).
   * @default 'nuban'
   */
  @ApiPropertyOptional({ enum: ['nuban', 'mobile_money', 'basa'], default: 'nuban' })
  @IsOptional()
  @IsIn(['nuban', 'mobile_money', 'basa'])
  type?: string;

  // ── Mobile money fields (MTN MoMo, M-Pesa) ────────────────────────────

  /**
   * Mobile money phone number in international format (e.g. +233241234567).
   * Required for MTN Mobile Money and M-Pesa.
   */
  @ApiPropertyOptional({
    example: '+233241234567',
    description: 'Mobile money number in international format. Required for MTN MoMo and M-Pesa.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  phone?: string;
}
