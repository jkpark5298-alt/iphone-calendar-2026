import { ImageResponse } from "next/og";
import {
  buildOsmTileLayout,
  fetchOsmTilesAsDataUrls,
  type OsmTileMarker,
} from "./osmTileMapUtils";

/** 서버에서 Carto 타일 + 마커를 PNG data URL로 합성 (네이버 Static Map 대체) */
export async function composeOsmTileMapDataUrl(
  markers: OsmTileMarker[],
  width = 800,
  height = 500,
): Promise<string | null> {
  const layout = buildOsmTileLayout(markers, width, height);
  if (!layout) return null;

  const tiles = await fetchOsmTilesAsDataUrls(layout);
  if (tiles.length === 0) return null;

  try {
    const element = (
      <div
        style={{
          display: "flex",
          width: layout.width,
          height: layout.height,
          position: "relative",
          backgroundColor: "#dbe4ee",
        }}
      >
        {tiles.map((tile, index) => (
          // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
          <img
            key={`t-${index}`}
            src={tile.dataUrl}
            width={256}
            height={256}
            style={{
              position: "absolute",
              left: tile.left,
              top: tile.top,
            }}
          />
        ))}
        {layout.markers.map((marker, index) => (
          <div
            key={`m-${index}`}
            style={{
              position: "absolute",
              left: marker.x - 12,
              top: marker.y - 28,
              width: 24,
              height: 24,
              borderRadius: 999,
              backgroundColor: marker.color,
              color: "#ffffff",
              fontSize: 12,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {marker.label}
          </div>
        ))}
      </div>
    );

    const response = new ImageResponse(element, {
      width: layout.width,
      height: layout.height,
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 500) return null;
    return `data:image/png;base64,${buffer.toString("base64")}`;
  } catch (error) {
    console.warn("composeOsmTileMapDataUrl failed", error);
    return null;
  }
}
