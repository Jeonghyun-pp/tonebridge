/**
 * Dynamic OG image — /api/og?song=…&artist=…
 *
 * Uses Next.js's `next/og` ImageResponse (Edge runtime, satori-backed).
 * Kept simple: title + subtitle + brand. Polish later with album art etc.
 */
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const song = req.nextUrl.searchParams.get("song")?.slice(0, 80) ?? "ToneBridge";
  const artist = req.nextUrl.searchParams.get("artist")?.slice(0, 60) ?? "Your gear, any guitar tone";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#09090b",
          color: "#fafafa",
          display: "flex",
          flexDirection: "column",
          padding: "80px",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 22,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: "#a1a1aa",
            marginBottom: 24,
          }}
        >
          ToneBridge · Tone Recipe
        </div>
        <div
          style={{
            fontSize: 80,
            fontWeight: 700,
            lineHeight: 1.05,
            marginBottom: 16,
          }}
        >
          {song}
        </div>
        <div style={{ fontSize: 36, color: "#a1a1aa" }}>{artist}</div>
        <div style={{ flex: 1 }} />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            color: "#a1a1aa",
            fontSize: 22,
          }}
        >
          <span>Amp settings · Pedal chain · Pickup choice</span>
          <span style={{ fontSize: 18 }}>tonebridge.app</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
