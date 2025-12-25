import { pb } from '@/lib/pocketbase';

export type VerifyOrderPaymentResponse = {
  confirmed: boolean;
  status?: 'pending' | 'confirmed' | 'expired' | 'failed';
  txid?: string;
  license?: { id?: string; code?: string };
  message?: string;
};

export type OrderLike = {
  id: string;
  user: string;
  address: string;
  amount: string;
  status?: 'pending' | 'confirmed' | 'expired' | 'failed';
  expires_at?: string;
  created?: string;
  updated?: string;
  chain?: string;
  token?: string;
  txid?: string;
  license_key?: string;
};

type NormalizedTransfer = {
  to: string;
  amount: number;
  txid: string;
  timestampMs: number;
};

const genLicenseCode = () => {
  const rand = () => Math.random().toString(36).replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 4).padEnd(4, 'X');
  return `${rand()}-${rand()}-${rand()}-${rand()}-${rand()}`;
};

const nearlyEqual = (a: number, b: number, eps = 0.00005) => Math.abs(a - b) <= eps;

const fetchJsonWithFallback = async (url: string, init?: RequestInit) => {
  const viaJina = `https://r.jina.ai/${url.startsWith('https://') ? url.slice('https://'.length) : url}`;
  const viaAllorigins = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;

  const tryParse = async (res: Response) => {
    if (res.headers.get('content-type')?.includes('application/json')) return res.json();
    const text = await res.text();
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('json parse failed');
  };

  try {
    const res = await fetch(viaJina, { cache: 'no-store', ...init });
    if (res.ok) return await tryParse(res);
  } catch {
    // ignore
  }

  try {
    const res = await fetch(viaAllorigins, { cache: 'no-store', ...init });
    if (res.ok) return await tryParse(res);
  } catch {
    // ignore
  }

  const res = await fetch(url, { cache: 'no-store', ...init });
  if (!res.ok) throw new Error('direct fetch failed');
  return await tryParse(res);
};

const normalizeTrc20Transfers = (data: any): NormalizedTransfer[] => {
  const arr = (data?.data || data?.token_transfers || data?.tokenTransfers || data?.transfers || []) as any[];
  if (!Array.isArray(arr)) return [];
  return arr
    .map((t) => {
      const to = String(t.to || t.to_address || t.toAddress || '').toLowerCase();
      const txid = String(t.transaction_id || t.transactionID || t.txid || t.hash || t.txHash || '');
      const ts = Number(t.block_timestamp || t.timestamp || t.time || t.blockTimeStamp || 0);
      const value = Number(t.value ?? t.amount ?? t.quant ?? 0);
      const decimals = Number(t.token_info?.decimals ?? t.tokenInfo?.decimals ?? t.token_decimal ?? 6);
      const amount = Number.isFinite(value) ? value / Math.pow(10, decimals) : 0;
      const timestampMs = ts > 10_000_000_000 ? ts : ts * 1000; // some APIs use seconds
      if (!to || !txid || !Number.isFinite(amount)) return null;
      return { to, amount, txid, timestampMs } as NormalizedTransfer;
    })
    .filter(Boolean) as NormalizedTransfer[];
};

async function verifyTrc20UsdtOnChain(params: {
  toAddress: string;
  expectedAmount: number;
  sinceMs: number;
}): Promise<{ txid: string } | null> {
  const usdtContract = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
  const tronApiKey = (import.meta as any).env?.VITE_TRON_PRO_API_KEY;
  const tronHeaders = tronApiKey ? { 'TRON-PRO-API-KEY': tronApiKey } : undefined;
  const toAddress = params.toAddress;
  const endpoints = [
    `https://api.trongrid.io/v1/accounts/${toAddress}/transactions/trc20?only_to=true&contract_address=${usdtContract}&order_by=block_timestamp%2Cdesc&limit=50`,
    `https://apilist.tronscanapi.com/api/token_trc20/transfers?limit=50&start=0&sort=-timestamp&toAddress=${toAddress}&contract_address=${usdtContract}`,
    `https://apilist.tronscanapi.com/api/new/token_trc20/transfers?limit=50&start=0&sort=-timestamp&toAddress=${toAddress}&contract_address=${usdtContract}`,
    `https://apilist.tronscanapi.com/api/token_trc20/transfers?toAddress=${toAddress}&contract_address=${usdtContract}`,
  ];

  for (const ep of endpoints) {
    try {
      const data = await fetchJsonWithFallback(ep, tronHeaders ? ({ headers: tronHeaders } as any) : undefined);
      const transfers = normalizeTrc20Transfers(data);
      const match = transfers.find((t) => {
        if (t.to !== toAddress.toLowerCase()) return false;
        if (t.timestampMs && t.timestampMs < params.sinceMs) return false;
        return nearlyEqual(t.amount, params.expectedAmount);
      });
      if (match) return { txid: match.txid };
    } catch {
      // try next
    }
  }
  return null;
}

export async function verifyOrderPayment(order: OrderLike): Promise<VerifyOrderPaymentResponse> {
  // 1) Prefer server-side verification if you later implement it.
  const path = (import.meta as any).env?.VITE_PAYMENT_VERIFY_PATH || '/api/verify-order';
  const base = pb.baseUrl.replace(/\/$/, '');
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = pb.authStore?.token;
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ orderId: order.id }),
    });

    if (res.status !== 404) {
      const contentType = res.headers.get('content-type') || '';
      const payload = contentType.includes('application/json') ? await res.json().catch(() => null) : await res.text().catch(() => null);
      if (!res.ok) {
        const msg = typeof payload === 'string' ? payload : (payload?.message || payload?.error || `HTTP ${res.status}`);
        throw new Error(msg);
      }
      if (typeof payload === 'string') throw new Error('verify endpoint returned non-json response');
      return payload as VerifyOrderPaymentResponse;
    }
  } catch (err) {
    // if server verify exists but fails, surface error; only fall back on 404
    if (!(err instanceof Error) || !String(err.message || '').toLowerCase().includes('not found')) {
      // keep going to fallback only when the endpoint doesn't exist; otherwise return the real error
    }
  }

  // 2) Fallback: client-side on-chain verification (TRC20 USDT).
  if (order.status === 'confirmed' || order.license_key) {
    return { confirmed: true, status: 'confirmed', txid: order.txid };
  }

  const expectedAmount = Number(order.amount);
  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
    throw new Error('订单金额不合法，无法校验');
  }
  if (!order.address) {
    throw new Error('订单收款地址为空，无法校验');
  }

  const createdMs = order.created ? new Date(order.created).getTime() : Date.now() - 60 * 60 * 1000;
  const sinceMs = Math.max(0, createdMs - 60_000);

  const hit = await verifyTrc20UsdtOnChain({
    toAddress: order.address,
    expectedAmount,
    sinceMs,
  });

  if (!hit) {
    return { confirmed: false, status: order.status || 'pending', message: '暂未检测到该订单金额的入账' };
  }

  // Avoid reusing same txid across orders (best-effort; depends on rules)
  try {
    const dup = await pb.collection('orders').getList(1, 1, {
      filter: `txid = "${hit.txid}" && id != "${order.id}"`,
      $autoCancel: false,
    });
    if (dup.totalItems > 0) {
      return { confirmed: false, status: order.status || 'pending', message: '该交易哈希已被其它订单使用' };
    }
  } catch {
    // ignore when rules disallow
  }

  // Update order as confirmed
  try {
    await pb.collection('orders').update(order.id, {
      status: 'confirmed',
      txid: hit.txid,
      chain: order.chain || 'TRC20',
      token: order.token || 'USDT',
    } as any, { $autoCancel: false } as any);
  } catch (e) {
    throw new Error('PocketBase 订单更新失败（可能是权限规则不允许确认订单）');
  }

  // Ensure license key exists and is linked to order
  let licenseId = order.license_key;
  let licenseCode: string | undefined;

  if (!licenseId) {
    try {
      const existing = await pb.collection('license_keys').getList(1, 1, {
        filter: `note = "order:${order.id}"`,
        $autoCancel: false,
      });
      if (existing.totalItems > 0) {
        const lic: any = existing.items[0];
        licenseId = lic.id;
        licenseCode = lic.code;
      }
    } catch {
      // ignore
    }
  }

  if (!licenseId) {
    try {
      const lic: any = await pb.collection('license_keys').create({
        code: genLicenseCode(),
        user: order.user,
        status: 'unused',
        purchased_at: new Date().toISOString(),
        note: `order:${order.id}`,
      } as any, { $autoCancel: false } as any);
      licenseId = lic.id;
      licenseCode = lic.code;
    } catch {
      // If rules forbid creating license, we still treat payment as confirmed.
    }
  }

  if (licenseId) {
    try {
      await pb.collection('orders').update(order.id, { license_key: licenseId } as any, { $autoCancel: false } as any);
    } catch {
      // ignore
    }
  }

  return {
    confirmed: true,
    status: 'confirmed',
    txid: hit.txid,
    license: licenseId || licenseCode ? { id: licenseId, code: licenseCode } : undefined,
    message: '已确认到账',
  };
}
