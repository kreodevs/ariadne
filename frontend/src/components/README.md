# Componentes

## Layout

- **Layout** — Shell principal con SidebarModern (Kreo), header y área de contenido.
- **layout/SidebarModern** — Navegación lateral colapsable con grupos, iconos y sección de usuario/SSO.
- **atoms/Avatar** — Avatar con imagen, iniciales o icono por defecto.

## UI (Kreo)

Componentes basados en el registro Kreo con tema corporate/luxury (negro, carbón, dorado):

- **button** — Variantes: default, destructive, outline, secondary, ghost, link. Soporta `asChild` para Link.
- **card** — Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter.
- **input** — Campo de texto.
- **select** — Select Radix con Trigger, Content, Item.
- **badge** — Etiquetas con variantes.
- **label** — Etiquetas para formularios.
- **alert** — Alert, AlertTitle, AlertDescription.
- **skeleton** — Placeholder de carga (pulse).
- **table** — Table, TableHeader, TableBody, TableRow, TableHead, TableCell.
- **dialog** — Modal Radix con composición.

## Otros

- **MarkdownBlock** — Renderiza markdown con ReactMarkdown + remarkGfm (tablas, encabezados). Usado en diagnósticos y reingeniería.
- **StatusBadge** — Badge de estado para jobs/repos (pending, running, completed, error).
- **ProtectedRoute** — Wrapper para rutas que requieren autenticación.
- **DocViewer** — Visor de documentación markdown.
