import { Table, TableBody, TableHeader } from '@/components/ui/table'
import SkeletonRows, { SkeletonHeader } from './skeleton-rows'

export default function SkeletonTable({ classes }: { classes?: string }) {
  return (
    <div className={classes}>
      <div className='rounded-md border text-xs max-w-[96vw] @md:text-base'>
        <Table className={'relative animate-pulse'}>
          <TableHeader>
            <SkeletonHeader />
          </TableHeader>
          <TableBody>
            <SkeletonRows />
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
