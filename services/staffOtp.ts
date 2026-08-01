const STAFF_OTP_API_BASE_URL = 'https://whatsapp.indiantrendstore.in';
const STAFF_OTP_DEBUG_LOGS_ENABLED = String((import.meta as any)?.env?.VITE_DEBUG_AUTH_LOGS || 'false').toLowerCase() === 'true'
  || String((import.meta as any)?.env?.VITE_DEBUG_STAFF_OTP_LOGS || 'false').toLowerCase() === 'true';

const makeOtpRequestId = (path: string) => `otp-${path.includes('/verify') ? 'verify' : 'send'}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const maskEmail = (value?: string) => {
  const text = String(value || '').trim();
  if (!text.includes('@')) return text ? '***' : '';
  const [local, domain] = text.split('@');
  const safeLocal = local.length <= 2 ? `${local.slice(0, 1)}***` : `${local.slice(0, 2)}***`;
  return `${safeLocal}@${domain}`;
};
const maskOtp = (value?: unknown) => {
  const text = String(value ?? '').trim();
  return text ? `${'*'.repeat(Math.max(0, text.length - 2))}${text.slice(-2)}` : '';
};
const logStaffOtpDebug = (event: string, payload: Record<string, unknown>) => {
  if (!STAFF_OTP_DEBUG_LOGS_ENABLED) return;
  console.log(`[staff-otp] ${event}`, payload);
};

const parseErrorMessage = (payload: any, fallback: string): string => {
  if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error;
  if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message;
  if (typeof payload?.code === 'string' && payload.code.trim()) return payload.code;
  return fallback;
};

const postJson = async <T>(path: string, body: Record<string, unknown>, fallbackError: string): Promise<T> => {
  const requestId = makeOtpRequestId(path);
  const startedAt = Date.now();
  const url = `${STAFF_OTP_API_BASE_URL}${path}`;
  logStaffOtpDebug('request.start', {
    requestId,
    url,
    method: 'POST',
    body: {
      email: maskEmail(String(body.email || '')),
      otp: maskOtp(body.otp),
    },
  });
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    logStaffOtpDebug('request.network_error', {
      requestId,
      url,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error || ''),
    });
    throw new Error('Could not reach OTP server. Please check backend status or internet connection.');
  }

  const payload = await response.json().catch(() => ({}));
  logStaffOtpDebug('request.response', {
    requestId,
    url,
    status: response.status,
    ok: response.ok,
    durationMs: Date.now() - startedAt,
    payload,
  });
  if (response.status === 429) {
    throw new Error('Too many attempts. Please wait and try again.');
  }
  if (!response.ok) {
    const parsedError = parseErrorMessage(payload, fallbackError);
    logStaffOtpDebug('request.failed', {
      requestId,
      url,
      status: response.status,
      error: parsedError,
    });
    throw new Error(parsedError);
  }
  logStaffOtpDebug('request.success', {
    requestId,
    url,
    status: response.status,
    durationMs: Date.now() - startedAt,
  });
  return payload as T;
};

export const sendStaffOtp = async (
  email: string,
): Promise<{ ok?: boolean; success?: boolean; message?: string; expiresInSeconds?: number; expiresAt?: string }> => (
  postJson('/api/staff-otp/send', { email }, 'Unable to send verification code.')
);

export const verifyStaffOtp = async (
  email: string,
  otp: string,
): Promise<{ ok?: boolean; success?: boolean; message?: string }> => (
  postJson('/api/staff-otp/verify', { email, otp }, 'Invalid OTP')
);
