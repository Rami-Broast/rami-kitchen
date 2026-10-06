import React, { useState } from 'react';

import { ApiError } from '../api/http';
import { useAuth } from '../auth/AuthProvider';

/** Branch-staff sign-in for the POS. */
export function LoginScreen(): React.JSX.Element {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.details && err.details.length > 0 ? err.details.join(' ') : err.message);
      } else {
        setError('Could not sign in.');
      }
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 24 }}>
      <form className="card" onSubmit={submit} style={{ width: 'min(400px, 100%)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <img src="/logo.jpeg" alt="Rami Broast" style={{ width: 200, height: 80, objectFit: 'contain' }} />
          <p className="muted" style={{ margin: '4px 0 0' }}>Branch POS — staff sign in</p>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Email</span>
          <input className="input" type="text" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Password</span>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error ? <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p> : null}
        <button className="btn block" type="submit" disabled={busy || !email || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
