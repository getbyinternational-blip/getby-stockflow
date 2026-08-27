export type MetaWhatsAppInvoiceRequest = {
  to: string;
  customerName: string;
  customerPhone: string;
  storeName: string;
  storePhone: string;
  storeAddress: string;
  storeGstin: string;
  invoiceNo: string;
  invoiceDate: string;
  invoiceAmount: number;
  paymentMethod: string;
  creditDue: number;
  items: Array<{
    name: string;
    qty: number;
    rate: number;
    amount: number;
  }>;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
};

export type MetaWhatsAppInvoiceResponse = {
  ok?: boolean;
  message?: string;
  whatsappMessageId?: string;
  whatsappMediaId?: string;
};

export type MetaWhatsAppStatementPdfRequest = {
  to: string;
  fileName: string;
  pdfBase64: string;
};

const DEV_META_WHATSAPP_SERVER_URL = 'http://localhost:3000';

export type OfficialWhatsAppConfigDiagnostics = {
  resolvedBaseUrl: string;
  hasExplicitUrlEnv: boolean;
  hasBackendKey: boolean;
  usingDevFallback: boolean;
  missingVars: Array<'VITE_META_WHATSAPP_SERVER_URL' | 'VITE_META_WHATSAPP_BACKEND_PUBLIC_KEY'>;
};

export const getOfficialWhatsAppConfigDiagnostics = (): OfficialWhatsAppConfigDiagnostics => {
  const rawUrl = String(import.meta.env.VITE_META_WHATSAPP_SERVER_URL || '').trim();
  const backendKey = String(import.meta.env.VITE_META_WHATSAPP_BACKEND_PUBLIC_KEY || '').trim();
  const hasExplicitUrlEnv = Boolean(rawUrl);
  const usingDevFallback = !hasExplicitUrlEnv && Boolean(import.meta.env.DEV);
  const resolvedBaseUrl = (hasExplicitUrlEnv ? rawUrl : (usingDevFallback ? DEV_META_WHATSAPP_SERVER_URL : ''))
    .trim()
    .replace(/\/$/, '');
  const hasBackendKey = Boolean(backendKey);
  const missingVars: Array<'VITE_META_WHATSAPP_SERVER_URL' | 'VITE_META_WHATSAPP_BACKEND_PUBLIC_KEY'> = [];
  if (!hasExplicitUrlEnv && !usingDevFallback) missingVars.push('VITE_META_WHATSAPP_SERVER_URL');
  if (!hasBackendKey) missingVars.push('VITE_META_WHATSAPP_BACKEND_PUBLIC_KEY');
  return {
    resolvedBaseUrl,
    hasExplicitUrlEnv,
    hasBackendKey,
    usingDevFallback,
    missingVars,
  };
};

const getMetaBaseUrl = () => {
  const diagnostics = getOfficialWhatsAppConfigDiagnostics();
  if (!diagnostics.resolvedBaseUrl) {
    throw new Error('Official WhatsApp backend URL is not configured. Missing env: VITE_META_WHATSAPP_SERVER_URL.');
  }
  return diagnostics.resolvedBaseUrl;
};

const getMetaPublicKey = () => {
  const value = String(import.meta.env.VITE_META_WHATSAPP_BACKEND_PUBLIC_KEY || '').trim();
  if (!value) throw new Error('Official WhatsApp backend key is not configured. Missing env: VITE_META_WHATSAPP_BACKEND_PUBLIC_KEY.');
  return value;
};

export const getConfiguredMetaWhatsAppServerUrl = () => {
  try {
    return getMetaBaseUrl();
  } catch {
    return '';
  }
};

export const sendInvoiceViaMetaWhatsApp = async (
  payload: MetaWhatsAppInvoiceRequest,
): Promise<MetaWhatsAppInvoiceResponse> => {
  const diagnostics = getOfficialWhatsAppConfigDiagnostics();
  const backendKey = getMetaPublicKey().trim();
  const finalUrl = `${getMetaBaseUrl()}/api/whatsapp/send-invoice`;
  console.info('[OFFICIAL_WHATSAPP_SEND][REQUEST]', {
    finalUrl,
    hasBackendKey: Boolean(backendKey),
    hasExplicitUrlEnv: diagnostics.hasExplicitUrlEnv,
    usingDevFallback: diagnostics.usingDevFallback,
    missingVars: diagnostics.missingVars,
    payloadSummary: {
      to: payload.to,
      invoiceNo: payload.invoiceNo,
      customerName: payload.customerName,
      itemsCount: Array.isArray(payload.items) ? payload.items.length : 0,
      total: payload.total,
      paymentMethod: payload.paymentMethod,
    },
  });

  let response: Response;
  try {
    response = await fetch(finalUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-stockflow-whatsapp-key': backendKey,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error('[OFFICIAL_WHATSAPP_SEND][FETCH_ERROR]', {
      finalUrl,
      hasBackendKey: Boolean(backendKey),
      hasExplicitUrlEnv: diagnostics.hasExplicitUrlEnv,
      usingDevFallback: diagnostics.usingDevFallback,
      missingVars: diagnostics.missingVars,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const text = await response.text();
  let data: MetaWhatsAppInvoiceResponse = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  console.info('[OFFICIAL_WHATSAPP_SEND][RESPONSE]', {
    finalUrl,
    status: response.status,
    ok: response.ok,
    data,
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('WhatsApp backend key is invalid. Check frontend Vercel env key.');
    }
    throw new Error(data?.message || 'Failed to send invoice via Official WhatsApp.');
  }

  return data;
};

export const sendStatementPdfViaMetaWhatsApp = async (
  payload: MetaWhatsAppStatementPdfRequest,
): Promise<MetaWhatsAppInvoiceResponse> => {
  const backendKey = getMetaPublicKey().trim();
  const finalUrl = `${getMetaBaseUrl()}/api/whatsapp/send-statement-pdf`;

  let response: Response;
  try {
    response = await fetch(finalUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-stockflow-whatsapp-key': backendKey,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not reach Official WhatsApp statement backend at ${finalUrl}. ${detail}`);
  }

  const text = await response.text();
  let data: MetaWhatsAppInvoiceResponse = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!response.ok || data?.ok === false) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('WhatsApp backend key is invalid. Check frontend Vercel env key.');
    }
    throw new Error(data?.message || 'Failed to send ledger statement PDF via Official WhatsApp.');
  }

  return {
    ...data,
    ok: data?.ok ?? true,
    message: data?.message || 'Statement PDF accepted by WhatsApp',
  };
};