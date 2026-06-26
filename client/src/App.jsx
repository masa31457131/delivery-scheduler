import { useState } from 'react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { useToast, ToastContainer } from './hooks/useToast';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import NewProjectPage from './pages/NewProjectPage';
import DetailPage from './pages/DetailPage';
import CalendarPage from './pages/CalendarPage';
import AdminUsersPage from './pages/AdminUsersPage';

const IconHome     = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>;
const IconPlus     = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>;
const IconCalendar = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>;
const IconUsers    = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/><path d="M16 3.13a4 4 0 010 7.75"/><path d="M21 21v-2a4 4 0 00-3-3.87"/></svg>;

function AppInner() {
  const { user, logout } = useAuth();
  const { toasts, addToast } = useToast();
  const [page, setPage] = useState('dashboard');
  const [detailId, setDetailId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  if (!user) return <LoginPage />;

  const navigate = (to, id) => { setPage(to); if (id) setDetailId(id); };
  const refresh = () => setRefreshKey(k => k + 1);

  const NAV_SALES = [
    { key: 'dashboard', label: 'ホーム',     Icon: IconHome },
    { key: 'new',       label: '案件登録',   Icon: IconPlus },
    { key: 'calendar',  label: 'カレンダー', Icon: IconCalendar },
  ];
  const NAV_ADMIN = [
    { key: 'dashboard', label: 'ホーム',     Icon: IconHome },
    { key: 'new',       label: '案件登録',   Icon: IconPlus },
    { key: 'calendar',  label: 'カレンダー', Icon: IconCalendar },
    { key: 'users',     label: 'メンバー',   Icon: IconUsers },
  ];
  const NAV = user.role === 'admin' ? NAV_ADMIN : NAV_SALES;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-logo"><span className="dot" />納品スケジューラー</div>
        <div className="topbar-right">
          <span>{user.name}</span>
          <button className="btn btn-ghost btn-sm" onClick={logout} style={{ padding: '4px 10px' }}>ログアウト</button>
        </div>
      </header>

      <main className="main-content" key={page === 'detail' ? detailId : page + refreshKey}>
        {page === 'dashboard' && <DashboardPage onNavigate={navigate} key={refreshKey} />}
        {page === 'new' && <NewProjectPage addToast={addToast} onSaved={() => { refresh(); setPage('dashboard'); }} />}
        {page === 'calendar' && <CalendarPage onNavigate={navigate} key={refreshKey} />}
        {page === 'detail' && detailId && (
          <DetailPage projectId={detailId} onBack={() => setPage('dashboard')} addToast={addToast} onRefresh={refresh} />
        )}
        {page === 'users' && user.role === 'admin' && <AdminUsersPage addToast={addToast} />}
      </main>

      <nav className="bottom-nav">
        {NAV.map(({ key, label, Icon }) => (
          <button key={key}
            className={`nav-item ${page === key || (page === 'detail' && key === 'dashboard') ? 'active' : ''}`}
            onClick={() => setPage(key)}>
            <Icon />{label}
          </button>
        ))}
      </nav>

      <ToastContainer toasts={toasts} />
    </div>
  );
}

export default function App() {
  return <AuthProvider><AppInner /></AuthProvider>;
}
