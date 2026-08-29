import { createFerry } from '@jeremy46231/ferry'

const ferry = createFerry({ basePath: '/api/submit' })

export default async function handler(request) {
  return (await ferry.handle(request)) ?? new Response('Not found', { status: 404 })
}