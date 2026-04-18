/**
 * @fileoverview Tabla con TanStack Table: ordenación y filtro global (Shadcn Table).
 */
import { useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type DataTableProps<T> = {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  filterPlaceholder?: string;
  /** Clase del contenedor de la tabla (scroll horizontal). */
  tableClassName?: string;
};

export function DataTable<T>({ columns, data, filterPlaceholder = 'Filtrar…', tableClassName }: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: 'includesString',
  });

  return (
    <div className="space-y-3">
      <Input
        value={globalFilter ?? ''}
        onChange={(e) => setGlobalFilter(e.target.value)}
        placeholder={filterPlaceholder}
        className="max-w-sm border-[var(--border)] bg-[var(--input)]/30"
      />
      <div className={cn('rounded-xl border border-[var(--border)] bg-[var(--card)]/50', tableClassName)}>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="border-[var(--border)] hover:bg-transparent">
                {hg.headers.map((header) => (
                  <TableHead key={header.id} className="text-[var(--foreground-muted)]">
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-ml-2 h-8 font-semibold hover:bg-[var(--secondary)]"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === 'desc' ? (
                          <ArrowDown className="ml-1 size-3.5 opacity-70" />
                        ) : header.column.getIsSorted() === 'asc' ? (
                          <ArrowUp className="ml-1 size-3.5 opacity-70" />
                        ) : (
                          <ArrowUpDown className="ml-1 size-3.5 opacity-40" />
                        )}
                      </Button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="border-[var(--border)]/80 transition-colors hover:bg-[var(--secondary)]/40">
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-sm text-[var(--foreground-muted)]">
                  Sin resultados.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
