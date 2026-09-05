export const config = {
  runtime: 'edge',
}

export default async function handler() {
  const destination = process.env.AIRTABLE_REVIEW_INTERFACE
  if (!destination) {
    return new Response('AIRTABLE_REVIEW_INTERFACE is not configured', { status: 500 })
  }
  return Response.redirect(destination, 307)
}
