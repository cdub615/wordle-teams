import AppGrid from '@/components/app-grid'
import { baseUrl } from '@/lib/utils'
import { headers } from 'next/headers'

const getTeams = async () => {
  const res = await fetch(`${baseUrl(headers().get('host'))}/api/my-teams`)

  if (!res.ok) throw new Error('Failed to fetch teams')

  return await res.json()
}

const Home = async () => {
  const teamsData = await getTeams()

  return teamsData ? <AppGrid teamsData={teamsData} /> : <div>Loading...</div>
}

export default Home
