'use client'

import {
  ColumnDef,
  ColumnFiltersState,
  ColumnPinningState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useTeams } from '@/lib/contexts/teams-context'
import { cn } from '@/lib/utils'
import { useEffect, useState } from 'react'
import { MonthScoresRow } from './scores-table-types'
import SkeletonTable from './skeleton-table'
import { getColumns, getData, getDayVisibility, getHeaderClass, getRowClass } from './table-config'

const ScoresTable = ({ classes }: { classes?: string }) => {
  const [loading, setLoading] = useState(true)
  const { teams, teamId, selectedMonth } = useTeams()
  const [columns, setColumns] = useState<ColumnDef<MonthScoresRow>[]>([])
  const [data, setData] = useState<MonthScoresRow[]>([])

  useEffect(() => {
    const team = teams?.find((t) => t.id === teamId)
    if (team) {
      setColumns(getColumns(selectedMonth, team.playWeekends ?? false))
      setData(getData(team, selectedMonth))
    }
    setLoading(false)
  }, [])
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>({})
  const [rowSelection, setRowSelection] = useState({})
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(getDayVisibility(selectedMonth))

  const table = useReactTable({
    data,
    columns,
    enablePinning: true,
    onColumnPinningChange: setColumnPinning,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    state: {
      sorting,
      columnPinning,
      columnFilters,
      columnVisibility,
      rowSelection,
    },
    initialState: {
      columnPinning: {
        left: ['playerName'],
        right: ['monthTotal'],
      },
    },
  })

  return table.getRowModel().rows?.length ? (
    <div className={classes}>
      <div className='rounded-md border text-xs max-w-[96vw] md:text-base'>
        <Table className={cn('relative', loading ? 'animate-pulse' : '')}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id} className={getHeaderClass(header.id)}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={getRowClass(cell.id)}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className='h-24 text-center'>
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  ) : (
    <SkeletonTable classes={classes} />
  )
}

export default ScoresTable
