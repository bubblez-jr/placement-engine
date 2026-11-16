import { handleTravelMatrix, liveDeps } from './_lib/handlers.js'

// Vercel function (Node.js runtime, London region: see vercel.json).
// POST coordinates and arrival times; get back minutes and distances from
// TravelTime. The key is read here, on the server, and never sent to the
// browser. All logic is in `_lib/handlers.ts`, tested in tests/travel-api.test.ts.

declare const process: { env: Record<string, string | undefined> }

export function POST(request: Request): Promise<Response> {
  return handleTravelMatrix(request, liveDeps(process.env))
}

export function GET(request: Request): Promise<Response> {
  return handleTravelMatrix(request, liveDeps(process.env))
}
