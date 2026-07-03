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
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: '2.4rem', marginBottom: 10 }}>📦</div>
          <div className="login-title">納品スケジューラー</div>
          <div className="login-sub">ログインIDとパスワードを入力してください</div>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>ログインID</label>
            <input
              value={loginId}
              onChange={e => setLoginId(e.target.value)}
              placeholder="ログインIDを入力"
              required
              autoComplete="username"
              autoCapitalize="off"
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
            <div style={{ color: 'var(--danger)', fontSize: '0.82rem', marginBottom: 12, padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 8 }}>
              {error}
            </div>
          )}
          <button className="btn btn-primary btn-full" type="submit" disabled={loading}>
            {loading ? 'ログイン中...' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  );
}
