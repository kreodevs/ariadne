/**
 * @fileoverview Utilidades SSO para integración con apisso.grupowib.com.mx. Flujo: redirigir a SSO si no hay token → callback guarda token → requests con Bearer.
 */
const SSO_BASE = (import.meta.env.VITE_SSO_BASE_URL as string) || 'https://apisso.grupowib.com.mx/api/v1';
const SSO_APP_ID = (import.meta.env.VITE_SSO_APPLICATION_ID as string) || '';

export const SSO_CONFIG = {
  baseUrl: SSO_BASE,
  frontendUrl: (import.meta.env.VITE_SSO_FRONTEND_URL as string) || 'https://sso.grupowib.com.mx',
  applicationId: SSO_APP_ID,
};

/** Indica si SSO está configurado (VITE_SSO_APPLICATION_ID). */
export const isSSOEnabled = (): boolean => !!SSO_APP_ID.trim();

/** Obtiene el token JWT del localStorage. */
export const getToken = (): string | null => localStorage.getItem('sso_token');

/** Guarda el token en localStorage. */
export const setToken = (token: string): void => {
  localStorage.setItem('sso_token', token);
};

/** Elimina el token del localStorage. */
export const removeToken = (): void => {
  localStorage.removeItem('sso_token');
};

/** Comprueba si el JWT está expirado (claim exp). */
export const isTokenExpired = (token: string): boolean => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const exp = (payload.exp ?? 0) * 1000;
    return Date.now() >= exp;
  } catch {
    return true;
  }
};

/** Redirige al flujo SSO; opcionalmente usa returnUrl como URL de retorno. */
export const redirectToSSO = (returnUrl?: string): void => {
  const url = returnUrl || window.location.href;
  const ssoUrl = `${SSO_CONFIG.baseUrl}/auth/sso?applicationId=${SSO_CONFIG.applicationId}&returnUrl=${encodeURIComponent(url)}`;
  window.location.href = ssoUrl;
};

/**
 * Extrae token de query ?token=..., lo guarda en localStorage y limpia la URL. Retorna true si encontró y guardó.
 * @returns {boolean}
 */
export const extractTokenFromUrl = (): boolean => {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (!token) return false;
  setToken(token);
  params.delete('token');
  const qs = params.toString();
  const clean = window.location.pathname + (qs ? `?${qs}` : '');
  window.history.replaceState({}, document.title, clean);
  return true;
};

/** Valida el token contra el endpoint /auth/validate del SSO. */
export const validateToken = async (token: string): Promise<boolean> => {
  try {
    const res = await fetch(`${SSO_CONFIG.baseUrl}/auth/validate`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Application-Id': SSO_CONFIG.applicationId,
      },
    });
    const json = await res.json();
    return json?.data?.valid === true || json?.valid === true;
  } catch {
    return false;
  }
};

/**
 * Comprueba si el payload del JWT incluye rol "admin" para esta aplicación o isSystemAdmin.
 * @param {string} token - JWT.
 * @returns {boolean}
 */
export const hasAdminRole = (token: string): boolean => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1])) as {
      isSystemAdmin?: boolean;
      applications?: Array<{ applicationId: string; roles?: string[] }>;
    };
    if (payload.isSystemAdmin) return true;
    const app = payload.applications?.find((a) => a.applicationId === SSO_CONFIG.applicationId);
    return Boolean(app?.roles?.includes('admin'));
  } catch {
    return false;
  }
};
