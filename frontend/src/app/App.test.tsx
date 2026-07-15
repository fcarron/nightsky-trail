import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

vi.mock("../features/map/MapPanel", () => ({
  MapPanel: () => <section aria-label="Karte" />,
}));

vi.mock("../features/elevation/ElevationPanel", () => ({
  ElevationPanel: ({
    profile,
    status,
    message,
  }: {
    profile: { ascentMeters: number; descentMeters: number } | null;
    status: string;
    message: string | null;
  }) => (
    <section aria-label="Höhenprofil">
      <span>{status === "error" ? message : status}</span>
      {profile ? (
        <>
          <span>Aufstieg {profile.ascentMeters} m</span>
          <span>Abstieg {profile.descentMeters} m</span>
        </>
      ) : null}
    </section>
  ),
}));

describe("App", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the planner shell and reports a healthy API", async () => {
    vi.stubGlobal("fetch", createFetchMock());

    render(<App />);

    expect(screen.getByText("Swiss Route Planner")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Karte" })).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByText("API bereit")).toBeInTheDocument(),
    );
  });

  it("reports an unavailable API when health fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network failed")),
    );

    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("API nicht erreichbar")).toBeInTheDocument(),
    );
  });

  it("restores a saved route and shows segment counts", async () => {
    storeRouteWithTwoWaypoints();
    vi.stubGlobal(
      "fetch",
      createFetchMock({
        routeResponses: [routeResponse({ distanceMeters: 1234 })],
      }),
    );

    render(<App />);

    expect(screen.getByText("46.9000, 7.4000")).toBeInTheDocument();
    expect(screen.getByText("47.3000, 8.5000")).toBeInTheDocument();
    expect(screen.getByLabelText("Routenzusammenfassung")).toHaveTextContent(
      "Segmente1",
    );
    await waitFor(() =>
      expect(screen.getByText("1.23 km")).toBeInTheDocument(),
    );
    expect(screen.getByText("Route berechnet")).toBeInTheDocument();
    expect(screen.getByLabelText("Legende")).toHaveTextContent("Gerade");
    expect(screen.getByLabelText("Legende")).toHaveTextContent("Routing");
  });

  it("loads the elevation profile after route computation", async () => {
    storeRouteWithTwoWaypoints();
    vi.stubGlobal(
      "fetch",
      createFetchMock({
        routeResponses: [routeResponse({ distanceMeters: 1234 })],
        elevationResponses: [
          elevationResponse({ ascentMeters: 88, descentMeters: 22 }),
        ],
      }),
    );

    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("Aufstieg 88 m")).toBeInTheDocument(),
    );
    expect(screen.getByText("Abstieg 22 m")).toBeInTheDocument();
  });

  it("deletes the selected waypoint with the keyboard", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "swiss-route-planner.active-route.v1",
      JSON.stringify({
        waypoints: [{ id: "waypoint-1", position: { lon: 7.4, lat: 46.9 } }],
        segments: [],
      }),
    );
    vi.stubGlobal("fetch", createFetchMock());

    render(<App />);

    await user.click(screen.getByRole("button", { name: /46\.9000/ }));
    await user.keyboard("{Delete}");

    expect(screen.queryByText("46.9000, 7.4000")).not.toBeInTheDocument();
  });

  it("keeps the last computed route visible after a backend failure", async () => {
    const user = userEvent.setup();
    storeRouteWithTwoWaypoints();
    vi.stubGlobal(
      "fetch",
      createFetchMock({
        routeResponses: [
          routeResponse({ distanceMeters: 1234 }),
          routeErrorResponse("Route request validation failed."),
        ],
      }),
    );

    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("1.23 km")).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Umkehren" }));

    await waitFor(() =>
      expect(
        screen.getByText("Route request validation failed."),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("1.23 km")).toBeInTheDocument();
  });

  it("sends routed segment mode after toggling a segment", async () => {
    const user = userEvent.setup();
    const fetchMock = createFetchMock({
      routeResponses: [
        routeResponse({ distanceMeters: 1234 }),
        routeResponse({ distanceMeters: 2345, mode: "routed" }),
      ],
    });
    storeRouteWithTwoWaypoints();
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("1.23 km")).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Gerade" }));

    await waitFor(() =>
      expect(screen.getByText("2.35 km")).toBeInTheDocument(),
    );
    const routeCall = fetchMock.mock.calls
      .filter(([url]) => url.toString().endsWith("/api/v1/route/compute"))
      .at(-1);
    const routeRequest = JSON.parse(String(routeCall?.[1]?.body)) as {
      segments: Array<{ mode: string }>;
    };
    expect(routeRequest.segments[0].mode).toBe("routed");
  });

  it("ignores stale route compute responses", async () => {
    const user = userEvent.setup();
    const firstRouteResponse = createDeferred<Response>();
    storeRouteWithTwoWaypoints();
    vi.stubGlobal(
      "fetch",
      createFetchMock({
        routeResponses: [
          firstRouteResponse.promise,
          routeResponse({ distanceMeters: 4321 }),
        ],
      }),
    );

    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("Route wird berechnet")).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Umkehren" }));
    await waitFor(() =>
      expect(screen.getByText("4.32 km")).toBeInTheDocument(),
    );

    firstRouteResponse.resolve(routeResponse({ distanceMeters: 1234 }));

    await waitFor(() =>
      expect(screen.getByText("4.32 km")).toBeInTheDocument(),
    );
    expect(screen.queryByText("1.23 km")).not.toBeInTheDocument();
  });
});

function storeRouteWithTwoWaypoints() {
  window.localStorage.setItem(
    "swiss-route-planner.active-route.v1",
    JSON.stringify({
      waypoints: [
        { id: "waypoint-1", position: { lon: 7.4, lat: 46.9 } },
        { id: "waypoint-2", position: { lon: 8.5, lat: 47.3 } },
      ],
      segments: [
        {
          id: "waypoint-1-waypoint-2",
          fromWaypointId: "waypoint-1",
          toWaypointId: "waypoint-2",
          mode: "straight",
        },
      ],
    }),
  );
}

function createFetchMock(
  options: {
    routeResponses?: Array<Promise<Response> | Response>;
    elevationResponses?: Array<Promise<Response> | Response>;
  } = {},
) {
  const routeResponses = [...(options.routeResponses ?? [])];
  const elevationResponses = [...(options.elevationResponses ?? [])];

  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url.endsWith("/api/v1/health")) {
      return Promise.resolve(
        new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }

    if (url.endsWith("/api/v1/route/compute")) {
      void init;
      const response =
        routeResponses.shift() ?? routeResponse({ distanceMeters: 1234 });
      return response instanceof Response
        ? Promise.resolve(response)
        : response;
    }

    if (url.endsWith("/api/v1/elevation/profile")) {
      void init;
      const response =
        elevationResponses.shift() ??
        elevationResponse({ ascentMeters: 40, descentMeters: 10 });
      return response instanceof Response
        ? Promise.resolve(response)
        : response;
    }

    return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
  });
}

function elevationResponse({
  ascentMeters,
  descentMeters,
}: {
  ascentMeters: number;
  descentMeters: number;
}) {
  return new Response(
    JSON.stringify({
      distanceMeters: 1234,
      ascentMeters,
      descentMeters,
      minElevationMeters: 500,
      maxElevationMeters: 600,
      points: [
        {
          distanceMeters: 0,
          elevationMeters: 500,
          smoothedElevationMeters: 500,
          gradientPercent: 0,
          longitude: 7.4,
          latitude: 46.9,
        },
        {
          distanceMeters: 1234,
          elevationMeters: 600,
          smoothedElevationMeters: 600,
          gradientPercent: 8,
          longitude: 8.5,
          latitude: 47.3,
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function routeResponse({
  distanceMeters,
  mode = "straight",
}: {
  distanceMeters: number;
  mode?: "straight" | "routed";
}) {
  return new Response(
    JSON.stringify({
      geometry: {
        type: "LineString",
        coordinates: [
          [7.4, 46.9],
          [8.5, 47.3],
        ],
      },
      distanceMeters,
      segments: [
        {
          id: "waypoint-1-waypoint-2",
          fromWaypointId: "waypoint-1",
          toWaypointId: "waypoint-2",
          mode,
          distanceMeters,
          details: { hike_rating: [[0, 1, 0]] },
          geometry: {
            type: "LineString",
            coordinates: [
              [7.4, 46.9],
              [8.5, 47.3],
            ],
          },
        },
      ],
      warnings: [],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function routeErrorResponse(message: string) {
  return new Response(
    JSON.stringify({
      code: "invalid_route_request",
      message,
      details: {},
    }),
    { status: 422, headers: { "Content-Type": "application/json" } },
  );
}

function createDeferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}
