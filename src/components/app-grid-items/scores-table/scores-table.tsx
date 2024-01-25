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
import { Database } from '@/lib/database.types'
import { Team } from '@/lib/types'
import { cn, monthAsDate } from '@/lib/utils'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { useEffect, useState } from 'react'
import { MonthScoresRow } from './scores-table-types'
import { getColumns, getData, getDayVisibility, getHeaderClass, getRowClass } from './table-config'

const ScoresTable = ({ teamId, month, classes }: { teamId: number; month: string; classes?: string }) => {
  const [loading, setLoading] = useState(false)
  const selectedMonth = monthAsDate(month)
  const supabase = createClientComponentClient<Database>()
  const [columns, setColumns] = useState<ColumnDef<MonthScoresRow>[]>([])
  const [data, setData] = useState<MonthScoresRow[]>([])

  useEffect(() => {
    const getTeams = async () => {
      setLoading(true)
      const { data: dbTeam } = await supabase.from('teams').select('*').eq('id', teamId).single()
      const playerIds = dbTeam?.player_ids ?? []
      const { data: players } = await supabase
        .from('players')
        .select('*, daily_scores ( id, created_at, player_id, date, answer, guesses )')
        .in('id', playerIds)

      if (dbTeam) {
        const team = Team.prototype.fromDbTeam(dbTeam, players ?? undefined)

        setColumns(getColumns(selectedMonth, team.playWeekends ?? false))
        setData(getData(team, selectedMonth))
      }
      setLoading(false)
    }

    getTeams()
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

  return (
    <div className={classes}>
      <div className='rounded-md border text-xs max-w-[96vw] @md:text-base'>
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
  )
}

export default ScoresTable
