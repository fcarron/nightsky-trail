import Feature from "ol/Feature.js";
import {
  buffer as bufferExtent,
  createEmpty,
  extend,
  intersects,
} from "ol/extent.js";
import { LineString, MultiLineString } from "ol/geom.js";
import { fromLonLat } from "ol/proj.js";
import VectorSource from "ol/source/Vector.js";

import type { OfficialTrailSegmentDto } from "../../types/api";

const ROUTE_CATEGORY_MATCH_TOLERANCE_METERS = 20;
const ROUTE_CATEGORY_GRID_CELL_METERS = 100;

interface RoutePart {
  start: number[];
  end: number[];
}

type RoutePartGrid = Map<string, RoutePart[]>;

export function updateRouteCategoryFeatures(
  categorySource: VectorSource,
  routeSource: VectorSource,
  officialSegments: OfficialTrailSegmentDto[],
  visible: boolean,
) {
  categorySource.clear();
  if (!visible || officialSegments.length === 0) {
    return;
  }

  const routeLines = routeSource
    .getFeatures()
    .map((feature) => feature.getGeometry())
    .filter(
      (geometry): geometry is LineString => geometry instanceof LineString,
    );
  if (routeLines.length === 0) {
    return;
  }

  const routeExtent = bufferExtent(
    routeLines.reduce(
      (extent, routeLine) => extend(extent, routeLine.getExtent()),
      createEmpty(),
    ),
    ROUTE_CATEGORY_MATCH_TOLERANCE_METERS,
  );
  const matchedPartsByCategory = new Map<string, number[][][]>();
  const routePartGrid = buildRoutePartGrid(routeLines);

  officialSegments.forEach((segment) => {
    if (!isVisibleOfficialTrailCategory(segment.officialCategory)) {
      return;
    }

    const coordinates = segment.geometry.coordinates.map(([lon, lat]) =>
      fromLonLat([lon, lat]),
    );
    const officialLine = new LineString(coordinates);
    if (!intersects(routeExtent, officialLine.getExtent())) {
      return;
    }
    let matchedCoordinates: number[][] = [];

    const flushMatchedCoordinates = () => {
      if (matchedCoordinates.length < 2) {
        matchedCoordinates = [];
        return;
      }
      const categoryParts = matchedPartsByCategory.get(
        segment.officialCategory,
      );
      if (categoryParts) {
        categoryParts.push(matchedCoordinates);
      } else {
        matchedPartsByCategory.set(segment.officialCategory, [
          matchedCoordinates,
        ]);
      }
      matchedCoordinates = [];
    };

    for (let index = 1; index < coordinates.length; index += 1) {
      const start = coordinates[index - 1];
      const end = coordinates[index];
      if (officialLinePartMatchesRoute(start, end, routePartGrid)) {
        if (matchedCoordinates.length === 0) {
          matchedCoordinates.push(start);
        }
        matchedCoordinates.push(end);
      } else {
        flushMatchedCoordinates();
      }
    }
    flushMatchedCoordinates();
  });

  matchedPartsByCategory.forEach((parts, officialCategory) => {
    const feature = new Feature(new MultiLineString(parts));
    feature.set("officialCategory", officialCategory);
    categorySource.addFeature(feature);
  });
}

function officialLinePartMatchesRoute(
  start: number[],
  end: number[],
  routePartGrid: RoutePartGrid,
): boolean {
  const midpoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  const toleranceSquared = ROUTE_CATEGORY_MATCH_TOLERANCE_METERS ** 2;

  return [start, midpoint, end].some((coordinate) =>
    (routePartGrid.get(gridKey(coordinate)) ?? []).some(
      (routePart) =>
        pointToSegmentDistanceSquared(coordinate, routePart) <=
        toleranceSquared,
    ),
  );
}

function buildRoutePartGrid(routeLines: LineString[]): RoutePartGrid {
  const grid: RoutePartGrid = new Map();

  routeLines.forEach((routeLine) => {
    const coordinates = routeLine.getCoordinates();
    for (let index = 1; index < coordinates.length; index += 1) {
      const routePart = {
        start: coordinates[index - 1],
        end: coordinates[index],
      };
      const minCellX = gridCoordinate(
        Math.min(routePart.start[0], routePart.end[0]) -
          ROUTE_CATEGORY_MATCH_TOLERANCE_METERS,
      );
      const maxCellX = gridCoordinate(
        Math.max(routePart.start[0], routePart.end[0]) +
          ROUTE_CATEGORY_MATCH_TOLERANCE_METERS,
      );
      const minCellY = gridCoordinate(
        Math.min(routePart.start[1], routePart.end[1]) -
          ROUTE_CATEGORY_MATCH_TOLERANCE_METERS,
      );
      const maxCellY = gridCoordinate(
        Math.max(routePart.start[1], routePart.end[1]) +
          ROUTE_CATEGORY_MATCH_TOLERANCE_METERS,
      );

      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
          const key = `${cellX}:${cellY}`;
          const parts = grid.get(key);
          if (parts) {
            parts.push(routePart);
          } else {
            grid.set(key, [routePart]);
          }
        }
      }
    }
  });

  return grid;
}

function gridKey(coordinate: number[]): string {
  return `${gridCoordinate(coordinate[0])}:${gridCoordinate(coordinate[1])}`;
}

function gridCoordinate(value: number): number {
  return Math.floor(value / ROUTE_CATEGORY_GRID_CELL_METERS);
}

function pointToSegmentDistanceSquared(
  point: number[],
  segment: RoutePart,
): number {
  const deltaX = segment.end[0] - segment.start[0];
  const deltaY = segment.end[1] - segment.start[1];
  const lengthSquared = deltaX ** 2 + deltaY ** 2;
  if (lengthSquared === 0) {
    return (
      (point[0] - segment.start[0]) ** 2 + (point[1] - segment.start[1]) ** 2
    );
  }

  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - segment.start[0]) * deltaX +
        (point[1] - segment.start[1]) * deltaY) /
        lengthSquared,
    ),
  );
  const closestX = segment.start[0] + projection * deltaX;
  const closestY = segment.start[1] + projection * deltaY;
  return (point[0] - closestX) ** 2 + (point[1] - closestY) ** 2;
}

function isVisibleOfficialTrailCategory(category: string): boolean {
  return [
    "hiking_trail",
    "mountain_hiking_trail",
    "alpine_hiking_trail",
  ].includes(category);
}
