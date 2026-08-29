import { Customer, StoreProfile, Transaction } from '../types';
import { getFriendlyErrorMessage } from './errorMessages';
import { getConfiguredMetaWhatsAppServerUrl, getOfficialWhatsAppConfigDiagnostics, sendInvoiceViaMetaWhatsApp, sendStatementPdfViaMetaWhatsApp } from './metaWhatsAppStatus';
import { normalizeTransactionItems } from '../utils/transactionItems';
import { requireTransactionDocumentNumber } from './invoiceDocument';

export type MetaWhatsAppShareResult = {
  ok: boolean;
  reason: 'META_WHATSAPP_NOT_CONFIGURED' | 'META_WHATSAPP_KEY_MISSING' | 'META_WHATSAPP_PHONE_MISSING' | 'META_WHATSAPP_FILE_MISSING' | 'META_WHATSAPP_SEND_FAILED' | 'META_WHATSAPP_SENT';
  message: string;
  whatsappMessageId?: string;
  whatsappMediaId?: string;
  backendUrl?: string;
};

const safeAmount = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getPaymentMethodLabel = (transaction: Transaction) => {
  if (transaction.paymentMethod && String(transaction.paymentMethod).trim()) return String(transaction.paymentMethod);
  const settlement = transaction.saleSettlement;
  if (settlement) {
    const hasCash = safeAmount(settlement.cashPaid) > 0;
    const hasOnline = safeAmount(settlement.onlinePaid) > 0;
    const hasCredit = safeAmount(settlement.creditDue) > 0;
    const kinds = [hasCash, hasOnline, hasCredit].filter(Boolean).length;
    if (kinds > 1) return 'Mixed';
    if (hasOnline) return 'Online';
    if (hasCredit) return 'Credit';
  }
  return 'Cash';
};

const buildStoreAddress = (profile?: Partial<StoreProfile> | null) => {
  return [profile?.addressLine1 || '', profile?.addressLine2 || '']
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(', ');
};

const blobToBase64 = async (blob: Blob) => {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('Failed to read PDF blob.'));
    reader.readAsDataURL(blob);
  });
  return dataUrl.replace(/^data:application\/pdf;base64,/, '');
};
const buildMetaInvoicePayload = (
  transaction: Transaction,
  customers: Customer[],
  profile?: Partial<StoreProfile> | null,
) => {
  const customer = customers.find((entry) => entry.id === transaction.customerId);
  const customerName = String(transaction.customerName || customer?.name || 'Customer').trim();
  const customerPhone = String(transaction.customerPhone || customer?.phone || '').trim();
  const invoiceNo = requireTransactionDocumentNumber(transaction);
  const paymentMethod = getPaymentMethodLabel(transaction);
  const normalizedItems = normalizeTransactionItems(transaction.items);
  const subtotal = Math.max(0, safeAmount(transaction.subtotal, Math.abs(safeAmount(transaction.total))));
  const discount = Math.max(0, safeAmount(transaction.discount));
  const tax = Math.max(0, safeAmount(transaction.tax));
  const total = Math.max(0, Math.abs(safeAmount(transaction.total)));
  const creditDue = Math.max(
    0,
    safeAmount(transaction.saleSettlement?.creditDue, safeAmount(transaction.receivableIncrease, 0)),
  );

  return {
    to: customerPhone,
    customerName,
    customerPhone,
    storeName: String(profile?.storeName || 'Stockflow').trim() || 'Stockflow',
    storePhone: String(profile?.phone || '').trim(),
    storeAddress: buildStoreAddress(profile),
    storeGstin: String(profile?.gstin || '').trim(),
    invoiceNo,
    invoiceDate: String(transaction.date || transaction.effectiveAt || new Date().toISOString()),
    invoiceAmount: total,
    paymentMethod,
    creditDue,
    items: normalizedItems.map((item) => {
      const qty = Math.max(0, safeAmount(item.quantity, 0));
      const rate = Math.max(0, safeAmount(item.sellPrice, 0));
      const grossAmount = qty * rate;
      const discountAmount = Math.max(0, safeAmount(item.discountAmount, 0));
      return {
        name: String(item.name || 'Item').trim() || 'Item',
        qty,
        rate,
        amount: Math.max(0, grossAmount - discountAmount),
      };
    }),
    subtotal,
    discount,
    tax,
    total,
  };
};

export const shareTransactionInvoiceViaMetaWhatsApp = async (
  transaction: Transaction,
  customers: Customer[],
  profile?: Partial<StoreProfile> | null,
): Promise<MetaWhatsAppShareResult> => {
  const configuredUrl = getConfiguredMetaWhatsAppServerUrl();
  if (!configuredUrl) {
    const diagnostics = getOfficialWhatsAppConfigDiagnostics();
    return {
      ok: false,
      reason: 'META_WHATSAPP_NOT_CONFIGURED',
      message: `Official WhatsApp backend URL is not configured. Missing env: ${diagnostics.missingVars.join(', ') || 'VITE_META_WHATSAPP_SERVER_URL'}.`,
    };
  }

  const publicKey = String(import.meta.env.VITE_META_WHATSAPP_BACKEND_PUBLIC_KEY || '').trim();
  if (!publicKey) {
    return {
      ok: false,
      reason: 'META_WHATSAPP_KEY_MISSING',
      message: 'Official WhatsApp backend key is not configured. Missing env: VITE_META_WHATSAPP_BACKEND_PUBLIC_KEY.',
    };
  }

  const payload = buildMetaInvoicePayload(transaction, customers, profile);
  if (!payload.customerPhone) {
    return {
      ok: false,
      reason: 'META_WHATSAPP_PHONE_MISSING',
      message: 'Customer phone number is missing.',
    };
  }

  try {
    const response = await sendInvoiceViaMetaWhatsApp(payload);
    return {
      ok: true,
      reason: 'META_WHATSAPP_SENT',
      message: response.message || 'Message accepted by WhatsApp',
      whatsappMessageId: response.whatsappMessageId,
      whatsappMediaId: response.whatsappMediaId,
      backendUrl: configuredUrl,
    };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : getFriendlyErrorMessage(error, 'whatsapp.meta_invoice');

    return {
      ok: false,
      reason: 'META_WHATSAPP_SEND_FAILED',
      message,
      backendUrl: configuredUrl,
    };
  }
};
export const shareStatementPdfViaMetaWhatsApp = async ({
  phone,
  fileName,
  pdfBlob,
}: {
  phone?: string | null;
  fileName: string;
  pdfBlob: Blob | null;
}): Promise<MetaWhatsAppShareResult> => {
  const configuredUrl = getConfiguredMetaWhatsAppServerUrl();
  if (!configuredUrl) {
    const diagnostics = getOfficialWhatsAppConfigDiagnostics();
    return {
      ok: false,
      reason: 'META_WHATSAPP_NOT_CONFIGURED',
      message: `Official WhatsApp backend URL is not configured. Missing env: ${diagnostics.missingVars.join(', ') || 'VITE_META_WHATSAPP_SERVER_URL'}.`,
    };
  }

  const publicKey = String(import.meta.env.VITE_META_WHATSAPP_BACKEND_PUBLIC_KEY || '').trim();
  if (!publicKey) {
    return {
      ok: false,
      reason: 'META_WHATSAPP_KEY_MISSING',
      message: 'Official WhatsApp backend key is not configured. Missing env: VITE_META_WHATSAPP_BACKEND_PUBLIC_KEY.',
    };
  }

  const to = String(phone || '').trim();
  if (!to) {
    return {
      ok: false,
      reason: 'META_WHATSAPP_PHONE_MISSING',
      message: 'Phone number is missing.',
    };
  }

  if (!(pdfBlob instanceof Blob)) {
    return {
      ok: false,
      reason: 'META_WHATSAPP_FILE_MISSING',
      message: 'Ledger PDF could not be generated.',
      backendUrl: configuredUrl,
    };
  }

  try {
    const pdfBase64 = await blobToBase64(pdfBlob);
    const response = await sendStatementPdfViaMetaWhatsApp({
      to,
      fileName,
      pdfBase64,
    });
    return {
      ok: true,
      reason: 'META_WHATSAPP_SENT',
      message: response.message || 'Message accepted by WhatsApp',
      whatsappMessageId: response.whatsappMessageId,
      whatsappMediaId: response.whatsappMediaId,
      backendUrl: configuredUrl,
    };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : getFriendlyErrorMessage(error, 'whatsapp.meta_statement');

    return {
      ok: false,
      reason: 'META_WHATSAPP_SEND_FAILED',
      message,
      backendUrl: configuredUrl,
    };
  }
};
