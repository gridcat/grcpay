import Joi from 'joi';
import { WalletMode } from '../../models/Wallet';
import { GRC_ADDRESS_PATTERN } from '../../lib/address';
import { config } from '../../config';
import { isValidWebhookUrl } from '../../lib/ssrfGuard';
import { grc2halford, MIN_FEE_HALFORD, SPLIT_DUST_HALFORD } from '../../lib/nomination';
import { MAX_SPLITS, SplitInput } from '../../lib/splits';

interface WalletAttributes {
  amountRequired: number;
  recipient?: string;
  // Optional payout splits: each `amount` GRC of amountRequired goes to
  // its `address` at payout. Only alongside a recipient (there is no
  // payout to split without one).
  splits?: SplitInput[];
  mode?: WalletMode;
  lifespanSeconds?: number;
  // Optional opt-in callback. Validated SYNTACTICALLY only here (no
  // DNS / no ping — deliberate); the full SSRF guard runs at delivery
  // time in the dispatcher.
  webhookUrl?: string;
}

export interface WalletInput {
  data: {
    type: string;
    attributes: WalletAttributes;
  }
}

export interface WalletData extends WalletAttributes {
  id: undefined;
  type: string;
}

export const WalletSchema = Joi.object<WalletData>({
  type: 'wallets',
  id: Joi.any().optional(),
  // Floor at 2x the network fee. A sub-fee invoice would flip to
  // `funded` on payment but then compute a negative forward amount
  // (received - MIN_FEE < 0), fail the send, park in `error`, and
  // strand the customer's money in the hot wallet with no refund
  // (the amount is below the dust/fee threshold). `positive()` stays
  // first so 0 / negative still report the "positive" message.
  amountRequired: Joi.number().required().positive().min(config.MIN_FEE * 2),
  recipient: Joi.string().optional().length(34).pattern(
    GRC_ADDRESS_PATTERN,
    'base58 address',
  ),
  // Each split address must be unique and differ from recipient:
  // sendMany would merge two outputs to the same address into one.
  // The splits together must leave the recipient the same 2x-fee floor
  // amountRequired has, so the primary output stays positive once the
  // fee comes off it. Splits under SPLIT_DUST don't count: the payout
  // leaves them with the recipient. Summed in halford, the way the
  // payout does its math, so a float residual can't let through what
  // the payout would reject.
  splits: Joi.array().max(MAX_SPLITS).items(Joi.object({
    address: Joi.string().required().length(34).pattern(GRC_ADDRESS_PATTERN, 'base58 address'),
    amount: Joi.number().required().positive(),
  })).unique('address')
    .optional()
    .custom((value: SplitInput[], helpers) => {
      const parent = helpers.state.ancestors[0] ?? {};
      // Splitting needs a primary recipient to split the payout with.
      // An empty list asks for nothing, so it passes without one.
      if (value.length > 0 && parent.recipient === undefined) {
        return helpers.message({ custom: 'splits require a recipient' });
      }
      if (value.some((split) => split.address === parent.recipient)) {
        return helpers.message({ custom: 'a split address must differ from recipient' });
      }
      const required = Number(parent.amountRequired);
      if (!Number.isFinite(required)) return value;
      const total = value
        .map((split) => grc2halford(split.amount))
        .filter((halford) => halford >= SPLIT_DUST_HALFORD)
        .reduce((sum, halford) => sum + halford, BigInt(0));
      if (total + MIN_FEE_HALFORD * BigInt(2) > grc2halford(required)) {
        return helpers.message({
          custom: `splits must leave at least ${config.MIN_FEE * 2} GRC of amountRequired for the recipient`,
        });
      }
      return value;
    }),
  // Narrow the accepted set to the modes we actually implement today.
  // Crowdfunding will be added here (and to WalletMode) once the
  // lifecycle branch lands.
  mode: Joi.string().valid(WalletMode.checkout).optional(),
  // Upper bound is a soft sanity check, not a business rule. 90 days
  // comfortably covers any crowdfunding campaign we'd want to support;
  // the lower bound prevents wallets that would expire before the
  // funded processor's next poll cycle can see them.
  lifespanSeconds: Joi.number().integer().min(60).max(60 * 60 * 24 * 90)
    .optional(),
  // Syntactic check only. `isValidWebhookUrl` also enforces the
  // scheme allowlist (https always; http only when
  // WEBHOOK_ALLOW_PRIVATE). Rejected outright when the feature is off
  // so an integrator gets an immediate, clear 400 instead of silently
  // never receiving anything.
  // 2048-char ceiling matches Stripe's webhook-URL limit and bounds
  // the per-row disk + per-delivery bandwidth amplification an
  // attacker could otherwise drive by submitting a multi-MB URL on
  // POST /wallets. The Joi length check runs before the custom
  // resolver so an oversize URL never reaches isValidWebhookUrl.
  webhookUrl: Joi.string().max(2048).custom((value, helpers) => {
    if (!config.WEBHOOKS_ENABLED) {
      return helpers.message({ custom: 'webhooks are not enabled on this instance' });
    }
    if (!isValidWebhookUrl(value)) {
      return helpers.message({ custom: 'webhookUrl must be a valid http(s) URL' });
    }
    return value;
  }).optional(),
});
