/**
 * Perfil de usuario: datos personales y gestión de token MCP.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Key, Copy, Check, RefreshCw, Shield, Mail, User } from 'lucide-react';
import { getUser, removeToken } from '../utils/auth';
import type { UserInfo } from '../utils/auth';
import { api } from '../api';

export function ProfilePage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [mcpToken, setMcpToken] = useState<string | null>(null);
  const [hasMcpToken, setHasMcpToken] = useState(false);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const u = getUser();
    if (!u) {
      navigate('/login', { replace: true });
      return;
    }
    setUser(u);
    // Cargar info del perfil desde la API
    loadProfile();
  }, [navigate]);

  const loadProfile = async () => {
    try {
      const u = getUser();
      if (!u) return;
      // /users/:id da info del token
      const profile = await api.getUserProfile(u.id) as {
        mcpTokenPrefix: string | null;
        hasMcpToken: boolean;
      };
      setHasMcpToken(profile.hasMcpToken);
    } catch {
      // Si falla, al menos tenemos los datos locales
    }
  };

  const handleRegenerateToken = async () => {
    if (!user) return;
    setRegenerating(true);
    setError(null);
    setCopied(false);
    try {
      const result = await api.regenerateMcpToken(user.id) as {
        token: string;
        prefix: string;
      };
      setMcpToken(result.token);
      setHasMcpToken(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al regenerar token');
    } finally {
      setRegenerating(false);
    }
  };

  const handleCopyToken = () => {
    if (!mcpToken) return;
    navigator.clipboard.writeText(mcpToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <div>
              <Label className="text-xs text-muted-foreground">Email</Label>
              <p className="font-medium">{user.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <div>
              <Label className="text-xs text-muted-foreground">Rol</Label>
              <p className="font-medium capitalize">{user.role}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Token MCP */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Token MCP
          </CardTitle>
          <CardDescription>
            Usa este token para autenticarte en el servidor MCP de Ariadne desde tu IDE o agente.
            El token solo se muestra una vez al generarlo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {mcpToken && (
            <div className="space-y-2">
              <Label htmlFor="mcp-token">Tu nuevo token MCP</Label>
              <div className="flex gap-2">
                <Input
                  id="mcp-token"
                  value={mcpToken}
                  readOnly
                  className="font-mono text-xs"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleCopyToken}
                  title="Copiar token"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-amber-600 dark:text-amber-400">
                ⚠️ Guarda este token en un lugar seguro. No podrás volver a verlo.
              </p>
            </div>
          )}

          {!mcpToken && hasMcpToken && (
            <p className="text-sm text-muted-foreground">
              Ya tienes un token MCP generado. Al regenerarlo, el anterior dejará de funcionar.
            </p>
          )}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <Button
            onClick={handleRegenerateToken}
            disabled={regenerating}
            variant={mcpToken ? 'outline' : 'default'}
            className="w-full"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${regenerating ? 'animate-spin' : ''}`} />
            {mcpToken ? 'Regenerar token' : hasMcpToken ? 'Regenerar token' : 'Generar token MCP'}
          </Button>
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

// Añadir función a api para user profile
// Esto se agrega en api.ts
