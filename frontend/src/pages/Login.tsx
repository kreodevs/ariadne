/**
 * Página de login con OTP: email → código.
 */
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  requestOtp,
  verifyOtp,
  setToken,
  getToken,
  isTokenExpired,
} from '../utils/auth';

const API_BASE =
  ((import.meta.env.VITE_API_URL as string) || 'http://localhost:3000').replace(
    /\/$/,
    '',
  ) + '/api';

type Step = 'email' | 'code' | 'sso' | 'register';

export function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [setupName, setSetupName] = useState('');

  // Check for SSO config, SSO redirect token, and if setup is needed
  useEffect(() => {
    // Check SSO via import.meta.env
    const ssoUrl = import.meta.env.VITE_SSO_URL as string;
    if (ssoUrl?.trim()) {
      setSsoEnabled(true);
    }

    // Handle SSO redirect back with token
    const ssoToken = searchParams.get('sso_token');
    if (ssoToken) {
      handleSsoLogin(ssoToken);
    }

    // Check if users exist
    checkHasUsers();
  }, [searchParams]);

  const checkHasUsers = async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/has-users`);
      const data = await res.json() as { hasUsers?: boolean };
      if (data.hasUsers === false) {
        setNeedsSetup(true);
        setStep('register');
      } else {
        setNeedsSetup(false);
      }
    } catch {
      setNeedsSetup(false);
    }
  };

  const handleRegisterFirstAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Email requerido');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/auth/register-first-admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), name: setupName.trim() || undefined }),
      });
      const data = await res.json();
      if (data?.created && data?.user) {
        setStep('email');
        setNeedsSetup(false);
        setError(null);
      } else {
        setError(data?.message || 'Error al crear administrador');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  const handleSsoLogin = async (token: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/auth/sso/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (data?.valid && data?.token) {
        setToken(data.token);
        navigate('/dashboard', { replace: true });
      } else {
        setError('Error de autenticación SSO');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error SSO');
    } finally {
      setLoading(false);
    }
  };

  const handleSsoRedirect = () => {
    const ssoUrl = import.meta.env.VITE_SSO_URL as string;
    if (ssoUrl) {
      window.location.href = ssoUrl;
    }
  };

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError('Email requerido');
      return;
    }
    setLoading(true);
    try {
      const result = await requestOtp(email.trim());
      if (result.devCode) setDevCode(result.devCode);
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al solicitar OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!code.trim()) {
      setError('Código requerido');
      return;
    }
    setLoading(true);
    try {
      const result = await verifyOtp(email.trim(), code.trim());
      if (result.valid && result.token) {
        // setToken guarda automáticamente el user desde el JWT
        if (result.user) {
          // Si la API devuelve user, lo usamos directamente
          setToken(result.token);
          // Forzar actualización guardando user explícitamente
          localStorage.setItem('ariadne_user', JSON.stringify(result.user));
        } else {
          setToken(result.token);
        }
        navigate('/dashboard', { replace: true });
      } else {
        setError('Código incorrecto o expirado');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al verificar');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setStep('email');
    setCode('');
    setError(null);
    setDevCode(null);
  };

  const token = getToken();
  if (token && !isTokenExpired(token)) {
    navigate('/dashboard', { replace: true });
    return null;
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[var(--background)] p-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">ARIADNE</CardTitle>
          <CardDescription>
            {step === 'email'
              ? 'Ingresa tu email para recibir un código'
              : 'Ingresa el código de 6 dígitos'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {needsSetup === null ? (
            <p className="text-muted-foreground text-sm">Cargando...</p>
          ) : step === 'register' ? (
            <form onSubmit={handleRegisterFirstAdmin} className="space-y-4">
              <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                ⚙️ No hay usuarios registrados. Crea el primer administrador.
              </p>
              <div>
                <Label htmlFor="setup-email">Email</Label>
                <Input
                  id="setup-email"
                  type="email"
                  placeholder="admin@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  autoFocus
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="setup-name">Nombre (opcional)</Label>
                <Input
                  id="setup-name"
                  type="text"
                  placeholder="Tu nombre"
                  value={setupName}
                  onChange={(e) => setSetupName(e.target.value)}
                  disabled={loading}
                  className="mt-2"
                />
              </div>
              {error && (
                <p className="text-destructive text-sm">{error}</p>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Creando...' : 'Crear administrador'}
              </Button>
            </form>
          ) : step === 'email' ? (
            <>
            <form onSubmit={handleRequestOtp} className="space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="tu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  autoFocus
                  className="mt-2"
                />
              </div>
              {error && (
                <p className="text-destructive text-sm">{error}</p>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Enviando...' : 'Enviar código'}
              </Button>
            </form>
            {ssoEnabled && (
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-[var(--card)] px-2 text-muted-foreground">o</span>
                </div>
              </div>
            )}
            {ssoEnabled && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleSsoRedirect}
                disabled={loading}
              >
                Iniciar sesión con SSO
              </Button>
            )}
            </>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <p className="text-muted-foreground text-sm">
                Código enviado a <strong>{email}</strong>
              </p>
              {devCode && (
                <p className="rounded-md bg-amber-500/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                  Modo dev: código <code className="font-mono font-bold">{devCode}</code>
                </p>
              )}
              <div>
                <Label htmlFor="code">Código</Label>
                <Input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  placeholder="000000"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  disabled={loading}
                  autoFocus
                  className="mt-2 font-mono text-lg tracking-widest"
                />
              </div>
              {error && (
                <p className="text-destructive text-sm">{error}</p>
              )}
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={handleBack} disabled={loading}>
                  Atrás
                </Button>
                <Button type="submit" className="flex-1" disabled={loading || code.length !== 6}>
                  {loading ? 'Verificando...' : 'Verificar'}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
