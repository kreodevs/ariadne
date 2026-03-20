/**
 * Protege rutas exigiendo autenticación OTP (JWT válido).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getToken, isTokenExpired } from '../utils/auth';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

/** Envuelve children y exige token JWT válido. Redirige a /login si no hay sesión. */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token || isTokenExpired(token)) {
      setAuthenticated(false);
    } else {
      setAuthenticated(true);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      navigate('/login', { replace: true });
    }
  }, [ready, authenticated, navigate]);

  if (!ready) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <span className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-muted-foreground text-sm">Comprobando sesión...</p>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return null;
  }

  return <>{children}</>;
}
