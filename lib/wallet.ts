import walletJson from "../data/customers.json";

export type LockReason =
  | "suspected_fraud"
  | "lost_card"
  | "security_review"
  | null;

export type WalletTransaction = {
  id: string;
  type: "fee" | "transfer";
  amountCents: number;
  status: "completed" | "refunded" | "reversed";
  description: string;
  feeRefunded?: boolean;
  recipientReceived?: boolean;
};

export type WalletAccount = {
  id: string;
  name: string;
  balanceCents: number;
  dailyLimitCents: number;
  lock: { locked: boolean; reason: LockReason };
  transactions: WalletTransaction[];
};

export type Wallet = {
  customers: WalletAccount[];
};

export type WalletMutation =
  | {
      type: "refund_fee";
      customerId: string;
      transactionId: string;
      amountCents: number;
    }
  | { type: "reverse_transaction"; customerId: string; transactionId: string }
  | { type: "raise_limit"; customerId: string; newDailyLimitCents: number }
  | { type: "unlock_account"; customerId: string };

export type WalletErrorCode =
  | "account_not_found"
  | "transaction_not_found"
  | "already_done"
  | "amount_mismatch"
  | "already_unlocked";

export class WalletError extends Error {
  constructor(readonly code: WalletErrorCode) {
    super(code);
    this.name = "WalletError";
  }
}

export function loadWallet(): Wallet {
  return structuredClone(walletJson) as unknown as Wallet;
}

export function findAccount(
  wallet: Wallet,
  customerId: string
): WalletAccount | undefined {
  return wallet.customers.find((customer) => customer.id === customerId);
}

export function findTransaction(
  wallet: Wallet,
  transactionId: string
): { account: WalletAccount; transaction: WalletTransaction } | undefined {
  for (const account of wallet.customers) {
    const transaction = account.transactions.find(
      (candidate) => candidate.id === transactionId
    );

    if (transaction) return { account, transaction };
  }

  return undefined;
}

export function applyMutation(
  wallet: Wallet,
  mutation: WalletMutation
): Wallet {
  const next = structuredClone(wallet);
  const account = next.customers.find(
    (customer) => customer.id === mutation.customerId
  );

  if (!account) throw new WalletError("account_not_found");

  switch (mutation.type) {
    case "refund_fee": {
      const transaction = account.transactions.find(
        (candidate) => candidate.id === mutation.transactionId
      );

      if (!transaction || transaction.type !== "fee") {
        throw new WalletError("transaction_not_found");
      }

      if (transaction.feeRefunded) throw new WalletError("already_done");
      if (transaction.amountCents !== mutation.amountCents) {
        throw new WalletError("amount_mismatch");
      }

      transaction.feeRefunded = true;
      transaction.status = "refunded";
      account.balanceCents += transaction.amountCents;
      return next;
    }

    case "reverse_transaction": {
      const transaction = account.transactions.find(
        (candidate) => candidate.id === mutation.transactionId
      );

      if (!transaction || transaction.type !== "transfer") {
        throw new WalletError("transaction_not_found");
      }

      if (transaction.status === "reversed") {
        throw new WalletError("already_done");
      }

      transaction.status = "reversed";
      account.balanceCents += transaction.amountCents;
      return next;
    }

    case "raise_limit": {
      account.dailyLimitCents = mutation.newDailyLimitCents;
      return next;
    }

    case "unlock_account": {
      if (!account.lock.locked) throw new WalletError("already_unlocked");

      account.lock = { locked: false, reason: null };
      return next;
    }
  }
}
