import { useState } from 'react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { useToast, ToastContainer } from './hooks/useToast';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import NewProjectPage from './pages/NewProjectPage';
import DetailPage from './pages/DetailPage';
import CalendarPage from './pages/CalendarPage';

// Icons
const IconHome    = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>;
const IconPlus    = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>;
const IconCalendar= () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>;

function AppInner() {
  const { user, logout } = useAuth();
  const { toasts, addToast } = useToast();
  const [page, setPage] = useState('dashboard');
  const [detailId, setDetailId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  if (!user) return <LoginPage />;

  const navigate = (to, id) => {
    setPage(to);
    if (id) setDetailId(id);
  };

  const refresh = () => setRefreshKey(k => k + 1);

  const NAV = [
    { key: 'dashboard', label: 'ホーム',   Icon: IconHome },
    { key: 'new',       label: '案件登録', Icon: IconPlus },
    { key: 'calendar',  label: 'カレンダー', Icon: IconCalendar },
  ];

  return (
    <div className="app-shell">
      {/* Top bar */}
      <header className="topbar">
        <div className="topbar-logo">
          <span className="dot" />
          納品スケジューラー
        </div>
        <div className="topbar-right">
          <span>{user.name}</span>
          <button className="btn btn-ghost btn-sm" onClick={logout} style={{ padding: '4px 10px' }}>
            ログアウト
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="main-content" key={page === 'detail' ? detailId : page + refreshKey}>
        {page === 'dashboard' && (
          <DashboardPage onNavigate={navigate} key={refreshKey} />
        )}
        {page === 'new' && (
          <NewProjectPage
            addToast={addToast}
            onSaved={() => { refresh(); setPage('dashboard'); }}
          />
        )}
        {page === 'calendar' && (
          <CalendarPage onNavigate={navigate} key={refreshKey} />
        )}
        {page === 'detail' && detailId && (
          <DetailPage
            projectId={detailId}
            onBack={() => setPage('dashboard')}
            addToast={addToast}
            onRefresh={refresh}
          />
        )}
      </main>

      {/* Bottom nav */}
      <nav className="bottom-nav">
        {NAV.map(({ key, label, Icon }) => (
          <button
            key={key}
            className={`nav-item ${page === key || (page === 'detail' && key === 'dashboard') ? 'active' : ''}`}
            onClick={() => setPage(key)}
          >
            <Icon />
            {label}
          </button>
        ))}
      </nav>

      <ToastContainer toasts={toasts} />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}
