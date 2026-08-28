import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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

  it("renders the planner shell while the API is healthy", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(screen.getByText("nightsky trail")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Karte" })).toBeInTheDocument();

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) =>
          url.toString().endsWith("/api/v1/health"),
        ),
      ).toBe(true),
    );
    expect(screen.queryByText("API bereit")).not.toBeInTheDocument();
  });

  it("opens the mobile header only when requested", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", createFetchMock());

    render(<App />);

    const header = screen.getByRole("banner");
    expect(header).not.toHaveClass("mobileHeaderOpen");

    await user.click(screen.getByRole("button", { name: "Navigation öffnen" }));
    expect(header).toHaveClass("mobileHeaderOpen");

    await user.click(
      screen.getByRole("button", { name: "Navigation schließen" }),
    );
    expect(header).not.toHaveClass("mobileHeaderOpen");
  });

  it("shows the planning limitations in the app information", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", createFetchMock());

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Info" }));

    expect(screen.getByText("Planungshinweis")).toBeInTheDocument();
    expect(
      screen.getByText(/Sperrungen und Wegzustand können fehlen/),
    ).toBeInTheDocument();
  });

  it("starts in exploration mode and enables route tools explicitly", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", createFetchMock());

    render(<App />);

    expect(screen.getByText("Karte erkunden")).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Routing-Profil" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Route zeichnen" }));

    expect(screen.getByText("Zeichnen")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Routing-Profil" }),
    ).toHaveValue("hike");
    expect(
      screen.getByRole("checkbox", { name: "Wegen folgen" }),
    ).toBeChecked();
  });

  it("cycles the mobile route sheet through summary and detail states", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", createFetchMock());

    render(<App />);

    const routePanel = screen.getByRole("complementary", {
      name: "Routeninformationen",
    });
    expect(routePanel).toHaveClass("mobileSheet-collapsed");

    await user.click(
      screen.getByRole("button", { name: "Routenpanel öffnen" }),
    );
    expect(routePanel).toHaveClass("mobileSheet-half");

    await user.click(
      screen.getByRole("button", {
        name: "Routenpanel vollständig öffnen",
      }),
    );
    expect(routePanel).toHaveClass("mobileSheet-full");

    await user.click(
      screen.getByRole("button", { name: "Routenpanel einklappen" }),
    );
    expect(routePanel).toHaveClass("mobileSheet-collapsed");
  });

  it("moves the mobile route sheet one level with a vertical swipe", () => {
    vi.stubGlobal("fetch", createFetchMock());

    render(<App />);

    const routePanel = screen.getByRole("complementary", {
      name: "Routeninformationen",
    });
    const handle = screen.getByRole("button", {
      name: "Routenpanel öffnen",
    });

    fireEvent.pointerDown(handle, { clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 430, pointerId: 1 });
    expect(routePanel).toHaveClass("mobileSheet-half");

    fireEvent.pointerDown(handle, { clientY: 430, pointerId: 2 });
    fireEvent.pointerUp(handle, { clientY: 500, pointerId: 2 });
    expect(routePanel).toHaveClass("mobileSheet-collapsed");
  });

  it("keeps tours, account, and GPX actions in separate menus", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", createFetchMock());

    render(<App />);

    expect(screen.queryByLabelText("Meine Touren")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Meine Touren" }));

    expect(screen.getByLabelText("Meine Touren")).toBeInTheDocument();
    expect(screen.getByText("Touren speichern")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Datei" }));
    expect(
      screen.getByRole("button", { name: "GPX importieren" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Konto" }));
    expect(screen.getByLabelText("Konto")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Login" })).toBeInTheDocument();
  });

  it("checks the password confirmation before registering", async () => {
    const user = userEvent.setup();
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Konto" }));
    await user.click(screen.getByRole("button", { name: "Registrieren" }));
    await user.type(screen.getByLabelText("E-Mail"), "runner@example.com");
    await user.type(screen.getByLabelText("Passwort"), "trail-check-2026");
    await user.type(
      screen.getByLabelText("Passwort bestätigen"),
      "other-password",
    );
    await user.click(screen.getByRole("button", { name: "Konto erstellen" }));

    expect(
      screen.getByText("Die beiden Passwörter stimmen nicht überein."),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) =>
        url.toString().endsWith("/api/v1/auth/register"),
      ),
    ).toBe(false);
  });

  it("asks for email verification after registration", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      createFetchMock({
        authRegisterResponse: new Response(
          JSON.stringify({
            authenticated: false,
            user: null,
          }),
          { status: 202, headers: { "Content-Type": "application/json" } },
        ),
      }),
    );

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Konto" }));
    await user.click(screen.getByRole("button", { name: "Registrieren" }));
    await user.type(screen.getByLabelText("E-Mail"), "runner@example.com");
    await user.type(screen.getByLabelText("Passwort"), "trail-check-2026");
    await user.type(
      screen.getByLabelText("Passwort bestätigen"),
      "trail-check-2026",
    );
    await user.click(screen.getByRole("button", { name: "Konto erstellen" }));

    expect(
      screen.getByText(
        "Fast geschafft: Bitte bestätige deine E-Mail über den zugesandten Link.",
      ),
    ).toBeInTheDocument();
  });

  it("requests a password reset without revealing account existence", async () => {
    const user = userEvent.setup();
    const fetchMock = createFetchMock({
      passwordResetResponse: new Response(JSON.stringify({ sent: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Konto" }));
    await user.click(
      screen.getByRole("button", { name: "Passwort vergessen?" }),
    );
    await user.type(screen.getByLabelText("E-Mail"), "runner@example.com");
    await user.click(screen.getByRole("button", { name: "Reset-Link senden" }));

    expect(
      screen.getByText(
        "Falls ein Konto zu dieser E-Mail existiert, wurde ein Reset-Link versendet.",
      ),
    ).toBeInTheDocument();
    const resetCall = fetchMock.mock.calls.find(([url]) =>
      url.toString().endsWith("/api/v1/auth/password-reset/request"),
    );
    expect(JSON.parse(resetCall?.[1]?.body?.toString() ?? "{}")).toEqual({
      email: "runner@example.com",
    });
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

  it("explains effort kilometres on demand", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", createFetchMock());

    render(<App />);

    await user.click(
      screen.getByRole("button", { name: "Effort km erklären" }),
    );
    expect(
      screen.getByText(/Distanz in km plus Aufstieg in m geteilt durch 100/),
    ).toBeInTheDocument();
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
    expect(screen.getByLabelText("Trailrunning Kennzahlen")).toHaveTextContent(
      "Distanz",
    );
    expect(screen.getByText("2 Punkte · 1 Abschnitte")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("1.23 km")).toBeInTheDocument(),
    );
    expect(screen.getByText("Route berechnet")).toBeInTheDocument();
    expect(screen.getByLabelText("Legende")).toHaveTextContent("Gerade");
    expect(screen.getByLabelText("Legende")).toHaveTextContent("Routing");
    expect(
      screen.queryByLabelText("Wegbeschaffenheit"),
    ).not.toBeInTheDocument();
  });

  it("summarizes classified route surface details", async () => {
    storeRouteWithTwoWaypoints();
    vi.stubGlobal(
      "fetch",
      createFetchMock({
        routeResponses: [
          routeResponse({
            distanceMeters: 1234,
            mode: "routed",
            surfaceDetails: [
              [0, 1, "asphalt"],
              [1, 2, "ground"],
            ],
          }),
        ],
      }),
    );

    render(<App />);

    await waitFor(() =>
      expect(screen.getByLabelText("Wegbeschaffenheit")).toHaveTextContent(
        "Strasse",
      ),
    );
    expect(screen.getByLabelText("Wegbeschaffenheit")).toHaveTextContent(
      "Trail/Natur",
    );
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

  it("opens a map-first mobile profile mode", async () => {
    const user = userEvent.setup();
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

    await user.click(await screen.findByRole("button", { name: "Profil" }));
    const routePanel = screen.getByRole("complementary", {
      name: "Routeninformationen",
    });
    expect(routePanel).toHaveClass("mobileProfileMode");

    await user.click(
      screen.getByRole("button", { name: "Höhenprofil schließen" }),
    );
    expect(routePanel).not.toHaveClass("mobileProfileMode");
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
    await user.click(screen.getByText("Abschnitte"));
    const segmentPanel = screen.getByText("Abschnitte").closest("details");
    expect(segmentPanel).not.toBeNull();
    await user.click(
      within(segmentPanel as HTMLElement).getByRole("button", {
        name: "Gerade",
      }),
    );

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

  it("switches to velo routing from the main planning UI", async () => {
    const user = userEvent.setup();
    const fetchMock = createFetchMock({
      routeResponses: [
        routeResponse({ distanceMeters: 1234 }),
        routeResponse({ distanceMeters: 1234 }),
      ],
    });
    storeRouteWithTwoWaypoints();
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("1.23 km")).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Route zeichnen" }));
    const profileSelect = screen.getByRole("combobox", {
      name: "Routing-Profil",
    });
    await user.selectOptions(profileSelect, "bike");
    expect(profileSelect).toHaveValue("bike");
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          url.toString().endsWith("/api/v1/route/compute"),
        ),
      ).toHaveLength(2),
    );
    const routeCall = fetchMock.mock.calls
      .filter(([url]) => url.toString().endsWith("/api/v1/route/compute"))
      .at(-1);
    const routeRequest = JSON.parse(String(routeCall?.[1]?.body)) as {
      profile: string;
    };
    expect(routeRequest.profile).toBe("bike");
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

  it("searches places and shows selectable results", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", createFetchMock());

    render(<App />);

    await user.type(
      screen.getByLabelText("Ort, Adresse oder Route suchen"),
      "Bern",
    );

    await waitFor(() => expect(screen.getByText("Bern")).toBeInTheDocument());
    expect(screen.getByText("Ort")).toBeInTheDocument();
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
    authRegisterResponse?: Promise<Response> | Response;
    passwordResetResponse?: Promise<Response> | Response;
    routeResponses?: Array<Promise<Response> | Response>;
    elevationResponses?: Array<Promise<Response> | Response>;
  } = {},
) {
  const routeResponses = [...(options.routeResponses ?? [])];
  const elevationResponses = [...(options.elevationResponses ?? [])];
  const authRegisterResponse = options.authRegisterResponse;
  const passwordResetResponse = options.passwordResetResponse;

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

    if (url.endsWith("/api/v1/auth/session")) {
      return Promise.resolve(
        new Response(JSON.stringify({ authenticated: false, user: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }

    if (url.endsWith("/api/v1/auth/register")) {
      if (!authRegisterResponse) {
        return Promise.reject(new Error("Unexpected registration request"));
      }
      return authRegisterResponse instanceof Response
        ? Promise.resolve(authRegisterResponse)
        : authRegisterResponse;
    }

    if (url.endsWith("/api/v1/auth/password-reset/request")) {
      if (!passwordResetResponse) {
        return Promise.reject(new Error("Unexpected password reset request"));
      }
      return passwordResetResponse instanceof Response
        ? Promise.resolve(passwordResetResponse)
        : passwordResetResponse;
    }

    if (url.includes("/api/v1/search?")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            results: [
              {
                id: "bern",
                label: "Bern",
                origin: "gazetteer",
                longitude: 7.4474,
                latitude: 46.948,
                zoom: 12,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
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
      hikingTime: {
        duration_minutes: 18,
        method: "swiss_hiking_polynomial",
        segment_length_m: 50,
        smoothing_window_m: 40,
        segment_count: 25,
      },
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
  surfaceDetails,
}: {
  distanceMeters: number;
  mode?: "straight" | "routed";
  surfaceDetails?: Array<[number, number, string]>;
}) {
  return new Response(
    JSON.stringify({
      geometry: {
        type: "LineString",
        coordinates: [
          [7.4, 46.9],
          [7.95, 47.1],
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
          details: {
            hike_rating: [[0, 1, 0]],
            ...(surfaceDetails ? { surface: surfaceDetails } : {}),
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [7.4, 46.9],
              [7.95, 47.1],
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
