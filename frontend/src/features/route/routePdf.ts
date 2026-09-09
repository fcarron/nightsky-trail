import type { ElevationProfile } from "../elevation/elevationModel";
import {
  GRADIENT_GROUPS,
  gradientGroupForPercent,
} from "../elevation/elevationModel";
import type { LonLat } from "./routeModel";

const MAP_WIDTH = 1000;
const MAP_HEIGHT = 773;
const PROFILE_WIDTH = 1000;
const PROFILE_HEIGHT = 300;
const BRAND_MARK_SVG = `<svg viewBox="0 0 32 32" aria-hidden="true">
  <rect width="32" height="32" rx="7" fill="#102a56"/>
  <path fill="#dbeafe" d="m22.6 5.2 1.1 3.2 3.3 1-3.3 1.1-1.1 3.2-1.1-3.2-3.2-1.1 3.2-1z"/>
  <path fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4" d="M5.5 23.5c4.8-5.2 8.5-6.1 11-2.6 2.6 3.5 5.6 2.4 10-3.2"/>
  <circle cx="10" cy="17" r="1.7" fill="#60a5fa"/>
</svg>`;

export interface RoutePdfStatistic {
  label: string;
  value: string;
}

export interface RoutePdfReport {
  language: string;
  title: string;
  subtitle: string;
  profile: ElevationProfile;
  statistics: RoutePdfStatistic[];
  generatedLabel: string;
  sourceLabel: string;
  gradientLabel: string;
  share?: {
    label: string;
    qrCodeSvg: string;
    url: string;
  };
}

export async function createRouteQrCodeSvg(url: string): Promise<string> {
  const { default: QRCode } = await import("qrcode");
  return QRCode.toString(url, {
    color: { dark: "#102b54ff", light: "#ffffffff" },
    errorCorrectionLevel: "M",
    margin: 1,
    type: "svg",
  });
}

export function openRoutePdfPrintView(report: RoutePdfReport): boolean {
  const printWindow = createRoutePdfPrintWindow();
  if (!printWindow) {
    return false;
  }

  renderRoutePdfPrintView(printWindow, report);
  return true;
}

export function createRoutePdfPrintWindow(): Window | null {
  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.opener = null;
  }
  return printWindow;
}

export function renderRoutePdfPrintView(
  printWindow: Window,
  report: RoutePdfReport,
): void {
  printWindow.addEventListener("load", () => {
    window.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 250);
  });
  printWindow.document.open();
  printWindow.document.write(buildRoutePdfDocument(report));
  printWindow.document.close();
}

export function buildRoutePdfDocument(report: RoutePdfReport): string {
  const routePoints = report.profile.points.map((point) => ({
    lat: point.latitude,
    lon: point.longitude,
  }));
  const map = buildMapGraphic(routePoints, report.profile);
  const profile = buildProfileGraphic(report.profile);
  const statistics = report.statistics
    .map(
      (statistic) => `
        <div class="stat">
          <span>${escapeHtml(statistic.label)}</span>
          <strong>${escapeHtml(statistic.value)}</strong>
        </div>`,
    )
    .join("");
  const gradientLegend = GRADIENT_GROUPS.map(
    (group) =>
      `<span><i style="background:${escapeHtml(group.color)}"></i>${escapeHtml(group.label)}</span>`,
  ).join("");
  const share = report.share
    ? `<aside class="share">
        <div><strong>${escapeHtml(report.share.label)}</strong><span>${escapeHtml(report.share.url)}</span></div>
        <div class="qr">${report.share.qrCodeSvg}</div>
      </aside>`
    : "";

  return `<!doctype html>
<html lang="${escapeHtml(report.language)}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(report.title)} · nightsky trail</title>
    <style>
      @page { size: A4 portrait; margin: 8mm; }
      * { box-sizing: border-box; }
      html, body { margin: 0; color: #111827; font-family: Arial, sans-serif; }
      body { background: #fff; }
      .sheet { display: grid; gap: 3mm; }
      header { display: grid; gap: 3mm; }
      .heading { display: flex; min-height: 16mm; align-items: center; justify-content: space-between; gap: 5mm; }
      .brand { display: flex; align-items: center; gap: 2mm; color: #17345f; font-size: 10pt; font-weight: 800; letter-spacing: 0; }
      .brandMark, .brandMark svg { display: block; width: 8mm; height: 8mm; }
      h1 { margin: 1.5mm 0 0; font-size: 19pt; line-height: 1.05; letter-spacing: 0; }
      .subtitle { margin-top: 1.5mm; color: #64748b; font-size: 8.5pt; }
      .stats { display: grid; grid-template-columns: repeat(3, 1fr); border-top: .3mm solid #cbd5e1; border-bottom: .3mm solid #cbd5e1; }
      .stat { min-height: 10mm; padding: 1.6mm 2.2mm; border-right: .3mm solid #e2e8f0; }
      .stat:nth-child(3n) { border-right: 0; }
      .stat:nth-child(n+4) { border-top: .3mm solid #e2e8f0; }
      .stat span { display: block; color: #64748b; font-size: 6.8pt; }
      .stat strong { display: block; margin-top: .7mm; font-size: 10pt; }
      .share { display: grid; grid-template-columns: minmax(0, 1fr) 23mm; align-items: center; gap: 2mm; max-width: 70mm; color: #475569; font-size: 6.5pt; text-align: right; }
      .share strong, .share span { display: block; }
      .share strong { color: #17345f; font-size: 7.5pt; }
      .share span { margin-top: 1mm; overflow-wrap: anywhere; }
      .qr, .qr svg { display: block; width: 23mm; height: 23mm; }
      .map { position: relative; height: 140mm; overflow: hidden; border: .3mm solid #cbd5e1; background: #edf2f5; }
      .map > img, .map > svg { position: absolute; inset: 0; width: 100%; height: 100%; }
      .map > img { object-fit: fill; }
      .profile { display: grid; grid-template-rows: minmax(0, 1fr) auto; height: 58mm; border: .3mm solid #cbd5e1; }
      .profileChart, .profileChart svg { display: block; width: 100%; height: 100%; min-height: 0; }
      .gradientLegend { display: flex; align-items: center; justify-content: center; gap: 3mm; border-top: .3mm solid #e2e8f0; padding: 1.2mm 2mm; color: #64748b; font-size: 6.5pt; }
      .gradientLegend strong { color: #334155; }
      .gradientLegend span { display: inline-flex; align-items: center; gap: 1mm; white-space: nowrap; }
      .gradientLegend i { width: 4mm; height: 2mm; }
      footer { display: flex; justify-content: space-between; color: #64748b; font-size: 6.5pt; }
      @media screen { body { padding: 8mm; background: #e5e7eb; } .sheet { max-width: 210mm; margin: auto; padding: 8mm; background: #fff; box-shadow: 0 4mm 12mm rgba(15,23,42,.18); } }
      @media print { .sheet { break-inside: avoid; } }
    </style>
  </head>
  <body>
    <main class="sheet">
      <header>
        <div class="heading">
          <div>
            <div class="brand"><span class="brandMark">${BRAND_MARK_SVG}</span><span>nightsky trail</span></div>
            <h1>${escapeHtml(report.title)}</h1>
            <div class="subtitle">${escapeHtml(report.subtitle)}</div>
          </div>
          ${share}
        </div>
        <div class="stats">${statistics}</div>
      </header>
      <section class="map" aria-label="Route map">
        <img src="${escapeHtml(map.imageUrl)}" alt="">
        ${map.overlaySvg}
      </section>
      <section class="profile" aria-label="Elevation profile">
        <div class="profileChart">${profile}</div>
        <div class="gradientLegend"><strong>${escapeHtml(report.gradientLabel)}</strong>${gradientLegend}</div>
      </section>
      <footer>
        <span>${escapeHtml(report.sourceLabel)}</span>
        <span>${escapeHtml(report.generatedLabel)}</span>
      </footer>
    </main>
  </body>
</html>`;
}

export function kilometreMarkerInterval(distanceMeters: number): number {
  if (distanceMeters <= 15_000) return 1;
  if (distanceMeters <= 40_000) return 2;
  if (distanceMeters <= 80_000) return 5;
  return 10;
}

function buildMapGraphic(points: LonLat[], profile: ElevationProfile) {
  const projectedPoints = points.map(projectWebMercator);
  const extent = fittedExtent(projectedPoints, MAP_WIDTH / MAP_HEIGHT);
  const routePath = projectedPoints
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${mapX(point[0], extent).toFixed(1)} ${mapY(point[1], extent).toFixed(1)}`,
    )
    .join(" ");
  const markerInterval = kilometreMarkerInterval(profile.distanceMeters);
  const kilometreMarkers: string[] = [];
  for (
    let kilometre = markerInterval;
    kilometre * 1000 < profile.distanceMeters;
    kilometre += markerInterval
  ) {
    const position = profilePositionAtDistance(profile, kilometre * 1000);
    const projected = projectWebMercator(position);
    const x = mapX(projected[0], extent);
    const y = mapY(projected[1], extent);
    kilometreMarkers.push(
      `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><circle r="12" fill="#fff" stroke="#173f7a" stroke-width="3"/><text y="4" text-anchor="middle" fill="#173f7a" font-size="10" font-weight="700">${kilometre}</text></g>`,
    );
  }
  const start = projectedPoints[0];
  const end = projectedPoints.at(-1)!;
  const endpoint = (point: [number, number], label: string, fill: string) =>
    `<g transform="translate(${mapX(point[0], extent).toFixed(1)} ${mapY(point[1], extent).toFixed(1)})"><circle r="14" fill="${fill}" stroke="#fff" stroke-width="4"/><text y="4" text-anchor="middle" fill="#fff" font-size="11" font-weight="800">${label}</text></g>`;

  return {
    imageUrl: swissTopoMapUrl(extent),
    overlaySvg: `<svg viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}" aria-hidden="true">
      <path d="${routePath}" fill="none" stroke="rgba(255,255,255,.96)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${routePath}" fill="none" stroke="#1967d2" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
      ${kilometreMarkers.join("")}
      ${endpoint(start, "S", "#173f7a")}
      ${endpoint(end, "Z", "#1967d2")}
    </svg>`,
  };
}

function buildProfileGraphic(profile: ElevationProfile): string {
  const left = 64;
  const right = 18;
  const top = 18;
  const bottom = 34;
  const chartWidth = PROFILE_WIDTH - left - right;
  const chartHeight = PROFILE_HEIGHT - top - bottom;
  const elevationRange = Math.max(
    20,
    profile.maxElevationMeters - profile.minElevationMeters,
  );
  const minimumElevation = profile.minElevationMeters - elevationRange * 0.08;
  const maximumElevation = profile.maxElevationMeters + elevationRange * 0.08;
  const x = (distance: number) =>
    left + (distance / profile.distanceMeters) * chartWidth;
  const y = (elevation: number) =>
    top +
    ((maximumElevation - elevation) / (maximumElevation - minimumElevation)) *
      chartHeight;
  const profileLine = profile.points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${x(point.distanceMeters).toFixed(1)} ${y(point.smoothedElevationMeters).toFixed(1)}`,
    )
    .join(" ");
  const areaPath = `${profileLine} L${x(profile.distanceMeters).toFixed(1)} ${(top + chartHeight).toFixed(1)} L${left} ${(top + chartHeight).toFixed(1)} Z`;
  const bands = profile.gradientBands
    .map((band) => {
      const start = x(band.startDistanceMeters);
      const width = Math.max(1, x(band.endDistanceMeters) - start + 0.7);
      return `<rect x="${start.toFixed(1)}" y="${top}" width="${width.toFixed(1)}" height="${chartHeight}" fill="${gradientGroupForPercent(band.gradientPercent).color}"/>`;
    })
    .join("");
  const markerInterval = kilometreMarkerInterval(profile.distanceMeters);
  const verticalGrid: string[] = [];
  for (
    let kilometre = 0;
    kilometre * 1000 <= profile.distanceMeters;
    kilometre += markerInterval
  ) {
    const gridX = x(kilometre * 1000);
    verticalGrid.push(
      `<line x1="${gridX}" y1="${top}" x2="${gridX}" y2="${top + chartHeight}" stroke="#dbe3ea" stroke-width="1"/><text x="${gridX}" y="${PROFILE_HEIGHT - 10}" text-anchor="middle" fill="#64748b" font-size="11">${kilometre} km</text>`,
    );
  }
  const horizontalGrid = Array.from({ length: 4 }, (_, index) => {
    const ratio = index / 3;
    const elevation =
      maximumElevation - ratio * (maximumElevation - minimumElevation);
    const gridY = top + ratio * chartHeight;
    return `<line x1="${left}" y1="${gridY}" x2="${PROFILE_WIDTH - right}" y2="${gridY}" stroke="#dbe3ea" stroke-width="1"/><text x="${left - 8}" y="${gridY + 4}" text-anchor="end" fill="#64748b" font-size="11">${Math.round(elevation)} m</text>`;
  }).join("");

  return `<svg viewBox="0 0 ${PROFILE_WIDTH} ${PROFILE_HEIGHT}" role="img" aria-label="Elevation profile">
    <defs><clipPath id="profile-area"><path d="${areaPath}"/></clipPath></defs>
    <rect width="${PROFILE_WIDTH}" height="${PROFILE_HEIGHT}" fill="#fff"/>
    ${horizontalGrid}${verticalGrid.join("")}
    <g clip-path="url(#profile-area)">${bands}</g>
    <path d="${profileLine}" fill="none" stroke="#334155" stroke-width="1.6" stroke-linejoin="round"/>
  </svg>`;
}

function swissTopoMapUrl(extent: [number, number, number, number]): string {
  const params = new URLSearchParams({
    BBOX: extent.join(","),
    CRS: "EPSG:3857",
    FORMAT: "image/png",
    HEIGHT: String(MAP_HEIGHT),
    LAYERS: "ch.swisstopo.pixelkarte-farbe",
    REQUEST: "GetMap",
    SERVICE: "WMS",
    STYLES: "",
    TRANSPARENT: "false",
    VERSION: "1.3.0",
    WIDTH: String(MAP_WIDTH),
  });
  return `https://wms.geo.admin.ch/?${params.toString()}`;
}

function fittedExtent(
  points: [number, number][],
  targetAspectRatio: number,
): [number, number, number, number] {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  let width = Math.max(500, Math.max(...xs) - Math.min(...xs));
  let height = Math.max(500, Math.max(...ys) - Math.min(...ys));
  width *= 1.16;
  height *= 1.16;
  if (width / height < targetAspectRatio) {
    width = height * targetAspectRatio;
  } else {
    height = width / targetAspectRatio;
  }
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  return [
    centerX - width / 2,
    centerY - height / 2,
    centerX + width / 2,
    centerY + height / 2,
  ];
}

function profilePositionAtDistance(
  profile: ElevationProfile,
  distanceMeters: number,
): LonLat {
  const after =
    profile.points.find((point) => point.distanceMeters >= distanceMeters) ??
    profile.points.at(-1)!;
  const before =
    [...profile.points]
      .reverse()
      .find((point) => point.distanceMeters <= distanceMeters) ??
    profile.points[0];
  const span = after.distanceMeters - before.distanceMeters;
  const ratio = span > 0 ? (distanceMeters - before.distanceMeters) / span : 0;
  return {
    lat: before.latitude + (after.latitude - before.latitude) * ratio,
    lon: before.longitude + (after.longitude - before.longitude) * ratio,
  };
}

function projectWebMercator(point: LonLat): [number, number] {
  const radius = 6_378_137;
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, point.lat));
  return [
    radius * ((point.lon * Math.PI) / 180),
    radius * Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360)),
  ];
}

function mapX(value: number, extent: [number, number, number, number]): number {
  return ((value - extent[0]) / (extent[2] - extent[0])) * MAP_WIDTH;
}

function mapY(value: number, extent: [number, number, number, number]): number {
  return (
    MAP_HEIGHT - ((value - extent[1]) / (extent[3] - extent[1])) * MAP_HEIGHT
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
