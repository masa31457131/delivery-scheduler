import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';

export default function LoginPage() {
  const { login } = useAuth();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await api.login(loginId, password);
      login(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>📦</div>
          <div className="login-title">納品スケジューラー</div>
          <div className="login-sub">営業・管理者でログイン</div>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>ログインID</label>
            <input
              value={loginId}
              onChange={e => setLoginId(e.target.value)}
              placeholder="例: yamada"
              required
              autoComplete="username"
            />
          </div>
          <div className="form-group">
            <label>パスワード</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="パスワードを入力"
              required
              autoComplete="current-password"
            />
          </div>
          {error && (
            <div style={{ color: 'var(--danger)', fontSize: '0.82rem', marginBottom: 12 }}>
              {error}
            </div>
          )}
          <button className="btn btn-primary btn-full" type="submit" disabled={loading}>
            {loading ? 'ログイン中...' : 'ログイン'}
          </button>
        </form>
        <hr className="divider" />
        <div className="text-sub" style={{ fontSize: '0.75rem', lineHeight: 1.6 }}>
          <div style={{ marginBottom: 4, fontWeight: 600 }}>初期アカウント</div>
          <div>管理者：admin / admin123</div>
          <div>山田 太郎：yamada / sales123</div>
          <div>田中 一郎：tanaka / sales456</div>
        </div>
      </div>
    </div>
  );
}
