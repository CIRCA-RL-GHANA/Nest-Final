import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FacilitatorProvider } from './payment-facilitator.service';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AccountField {
  /** Machine-readable key — matches the DTO field name */
  key: string;
  /** Human-readable label for the UI */
  label: string;
  /** Input type hint for the client */
  type: 'text' | 'phone' | 'select';
  required: boolean;
  /** Only present for type='select' */
  options?: { value: string; label: string }[];
}

export interface FacilitatorInfo {
  provider: FacilitatorProvider;
  displayName: string;
  description: string;
  /** ISO 3166-1 alpha-2 country codes where this facilitator operates */
  supportedCountries: string[];
  /** ISO 4217 currency codes supported */
  currencies: string[];
  /** Fields the client must collect from the user to register an account */
  accountFields: AccountField[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalog — canonical metadata for every supported provider
// ─────────────────────────────────────────────────────────────────────────────

export const FACILITATOR_CATALOG: Record<FacilitatorProvider, FacilitatorInfo> = {
  mock: {
    provider: 'mock',
    displayName: 'Test (Mock)',
    description: 'Development / testing only. No real money is moved.',
    supportedCountries: [],
    currencies: ['USD'],
    accountFields: [],
  },

  paystack: {
    provider: 'paystack',
    displayName: 'Paystack',
    description:
      'Licensed payment processor operating in Nigeria, Ghana, South Africa, and Kenya.',
    supportedCountries: ['NG', 'GH', 'ZA', 'KE'],
    currencies: ['NGN', 'GHS', 'ZAR', 'KES', 'USD'],
    accountFields: [
      { key: 'accountNumber', label: 'Account Number', type: 'text', required: true },
      { key: 'bankCode', label: 'Bank Code', type: 'text', required: true },
      { key: 'accountName', label: 'Account Holder Name', type: 'text', required: false },
      {
        key: 'type',
        label: 'Account Type',
        type: 'select',
        required: false,
        options: [
          { value: 'nuban', label: 'Bank Account (NUBAN)' },
          { value: 'mobile_money', label: 'Mobile Money' },
          { value: 'basa', label: 'BASA' },
        ],
      },
    ],
  },

  flutterwave: {
    provider: 'flutterwave',
    displayName: 'Flutterwave',
    description: 'Pan-African payment processor available in 35+ African countries.',
    supportedCountries: [
      'NG', 'GH', 'KE', 'UG', 'TZ', 'ZA', 'CI', 'SN', 'CM', 'RW', 'ZM', 'EG', 'MA', 'ET',
    ],
    currencies: [
      'NGN', 'GHS', 'KES', 'UGX', 'TZS', 'ZAR', 'XOF', 'XAF', 'USD', 'GBP', 'EUR',
    ],
    accountFields: [
      { key: 'accountNumber', label: 'Account Number', type: 'text', required: true },
      { key: 'bankCode', label: 'Bank Code', type: 'text', required: true },
    ],
  },

  mtn_momo: {
    provider: 'mtn_momo',
    displayName: 'MTN Mobile Money',
    description: 'MTN Mobile Money — available in 17 African countries.',
    supportedCountries: ['GH', 'NG', 'UG', 'RW', 'ZM', 'CI', 'CM', 'BJ', 'CG'],
    currencies: ['GHS', 'NGN', 'UGX', 'RWF', 'ZMW', 'XOF', 'XAF'],
    accountFields: [
      { key: 'phone', label: 'MTN Mobile Money Number (with country code)', type: 'phone', required: true },
    ],
  },

  mpesa: {
    provider: 'mpesa',
    displayName: 'M-Pesa',
    description:
      "Safaricom M-Pesa — Kenya's leading mobile money platform; also available in Tanzania and Mozambique.",
    supportedCountries: ['KE', 'TZ', 'MZ'],
    currencies: ['KES', 'TZS', 'MZN'],
    accountFields: [
      { key: 'phone', label: 'M-Pesa Phone Number (with country code)', type: 'phone', required: true },
    ],
  },

  wise: {
    provider: 'wise',
    displayName: 'Wise',
    description:
      'Wise (formerly TransferWise) — international bank transfers in 80+ countries and 50+ currencies.',
    supportedCountries: [
      'GB', 'US', 'CA', 'AU', 'NZ', 'DE', 'FR', 'ES', 'NL', 'SE', 'DK', 'NO', 'FI', 'BE',
      'AT', 'CH', 'PT', 'IE', 'IT', 'PL', 'HU', 'CZ', 'SK', 'RO', 'BG', 'HR', 'SI', 'EE',
      'LV', 'LT', 'MT', 'CY', 'LU', 'JP', 'SG', 'HK', 'IN', 'ZA', 'BR', 'MX', 'AE', 'MY',
      'PH', 'NG', 'GH', 'KE',
    ],
    currencies: [
      'USD', 'GBP', 'EUR', 'CAD', 'AUD', 'JPY', 'SGD', 'HKD', 'INR', 'ZAR', 'BRL', 'MXN',
      'AED', 'GHS', 'NGN', 'KES', 'CHF', 'NOK', 'SEK', 'DKK', 'PLN',
    ],
    accountFields: [
      { key: 'accountNumber', label: 'Account Number / IBAN', type: 'text', required: true },
      { key: 'routingCode', label: 'Sort Code / Routing Number / SWIFT', type: 'text', required: true },
      { key: 'accountName', label: 'Account Holder Name', type: 'text', required: true },
      { key: 'currency', label: 'Account Currency (ISO 4217)', type: 'text', required: true },
    ],
  },

  stripe: {
    provider: 'stripe',
    displayName: 'Stripe',
    description:
      'Stripe Connect — available in 46+ countries including US, UK, EU, and select African markets.',
    supportedCountries: [
      'US', 'CA', 'GB', 'AU', 'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
      'DE', 'GH', 'GR', 'HU', 'IN', 'IE', 'IT', 'JP', 'KE', 'LV', 'LI', 'LT', 'LU', 'MY',
      'MT', 'MX', 'NL', 'NZ', 'NG', 'NO', 'PL', 'PT', 'RO', 'SG', 'SK', 'SI', 'ZA', 'ES',
      'SE', 'CH', 'TH', 'AE', 'UY',
    ],
    currencies: [
      'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'SGD', 'MXN', 'BRL', 'INR', 'GHS', 'NGN',
      'KES', 'ZAR', 'CHF', 'NOK', 'SEK', 'DKK', 'PLN', 'CZK', 'RON', 'HUF',
    ],
    accountFields: [
      { key: 'accountNumber', label: 'Account Number / IBAN', type: 'text', required: true },
      { key: 'routingCode', label: 'Routing / Sort Code', type: 'text', required: true },
      { key: 'accountName', label: 'Account Holder Name', type: 'text', required: true },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Jurisdiction map
// country code (ISO 3166-1 alpha-2) → ordered preferred providers
// First entry is the recommended default for that jurisdiction.
// ─────────────────────────────────────────────────────────────────────────────

export const JURISDICTION_FACILITATOR_MAP: Readonly<Record<string, FacilitatorProvider[]>> = {
  // ── West & Central Africa ───────────────────────────────────────────────
  GH: ['mtn_momo', 'flutterwave', 'paystack', 'stripe'],
  NG: ['paystack', 'flutterwave', 'mtn_momo', 'wise', 'stripe'],
  CI: ['mtn_momo', 'flutterwave'],
  CM: ['mtn_momo', 'flutterwave'],
  SN: ['flutterwave'],
  BJ: ['mtn_momo', 'flutterwave'],
  CG: ['mtn_momo', 'flutterwave'],
  // ── East Africa ─────────────────────────────────────────────────────────
  KE: ['mpesa', 'flutterwave', 'wise', 'stripe'],
  TZ: ['mpesa', 'flutterwave'],
  UG: ['mtn_momo', 'flutterwave'],
  RW: ['mtn_momo', 'flutterwave'],
  ET: ['flutterwave'],
  // ── North Africa ────────────────────────────────────────────────────────
  EG: ['flutterwave'],
  MA: ['flutterwave'],
  // ── Southern Africa ─────────────────────────────────────────────────────
  ZA: ['paystack', 'flutterwave', 'wise', 'stripe'],
  ZM: ['mtn_momo', 'flutterwave'],
  MZ: ['mpesa', 'flutterwave'],
  // ── UK & Western Europe ─────────────────────────────────────────────────
  GB: ['wise', 'stripe'],
  DE: ['wise', 'stripe'],
  FR: ['wise', 'stripe'],
  NL: ['wise', 'stripe'],
  SE: ['wise', 'stripe'],
  NO: ['wise', 'stripe'],
  DK: ['wise', 'stripe'],
  AT: ['wise', 'stripe'],
  BE: ['wise', 'stripe'],
  CH: ['wise', 'stripe'],
  IE: ['wise', 'stripe'],
  IT: ['wise', 'stripe'],
  PT: ['wise', 'stripe'],
  ES: ['wise', 'stripe'],
  FI: ['wise', 'stripe'],
  LU: ['wise', 'stripe'],
  // ── Eastern Europe ──────────────────────────────────────────────────────
  PL: ['wise', 'stripe'],
  HU: ['wise', 'stripe'],
  CZ: ['wise', 'stripe'],
  SK: ['wise', 'stripe'],
  RO: ['wise', 'stripe'],
  BG: ['wise', 'stripe'],
  HR: ['wise', 'stripe'],
  SI: ['wise', 'stripe'],
  EE: ['wise', 'stripe'],
  LV: ['wise', 'stripe'],
  LT: ['wise', 'stripe'],
  MT: ['wise', 'stripe'],
  CY: ['wise', 'stripe'],
  // ── Americas ────────────────────────────────────────────────────────────
  US: ['stripe', 'wise'],
  CA: ['stripe', 'wise'],
  BR: ['stripe', 'wise'],
  MX: ['stripe', 'wise'],
  UY: ['stripe', 'wise'],
  // ── Asia-Pacific ────────────────────────────────────────────────────────
  JP: ['stripe', 'wise'],
  SG: ['stripe', 'wise'],
  HK: ['wise', 'stripe'],
  IN: ['wise', 'stripe'],
  AU: ['stripe', 'wise'],
  NZ: ['stripe', 'wise'],
  MY: ['stripe', 'wise'],
  PH: ['wise', 'stripe'],
  TH: ['stripe', 'wise'],
  // ── Middle East ─────────────────────────────────────────────────────────
  AE: ['wise', 'stripe'],
} as const;

const GLOBAL_FALLBACK: FacilitatorProvider[] = ['wise', 'stripe'];

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class FacilitatorRegistryService {
  /** Set of providers that have valid API credentials in the current environment. */
  private readonly configuredProviders: Set<FacilitatorProvider>;

  constructor(private readonly config: ConfigService) {
    const configured = new Set<FacilitatorProvider>();

    const register = (provider: FacilitatorProvider, ...keyPaths: string[]) => {
      const key = keyPaths.map((p) => config.get<string>(p) ?? '').find((v) => v.length > 8 && !v.startsWith('mock_') && !v.startsWith('REPLACE_'));
      if (key) configured.add(provider);
    };

    // Legacy single-provider config (backward-compatible)
    const legacyKey = config.get<string>('payments.facilitatorSecretKey') ?? '';
    const legacyProvider = config.get<string>('payments.facilitatorProvider') ?? '';
    if (legacyKey.length > 8 && !legacyKey.startsWith('mock_') && legacyProvider && legacyProvider !== 'mock') {
      configured.add(legacyProvider as FacilitatorProvider);
    }

    // Per-provider keys
    register('paystack', 'payments.paystack.secretKey');
    register('flutterwave', 'payments.flutterwave.secretKey');
    register('mtn_momo', 'payments.mtnMomo.apiKey');
    register('mpesa', 'payments.mpesa.consumerKey');
    register('wise', 'payments.wise.apiKey');
    register('stripe', 'payments.stripe.secretKey');

    // Always include mock in dev (when nothing else is configured)
    if (configured.size === 0) {
      configured.add('mock');
    }

    this.configuredProviders = configured;
  }

  /** Returns true when the provider has valid API credentials in this environment. */
  isProviderConfigured(provider: FacilitatorProvider): boolean {
    return this.configuredProviders.has(provider);
  }

  /**
   * Returns all available and configured facilitators for a country.
   * Ordered by local preference (first = recommended default).
   * Falls back to global providers (Wise, Stripe) when no country-specific match.
   */
  getForCountry(countryCode: string): FacilitatorInfo[] {
    const upper = countryCode.toUpperCase();
    const candidates = (JURISDICTION_FACILITATOR_MAP[upper] ?? GLOBAL_FALLBACK) as FacilitatorProvider[];
    return candidates
      .filter((p) => this.isProviderConfigured(p))
      .map((p) => FACILITATOR_CATALOG[p]);
  }

  /**
   * Returns the preferred (first configured) provider for a jurisdiction.
   * Falls back to 'mock' when no providers are configured (dev / test).
   */
  getPreferred(countryCode: string): FacilitatorProvider {
    return this.getForCountry(countryCode)[0]?.provider ?? 'mock';
  }

  /** Returns the full catalog (excluding mock) for documentation / display. */
  getCatalog(): FacilitatorInfo[] {
    return Object.values(FACILITATOR_CATALOG).filter((f) => f.provider !== 'mock');
  }

  /** Returns info for a single provider. */
  getProviderInfo(provider: FacilitatorProvider): FacilitatorInfo {
    return FACILITATOR_CATALOG[provider];
  }
}
