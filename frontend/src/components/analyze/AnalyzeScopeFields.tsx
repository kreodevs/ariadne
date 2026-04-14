/**
 * Campos opcionales de alcance para analyze (prefijos, globs, duplicados cross-boundary).
 */
import { Label } from '@/components/ui/label';

export function AnalyzeScopeFields(props: {
  includePrefixesText: string;
  onIncludePrefixesText: (v: string) => void;
  excludeGlobsText: string;
  onExcludeGlobsText: (v: string) => void;
  crossPackageDuplicates: boolean;
  onCrossPackageDuplicates: (v: boolean) => void;
  showCrossPackage: boolean;
}) {
  return (
    <div className="space-y-3 rounded-md border border-dashed border-[var(--border)] p-3 text-xs">
      <p className="font-medium text-foreground">Alcance opcional</p>
      <div className="space-y-1">
        <Label htmlFor="analyze-include-prefixes" className="text-muted-foreground font-normal">
          Prefijos de ruta (uno por línea)
        </Label>
        <textarea
          id="analyze-include-prefixes"
          value={props.includePrefixesText}
          onChange={(e) => props.onIncludePrefixesText(e.target.value)}
          rows={2}
          placeholder="p. ej. src/components"
          className="w-full resize-y rounded-md border bg-background px-2 py-1.5 font-mono text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="analyze-exclude-globs" className="text-muted-foreground font-normal">
          Excluir (globs, uno por línea)
        </Label>
        <textarea
          id="analyze-exclude-globs"
          value={props.excludeGlobsText}
          onChange={(e) => props.onExcludeGlobsText(e.target.value)}
          rows={2}
          placeholder="p. ej. **/*.spec.ts"
          className="w-full resize-y rounded-md border bg-background px-2 py-1.5 font-mono text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      {props.showCrossPackage && (
        <label className="flex cursor-pointer items-start gap-2 pt-1">
          <input
            type="checkbox"
            className="mt-0.5 rounded border-[var(--border)]"
            checked={props.crossPackageDuplicates}
            onChange={(e) => props.onCrossPackageDuplicates(e.target.checked)}
          />
          <span className="text-muted-foreground leading-snug">
            Modo duplicados: incluir pares cross-boundary (un solo extremo en el foco)
          </span>
        </label>
      )}
    </div>
  );
}
