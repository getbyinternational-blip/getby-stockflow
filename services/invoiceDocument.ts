import { Transaction } from '../types';

const normalizeDocumentNumber = (value: unknown) => String(value ?? '').trim();

const getMissingDocumentNumberMessage = (transaction: Transaction) => {
  const type = String(transaction.type || '').trim().toLowerCase();
  if (type === 'sale') {
    return 'Invoice number is missing for this sale. Reload the saved transaction and try again.';
  }
  if (type === 'return') {
    return 'Credit note number is missing for this return. Reload the saved transaction and try again.';
  }
  if (type === 'payment' || type === 'customer_credit' || type === 'customer_cash_out') {
    return 'Receipt number is missing for this transaction. Reload the saved transaction and try again.';
  }
  return 'Document number is missing for this transaction. Reload the saved transaction and try again.';
};

export const getTransactionDocumentNumber = (transaction: Transaction): string => {
  const type = String(transaction.type || '').trim().toLowerCase();
  if (type === 'sale') return normalizeDocumentNumber(transaction.invoiceNo);
  if (type === 'return') return normalizeDocumentNumber(transaction.creditNoteNo);
  if (type === 'payment' || type === 'customer_credit' || type === 'customer_cash_out') {
    return normalizeDocumentNumber(transaction.receiptNo);
  }
  return '';
};

export const requireTransactionDocumentNumber = (transaction: Transaction): string => {
  const documentNumber = getTransactionDocumentNumber(transaction);
  if (documentNumber) return documentNumber;
  throw new Error(getMissingDocumentNumberMessage(transaction));
};
