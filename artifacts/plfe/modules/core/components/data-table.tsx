"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, FileSpreadsheet, Inbox, RotateCw, Search } from "lucide-react";
import { API, list, type PageData, type RecordData } from "@/lib/client";
import { L } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type DataTableProps = {
  company: string;
  resource: string;
  columns: ColumnDef<RecordData, any>[];
  refreshKey?: number;
  statusOptions?: { value: string; label: string }[];
  toolbar?: ReactNode;
  extra?: Record<string, string>;
  pageSize?: number;
  onRowClick?: (r: RecordData) => void;
  exportable?: boolean;
};

export function DataTable({ company, resource, columns, refreshKey = 0, statusOptions, toolbar, extra, pageSize = 10, onRowClick, exportable = true }: DataTableProps) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);
  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const extraKey = JSON.stringify(extra ?? {});
  useEffect(()=>setPage(1),[extraKey,resource,company]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ search: q, page: String(page), pageSize: String(pageSize), sort: sorting[0]?.id ?? "createdAt", direction: sorting[0]?.desc === false ? "asc" : "desc", status });
    Object.entries(JSON.parse(extraKey) as Record<string, string>).forEach(([k, v]) => p.set(k, v));
    return p;
  }, [q, page, pageSize, sorting, status, extraKey]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    list(company, resource, params)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [company, resource, params, refreshKey, tick]);

  const table = useReactTable({
    data: data?.rows ?? [],
    columns,
    state: { sorting },
    manualSorting: true,
    manualPagination: true,
    enableSortingRemoval: false,
    onSortingChange: (u) => { setSorting(u); setPage(1); },
    getCoreRowModel: getCoreRowModel(),
  });
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const exportHref = (() => { const p = new URLSearchParams(params); p.set("export", "xlsx"); p.delete("page"); return `${API}/${company}/${resource}?${p}`; })();

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2.5">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            placeholder={L.common.search}
            className="h-8 bg-card pl-8 text-sm"
            data-testid={`input-search-${resource}`}
            onChange={(e) => {
              const v = e.target.value;
              setSearch(v);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => { setQ(v); setPage(1); }, 300);
            }}
          />
        </div>
        {statusOptions && (
          <Select value={status || "__all"} onValueChange={(v) => { setStatus(v === "__all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="h-8 w-40 bg-card text-sm" data-testid={`select-status-${resource}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{L.common.allStatuses}</SelectItem>
              {statusOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setTick((t) => t + 1)} title={L.common.retry} data-testid={`button-refresh-${resource}`}><RotateCw className={loading ? "animate-spin" : ""} /></Button>
          {exportable && (
            <Button variant="outline" size="sm" asChild>
              <a href={exportHref} data-testid={`button-export-${resource}`}><FileSpreadsheet className="text-success" />{L.common.export}</a>
            </Button>
          )}
          {toolbar}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b">
                {hg.headers.map((h) => {
                  const can = h.column.getCanSort();
                  const dir = h.column.getIsSorted();
                  return (
                    <th key={h.id} className="h-9 whitespace-nowrap px-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      {can ? (
                        <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={h.column.getToggleSortingHandler()}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {dir === "asc" ? <ArrowUp className="h-3 w-3 text-primary" /> : dir === "desc" ? <ArrowDown className="h-3 w-3 text-primary" /> : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                        </button>
                      ) : flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading && !data ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b last:border-0">{columns.map((_, j) => <td key={j} className="px-3 py-3"><Skeleton className="h-4 w-full max-w-[160px]" /></td>)}</tr>
              ))
            ) : error ? (
              <tr><td colSpan={columns.length} className="px-3 py-12 text-center">
                <p className="font-medium text-destructive">{L.common.errorTitle}</p>
                <p className="mt-1 text-sm text-muted-foreground">{error}</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => setTick((t) => t + 1)}><RotateCw />{L.common.retry}</Button>
              </td></tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-3 py-14 text-center">
                <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-secondary text-secondary-foreground"><Inbox className="h-5 w-5" /></div>
                <p className="font-display font-semibold">{q || status ? L.common.noResults : L.common.empty}</p>
                {!q && !status && <p className="mt-1 text-sm text-muted-foreground">{L.common.emptyBody}</p>}
              </td></tr>
            ) : (
              table.getRowModel().rows.map((r) => (
                <tr
                  key={r.id}
                  data-testid={`row-${resource}-${r.original.id}`}
                  onClick={onRowClick ? () => onRowClick(r.original) : undefined}
                  className={`border-b transition-colors last:border-0 hover:bg-accent/[0.07] ${onRowClick ? "cursor-pointer" : ""} ${loading ? "opacity-60" : ""}`}
                >
                  {r.getVisibleCells().map((c) => <td key={c.id} className="whitespace-nowrap px-3 py-2.5 align-middle">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-mono">{total} {L.common.rows}</span>
        <div className="flex items-center gap-2">
          <span className="font-mono">{L.common.page} {page} {L.common.of} {pages}</span>
          <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} title={L.common.prev} data-testid={`button-prev-${resource}`}><ChevronLeft /></Button>
          <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} title={L.common.next} data-testid={`button-next-${resource}`}><ChevronRight /></Button>
        </div>
      </div>
    </div>
  );
}
