import { useEffect, useMemo, useState } from 'react';
import { pb } from '@/lib/pocketbase';
import { useAuth } from '@/components/auth-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { HugeiconsIcon } from '@hugeicons/react';
import { RefreshIcon, Copy01Icon } from '@hugeicons/core-free-icons';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Order {
  id: string;
  user: string;
  address: string;
  amount: string;
  status: 'pending' | 'confirmed' | 'expired' | 'failed';
  expires_at: string;
  txid?: string;
  license_key?: string;
  created?: string;
  updated?: string;
  chain?: string;
  token?: string;
  expand?: { user?: { id: string; email?: string }; license_key?: { id: string; code: string } };
}

const statusText: Record<Order['status'], string> = {
  pending: '待支付',
  confirmed: '已确认',
  expired: '已过期',
  failed: '失败',
};

const statusTone: Record<Order['status'], string> = {
  pending: 'bg-amber-50 text-amber-700 border border-amber-100',
  confirmed: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  expired: 'bg-neutral-100 text-neutral-500 border border-neutral-200',
  failed: 'bg-red-50 text-red-700 border border-red-100',
};

const normalizeOrder = (o: Order): Order => {
  if (o.license_key && o.status !== 'confirmed') return { ...o, status: 'confirmed' };
  return o;
};

export function Orders() {
  const { user, isSuperAdmin } = useAuth();
  const [items, setItems] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [query, setQuery] = useState('');
  type ToastVariant = 'success' | 'error' | 'warning' | 'info';
  const [toasts, setToasts] = useState<{ id: number; title: string; description?: string; variant: ToastVariant }[]>([]);
  const pushToast = (params: { title: string; description?: string; variant?: ToastVariant }) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, title: params.title, description: params.description, variant: params.variant || 'info' }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 2400);
  };
  const payAddress = useMemo(() => selected?.address || '', [selected]);
  const [licenseCode, setLicenseCode] = useState<string>('');
  const normalizedSelected = useMemo(() => selected ? normalizeOrder(selected) : null, [selected]);
  const isConfirmed = normalizedSelected?.status === 'confirmed';

  const genLicenseCode = () => {
    const rand = () => Math.random().toString(36).replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 4).padEnd(4, 'X');
    return `${rand()}-${rand()}-${rand()}-${rand()}-${rand()}`;
  };

  useEffect(() => {
    const loadLicense = async () => {
      setLicenseCode('');
      if (!selected?.license_key) {
        if (selected?.expand?.license_key?.code) setLicenseCode(selected.expand.license_key.code);
        return;
      }
      try {
        const lic = await pb.collection('license_keys').getOne(selected.license_key, { $autoCancel: false });
        setLicenseCode(lic.code);
      } catch (err) {
        console.warn('load license code failed', err);
        setLicenseCode('');
      }
    };
    loadLicense();
  }, [selected?.license_key]);

  const safeCopy = async (text: string) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      pushToast({ title: '已复制地址', variant: 'success' });
    } catch (err) {
      console.error('copy failed', err);
      pushToast({ title: '复制失败', description: '请手动复制地址', variant: 'error' });
    }
  };

  const fetchJsonWithFallback = async (url: string, init?: RequestInit) => {
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    const directHeaders = { Accept: 'application/json', ...(init?.headers || {}) };
    const proxies = [
      (u: string) => `https://r.jina.ai/${u}`,
      (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
      (u: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
      (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
      (u: string) => `https://thingproxy.freeboard.io/fetch/${u}`,
    ];

    const tryParse = async (res: Response) => {
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) return res.json();
      const text = await res.text();
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      throw new Error('json parse failed');
    };

    try {
      const direct = await fetch(normalized, { ...init, cache: 'no-store', headers: directHeaders });
      if (direct.ok) return await tryParse(direct);
    } catch (err) {
      // fall through to proxies when CORS blocks direct
    }

    for (const makeUrl of proxies) {
      const u = makeUrl(normalized);
      try {
        const res = await fetch(u, { ...init, cache: 'no-store', headers: init?.headers });
        if (res.ok) {
          if (u.includes('/get?')) {
            const json = await res.json();
            if (json?.contents) {
              const match = String(json.contents).match(/\{[\s\S]*\}/);
              if (match) return JSON.parse(match[0]);
              continue;
            }
          }
          return await tryParse(res);
        }
      } catch (err) {
        // try next proxy
      }
    }

    throw new Error('fetch failed');
  };

  const fetchOrders = async () => {
    if (!user) return;
    setLoading(true);
    try {
      if (isSuperAdmin) {
        const res = await pb.collection('orders').getFullList<Order>({
          sort: '-created',
          expand: 'user,license_key',
          $autoCancel: false,
        });
        setItems(res.map(normalizeOrder));
      } else {
        const res = await pb.collection('orders').getList<Order>(1, 50, {
          filter: `user = "${user.id}"`,
          sort: '-created',
          $autoCancel: false,
        });
        setItems(res.items.map(normalizeOrder));
      }
    } catch (error) {
      console.error('load orders failed', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const filtered = useMemo(() => {
    if (!isSuperAdmin || !query.trim()) return items;
    const q = query.trim().toLowerCase();
    return items.filter(o => {
      const idMatch = o.id?.toLowerCase().includes(q);
      const userMatch = o.expand?.user?.email?.toLowerCase().includes(q) || o.expand?.user?.id?.toLowerCase().includes(q);
      return idMatch || userMatch;
    });
  }, [items, query, isSuperAdmin]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">支付订单</h1>
          <p className="mt-2 text-neutral-600 dark:text-neutral-400">查看您创建的支付订单记录（待支付/已确认/过期/失败）</p>
        </div>
        <div className="flex items-center gap-2">
          {isSuperAdmin && (
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索用户邮箱/ID或订单号"
              className="w-64 h-9"
            />
          )}
          <Button variant="outline" size="icon" onClick={fetchOrders} disabled={loading}>
            <HugeiconsIcon icon={RefreshIcon} className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-neutral-50/50 dark:bg-neutral-950/50">
              <TableHead className="px-4 w-[20%]">订单号</TableHead>
              {isSuperAdmin && <TableHead className="px-4 w-[16%]">用户</TableHead>}
              <TableHead className="px-4 w-[12%]">金额</TableHead>
              <TableHead className="px-4 w-[10%]">链</TableHead>
              <TableHead className="px-4 w-[12%]">状态</TableHead>
              <TableHead className="px-4 w-[14%]">过期时间</TableHead>
              <TableHead className="px-4 w-[14%]">创建时间</TableHead>
              <TableHead className="px-4 w-[16%]">交易哈希</TableHead>
              <TableHead className="px-4 w-[12%]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={isSuperAdmin ? 9 : 8} className="py-12 text-center text-neutral-400">加载中...</TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isSuperAdmin ? 9 : 8} className="py-12 text-center text-neutral-400">暂无订单记录</TableCell>
              </TableRow>
            ) : (
              filtered.map(order => (
                <TableRow key={order.id} className="hover:bg-blue-50/30 dark:hover:bg-blue-900/5 transition-colors">
                  <TableCell className="px-4 font-mono text-sm">{order.id}</TableCell>
                  {isSuperAdmin && (
                    <TableCell className="px-4 text-sm">{order.expand?.user?.email || order.user}</TableCell>
                  )}
                  <TableCell className="px-4 text-sm font-semibold">{order.amount} USDT</TableCell>
                  <TableCell className="px-4 text-sm">{order.chain || 'TRC20'}</TableCell>
                  <TableCell className="px-4">
                    <Badge className={`rounded-lg text-xs font-bold border-none px-2.5 py-1 ${statusTone[order.status]}`}>
                      {statusText[order.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-4 text-sm">{order.expires_at ? new Date(order.expires_at).toLocaleString() : '—'}</TableCell>
                  <TableCell className="px-4 text-sm">{order.created ? new Date(order.created).toLocaleString() : '—'}</TableCell>
                  <TableCell className="px-4 text-sm max-w-[200px] truncate" title={order.txid || ''}>{order.txid || '—'}</TableCell>
                  <TableCell className="px-4 text-sm">
                    <Button
                      size="sm"
                      variant="outline"
                      className={(order.status === 'confirmed' || order.license_key) ? 'border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100' : ''}
                      onClick={() => setSelected(normalizeOrder(order))}
                    >
                      {(order.status === 'confirmed' || order.license_key) ? '已完成' : '再次校验/支付'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) { setSelected(null); setVerifying(false); setLicenseCode(''); } }}>
        <DialogContent className="max-w-xl" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>再次校验/支付</DialogTitle>
            <DialogDescription>使用该订单的地址与金额进行支付或重新校验。</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="text-sm text-neutral-600 dark:text-neutral-300 space-y-1">
              <div>订单号：<span className="font-mono text-xs">{selected?.id}</span></div>
              <div>金额：{selected?.amount} USDT（{selected?.chain || 'TRC20'}）</div>
              <div>状态：{normalizedSelected ? statusText[normalizedSelected.status] : '—'}</div>
              {licenseCode && (
                <div className="text-emerald-600 dark:text-emerald-300 font-medium">授权码：{licenseCode}</div>
              )}
              <div>地址：</div>
              <div className="font-mono text-sm break-all bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-md p-2 flex items-center justify-between gap-2">
                <span className="truncate">{payAddress || '—'}</span>
                <Button size="sm" variant="outline" type="button" onClick={() => payAddress && safeCopy(payAddress)}>
                  <HugeiconsIcon icon={Copy01Icon} className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {payAddress ? (
              <div className="flex justify-center">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(payAddress)}`}
                  alt="支付二维码"
                  className="h-64 w-64 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white"
                />
              </div>
            ) : null}

              <div className="text-sm text-neutral-500 space-y-1">
              <div>请按订单金额精确转账，付款后点击“已支付，去校验”。</div>
              {selected?.status === 'expired' && <div className="text-red-500">订单已过期，请重新创建新订单。</div>}
                {selected?.txid && <div className="text-neutral-500 break-all text-xs sm:text-sm">最新哈希：{selected.txid}</div>}
            </div>
          </div>

          <DialogFooter className="flex gap-2 sm:justify-end">
              <Button variant="secondary" onClick={() => { setSelected(null); setVerifying(false); setLicenseCode(''); }}>关闭</Button>
              {isSuperAdmin ? (
                <Button
                  disabled={!!licenseCode || !selected}
                  onClick={async () => {
                    if (!selected) return;
                    try {
                      const code = genLicenseCode();
                      const lic = await pb.collection('license_keys').create({
                        code,
                        user: selected.user,
                        status: 'unused',
                        purchased_at: new Date().toISOString(),
                        note: `order:${selected.id}`,
                      });
                      await pb.collection('orders').update(selected.id, { license_key: lic.id, status: 'confirmed' });
                      setItems(prev => prev.map(o => o.id === selected.id ? { ...o, status: 'confirmed', license_key: lic.id, expand: { ...o.expand, license_key: { id: lic.id, code: lic.code } } } : o));
                      setSelected(prev => prev ? { ...prev, status: 'confirmed', license_key: lic.id, expand: { ...prev.expand, license_key: { id: lic.id, code: lic.code } } } : prev);
                      setLicenseCode(lic.code);
                      pushToast({ title: '已生成授权码', description: lic.code, variant: 'success' });
                    } catch (err) {
                      console.error('admin create license failed', err);
                      pushToast({ title: '生成授权码失败', description: '请稍后再试', variant: 'error' });
                    }
                  }}
                >
                  {licenseCode ? '已发码' : '生成授权码'}
                </Button>
              ) : (
                <Button disabled={verifying || !selected || isConfirmed} onClick={async () => {
                  if (!selected) return;
                  if (isConfirmed) return;
                  if (!payAddress) {
                    pushToast({ title: '暂无收款地址', description: '请稍后再试或联系管理员。', variant: 'error' });
                    return;
                  }
                  if ((selected.chain || 'TRC20') !== 'TRC20') {
                    pushToast({ title: '暂不支持自动校验', description: 'ERC20 请联系管理员确认或手动核对。', variant: 'warning' });
                    return;
                  }
                  setVerifying(true);
                  try {
                    const usdtContract = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
                    const tronApiKey = import.meta.env.VITE_TRON_PRO_API_KEY;
                    const tronHeaders = tronApiKey ? { 'TRON-PRO-API-KEY': tronApiKey } : undefined;
                    const endpoints = [
                      `https://api.trongrid.io/v1/accounts/${payAddress}/transactions/trc20?only_to=true&contract_address=${usdtContract}&order_by=block_timestamp%2Cdesc&limit=50`,
                      `https://apilist.tronscanapi.com/api/token_trc20/transfers?limit=20&start=0&sort=-timestamp&toAddress=${payAddress}&contract_address=${usdtContract}`,
                      `https://apilist.tronscanapi.com/api/new/token_trc20/transfers?limit=20&start=0&sort=-timestamp&toAddress=${payAddress}&contract_address=${usdtContract}`,
                      `https://apilist.tronscanapi.com/api/token_trc20/transfers?toAddress=${payAddress}&contract_address=${usdtContract}`,
                    ];

                    let data: any = null;
                    for (const ep of endpoints) {
                      try {
                        data = await fetchJsonWithFallback(ep, tronHeaders ? { headers: tronHeaders } : undefined);
                        if (data) break;
                      } catch (err) {
                        // try next
                      }
                    }
                    if (!data) {
                      pushToast({
                        title: '自动校验被CORS拦截',
                        description: '请点击下方区块浏览器手动确认；如在正式环境请配置后端代理或设置 VITE_TRON_PRO_API_KEY。',
                        variant: 'warning',
                      });
                      return;
                    }
                    const transfers = data?.token_transfers || data?.data || [];
                    const match = transfers.find((t: any) => {
                      const to = (t.to || t.to_address || t.toAddress || '').toLowerCase();
                      const value = Number(t.value || t.amount || t.quant || 0);
                      const decimals = t.token_info?.decimals ?? t.tokenInfo?.decimals ?? 6;
                      const amount = value / Math.pow(10, decimals);
                      return to === payAddress.toLowerCase() && amount >= Number(selected.amount);
                    });
                    if (match) {
                      const txid = match.transaction_id || match.transactionID || match.txid || match.hash || match.txHash || '';
                      let licenseId = selected.license_key;
                      let licenseCodeLocal = licenseCode;

                      if (!licenseId) {
                        const code = genLicenseCode();
                        try {
                          const lic = await pb.collection('license_keys').create({
                            code,
                            user: selected.user,
                            status: 'unused',
                            purchased_at: new Date().toISOString(),
                            note: `order:${selected.id}`,
                          });
                          licenseId = lic.id;
                          licenseCodeLocal = lic.code;
                        } catch (createErr) {
                          console.warn('auto create license failed, please issue server-side', createErr);
                        }
                      }

                      await pb.collection('orders').update(selected.id, { status: 'confirmed', txid, license_key: licenseId });
                      setItems(prev => prev.map(o => o.id === selected.id ? { ...o, status: 'confirmed', txid, license_key: licenseId } : o));
                      setSelected(prev => prev ? { ...prev, status: 'confirmed', txid, license_key: licenseId || prev.license_key } : prev);
                      if (licenseCodeLocal) setLicenseCode(licenseCodeLocal);
                      pushToast({ title: '检测到入账', description: `订单已确认${licenseCodeLocal ? `，授权码：${licenseCodeLocal}` : ''}`, variant: 'success' });
                    } else {
                      pushToast({ title: '未检测到入账', description: '请稍后再试，或确认金额/链是否正确。', variant: 'warning' });
                    }
                  } catch (err) {
                    console.error('verify order failed', err);
                    pushToast({ title: '校验失败', description: '请稍后重试或联系客服。', variant: 'error' });
                  } finally {
                    setVerifying(false);
                  }
                }}>
                  {isConfirmed ? '已确认' : verifying ? '校验中...' : '已支付，去校验'}
                </Button>
              )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 简易提示 */}
      <div className="fixed bottom-6 right-6 z-50 space-y-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`min-w-[220px] rounded-xl px-4 py-3 shadow-lg text-sm border backdrop-blur bg-white/90 dark:bg-neutral-900/90 pointer-events-auto ${
              t.variant === 'success' ? 'border-emerald-200 text-emerald-700 dark:text-emerald-200' :
              t.variant === 'error' ? 'border-red-200 text-red-700 dark:text-red-200' :
              t.variant === 'warning' ? 'border-amber-200 text-amber-700 dark:text-amber-200' :
              'border-blue-200 text-blue-700 dark:text-blue-200'
            }`}
          >
            <div className="font-semibold">{t.title}</div>
            {t.description && <div className="text-xs mt-0.5 text-neutral-500 dark:text-neutral-400">{t.description}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
