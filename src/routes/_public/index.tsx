import { LandingPage } from '@/components/cinema/LandingPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_public/')({
  component: Index,
})

function Index() {
  return <LandingPage />
}
