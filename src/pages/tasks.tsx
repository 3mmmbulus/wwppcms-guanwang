import { useEffect, useMemo, useState } from 'react';
import { pb } from '@/lib/pocketbase';
import { cn } from '@/lib/utils';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Search01Icon,
  RefreshIcon,
  Bookmark01Icon,
  CheckmarkCircle01Icon,
  Delete01Icon,
  HourglassIcon,
  Copy01Icon,
} from '@hugeicons/core-free-icons';

interface LicenseKey {
  id: string;
  code: string;
  status: 'unused' | 'used' | 'banned' | 'expired';
  expires_at?: string;
  server_uid?: string;
  server_ip?: string;
  purchased_at?: string;
  first_used_at?: string;
  note?: string;
}

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
}

type ToastVariant = 'success' | 'error' | 'info' | 'warning';
interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

const statusMap: Record<LicenseKey['status'], { label: string; color: string; icon: any }> = {
  unused: { label: '未使用', color: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-300', icon: Bookmark01Icon },
  used: { label: '已使用', color: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-300', icon: CheckmarkCircle01Icon },
  banned: { label: '已封禁', color: 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-300', icon: Delete01Icon },
  expired: { label: '已过期', color: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-300', icon: HourglassIcon },
};

export function Tasks() {
  const { user } = useAuth();

  const PAY_ADDRESS = 'TNo5GoG5bV2ahj6XjS7rBwrA4WVhqEmNU9';
  const [payBase, setPayBase] = useState(2); // default; may be overridden by remote config
  const ORDER_EXPIRE_MINUTES = 20;
  const ORDER_REUSE_MINUTES = 5; // reuse same pending order within this window

  const genTempTxid = () => `temp-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  const [items, setItems] = useState<LicenseKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | LicenseKey['status']>('all');
  const [expiryFilter, setExpiryFilter] = useState<'all' | 'soon' | 'expired'>('all');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const perPage = 10;

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [isPayOpen, setIsPayOpen] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [verifyingPay, setVerifyingPay] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [countdown, setCountdown] = useState('');
  const [wallets, setWallets] = useState<any | null>(null);
  const [payChain, setPayChain] = useState<'TRC20'>('TRC20');

  const generatePayAmount = () => {
    const decimals = Math.floor(Math.random() * 10000);
    return `${payBase}.${decimals.toString().padStart(4, '0')}`;
  };

  const genLicenseCode = () => {
    const rand = () => Math.random().toString(36).replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 4).padEnd(4, 'X');
    return `${rand()}-${rand()}-${rand()}-${rand()}-${rand()}`;
  };

  const payAddress = useMemo(() => {
    const addr = wallets?.USDT?.TRC20?.[0];
    return addr || PAY_ADDRESS;
  }, [wallets]);

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

    // 1) jina (最稳定无 CORS)
    try {
      const res = await fetch(viaJina, { cache: 'no-store', ...init });
      if (res.ok) return await tryParse(res);
    } catch (err) {
      // ignore and try next
    }

    // 2) allorigins 代理
    try {
      const res = await fetch(viaAllorigins, { cache: 'no-store', ...init });
      if (res.ok) return await tryParse(res);
    } catch (err) {
      // ignore and try next
    }

    // 3) 直连（若服务端打开了 CORS）
    const res = await fetch(url, { cache: 'no-store', ...init });
    if (!res.ok) throw new Error('direct fetch failed');
    return await tryParse(res);
  };

  const loadWallets = async () => {
    const baseUrl = 'https://ip.erel.cc/yiyefangzhou/wallet_addresses.json';
    const url = `${baseUrl}?t=${Date.now()}`; // cache bust to ensure最新金额
    try {
      const data = await fetchJsonWithFallback(url);
      setWallets(data);
      if (data?.USDT?.amount) setPayBase(Number(data.USDT.amount) || payBase);
    } catch (err) {
      console.warn('load wallets failed, fallback to local address', err);
    }
  };

  useEffect(() => {
    loadWallets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isPayOpen) {
      loadWallets(); // 每次打开购买弹窗都拉取最新金额/地址
    }
  }, [isPayOpen]);

  const fetchRecentOrder = async () => {
    if (!user) return null;
    try {
      const now = new Date();
      const recentIso = new Date(now.getTime() - ORDER_REUSE_MINUTES * 60 * 1000).toISOString();
      const nowIso = now.toISOString();
      const res = await pb.collection('orders').getList<Order>(1, 1, {
        filter: `user = "${user.id}" && status = "pending" && created >= "${recentIso}" && expires_at >= "${nowIso}" && address = "${payAddress}" && chain = "TRC20"`,
        sort: '-created',
        $autoCancel: false,
      });
      return res.items[0] || null;
    } catch (err) {
      console.warn('fetch recent order failed', err);
      return null;
    }
  };

  const createOrder = async () => {
    if (!user) return null;
    setCreatingOrder(true);
    try {
      const amount = generatePayAmount();
      const expiresAt = new Date(Date.now() + ORDER_EXPIRE_MINUTES * 60 * 1000).toISOString();
      const payload = {
        user: user.id,
        address: payAddress,
        amount,
        status: 'pending',
        expires_at: expiresAt,
        txid: genTempTxid(),
        chain: payChain,
        token: 'USDT',
      };
      const order = await pb.collection('orders').create<Order>(payload, { $autoCancel: false });
      setCurrentOrder(order);
      setPayAmount(amount);
      pushToast('info', `已生成订单，金额 ${amount} USDT`);
      return order;
    } catch (error) {
      console.error('create order failed', error);
      pushToast('error', '创建订单失败，请重试');
      return null;
    } finally {
      setCreatingOrder(false);
    }
  };

  const paymentQr = useMemo(
    () => `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(payAddress)}`,
    [payAddress]
  );

  const isOrderExpired = useMemo(() => {
    if (!currentOrder) return false;
    return new Date(currentOrder.expires_at).getTime() < Date.now();
  }, [currentOrder]);

  useEffect(() => {
    if (!currentOrder) {
      setCountdown('');
      return;
    }
    const timer = setInterval(() => {
      const diff = new Date(currentOrder.expires_at).getTime() - Date.now();
      if (diff <= 0) {
        setCountdown('已过期');
        return;
      }
      const m = Math.floor(diff / 1000 / 60);
      const s = Math.floor((diff / 1000) % 60);
      setCountdown(`${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
    }, 1000);
    return () => clearInterval(timer);
  }, [currentOrder]);

  const pushToast = (variant: ToastVariant, message: string) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, variant }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 2400);
  };

  const fetchLicenses = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const filters: string[] = [`user = "${user.id}"`];
      if (statusFilter !== 'all') {
        filters.push(`status = "${statusFilter}"`);
      }
      if (keyword.trim()) {
        const k = keyword.trim();
        filters.push(`(code ~ "${k}" || server_uid ~ "${k}" || server_ip ~ "${k}")`);
      }
      const nowIso = new Date().toISOString();
      const soonIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      if (expiryFilter === 'soon') {
        filters.push(`expires_at >= "${nowIso}" && expires_at <= "${soonIso}"`);
      }
      if (expiryFilter === 'expired') {
        filters.push(`expires_at < "${nowIso}"`);
      }

      const res = await pb.collection('license_keys').getList<LicenseKey>(page, perPage, {
        filter: filters.join(' && ') || undefined,
        sort: '-purchased_at',
        $autoCancel: false,
      });

      setItems(res.items);
      setTotalItems(res.totalItems);
      setTotalPages(res.totalPages);
    } catch (error) {
      const err = error as any;
      console.error('Failed to load licenses', err);
      if (err?.status === 401 || err?.status === 403) {
        pushToast('warning', `暂无权限读取授权 (状态 ${err.status || ''})`);
      } else {
        pushToast('error', `加载授权信息失败：${err?.message || '未知错误'}`);
      }
      setItems([]);
      setTotalItems(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  };

  const safeCopy = async (text: string, successMessage: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        const selection = document.getSelection();
        const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        document.execCommand('copy');
        document.body.removeChild(textarea);
        if (range && selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
      pushToast('success', successMessage);
    } catch (error) {
      pushToast('error', '复制失败，请手动复制');
    }
  };

  const handleCopy = async (code: string) => safeCopy(code, '已复制授权码');
  const handleCopyAddress = async () => safeCopy(payAddress, '已复制收款地址');

  const ensureOrder = async () => {
    if (!user) return;
    try {
      const existing = await fetchRecentOrder();
      if (existing) {
        setCurrentOrder(existing);
        setPayAmount(existing.amount);
        setPayChain('TRC20');
        return;
      }
      await createOrder();
    } catch (error) {
      console.error('ensure order failed', error);
    }
  };

  const handlePayOpenChange = (open: boolean) => {
    setIsPayOpen(open);
    if (open) {
      setPayChain('TRC20');
      setCurrentOrder(null);
      setPayAmount('');
      ensureOrder();
    } else {
      setCurrentOrder(null);
      setPayAmount('');
    }
  };

  const handleVerifyPayment = async () => {
    if (!currentOrder) {
      pushToast('info', '正在为您生成订单，请稍后再点校验');
      await createOrder();
      return;
    }

    if (isOrderExpired) {
      pushToast('warning', '订单已过期，为您生成新订单');
      await createOrder();
      return;
    }

    if (!payAmount) {
      setPayAmount(currentOrder.amount);
    }

    setVerifyingPay(true);
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
          data = await fetchJsonWithFallback(ep, tronHeaders ? { headers: tronHeaders } : undefined as any);
          if (data) break;
        } catch (err) {
          // try next
        }
      }

      if (!data) {
        pushToast('warning', '未能获取到账记录，请稍后再试或联系客服');
        return;
      }

      const transfers = data?.token_transfers || data?.data || [];
      const match = transfers.find((t: any) => {
        const to = (t.to || t.to_address || t.toAddress || '').toLowerCase();
        const value = Number(t.value || t.amount || t.quant || 0);
        const decimals = t.token_info?.decimals ?? t.tokenInfo?.decimals ?? 6;
        const amount = value / Math.pow(10, decimals);
        return to === payAddress.toLowerCase() && amount >= Number(currentOrder.amount);
      });

      if (match) {
        const txid = match.transaction_id || match.transactionID || match.txid || match.hash || match.txHash || '';
        try {
          await pb.collection('orders').update(currentOrder.id, { status: 'confirmed', txid });
          setCurrentOrder(prev => prev && prev.id === currentOrder.id ? { ...prev, status: 'confirmed', txid } : prev);
        } catch (updateErr) {
          console.warn('update order failed (likely due to rules), continue with local status', updateErr);
          setCurrentOrder(prev => prev && prev.id === currentOrder.id ? { ...prev, status: 'confirmed', txid } : prev);
        }

        try {
          await pb.collection('license_keys').create({
            code: genLicenseCode(),
            user: currentOrder.user,
            status: 'unused',
            purchased_at: new Date().toISOString(),
            note: `order:${currentOrder.id}`,
          });
        } catch (createKeyErr) {
          console.warn('auto create license failed (likely due to rules), please handle server-side', createKeyErr);
        }

        pushToast('success', '检测到入账，已标记订单');
        handlePayOpenChange(false);
        fetchLicenses();
      } else {
        pushToast('warning', '暂未检测到最新入账，请稍后再试');
      }
    } catch (error) {
      console.error('verify payment failed', error);
      pushToast('error', '校验失败，请稍后重试或联系客服');
    } finally {
      setVerifyingPay(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => {
      fetchLicenses();
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, statusFilter, expiryFilter, keyword, page]);

  return (
    <div className="space-y-5">
      {/* 全局提示 */}
      <div className="fixed bottom-6 right-6 z-[120] space-y-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={cn(
              'min-w-[220px] rounded-xl px-4 py-3 shadow-lg text-sm flex items-start gap-2 border backdrop-blur pointer-events-auto',
              t.variant === 'success' && 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-200 dark:border-emerald-800',
              t.variant === 'error' && 'bg-red-50 text-red-700 border-red-100 dark:bg-red-900/20 dark:text-red-200 dark:border-red-800',
              t.variant === 'warning' && 'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-800',
              t.variant === 'info' && 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-900/20 dark:text-blue-200 dark:border-blue-800'
            )}
          >
            <HugeiconsIcon icon={CheckmarkCircle01Icon} className="h-4 w-4 mt-0.5" />
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">授权信息</h1>
        <p className="text-neutral-500 dark:text-neutral-400">查看和管理您的授权码，支持筛选、搜索并复制使用</p>
      </div>

      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-4 space-y-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={statusFilter} onValueChange={(v) => { setPage(1); setStatusFilter(v as any); }}>
            <SelectTrigger className="w-40 h-9 rounded-xl">
              <SelectValue placeholder="状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="unused">未使用</SelectItem>
              <SelectItem value="used">已使用</SelectItem>
              <SelectItem value="banned">已封禁</SelectItem>
              <SelectItem value="expired">已过期</SelectItem>
            </SelectContent>
          </Select>

          <Select value={expiryFilter} onValueChange={(v) => { setPage(1); setExpiryFilter(v as any); }}>
            <SelectTrigger className="w-44 h-9 rounded-xl">
              <SelectValue placeholder="到期筛选" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部到期状态</SelectItem>
              <SelectItem value="soon">即将到期</SelectItem>
              <SelectItem value="expired">已过期</SelectItem>
            </SelectContent>
          </Select>

          <div className="relative flex-1 min-w-[240px] max-w-md">
            <HugeiconsIcon icon={Search01Icon} className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
            <Input
              placeholder="搜索 code / server_uid / server_ip"
              className="pl-9 h-9"
              value={keyword}
              onChange={(e) => { setPage(1); setKeyword(e.target.value); }}
            />
          </div>

          <div className="flex-1" />

          <Dialog open={isPayOpen} onOpenChange={handlePayOpenChange}>
            <DialogTrigger asChild>
              <Button variant="default" className="rounded-xl h-9 px-4" disabled={creatingOrder}>购买授权</Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl" onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
              <DialogHeader>
                <DialogTitle>购买授权码</DialogTitle>
                <DialogDescription>使用 USDT (TRC20) 转账后点击已支付，我们会为您分配授权码。</DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="flex items-start justify-between text-sm text-neutral-600 dark:text-neutral-300">
                  <div className="space-y-1">
                    <div>订单号：<span className="font-mono text-xs">{currentOrder?.id || '生成中...'}</span></div>
                    <div>倒计时：{countdown || '生成中...'}</div>
                  </div>
                  <div className={cn('px-2 py-1 rounded-md text-xs font-semibold',
                    currentOrder?.status === 'confirmed' && 'bg-emerald-50 text-emerald-700 border border-emerald-100',
                    currentOrder?.status === 'pending' && 'bg-amber-50 text-amber-700 border border-amber-100',
                    currentOrder?.status === 'expired' && 'bg-neutral-100 text-neutral-500 border border-neutral-200',
                    currentOrder?.status === 'failed' && 'bg-red-50 text-red-700 border border-red-100'
                  )}>
                    {currentOrder?.status ? `状态：${{
                      pending: '待支付',
                      confirmed: '已确认',
                      expired: '已过期',
                      failed: '失败',
                    }[currentOrder.status]}` : '状态：生成中'}
                  </div>
                </div>

                <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-neutral-500">收款地址 (TRC20)</span>
                    <div className="flex items-center gap-2">
                      <Badge className="h-7 px-2 text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-100">USDT-TRC20</Badge>
                      <Button size="sm" type="button" variant="outline" className="h-8 px-3" onClick={handleCopyAddress}>复制地址</Button>
                    </div>
                  </div>
                  <div className="font-mono text-base sm:text-lg leading-7 break-all whitespace-pre-wrap">
                    <span className="text-red-600 font-semibold">{payAddress.slice(0, 4)}</span>
                    <span>{payAddress.slice(4, -4)}</span>
                    <span className="text-red-600 font-semibold">{payAddress.slice(-4)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-neutral-600 dark:text-neutral-300">
                    <span>金额</span>
                    <div className="flex items-baseline gap-2">
                      <span className="font-semibold text-red-600 text-3xl leading-7">{payAmount || '—'}</span>
                      <span className="text-sm text-neutral-500">USDT (TRC20)</span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-center">
                  <img src={paymentQr} alt="支付二维码" className="h-64 w-64 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white" />
                </div>

                <div className="text-sm text-neutral-500 space-y-1">
                  <div>唯一金额，每次打开都会变化；请按显示金额精确转账。</div>
                  <div>扫描或复制地址支付：{payAmount || '生成中…'} USDT（TRC20）。</div>
                  {isOrderExpired && <div className="text-red-500">订单已过期，请重新生成。</div>}
                  <div>付款后点“已支付，去校验”获取授权。</div>
                </div>
              </div>

              <DialogFooter className="flex gap-2 sm:justify-end">
                <Button variant="secondary" onClick={() => handlePayOpenChange(false)}>稍后再说</Button>
                <Button onClick={() => handleVerifyPayment()} disabled={verifyingPay || creatingOrder}>
                  {verifyingPay ? '校验中...' : '已支付，去校验'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Button
            variant="outline"
            size="icon"
            onClick={() => fetchLicenses()}
            disabled={loading}
            className="rounded-xl h-9 w-9"
            title="刷新"
          >
            <HugeiconsIcon icon={RefreshIcon} className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-neutral-50/50 dark:bg-neutral-950/50">
              <TableHead className="w-[22%] px-4">授权码</TableHead>
              <TableHead className="w-[12%] px-4">状态</TableHead>
              <TableHead className="w-[14%] px-4">到期时间</TableHead>
              <TableHead className="w-[14%] px-4">服务器 UID</TableHead>
              <TableHead className="w-[14%] px-4">服务器 IP</TableHead>
              <TableHead className="w-[12%] px-4">购买时间</TableHead>
              <TableHead className="w-[12%] px-4">首次使用</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-16 text-center text-neutral-400">加载中...</TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-16 text-center text-neutral-400">
                  <div className="flex flex-col items-center gap-3">
                    <HugeiconsIcon icon={Bookmark01Icon} className="h-10 w-10 text-blue-500" />
                    <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">暂无授权码</div>
                    <div className="text-sm text-neutral-500">未查询到您的授权，请先购买或联系管理员。</div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              items.map(item => {
                const expiresSoon = item.expires_at ? new Date(item.expires_at).getTime() - Date.now() <= 7 * 24 * 60 * 60 * 1000 : false;
                const expired = item.expires_at ? new Date(item.expires_at).getTime() < Date.now() : false;
                return (
                  <TableRow key={item.id} className="hover:bg-blue-50/30 dark:hover:bg-blue-900/5 transition-colors">
                    <TableCell className="px-4 font-mono text-sm">
                      <div className="flex items-center gap-2">
                        <span className="truncate" title={item.code}>{item.code}</span>
                        <Button size="xs" variant="outline" className="h-7 px-2" onClick={() => handleCopy(item.code)}>
                          <HugeiconsIcon icon={Copy01Icon} className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      {item.note && <div className="text-xs text-neutral-400 mt-1 truncate">{item.note}</div>}
                    </TableCell>
                    <TableCell className="px-4">
                      <Badge className={cn('rounded-lg text-xs font-bold border-none px-2.5 py-1', statusMap[item.status].color)}>
                        <HugeiconsIcon icon={statusMap[item.status].icon} className="h-3.5 w-3.5 mr-1" />
                        {statusMap[item.status].label}
                      </Badge>
                    </TableCell>
                    <TableCell className={cn('px-4 text-sm', expired ? 'text-red-500' : expiresSoon ? 'text-amber-500' : '')}>
                      {item.expires_at ? new Date(item.expires_at).toLocaleDateString() : '—'}
                    </TableCell>
                    <TableCell className="px-4 text-sm truncate" title={item.server_uid || ''}>{item.server_uid || '—'}</TableCell>
                    <TableCell className="px-4 text-sm truncate" title={item.server_ip || ''}>{item.server_ip || '—'}</TableCell>
                    <TableCell className="px-4 text-sm">{item.purchased_at ? new Date(item.purchased_at).toLocaleString() : '—'}</TableCell>
                    <TableCell className="px-4 text-sm">{item.first_used_at ? new Date(item.first_used_at).toLocaleString() : '—'}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {totalPages > 1 && (
          <div className="px-4 py-3 flex items-center justify-between border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-950/40">
            <div className="text-xs text-neutral-500">共 {totalItems} 条</div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 rounded-lg"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <span className="sr-only">上一页</span>
                ‹
              </Button>
              <span className="text-xs text-neutral-500">{page} / {totalPages}</span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 rounded-lg"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                <span className="sr-only">下一页</span>
                ›
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Tasks;
