import { pb } from '@/lib/pocketbase';

export type VerifyOrderPaymentResponse = {
  confirmed: boolean;
  status?: 'pending' | 'confirmed' | 'expired' | 'failed';
  txid?: string;
  license?: { id?: string; code?: string };
  message?: string;
};

export async function verifyOrderPayment(orderId: string): Promise<VerifyOrderPaymentResponse> {
  const path = (import.meta as any).env?.VITE_PAYMENT_VERIFY_PATH || '/api/verify-order';
  const base = pb.baseUrl.replace(/\/$/, '');
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = pb.authStore?.token;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ orderId }),
  });

  const contentType = res.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await res.json().catch(() => null) : await res.text().catch(() => null);

  if (!res.ok) {
    const msg = typeof payload === 'string'
      ? payload
      : (payload?.message || payload?.error || `HTTP ${res.status}`);
    throw new Error(msg);
  }

  if (typeof payload === 'string') {
    throw new Error('verify endpoint returned non-json response');
  }

  return payload as VerifyOrderPaymentResponse;
}
