/**
 * Protege rutas exigiendo autenticación OTP (JWT válido). Usar como ruta layout con `<Outlet />`.
 */
import { useEffect, useState } from 'react';
import { useNavigate, Outlet } from 'react-router-dom';
import { getToken, isTokenExpired } from '../utils/auth';

/**
 * Envuelve rutas hijas y exige token JWT válido. Redirige a /login si no hay sesión.
 * Solo pruebas e2e: `VITE_E2E_AUTH_BYPASS=true` (nunca en producción).
 */
export function ProtectedRoute() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  const e2eBypass = import.meta.env.VITE_E2E_AUTH_BYPASS === 'true';

  useEffect(() => {
    if (e2eBypass) {
      setAuthenticated(true);
      setReady(true);
      return;
    }
    const token = getToken();
    if (!token || isTokenExpired(token)) {
      setAuthenticated(false);
    } else {
      setAuthenticated(true);
    }
    setReady(true);
  }, [e2eBypass]);

  useEffect(() => {
    if (e2eBypass) return;
    if (!ready) return;
    if (!authenticated) {
      navigate('/login', { replace: true });
    }
  }, [e2eBypass, ready, authenticated, navigate]);

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

  return <Outlet />;
}
