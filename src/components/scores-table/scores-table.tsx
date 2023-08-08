'use client'

import {
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
import AppContext from '@/lib/app-context'
import { cn } from '@/lib/utils'
import { useContext, useMemo, useState } from 'react'
import ScoresTableHeader from './scores-table-header'
import { getColumns, getData, getDayVisibility, getHeaderClass, getRowClass } from './table-config'

const ScoresTable = ({ classes }: { classes?: string }) => {
  const appContext = useContext(AppContext)
  const { selectedTeam, selectedMonth } = appContext

  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>({})
  const [rowSelection, setRowSelection] = useState({})
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(getDayVisibility(selectedMonth))

  const columns = useMemo(
    () => getColumns(selectedMonth, selectedTeam.playWeekends),
    [selectedMonth, selectedTeam]
  )
  const data = useMemo(() => getData(selectedTeam, selectedMonth), [selectedTeam, selectedMonth])

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

  return (
    <div className={cn('w-full', classes)}>
      <ScoresTableHeader />
      <div className='rounded-md border text-xs @md/root:text-base'>
        <Table>
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
  )
}

export default ScoresTable
