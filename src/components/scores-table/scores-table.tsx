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
import * as React from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Team } from '@/lib/types'
import { cn } from '@/lib/utils'
import { addMonths, differenceInMonths, format, formatISO, getDaysInMonth, startOfMonth } from 'date-fns'
import { ChevronDown } from 'lucide-react'
import { Dispatch } from 'react'
import { getColumns, getData } from './table-utils'

export type MonthScoresRow = {
  playerName: string
  monthTotal: number
  day1: number
  day2: number
  day3: number
  day4: number
  day5: number
  day6: number
  day7: number
  day8: number
  day9: number
  day10: number
  day11: number
  day12: number
  day13: number
  day14: number
  day15: number
  day16: number
  day17: number
  day18: number
  day19: number
  day20: number
  day21: number
  day22: number
  day23: number
  day24: number
  day25: number
  day26: number
  day27: number
  day28: number
  day29?: number
  day30?: number
  day31?: number
}

type ScoresTableProps = {
  teams: Team[]
  team: Team
  setTeam: Dispatch<any>
  month: Date
  setMonth: Dispatch<any>
  classes?: string
}

const ScoresTable = ({ teams, team, setTeam, month, setMonth, classes }: ScoresTableProps) => {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [columnPinning, setColumnPinning] = React.useState<ColumnPinningState>({})
  const [rowSelection, setRowSelection] = React.useState({})
  const numDays = getDaysInMonth(month)
  const dayVisibility: VisibilityState = {}
  for (let i = 29; i <= 31; i++) {
    if (i > numDays) dayVisibility[`day${i}`] = false
  }
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(dayVisibility)

  const data = getData(team, month)
  const columns = getColumns(month, team.playWeekends)

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

  const playerNameHeaderClass = 'sticky left-0 rounded-tl-lg bg-[rgb(255,255,255)] dark:bg-[rgb(13,10,10)]'
  const playerNameRowClass = 'sticky left-0 rounded-bl-lg bg-[rgb(255,255,255)] dark:bg-[rgb(13,10,10)]'
  const monthTotalHeaderClass = 'sticky right-0 rounded-tr-lg bg-[rgb(255,255,255)] dark:bg-[rgb(13,10,10)]'
  const monthTotalRowClass = 'sticky right-0 rounded-br-lg bg-[rgb(255,255,255)] dark:bg-[rgb(13,10,10)]'

  const getHeaderClass = (id: string) => {
    if (id === 'playerName') return playerNameHeaderClass
    if (id === 'monthTotal') return monthTotalHeaderClass
    return ''
  }
  const getRowClass = (id: string) => {
    if (id.includes('playerName')) return playerNameRowClass
    if (id.includes('monthTotal')) return monthTotalRowClass
    return ''
  }
  const months = () => {
    const earliest = team.players
      .map((player) => player.scores[0]?.date ?? new Date())
      .sort((a: Date, b: Date) => (a < b ? -1 : a == b ? 0 : 1))[0]
    const months = differenceInMonths(new Date(), earliest)
    let month = startOfMonth(earliest)
    let options = []
    for (let i = 0; i <= months; i++) {
      options.push(
        <DropdownMenuRadioItem key={format(month, 'yyyymm')} value={formatISO(month)}>
          {format(month, 'MMMM')}
        </DropdownMenuRadioItem>
      )
      month = startOfMonth(addMonths(month, 1))
    }
    return options
  }

  return (
    <div className={cn('w-full', classes)}>
      <div className='flex items-center py-4'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='outline' className='ml-auto'>
              {format(month, 'MMMM')} <ChevronDown className='ml-2 h-4 w-4' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuLabel>Change Month</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={formatISO(month)} onValueChange={setMonth}>
              {months().map((option) => option)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className='rounded-md border'>
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
