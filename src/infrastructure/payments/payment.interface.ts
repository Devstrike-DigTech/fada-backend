export interface InitializePaymentDto {
  email: string;
  amountKobo: number; // amount in kobo (NGN * 100)
  reference?: string;
  metadata?: Record<string, unknown>;
  callbackUrl?: string;
}

export interface InitializePaymentResult {
  authorizationUrl: string;
  reference: string;
  accessCode?: string;
}

export interface VerifyPaymentResult {
  status: 'success' | 'failed' | 'pending';
  reference: string;
  amountKobo: number;
  currency: string;
  paidAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface IPaymentProvider {
  initializePayment(dto: InitializePaymentDto): Promise<InitializePaymentResult>;
  verifyPayment(reference: string): Promise<VerifyPaymentResult>;
  cancelSubscription(subscriptionCode: string): Promise<void>;
}

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';
