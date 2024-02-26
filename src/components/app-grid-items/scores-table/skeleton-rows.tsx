import { Skeleton } from '@/components/ui/skeleton'
import { TableCell, TableRow } from '@/components/ui/table'

export default function SkeletonRows() {
  return (
    <>
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </>
  )
}

export function SkeletonRow() {
  return (
    <TableRow>
      <TableCell colSpan={1} className='h-24 text-center'>
        <Skeleton className='h-4 w-[250px] rounded-lg' />
      </TableCell>
      <TableCell colSpan={1} className='h-24 text-center'>
        <Skeleton className='h-4 w-[250px] rounded-full' />
      </TableCell>
      <TableCell colSpan={1} className='h-24 text-center'>
        <Skeleton className='h-4 w-[250px] rounded-full' />
      </TableCell>
      <TableCell colSpan={1} className='h-24 text-center'>
        <Skeleton className='h-4 w-[250px] rounded-full' />
      </TableCell>
      <TableCell colSpan={1} className='h-24 text-center'>
        <Skeleton className='h-4 w-[250px] rounded-full' />
      </TableCell>
      <TableCell colSpan={1} className='h-24 text-center'>
        <Skeleton className='h-4 w-[250px] rounded-full' />
      </TableCell>
      <TableCell colSpan={1} className='h-24 text-center'>
        <Skeleton className='h-4 w-[250px] rounded-full' />
      </TableCell>
      <TableCell colSpan={1} className='h-24 text-center'>
        <Skeleton className='h-4 w-[250px] rounded-full' />
      </TableCell>
      <TableCell colSpan={1} className='h-24 text-center'>
        <Skeleton className='h-4 w-[250px] rounded-full' />
      </TableCell>
      <TableCell colSpan={1} className='h-24 text-center'>
        <Skeleton className='h-4 w-[250px] rounded-full' />
      </TableCell>
      <TableCell colSpan={1} className='h-24 text-center'>
        <Skeleton className='h-4 w-[250px] rounded-full' />
      </TableCell>
      <TableCell colSpan={1} className='h-24 text-center'>
        <Skeleton className='h-4 w-[250px] rounded-full' />
      </TableCell>
      <TableCell colSpan={1} className='h-24 text-center'>
        <Skeleton className='h-4 w-[250px] rounded-full' />
      </TableCell>
      <TableCell colSpan={1} className='h-24 text-center'>
        <Skeleton className='h-4 w-[250px] rounded-full' />
      </TableCell>
      <TableCell colSpan={1} className='h-24 text-center'>
        <Skeleton className='h-4 w-[250px] rounded-full' />
      </TableCell>
      <TableCell colSpan={1} className='h-24 text-center'>
        <Skeleton className='h-4 w-[250px] rounded-full' />
      </TableCell>
    </TableRow>
  )
}
