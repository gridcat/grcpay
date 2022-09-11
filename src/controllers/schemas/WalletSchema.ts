import Joi from 'joi';

interface WalletAttributes {
  amountRequired: number;
  recipient?: string;
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
  amountRequired: Joi.number().required(),
  recipient: Joi.string().optional().length(34),
});
