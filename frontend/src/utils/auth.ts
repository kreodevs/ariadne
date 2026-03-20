/**
 * @fileoverview Auth OTP: token JWT local, request/verify OTP contra API.
 */
const API_BASE =
  ((import.meta.env.VITE_API_URL as string) || 'http://localhost:3000').replace(
    /\/$/,
    '',
  ) + '/api';

const TOKEN_KEY = 'ariadne_token';

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);

export const setToken = (token: string): void => {
  localStorage.setItem(TOKEN_KEY, token);
};

export const removeToken = (): void => {
  localStorage.removeItem(TOKEN_KEY);
};

export const isTokenExpired = (token: string): boolean => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1])) as { exp?: number };
    const exp = (payload.exp ?? 0) * 1000;
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

/** Verifica OTP y devuelve token si es válido. */
export const verifyOtp = async (
  email: string,
  code: string,
): Promise<{ valid: boolean; token?: string }> => {
  const res = await fetch(`${API_BASE}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  const data = await res.json();
  return { valid: data?.valid === true, token: data?.token };
};
