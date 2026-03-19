/**
 * Página de callback SSO. Recibe token por query, lo guarda y redirige a /.
 */
import { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { setToken, redirectToSSO, isSSOEnabled } from '../utils/sso';

/** Página de callback SSO: recibe token o error por query, guarda token y redirige a / o a /error. */
export function Callback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isSSOEnabled()) {
      navigate('/', { replace: true });
      return;
    }

    const token = searchParams.get('token');
    const error = searchParams.get('error');

    if (error) {
      console.error('Error SSO:', error);
      navigate(`/error?message=${encodeURIComponent(error)}`, { replace: true });
      return;
    }

    if (token) {
      setToken(token);
      window.history.replaceState({}, document.title, window.location.pathname);
      navigate('/', { replace: true });
    } else {
      redirectToSSO(window.location.origin + '/callback');
    }
  }, [searchParams, navigate]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <span className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-muted-foreground text-sm">Procesando autenticación...</p>
      </div>
    </div>
  );
}
