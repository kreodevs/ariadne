/**
 * Protege rutas exigiendo autenticación SSO. Si no hay token válido, redirige al SSO.
 */
import { useEffect, useState } from 'react';
import {
  getToken,
  isTokenExpired,
  redirectToSSO,
  validateToken,
  hasAdminRole,
  isSSOEnabled,
  extractTokenFromUrl,
} from '../utils/sso';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

/** Envuelve children y exige autenticación SSO (token válido + rol admin). Muestra loading o acceso denegado hasta que check() termine. */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    if (!isSSOEnabled()) {
      setAuthenticated(true);
      setReady(true);
      return;
    }

    /** Comprueba token en URL, valida con backend y rol admin; redirige a SSO si no hay token o no es válido. */
    const check = async () => {
      extractTokenFromUrl();
      const token = getToken();
      if (!token || isTokenExpired(token)) {
        redirectToSSO();
        setReady(true);
        return;
      }
      const valid = await validateToken(token);
      if (!valid) {
        redirectToSSO();
        setReady(true);
        return;
      }
      setAuthenticated(hasAdminRole(token));
      setReady(true);
    };

    check();
  }, []);

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
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
        <p className="text-destructive font-medium">Acceso denegado</p>
        <p className="text-muted-foreground text-sm">
          Se requiere rol admin para acceder a esta aplicación.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
