export default async function Page({ params }: { params: { teamId: string } }) {
  return <div className='p-24'>Team {params.teamId}</div>
}
