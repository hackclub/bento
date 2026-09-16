import { createFerry } from '@jeremy46231/ferry'

export const config = {
  runtime: 'edge',
}

const ferry = createFerry({ basePath: '/api/submit' })

// Fields Ferry/HCA are supposed to guarantee, but which can end up blank if
// someone edits the `scope=` param on the HCA authorize URL before consenting
// (this drops fields off the returned identity instead of failing outright).
const REQUIRED_FIELDS = [
  { fieldId: 'fldxYz3h4EATEQaBU', label: 'Email' },
  { fieldId: 'fldIly4XujqP4jFbw', label: 'First Name' },
  { fieldId: 'fldFkzAFVYfPZUBOA', label: 'Last Name' },
  { fieldId: 'fld9OqyH1Gw5pBRnv', label: 'Birthday' },
  { fieldId: 'fldA6SVZ8T2TubGeL', label: 'Address' },
]

const USER_TABLE_ID = 'tbl1Et4oOM6IzuZmz'
// filterByFormula only understands field *names*, not field IDs, so this one
// field has to be referenced by name (fieldId fldg4KEFcnoWBu5z2 for reference).
const AUTH_TOKEN_FIELD_NAME = 'Auth Token'

export default async function handler(request) {
  const response = await ferry.handle(request)
  if (!response) {
    return new Response('Not found', { status: 404 })
  }

  const guarded = await guardIncompleteIdentity(response)
  return guarded ?? response
}

// Only the final success redirect to the Fillout form matters here - every
// other response (intermediate HCA/Hackatime hops, errors, etc.) passes
// through untouched.
async function guardIncompleteIdentity(response) {
  if (response.status !== 302) return null

  const location = response.headers.get('Location')
  if (!location) return null

  const filloutFormUrl = process.env.FERRY_FILLOUT_FORM_URL
  if (!filloutFormUrl || !location.startsWith(filloutFormUrl)) return null

  const authToken = new URL(location).searchParams.get('auth_token')
  if (!authToken) return null

  // Fail open: this is a safeguard against tampered/incomplete HCA logins,
  // not a hard gate. If Airtable is unreachable or misbehaves we let the
  // user through rather than blocking every legitimate submission.
  let missing
  try {
    missing = await findMissingFields(authToken)
  } catch (error) {
    console.error('Identity validation check failed, failing open:', error)
    return null
  }

  if (!missing || missing.length === 0) return null

  return renderMissingFieldsResponse(missing)
}

async function findMissingFields(authToken) {
  const baseId = process.env.FERRY_AIRTABLE_BASE_ID
  const apiKey = process.env.FERRY_AIRTABLE_API_KEY
  if (!baseId || !apiKey) throw new Error('Airtable env vars are not configured')

  const filterFormula = `{${AUTH_TOKEN_FIELD_NAME}} = "${authToken}"`
  const params = new URLSearchParams({
    filterByFormula: filterFormula,
    // Without this, Airtable keys `fields` by field *name*, not field ID,
    // and every lookup below by fieldId would silently come back blank.
    returnFieldsByFieldId: 'true',
  })
  const url = `https://api.airtable.com/v0/${baseId}/${USER_TABLE_ID}?${params}`

  const airtableResponse = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!airtableResponse.ok) {
    throw new Error(`Airtable request failed with status ${airtableResponse.status}`)
  }

  const data = await airtableResponse.json()
  const record = data.records?.[0]
  if (!record) throw new Error('No matching Airtable record found for auth token')

  const fields = record.fields ?? {}
  return REQUIRED_FIELDS.filter(({ fieldId }) => isBlank(fields[fieldId]))
}

function isBlank(value) {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

function renderMissingFieldsResponse(missing) {
  const list = missing.map(({ label }) => `<li>${label}</li>`).join('')
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Profile Incomplete - Bento</title>
    <style>
      body {
        font-family: "LINE Seed JP", sans-serif;
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(to top, #f7e0b6, #d29723);
        padding: 20px;
        box-sizing: border-box;
      }
      .card {
        max-width: 480px;
        background: #ffedcb;
        border: 3px solid #5a4310;
        border-radius: 8px;
        padding: 32px;
        color: #5a4310;
        text-align: center;
      }
      h1 {
        font-size: 28px;
        margin: 0 0 12px;
      }
      p {
        font-size: 16px;
        line-height: 1.5;
      }
      ul {
        text-align: left;
        display: inline-block;
        margin: 12px auto;
        font-size: 16px;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Almost there!</h1>
      <p>
        Your Hack Club Auth profile is missing required info:
      </p>
      <ul>${list}</ul>
      <p>
        Please make sure your profile is fully filled in and try again.
      </p>
    </div>
  </body>
</html>`

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=UTF-8' },
  })
}
