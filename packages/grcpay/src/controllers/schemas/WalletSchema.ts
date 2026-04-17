import Joi from 'joi';
import { WalletMode } from '../../models/Wallet';

interface WalletAttributes {
  amountRequired: number;
  recipient?: string;
  mode?: WalletMode;
  lifespanSeconds?: number;
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
  amountRequired: Joi.number().required().positive(),
  recipient: Joi.string().optional().length(34).pattern(
    /^[1-9A-HJ-NP-Za-km-z]{34}$/,
    'base58 address',
  ),
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
});
