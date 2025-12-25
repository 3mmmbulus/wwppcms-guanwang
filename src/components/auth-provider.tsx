import { createContext, useContext, useEffect, useState } from 'react';
import { pb } from '@/lib/pocketbase';
import type { AuthModel } from 'pocketbase';

interface AuthContextType {
  user: AuthModel | null;
  isSuperAdmin: boolean;
  isValid: boolean;
  login: (email: string, password: string, isSuperAdmin?: boolean) => Promise<void>;
  register: (email: string, password: string, passwordConfirm: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthModel | null>(pb.authStore.model);
  const [isValid, setIsValid] = useState(pb.authStore.isValid);
  const [isLoading, setIsLoading] = useState(true);

  // 判断是否为超级管理员（PocketBase admin 没有 collectionId/collectionName）
  const checkIsSuperAdmin = (model: AuthModel | null) => {
    if (!model) return false;
    return !model.collectionId || model.collectionName === '_superusers';
  };

  const [isSuperAdmin, setIsSuperAdmin] = useState(checkIsSuperAdmin(pb.authStore.model));

  useEffect(() => {
    // 监听 authStore 的变化
    return pb.authStore.onChange((token, model) => {
      setUser(model);
      setIsValid(!!token);
      setIsSuperAdmin(checkIsSuperAdmin(model));
    });
  }, []);

  useEffect(() => {
    // 验证当前的 auth token
    const initAuth = async () => {
      if (!pb.authStore.isValid || !pb.authStore.model) {
        setIsLoading(false);
        return;
      }

      try {
        // 刷新 auth 以确保仍然有效
        // 根据 model 所在的 collection 进行刷新
        const model = pb.authStore.model;
        const collectionName = model?.collectionName;
        // admin 没有 collectionName，使用 admins 刷新；否则按集合刷新
        if (!collectionName) {
          await pb.admins.authRefresh({ $autoCancel: false });
        } else {
          await pb.collection(collectionName).authRefresh({ $autoCancel: false });
        }
      } catch (err: any) {
        console.error('Auth refresh failed:', err);
        // 只有在明确的 401/403 认证错误时才清空，防止网络抖动导致登出
        if (err?.status === 401 || err?.status === 403) {
          pb.authStore.clear();
          setUser(null);
          setIsValid(false);
          setIsSuperAdmin(false);
        } else if (err?.isAbort) {
          // 忽略自动取消的错误
          console.warn('Auth refresh was autocancelled, this is expected during navigation');
        }
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, []);

  const register = async (email: string, password: string, passwordConfirm: string) => {
    // 创建用户
    await pb.collection('users').create({
      email,
      password,
      passwordConfirm,
    });

    // 注册成功后自动登录
    await login(email, password, false);
  };

  const login = async (email: string, password: string, isSuperAdminLogin: boolean = false) => {
    let authData: any;
    if (isSuperAdminLogin) {
      // PocketBase admin 登录走 admins 端点
      authData = await pb.admins.authWithPassword(email, password);
    } else {
      authData = await pb.collection('users').authWithPassword(email, password);
    }
    setUser(authData.record || authData?.admin || authData?.model || authData);
    setIsValid(true);
    setIsSuperAdmin(isSuperAdminLogin || checkIsSuperAdmin(authData.record || authData.admin || authData.model || authData));
  };

  const logout = () => {
    pb.authStore.clear();
    setUser(null);
    setIsValid(false);
    setIsSuperAdmin(false);
  };

  return (
    <AuthContext.Provider value={{ user, isSuperAdmin, isValid, login, register, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

