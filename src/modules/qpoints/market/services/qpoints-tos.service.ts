import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { QPointsTosAcceptance } from '../entities/qpoints-tos-acceptance.entity';
import { AcceptQPointsTosDto } from '../dto/accept-tos.dto';

// ─── ToS Content ──────────────────────────────────────────────────────────────
// The canonical version and full text of the current Q Points Terms of Service.
// Bump CURRENT_TOS_VERSION to require all users to re-accept.
// A MINOR bump (1.0.x → 1.1.0) does NOT require re-acceptance.
// A MAJOR bump (1.x.x → 2.0.0) DOES require re-acceptance.
// ─────────────────────────────────────────────────────────────────────────────

export const CURRENT_TOS_VERSION = '1.1.0';
export const CURRENT_TOS_EFFECTIVE_DATE = 'April 27, 2026';
export const COMPANY_NAME = 'genie help Ltd.';
export const COMPANY_JURISDICTION = 'Republic of Ghana';
export const LEGAL_EMAIL = 'legal@genieinprompt.app';

export const QPOINTS_TOS_TEXT = `Q POINTS TERMS OF SERVICE
(Effective Date: ${CURRENT_TOS_EFFECTIVE_DATE})

These Q Points Terms of Service ("Terms") govern your access to and use of the Q Points functionality (the "Q Points System") made available by ${COMPANY_NAME}, a company duly organized under the laws of the ${COMPANY_JURISDICTION} ("Company", "we", "us", or "our"), through our platform (the "Platform").

By using the Q Points System, you ("you" or "User") acknowledge and agree to be bound by these Terms. These Terms are incorporated into the Platform's general Terms of Use / Master Services Agreement and, in the event of any conflict, these Terms shall control solely with respect to the Q Points System.

1. Nature of Q Points

1.1 Utility Token, Not a Security or Currency
Q Points are digital units of value that exist solely within the Platform's ecosystem. Q Points:

• are not a security, investment contract, or financial instrument under the laws of any jurisdiction;
• are not a form of legal tender, currency, or money;
• confer no ownership, equity, or governance rights in the Company or any affiliate;
• do not represent a deposit or any obligation of the Company to repay funds;
• do not accrue interest, dividends, or any passive return;
• are not redeemable for fiat currency by the Company (except as expressly provided in Section 5 with respect to peer-to-peer trading facilitated by a third-party licensed facilitator).

1.2 Limited Ecosystem Utility
Q Points may be used solely within the Platform to:

• purchase goods and services offered by third-party merchants or the Company;
• pay for rides, deliveries, and other Platform services;
• transfer to other Users in accordance with these Terms;
• engage in peer-to-peer trades as described in Section 4.

The Company may, in its sole discretion, add, modify, or remove utility features associated with Q Points at any time without liability.

2. No Financial Institution or Payment Processing Role

2.1 Company Is Not a Financial Institution
The Company is not a bank, credit union, money transmitter, money services business, electronic money institution, payment processor, or any other type of regulated financial entity. The Q Points System does not constitute a banking, payment, or money transmission service.

2.2 Licensed Facilitators Handle All Fiat
Any conversion of Q Points to fiat currency (e.g., selling Q Points for cash) or fiat to Q Points (e.g., buying Q Points with cash) is performed exclusively through third-party licensed payment facilitators (each, a "Facilitator") with whom you will have a separate direct relationship. The Company works with licensed Facilitators operating across all jurisdictions globally where the Platform is available, so that fiat conversion services are accessible to Users worldwide. The applicable Facilitator may vary by your jurisdiction and will be identified at the time of your transaction. The Company does not at any time hold, control, or have custody of fiat currency. Your use of any Facilitator's services is subject to their terms, conditions, and privacy policies.

2.3 No Platform Custody of Fiat
The Company does not accept deposits of fiat currency, does not process payments, and does not act as an intermediary for cash settlements. All cash settlements occur directly between Users' accounts with the Facilitator, governed by the Facilitator's own rules and applicable law.

3. Account and Eligibility

3.1 Eligibility
To use the Q Points System, you must:

• be at least 18 years old (or the age of majority in your jurisdiction);
• have a valid account on the Platform;
• if you intend to buy or sell Q Points for fiat, have completed all identity verification and onboarding requirements imposed by the Facilitator (including, where required, KYC/AML checks);
• comply with all applicable laws, including sanctions and anti-money laundering regulations.

3.2 Q Points Balance
Your Q Points balance is recorded in the Platform's ledger. The balance is a record of entitlement and does not represent a claim against the Company other than the right to use Q Points within the Platform as set forth herein.

4. Peer-to-Peer Trading and Order Book

4.1 Limit Order Book
The Q Points System provides a limit order book where Users may post offers to buy or sell Q Points at a specified price (per Q Point) in fiat currency. Orders are matched automatically based on price-time priority. The Company does not guarantee that any order will be executed, nor does it guarantee execution at any particular price.

4.2 Matching and Settlement
When a buy order and a sell order are matched:
• the agreed quantity of Q Points is transferred between the Users' Q Points balances within the Platform ledger;
• the corresponding fiat amount is transferred between the Users' accounts outside the Platform via the Facilitator.
The Platform merely records the Q Points transfer; the fiat transfer is handled solely by the Facilitator.

4.3 No Platform Role in Fiat Settlement
The Company does not initiate, facilitate, or confirm fiat transfers. Any dispute regarding a fiat transfer must be resolved directly with the Facilitator. The Platform may, at its discretion, suspend Q Points trading privileges if a User fails to complete a fiat transfer or breaches any applicable terms.

5. AI Participant \u2013 Ordinary User

5.1 Platform's Own Q Points Balance
The Company may maintain its own Q Points balance for operational purposes, such as:
• rewarding Users for certain activities;
• paying service providers (e.g., drivers, merchants);
• acquiring Q Points from Users to satisfy operational needs.

5.2 AI Participant as Last-Resort Counterparty
The Company deploys an automated algorithmic participant (the "AI Participant") that places standing orders on the order book as any other User. The AI Participant:
• maintains standing buy and sell orders at the fixed price of $1.00 per Q Point as an operational feature, so that a User who finds no willing peer counterparty at that price may trade with the AI Participant as a last resort;
• acts as last-resort counterparty only — peer-to-peer orders at the same price are matched first in accordance with standard price-time priority rules; the AI Participant's orders fill only when no peer order is available at that price;
• does not act as a dynamic market maker or price stabilizer — the price is fixed at $1.00 by these Terms, not by the AI Participant;
• trades solely for the Company's own operational purposes (e.g., to acquire Q Points to pay drivers, to reward Users, or to sell excess Q Points from the Company's balance).

The AI Participant is subject to the same matching rules, order types, and limitations as any other User. Maintaining standing orders is an operational commitment of the Company and does not constitute a legal guarantee of redemption, liquidity, or the availability of a market (see Section 6). The AI Participant's availability may be temporarily interrupted during scheduled Platform maintenance, security incidents, or as required by applicable law or regulatory authority.

6. No Redemption Obligation

6.1 No Guarantee of Fiat Redemption
The Company does not guarantee that any User will be able to sell Q Points for fiat currency. The primary mechanism for converting Q Points to fiat is finding a willing peer buyer through the order book; the AI Participant's standing orders (Section 5.2) serve only as a last-resort operational feature and do not constitute a legal guarantee of redemption, liquidity, or the continuous availability of a market. The Company has no legal obligation to repurchase Q Points for fiat, to maintain any market, or to ensure the AI Participant is available at any time. The AI Participant's standing orders may be withdrawn, suspended, or interrupted at any time without notice, and no liability shall attach to any such interruption.

6.2 Platform's Right to Suspend Trading
The Company may, at any time and without prior notice, suspend or terminate trading on the Q Points System for maintenance, security, legal, or business reasons. During any suspension, Users will not be able to place or execute orders.

6.3 No Liability for Illiquidity
The Company is not liable for any losses arising from the inability to sell Q Points, including due to lack of buyer interest, suspension of trading, or technical issues.

7. Fees and Taxes

7.1 Transaction Fees
The Company may charge fees for using the Q Points System, including but not limited to fees for order placement, trade execution, and withdrawal of Q Points from the Platform. Fees will be disclosed on the Platform and may be changed upon notice.

7.2 Taxes
You are solely responsible for determining and paying any taxes that may apply to your use of Q Points, including any taxes on trades or gains. The Company does not withhold or remit taxes on your behalf, except as required by law.

8. Prohibited Activities

You may not:
• use the Q Points System for any illegal purpose, including money laundering, fraud, or financing prohibited activities;
• manipulate the order book, including by placing orders you do not intend to honor;
• use the Q Points System in a manner that creates an unreasonable or disproportionately large load on the Platform's infrastructure;
• attempt to interfere with the AI Participant or any other User's orders.

9. Risk Disclosures

9.1 Market Risk
The price of Q Points is determined solely by supply and demand among Users. It may be highly volatile, and you may suffer losses.

9.2 Technical Risks
The Q Points System relies on software, networks, and third-party services. Errors, delays, or unauthorized access could result in loss of Q Points or inability to trade.

9.3 Regulatory Risks
Laws and regulations regarding digital tokens vary by jurisdiction and may change. The Company may be required to modify or discontinue the Q Points System to comply with legal developments.

9.4 No Insurance
Q Points are not insured by any government agency or deposit insurance scheme.

9.5 Acknowledgement
By using the Q Points System, you acknowledge that you have read and understood these risks and accept them in full.

10. Limitation of Liability

10.1 No Liability for Facilitator Actions
The Company is not responsible for any acts, omissions, or insolvency of any Facilitator. Your sole recourse for any failure of fiat settlement lies with the Facilitator.

10.2 Maximum Liability
To the maximum extent permitted by law, the Company's total aggregate liability arising out of or relating to the Q Points System shall not exceed the total amount of fees paid by you to the Company for the Q Points System during the twelve months preceding the claim.

10.3 Exclusion of Consequential Damages
In no event shall the Company be liable for any indirect, special, incidental, consequential, or punitive damages, including lost profits, lost data, or loss of business opportunity.

11. Dispute Resolution and Governing Law

11.1 Governing Law
These Terms and any dispute arising out of or in connection with them shall be governed by the laws of the Republic of Ghana, without regard to conflict of law principles.

11.2 Arbitration
Any dispute, controversy, claim, or difference of any kind whatsoever arising out of or in connection with these Terms shall be finally settled by arbitration in accordance with the Arbitration Rules of the Ghana Arbitration Centre. The seat of arbitration shall be Accra, Ghana. The language of the arbitration shall be English. Judgment upon the award rendered by the arbitrator(s) may be entered in any court having jurisdiction thereof.

11.3 Waiver of Class Actions
All disputes shall be resolved on an individual basis. You waive any right to participate in a class action, class arbitration, or other representative proceeding.

12. Modifications and Termination

12.1 Amendments
The Company may modify these Terms at any time by posting the revised version on the Platform. Your continued use of the Q Points System after the effective date of any modification constitutes your acceptance of the revised Terms.

12.2 Termination
The Company may terminate your access to the Q Points System at any time, with or without cause, upon notice. Upon termination, you will have the right to withdraw your Q Points (subject to any applicable withdrawal limits) and to sell them through the order book, but the Company may suspend trading during a wind-down period.

13. Miscellaneous

13.1 Entire Agreement
These Terms constitute the entire agreement between you and the Company regarding the Q Points System and supersede all prior or contemporaneous communications.

13.2 Severability
If any provision of these Terms is held to be invalid or unenforceable, the remaining provisions shall remain in full force and effect.

13.3 No Waiver
Failure by the Company to enforce any right or provision shall not constitute a waiver of future enforcement of that right or provision.

13.4 Contact
For questions regarding these Terms, please contact us at ${LEGAL_EMAIL}.

By using the Q Points System, you acknowledge that you have read, understood, and agree to be bound by these Terms.

1.00 Q Points is always equal to $1.00

The AI Participant maintains standing buy and sell orders at $1.00 per Q Point as an operational last-resort service. This is not a legal guarantee of redemption.`;

// Pre-computed SHA-256 of the canonical ToS text (computed once at startup).
export const CURRENT_TOS_HASH = createHash('sha256')
  .update(QPOINTS_TOS_TEXT, 'utf8')
  .digest('hex');

// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class QPointsTosService {
  private readonly logger = new Logger(QPointsTosService.name);

  constructor(
    @InjectRepository(QPointsTosAcceptance)
    private readonly repo: Repository<QPointsTosAcceptance>,
  ) {}

  // ── Public read ──────────────────────────────────────────────────────────

  /** Returns the current ToS metadata and full text for display. */
  getCurrentTos() {
    return {
      version: CURRENT_TOS_VERSION,
      effectiveDate: CURRENT_TOS_EFFECTIVE_DATE,
      contentHash: CURRENT_TOS_HASH,
      text: QPOINTS_TOS_TEXT,
    };
  }

  /**
   * Returns whether the given user has accepted the CURRENT version of the
   * Q Points ToS.  Used by the guard and by the Flutter app to decide
   * whether to show the acceptance screen.
   *
   * Compatibility rule:
   *   - Users who accepted ANY version with the SAME MAJOR number do not
   *     need to re-accept (non-breaking changes, e.g. 1.0.0 → 1.1.0).
   *   - A MAJOR version bump (1.x.x → 2.0.0) invalidates prior acceptances
   *     and forces re-acceptance from all users.
   */
  async hasAcceptedCurrentTos(userId: string): Promise<boolean> {
    const currentMajor = parseInt(CURRENT_TOS_VERSION.split('.')[0], 10);
    const rows = await this.repo.find({
      where: { userId },
      order: { acceptedAt: 'DESC' },
    });
    return rows.some((row) => {
      const acceptedMajor = parseInt(row.tosVersion.split('.')[0], 10);
      return acceptedMajor === currentMajor;
    });
  }

  // ── Acceptance recording ─────────────────────────────────────────────────

  /**
   * Records a user's acceptance of the Q Points ToS.
   * Validates all required confirmations and the version/hash.
   * Idempotent: returns the existing record if already accepted.
   */
  async recordAcceptance(
    userId: string,
    dto: AcceptQPointsTosDto,
    ipAddress: string,
    userAgent: string,
  ): Promise<QPointsTosAcceptance> {
    // --- Validate version matches current ToS ---
    if (dto.tosVersion !== CURRENT_TOS_VERSION) {
      throw new BadRequestException(
        `ToS version mismatch. Current version is "${CURRENT_TOS_VERSION}". ` +
          `You submitted "${dto.tosVersion}". Please fetch the current ToS and try again.`,
      );
    }

    // --- All consent fields must be true ---
    if (!dto.readConfirmed) {
      throw new BadRequestException(
        'You must confirm that you have read the full Terms of Service.',
      );
    }
    if (!dto.riskConfirmed) {
      throw new BadRequestException(
        'You must acknowledge the Risk Disclosures (Section 9) before proceeding.',
      );
    }
    if (!dto.ageConfirmed) {
      throw new BadRequestException(
        'You must confirm that you are at least 18 years of age.',
      );
    }

    // --- Idempotency: return existing record if already accepted ---
    const existing = await this.repo.findOne({
      where: { userId, tosVersion: CURRENT_TOS_VERSION },
    });
    if (existing) {
      return existing;
    }

    // --- Persist new acceptance ---
    const acceptance = this.repo.create({
      userId,
      tosVersion: CURRENT_TOS_VERSION,
      ipAddress,
      userAgent,
      platform: dto.platform,
      readConfirmed: dto.readConfirmed,
      riskConfirmed: dto.riskConfirmed,
      ageConfirmed: dto.ageConfirmed,
      tosContentHash: CURRENT_TOS_HASH,
    });

    const saved = await this.repo.save(acceptance);
    this.logger.log(
      `User ${userId} accepted Q Points ToS v${CURRENT_TOS_VERSION} from ${ipAddress} [${dto.platform}]`,
    );
    return saved;
  }

  /**
   * Returns the full acceptance history for a user (admin/audit use).
   */
  async getAcceptanceHistory(userId: string): Promise<QPointsTosAcceptance[]> {
    return this.repo.find({
      where: { userId },
      order: { acceptedAt: 'DESC' },
    });
  }
}
