/**
 * Página de configuración inicial — crear primer administrador.
 * Solo accesible cuando no hay usuarios registrados en el sistema.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const API_BASE =
  ((import.meta.env.VITE_API_URL as string) || 'http://localhost:3000').replace(
    /\/$/,
    '',
  ) + '/api';

export function SetupPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [checking, setChecking] = useState(true);

  // Verificar que realmente no hay usuarios; si los hay, redirigir al login
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/auth/has-users`)
      .then((r) => r.json())
      .then((data: { hasUsers?: boolean }) => {
        if (cancelled) return;
        if (data.hasUsers !== false) {
          navigate('/login', { replace: true });
          return;
        }
        setChecking(false);
      })
      .catch(() => {
        if (cancelled) return;
        setChecking(false);
      });
    return () => { cancelled = true; };
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
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
        body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined }),
      });
      const data = await res.json();
      if (data?.created && data?.user) {
        setSuccess(true);
      } else {
        setError(data?.message || 'Error al crear administrador');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[var(--background)] p-4">
        <p className="text-muted-foreground text-sm">Verificando estado del sistema...</p>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[var(--background)] p-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-2xl">¡Listo! 🎉</CardTitle>
            <CardDescription>
              Administrador <strong>{email}</strong> creado exitosamente.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Ahora inicia sesión con tu email para acceder al sistema.
              Recibirás un código OTP en tu correo.
            </p>
            <Button
              type="button"
              className="w-full"
              onClick={() => navigate('/login', { replace: true })}
            >
              Ir a iniciar sesión
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[var(--background)] p-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Configuración inicial</CardTitle>
          <CardDescription>
            No hay usuarios registrados. Crea el primer administrador del sistema.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-4 py-3">
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Este formulario solo está disponible durante la configuración inicial.
                El primer usuario se creará con rol de <strong>administrador</strong>.
              </p>
            </div>
            <div>
              <Label htmlFor="setup-email">Email</Label>
              <Input
                id="setup-email"
                type="email"
                placeholder="admin@ejemplo.com"
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
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
                className="mt-2"
              />
            </div>
            {error && (
              <p className="text-destructive text-sm">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Creando administrador...' : 'Crear administrador'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
