import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './auth-provider';

export function ProtectedRoute() {
  const { isValid, isLoading, isSuperAdmin } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
      </div>
    );
  }

  if (!isValid) {
    return <Navigate to="/login" replace />;
  }

  // 只有在访问根路径时才跳转
  const currentPath = window.location.pathname;
  if (isSuperAdmin && currentPath === '/') {
    return <Navigate to="/admin-dashboard" replace />;
  }

  return <Outlet />;
}
export function AdminOnlyRoute({ children }: { children: React.ReactNode }) {
  const { isSuperAdmin, isValid, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
      </div>
    );
  }

  if (!isValid || !isSuperAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}


