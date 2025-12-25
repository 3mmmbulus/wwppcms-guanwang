import { useEffect, useState } from 'react';
import { pb } from '@/lib/pocketbase';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  RefreshIcon,
  Search01Icon,
  CheckmarkCircle01Icon,
  Bookmark01Icon,
  Delete01Icon,
  HourglassIcon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Add01Icon,
  InformationCircleIcon,
} from '@hugeicons/core-free-icons';
import { useAuth } from '@/components/auth-provider';

interface LicenseKey {
  id: string;
  code: string;
  user: string;
  server_uid?: string;
  server_ip?: string;
  expires_at?: string;
  first_used_at?: string;
  status: 'unused' | 'used' | 'banned' | 'expired';
  note?: string;
  purchased_at?: string;
  expand?: {
    user?: {
      id: string;
      email?: string;
      username?: string;
    };
  };
}

interface UserSummary {
  id: string;
  email?: string;
  username?: string;
  created?: string;
}

interface UserStats {
  total: number;
  banned: number;
  soon: number;
  expired: number;
}

type ToastVariant = 'success' | 'error' | 'info' | 'warning';
interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

const statusMap: Record<LicenseKey['status'], { label: string; color: string; icon: any }> = {
  unused: { label: '未使用', color: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400', icon: Bookmark01Icon },
  used: { label: '已使用', color: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400', icon: CheckmarkCircle01Icon },
  banned: { label: '已封禁', color: 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400', icon: Delete01Icon },
  expired: { label: '已过期', color: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400', icon: HourglassIcon },
};

export function LicenseKeys() {
  const { isSuperAdmin } = useAuth();

  // 左侧用户列表
  const [userList, setUserList] = useState<UserSummary[]>([]);
  const [userListLoading, setUserListLoading] = useState(true);
  const [userListSearch, setUserListSearch] = useState('');
  const [userListPage, setUserListPage] = useState(1);
  const [userListTotalPages, setUserListTotalPages] = useState(1);
  const [userStats, setUserStats] = useState<Record<string, UserStats>>({});
  const userListPerPage = 8;
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // 授权列表
  const [items, setItems] = useState<LicenseKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | LicenseKey['status']>('all');
  const [expiryFilter, setExpiryFilter] = useState<'all' | 'soon' | 'expired'>('all');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const perPage = 10;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // 创建授权
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [customCode, setCustomCode] = useState('');
  const [note, setNote] = useState('');
  const [expiresAtInput, setExpiresAtInput] = useState('');
  const [creating, setCreating] = useState(false);

  // Toast
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // 批量确认
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const [pendingBatchStatus, setPendingBatchStatus] = useState<LicenseKey['status'] | null>(null);

  const pushToast = (variant: ToastVariant, message: string) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, variant }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 2400);
  };

  const generateCode = () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 20; i++) {
      out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out.replace(/(.{4})/g, '$1-').replace(/-$/, '');
  };

  // 用户列表及统计
  const fetchUsers = async () => {
    if (!isSuperAdmin) return;
    setUserListLoading(true);
    try {
      const filters: string[] = [];
      if (userListSearch.trim()) {
        const safe = userListSearch.trim().replace(/"/g, '');
        filters.push(`(email ~ "${safe}" || username ~ "${safe}" || id = "${safe}")`);
      }
      const res = await pb.collection('users').getList<UserSummary>(userListPage, userListPerPage, {
        filter: filters.join(' && ') || undefined,
        sort: '-created',
        $autoCancel: false,
      });
      setUserList(res.items);
      setUserListTotalPages(res.totalPages);

      const nowIso = new Date().toISOString();
      const soonIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const statsEntries = await Promise.all(res.items.map(async (u) => {
        const total = await pb.collection('license_keys').getList(1, 1, { filter: `user = "${u.id}"`, $autoCancel: false });
        const banned = await pb.collection('license_keys').getList(1, 1, { filter: `user = "${u.id}" && status = "banned"`, $autoCancel: false });
        const soon = await pb.collection('license_keys').getList(1, 1, { filter: `user = "${u.id}" && expires_at >= "${nowIso}" && expires_at <= "${soonIso}"`, $autoCancel: false });
        const expired = await pb.collection('license_keys').getList(1, 1, { filter: `user = "${u.id}" && expires_at < "${nowIso}"`, $autoCancel: false });
        return [u.id, { total: total.totalItems, banned: banned.totalItems, soon: soon.totalItems, expired: expired.totalItems } as UserStats];
      }));
      setUserStats(Object.fromEntries(statsEntries));

      if (!selectedUserId && res.items[0]) {
        setSelectedUserId(res.items[0].id);
      }
    } catch (error) {
      console.error('fetch users failed', error);
      setUserList([]);
      setUserListTotalPages(1);
      pushToast('error', '用户列表加载失败');
    } finally {
      setUserListLoading(false);
    }
  };

  // 授权列表
  const fetchList = async () => {
    if (!isSuperAdmin || !selectedUserId) return;
    setLoading(true);
    setSelectedIds([]);
    try {
      const filters: string[] = [`user = "${selectedUserId}"`];
      if (statusFilter !== 'all') {
        filters.push(`status = "${statusFilter}"`);
      }
      if (keyword) {
        filters.push(`(code ~ "${keyword}" || server_uid ~ "${keyword}" || server_ip ~ "${keyword}")`);
      }
      const nowIso = new Date().toISOString();
      const soonIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      if (expiryFilter === 'soon') {
        filters.push(`expires_at >= "${nowIso}" && expires_at <= "${soonIso}"`);
      }
      if (expiryFilter === 'expired') {
        filters.push(`expires_at < "${nowIso}"`);
      }

      const result = await pb.collection('license_keys').getList<LicenseKey>(page, perPage, {
        filter: filters.join(' && ') || undefined,
        sort: '-purchased_at',
        expand: 'user',
        $autoCancel: false,
      });

      setItems(result.items);
      setTotalPages(result.totalPages);
      setTotalItems(result.totalItems);
    } catch (error) {
      console.error('Failed to fetch license keys:', error);
      setItems([]);
      setTotalPages(1);
      setTotalItems(0);
      pushToast('error', '授权列表加载失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!selectedUserId) {
      pushToast('warning', '请先选择用户');
      setIsCreateOpen(false);
      return;
    }

    const count = Math.min(20, Math.max(1, Number(quantity) || 1));
    if (count !== quantity) {
      setQuantity(count);
    }

    if (count < 1 || count > 20) {
      pushToast('warning', '数量需在 1-20 之间');
      return;
    }

    if (count > 1 && customCode.trim()) {
      pushToast('warning', '批量生成时不支持自定义 code');
      return;
    }

    setCreating(true);
    try {
      const now = new Date().toISOString();
      const payloads = Array.from({ length: count }).map(() => {
        const code = count === 1 && customCode.trim() ? customCode.trim() : generateCode();
        return {
          code,
          user: selectedUserId,
          status: 'unused' as const,
          purchased_at: now,
          note: note || undefined,
          expires_at: expiresAtInput ? new Date(expiresAtInput).toISOString() : undefined,
        };
      });

      for (const payload of payloads) {
        await pb.collection('license_keys').create(payload, { $autoCancel: false });
      }
      pushToast('success', `已生成 ${count} 条授权码`);
      setIsCreateOpen(false);
      setCustomCode('');
      setNote('');
      setExpiresAtInput('');
      setQuantity(1);
      fetchList();
    } catch (error) {
      console.error('create license failed', error);
      pushToast('error', '生成授权码失败，请稍后重试');
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      pushToast('success', '已复制');
    } catch (e) {
      pushToast('error', '复制失败，请手动复制');
    }
  };

  const handleStatusChange = async (id: string, newStatus: LicenseKey['status']) => {
    const prevItem = items.find(i => i.id === id);
    setUpdatingId(id);
    try {
      await pb.collection('license_keys').update(id, { status: newStatus });
      setItems(prev => prev.map(item => item.id === id ? { ...item, status: newStatus } : item));
      if (selectedUserId && prevItem) {
        setUserStats(prev => {
          const stats = prev[selectedUserId];
          if (!stats) return prev;
          const bannedDelta = (newStatus === 'banned' ? 1 : 0) - (prevItem.status === 'banned' ? 1 : 0);
          return {
            ...prev,
            [selectedUserId]: { ...stats, banned: Math.max(0, stats.banned + bannedDelta) },
          };
        });
      }
      pushToast('success', newStatus === 'banned' ? '已封禁' : '已解封');
    } catch (error) {
      console.error('Failed to update status:', error);
      pushToast('error', '更新状态失败，请稍后重试');
    } finally {
      setUpdatingId(null);
    }
  };

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(items.map(i => i.id));
    } else {
      setSelectedIds([]);
    }
  };

  const toggleSelect = (id: string, checked: boolean) => {
    setSelectedIds(prev => checked ? [...prev, id] : prev.filter(x => x !== id));
  };

  const requestBatchStatus = (newStatus: LicenseKey['status']) => {
    if (selectedIds.length === 0) {
      pushToast('warning', '请先选择要批量处理的授权码');
      return;
    }
    setPendingBatchStatus(newStatus);
    setBatchConfirmOpen(true);
  };

  const confirmBatchStatus = async () => {
    if (!pendingBatchStatus) return;
    const targetStatus = pendingBatchStatus;
    const affected = items.filter(item => selectedIds.includes(item.id));
    setUpdatingId('batch');
    try {
      await Promise.all(selectedIds.map(id => pb.collection('license_keys').update(id, { status: targetStatus }, { $autoCancel: false })));
      setItems(prev => prev.map(item => selectedIds.includes(item.id) ? { ...item, status: targetStatus } : item));
      if (selectedUserId && affected.length > 0) {
        const bannedDelta = targetStatus === 'banned'
          ? affected.filter(a => a.status !== 'banned').length
          : -affected.filter(a => a.status === 'banned').length;
        setUserStats(prev => {
          const stats = prev[selectedUserId];
          if (!stats) return prev;
          return {
            ...prev,
            [selectedUserId]: { ...stats, banned: Math.max(0, stats.banned + bannedDelta) },
          };
        });
      }
      setSelectedIds([]);
      pushToast('success', targetStatus === 'banned' ? '已批量封禁' : '已批量解封');
    } catch (error) {
      console.error('batch update failed', error);
      pushToast('error', '批量操作失败，请重试');
    } finally {
      setUpdatingId(null);
      setBatchConfirmOpen(false);
      setPendingBatchStatus(null);
    }
  };

  useEffect(() => {
    if (!isSuperAdmin) return;
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin, userListSearch, userListPage]);

  useEffect(() => {
    if (!isSuperAdmin || !selectedUserId) return;
    const t = setTimeout(() => {
      fetchList();
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, expiryFilter, keyword, page, isSuperAdmin, selectedUserId]);

  return (
    <div className="space-y-4">
      {/* 全局提示容器 */}
      <div className="fixed bottom-6 right-6 z-50 space-y-2">
        {toasts.map(t => (
          <div
            key={t.id}
            className={cn(
              'min-w-[220px] rounded-xl px-4 py-3 shadow-lg text-sm flex items-start gap-2 border',
              t.variant === 'success' && 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-200 dark:border-emerald-800',
              t.variant === 'error' && 'bg-red-50 text-red-700 border-red-100 dark:bg-red-900/20 dark:text-red-200 dark:border-red-800',
              t.variant === 'warning' && 'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-800',
              t.variant === 'info' && 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-900/20 dark:text-blue-200 dark:border-blue-800'
            )}
          >
            <HugeiconsIcon icon={InformationCircleIcon} className="h-4 w-4 mt-0.5" />
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">授权管理</h1>
        <p className="text-neutral-500 dark:text-neutral-400">管理员视角：选择用户并管理其授权码，支持筛选、批量封禁/解封</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <HugeiconsIcon icon={Search01Icon} className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
              <Input
                placeholder="搜索用户 (邮箱/用户名/ID)"
                className="pl-9"
                value={userListSearch}
                onChange={(e) => { setUserListPage(1); setUserListSearch(e.target.value); }}
              />
            </div>
            <Button variant="outline" size="icon" className="h-10 w-10 rounded-xl" onClick={() => fetchUsers()} disabled={userListLoading}>
              <HugeiconsIcon icon={RefreshIcon} className={cn('h-4 w-4', userListLoading && 'animate-spin')} />
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 text-sm">
            {[
              { key: 'all', label: '全部', value: 'all' as const },
              { key: 'soon', label: '即将到期', value: 'soon' as const },
              { key: 'banned', label: '已封禁', value: 'banned' as const },
              { key: 'expired', label: '已过期', value: 'expired' as const },
            ].map(tab => (
              <Button
                key={tab.key}
                variant="outline"
                size="sm"
                className={cn(
                  'h-8 rounded-xl px-3 text-xs',
                  expiryFilter === tab.value ? 'border-blue-500 text-blue-600 bg-blue-50 dark:bg-blue-900/20' : ''
                )}
                onClick={() => {
                  if (tab.value === 'soon' || tab.value === 'expired') {
                    setExpiryFilter(tab.value);
                    if (tab.value === 'expired') setStatusFilter('expired');
                  } else {
                    setExpiryFilter('all');
                    if (tab.value === 'banned') setStatusFilter('banned');
                    else setStatusFilter('all');
                  }
                }}
              >
                {tab.label}
              </Button>
            ))}
          </div>

          <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
            {userListLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-16 rounded-xl border border-dashed border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-900/40 animate-pulse" />
              ))
            ) : userList.length === 0 ? (
              <div className="text-sm text-neutral-500 py-6 text-center">无用户数据</div>
            ) : userList.map(u => {
              const stats = userStats[u.id] || { total: 0, banned: 0, soon: 0, expired: 0 };
              const active = selectedUserId === u.id;
              return (
                <button
                  key={u.id}
                  onClick={() => {
                    setSelectedUserId(u.id);
                    setPage(1);
                  }}
                  className={cn(
                    'w-full text-left rounded-xl border px-3 py-3 transition-colors',
                    active
                      ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-900/20'
                      : 'border-neutral-200 dark:border-neutral-800 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-neutral-50 dark:hover:bg-neutral-900'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-neutral-900 dark:text-neutral-50 line-clamp-1">{u.email || u.username || '未命名用户'}</div>
                    <span className="text-[11px] text-neutral-400">ID:{u.id.slice(0, 6)}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-neutral-500">
                    <Badge variant="outline" className="rounded-full border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-200">总 {stats.total}</Badge>
                    <Badge variant="outline" className="rounded-full border-amber-200 dark:border-amber-700 text-amber-600 dark:text-amber-400">将到期 {stats.soon}</Badge>
                    <Badge variant="outline" className="rounded-full border-red-200 dark:border-red-700 text-red-600 dark:text-red-400">封禁 {stats.banned}</Badge>
                  </div>
                </button>
              );
            })}
          </div>

          {userListTotalPages > 1 && (
            <div className="flex items-center justify-between pt-2 text-xs text-neutral-500">
              <div>第 {userListPage} / {userListTotalPages} 页</div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg" onClick={() => setUserListPage(p => Math.max(1, p - 1))} disabled={userListPage === 1}>
                  <HugeiconsIcon icon={ArrowLeft01Icon} className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg" onClick={() => setUserListPage(p => Math.min(userListTotalPages, p + 1))} disabled={userListPage === userListTotalPages}>
                  <HugeiconsIcon icon={ArrowRight01Icon} className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">授权列表</h2>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">当前用户：{selectedUserId || '未选择'}，支持筛选、批量封禁/解封</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={selectedIds.length === 0 || updatingId === 'batch'}
                onClick={() => requestBatchStatus('banned')}
              >
                批量封禁
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={selectedIds.length === 0 || updatingId === 'batch'}
                onClick={() => requestBatchStatus('unused')}
              >
                批量解封
              </Button>
              <Button
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl h-9 px-4"
                onClick={() => {
                  if (!selectedUserId) {
                    pushToast('warning', '请先选择用户');
                    return;
                  }
                  setIsCreateOpen(true);
                }}
              >
                <HugeiconsIcon icon={Add01Icon} className="h-4 w-4 mr-2" /> 生成授权码
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => fetchList()}
                disabled={loading}
                className="rounded-xl h-9 w-9"
                title="刷新数据"
              >
                <HugeiconsIcon icon={RefreshIcon} className={cn('h-4 w-4', loading && 'animate-spin')} />
              </Button>
            </div>
          </div>

          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-3 space-y-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={statusFilter} onValueChange={(v) => { setPage(1); setStatusFilter(v as any); }}>
                <SelectTrigger className="w-40 h-9">
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
                <SelectTrigger className="w-44 h-9">
                  <SelectValue placeholder="到期筛选" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部到期状态</SelectItem>
                  <SelectItem value="soon">即将到期</SelectItem>
                  <SelectItem value="expired">已过期</SelectItem>
                </SelectContent>
              </Select>

              <div className="relative flex-1 min-w-[240px]">
                <HugeiconsIcon icon={Search01Icon} className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                <Input
                  placeholder="搜索 code / server_uid / server_ip"
                  className="pl-9"
                  value={keyword}
                  onChange={(e) => { setPage(1); setKeyword(e.target.value); }}
                />
              </div>

              {(statusFilter !== 'all' || expiryFilter !== 'all' || keyword) && (
                <Button variant="ghost" size="sm" onClick={() => { setStatusFilter('all'); setExpiryFilter('all'); setKeyword(''); setPage(1); }}>
                  清除筛选
                </Button>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-neutral-50/50 dark:bg-neutral-950/50">
                  <TableHead className="w-10 px-4">
                    <Checkbox
                      checked={
                        selectedIds.length > 0 && selectedIds.length < items.length
                          ? 'indeterminate'
                          : (items.length > 0 && selectedIds.length === items.length)
                      }
                      onCheckedChange={(v) => toggleSelectAll(v === true)}
                      aria-label="全选"
                    />
                  </TableHead>
                  <TableHead className="w-[16%] px-4">授权码</TableHead>
                  <TableHead className="w-[10%] px-4">状态</TableHead>
                  <TableHead className="w-[14%] px-4">到期时间</TableHead>
                  <TableHead className="w-[14%] px-4">服务器 UID</TableHead>
                  <TableHead className="w-[14%] px-4">服务器 IP</TableHead>
                  <TableHead className="w-[12%] px-4">购买时间</TableHead>
                  <TableHead className="w-[12%] px-4">首次使用</TableHead>
                  <TableHead className="w-[8%] px-4 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-16 text-center text-neutral-400">加载中...</TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-16 text-center text-neutral-400">暂无授权记录</TableCell>
                  </TableRow>
                ) : (
                  items.map(item => {
                    const expiresSoon = item.expires_at ? new Date(item.expires_at).getTime() - Date.now() <= 7 * 24 * 60 * 60 * 1000 : false;
                    const expired = item.expires_at ? new Date(item.expires_at).getTime() < Date.now() : false;
                    const isChecked = selectedIds.includes(item.id);
                    return (
                      <TableRow key={item.id} className="hover:bg-blue-50/30 dark:hover:bg-blue-900/5 transition-colors">
                        <TableCell className="px-4">
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={(v) => toggleSelect(item.id, Boolean(v))}
                            aria-label="选择"
                          />
                        </TableCell>
                        <TableCell className="px-4 font-mono text-sm">
                          <div className="flex items-center gap-2">
                            <span className="truncate" title={item.code}>{item.code}</span>
                            <Button size="xs" variant="outline" className="h-7 px-2" onClick={() => handleCopy(item.code)}>复制</Button>
                          </div>
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
                        <TableCell className="px-4 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-lg px-2 text-xs"
                            onClick={() => handleStatusChange(item.id, item.status === 'banned' ? 'unused' : 'banned')}
                            disabled={updatingId === item.id}
                          >
                            {item.status === 'banned' ? '解封' : '封禁'}
                          </Button>
                        </TableCell>
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
                    <HugeiconsIcon icon={ArrowLeft01Icon} className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-neutral-500">{page} / {totalPages}</span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 rounded-lg"
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  >
                    <HugeiconsIcon icon={ArrowRight01Icon} className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>生成授权码</DialogTitle>
            <DialogDescription>数量 1-20，默认未使用，生成到当前选中用户</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200">数量</label>
              <Input
                type="number"
                min={1}
                max={20}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value) || 1)}
              />
              <p className="text-xs text-neutral-500">一次最多生成 20 条</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200">到期时间（可选）</label>
              <Input
                type="date"
                value={expiresAtInput}
                onChange={(e) => setExpiresAtInput(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200">备注（可选）</label>
              <Input
                placeholder="给自己或用户的说明"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200 flex items-center justify-between">
                <span>自定义授权码（可选）</span>
                {quantity > 1 && <span className="text-xs text-neutral-400">批量时不支持</span>}
              </label>
              <Input
                placeholder="留空则自动生成"
                value={quantity > 1 ? '' : customCode}
                disabled={quantity > 1}
                onChange={(e) => setCustomCode(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsCreateOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={creating} className="bg-blue-600 hover:bg-blue-700 text-white">
              {creating ? '生成中...' : '生成授权码'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={batchConfirmOpen} onOpenChange={setBatchConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认批量操作</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingBatchStatus === 'banned' ? '批量封禁选中的授权码？' : '批量解封为未使用？'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setBatchConfirmOpen(false); setPendingBatchStatus(null); }}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmBatchStatus} disabled={updatingId === 'batch'}>
              确认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default LicenseKeys;
