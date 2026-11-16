import { handleTravelStatus, liveDeps } from './_lib/handlers.js'

// Vercel function (Node.js runtime, London region: see vercel.json).
// GET: whether TravelTime is configured. GET ?check=1: also one small real
// request, to confirm the key works. Never returns the key.

declare const process: { env: Record<string, string | undefined> }

export function GET(request: Request): Promise<Response> {
  return handleTravelStatus(request, liveDeps(process.env))
}
