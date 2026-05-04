/**
 * Perfil de usuario: datos personales y gestión de secret MCP.
 * Patrón UI idéntico a McpSecretCard de The Forge: toggle ojo, copia, regenerar con confirmación.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Shield, Eye, EyeOff, Copy, Check, RefreshCw, User, Mail } from 'lucide-react';
import { getUser, removeToken } from '../utils/auth';
import type { UserInfo } from '../utils/auth';
import { api } from '../api';

export function ProfilePage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [mcpSecret, setMcpSecret] = useState<string>('');
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const u = getUser();
    if (!u) {
      navigate('/login', { replace: true });
      return;
    }
    setUser(u);
  }, [navigate]);

  // Cargar secret al montar el componente (cuando tengamos user)
  useEffect(() => {
    if (user) {
      fetchSecret();
    }
  }, [user]);

  const fetchSecret = async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.getMcpSecret(user.id);
      setMcpSecret(data.mcpSecret ?? '');
      setMessage(data.mcpSecret ? '' : '');
    } catch (err) {
      setError('Error al obtener el secret MCP');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = async () => {
    if (!user) return;
    if (!confirm('¿Regenerar el secret MCP? El secret anterior dejará de funcionar inmediatamente.')) return;

    setLoading(true);
    setError('');
    setMessage('');
    try {
      const data = await api.regenerateMcpToken(user.id);
      setMcpSecret(data.token);
      setMessage('Secret regenerado exitosamente. Guárdalo de inmediato.');
    } catch (err) {
      setError('Error al regenerar el secret MCP');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(mcpSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback para entornos sin clipboard API
      const ta = document.createElement('textarea');
      ta.value = mcpSecret;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleLogout = () => {
    removeToken();
    navigate('/login', { replace: true });
  };

  if (!user) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Perfil</h1>
        <p className="text-muted-foreground mt-1">Configuración de tu cuenta</p>
      </div>

      {/* Datos del usuario */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Información de la cuenta
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="font-medium">{user.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Rol</p>
              <p className="font-medium capitalize">{user.role}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Secret MCP */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--primary)]/10">
              <Shield className="h-5 w-5 text-[var(--primary)]" />
            </div>
            <div>
              <CardTitle>Secret MCP</CardTitle>
              <CardDescription>
                Token para autenticar el MCP server como tu usuario. Se genera automáticamente y es rotable.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Mensajes */}
            {message && (
              <div className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-4 py-3 text-sm text-[var(--accent)]">
                {message}
              </div>
            )}
            {error && (
              <div className="rounded-lg border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 px-4 py-3 text-sm text-[var(--destructive)]">
                {error}
              </div>
            )}

            {/* Secret display */}
            <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/50 p-3">
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all font-mono text-sm text-[var(--foreground)]">
                  {mcpSecret
                    ? visible
                      ? mcpSecret
                      : mcpSecret.replace(/./g, '•')
                    : loading
                    ? 'Cargando...'
                    : 'Sin secret disponible'}
                </code>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setVisible(!visible)}
                  disabled={!mcpSecret}
                >
                  {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleCopy}
                  disabled={!mcpSecret}
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRegenerate}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Regenerar secret
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchSecret}
                disabled={loading}
              >
                Recargar
              </Button>
            </div>

            <p className="text-xs text-[var(--foreground-muted)]">
              Este secret permite que el MCP server actúe en tu nombre. Si lo comprometes,
              regéneralo para invalidar el anterior.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Cerrar sesión */}
      <div className="pt-4">
        <Button variant="destructive" onClick={handleLogout} className="w-full">
          Cerrar sesión
        </Button>
      </div>
    </div>
  );
}
