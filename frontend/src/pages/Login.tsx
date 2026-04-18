/**
 * Página de login con OTP: email → código.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

type Step = 'email' | 'code';

export function Login() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

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
        setToken(result.token);
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
          {step === 'email' ? (
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
