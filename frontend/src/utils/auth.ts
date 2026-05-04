/**
 * @fileoverview Auth OTP: token JWT local, request/verify OTP contra API.
 * Incluye decodificación del JWT para extraer userId, role y email.
 */
const API_BASE =
  ((import.meta.env.VITE_API_URL as string) || 'http://localhost:3000').replace(
    /\/$/,
    '',
  ) + '/api';

const TOKEN_KEY = 'ariadne_token';
const USER_KEY = 'ariadne_user';

export interface UserInfo {
  id: string;
  email: string;
  role: 'admin' | 'developer';
  name: string | null;
}

/** Extrae datos del JWT sin verificar firma. */
function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(atob(token.split('.')[1])) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);

export const setToken = (token: string): void => {
  localStorage.setItem(TOKEN_KEY, token);
  // Extraer user info del JWT y guardarlo
  const payload = decodeJwt(token);
  if (payload) {
    const user: UserInfo = {
      id: (payload.userId as string) || (payload.sub as string) || '',
      email: (payload.email as string) || (payload.sub as string) || '',
      role: (payload.role as 'admin' | 'developer') || 'admin',
      name: (payload.name as string) || null,
    };
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
};

export const removeToken = (): void => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};

export const getUser = (): UserInfo | null => {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserInfo;
  } catch {
    return null;
  }
};

export const isTokenExpired = (token: string): boolean => {
  try {
    const payload = decodeJwt(token);
    const exp = ((payload?.exp as number) ?? 0) * 1000;
    return Date.now() >= exp;
  } catch {
    return true;
  }
};

/** Solicita OTP para email. En dev (OTP_DEV_MODE) la respuesta puede incluir devCode. */
export const requestOtp = async (
  email: string,
): Promise<{ sent: boolean; devCode?: string }> => {
  const res = await fetch(`${API_BASE}/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      const json = JSON.parse(text) as { message?: string };
      if (json?.message) msg = json.message;
    } catch {
      /* use text */
    }
    throw new Error(msg);
  }
  return res.json();
};

/** Verifica OTP y devuelve token + user si es válido. */
export const verifyOtp = async (
  email: string,
  code: string,
): Promise<{ valid: boolean; token?: string; user?: UserInfo }> => {
  const res = await fetch(`${API_BASE}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  const data = await res.json();
  return {
    valid: data?.valid === true,
    token: data?.token,
    user: data?.user
      ? {
          id: data.user.id,
          email: data.user.email,
          role: data.user.role === 'admin' ? 'admin' : 'developer',
          name: data.user.name || null,
        }
      : undefined,
  };
};
