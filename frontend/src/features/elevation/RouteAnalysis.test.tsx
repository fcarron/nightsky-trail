import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RouteAnalysis } from "./RouteAnalysis";

describe("RouteAnalysis", () => {
  it("combines selected gradient bins into route statistics", () => {
    render(
      <RouteAnalysis
        activeTab="gradient"
        climbs={[]}
        gradientDistribution={[
          {
            ascentMeters: 30,
            descentMeters: 0,
            distanceMeters: 300,
            endGradientPercent: 12.5,
            label: "10 bis 12.5 %",
            startGradientPercent: 10,
          },
          {
            ascentMeters: 50,
            descentMeters: 0,
            distanceMeters: 200,
            endGradientPercent: 27.5,
            label: "25 bis 27.5 %",
            startGradientPercent: 25,
          },
          {
            ascentMeters: 0,
            descentMeters: 10,
            distanceMeters: 500,
            endGradientPercent: 0,
            label: "-2.5 bis 0 %",
            startGradientPercent: -2.5,
          },
        ]}
        onRangeChange={vi.fn()}
        onTabChange={vi.fn()}
        splits={[]}
        sustainedGradients={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /10 bis 12.5 %/ }));
    fireEvent.click(screen.getByRole("button", { name: /25 bis 27.5 %/ }));

    const summary = screen.getByRole("region", {
      name: "Ausgewählte Gradientbereiche",
    });
    expect(summary).toHaveTextContent("2 Bereiche");
    expect(summary).toHaveTextContent("500 m");
    expect(summary).toHaveTextContent("50.0 %");
    expect(summary).toHaveTextContent("+80 m · -0 m");

    fireEvent.click(screen.getByRole("button", { name: "Zurücksetzen" }));
    expect(
      screen.queryByRole("region", { name: "Ausgewählte Gradientbereiche" }),
    ).not.toBeInTheDocument();
  });

  it("highlights and pins the selected sustained-gradient passage", () => {
    const onRangeChange = vi.fn();
    const uphillRange = {
      startDistanceMeters: 3_100,
      endDistanceMeters: 3_600,
    };

    render(
      <RouteAnalysis
        activeTab="gradient"
        climbs={[]}
        gradientDistribution={[]}
        onRangeChange={onRangeChange}
        onTabChange={vi.fn()}
        splits={[]}
        sustainedGradients={[
          {
            downhillGradientPercent: -12.4,
            downhillRange: {
              startDistanceMeters: 7_000,
              endDistanceMeters: 7_500,
            },
            uphillGradientPercent: 18.6,
            uphillRange,
            windowMeters: 500,
          },
        ]}
      />,
    );

    const passage = screen.getByRole("button", {
      name: /Steilste Bergauf-Passage über 500 m/,
    });

    fireEvent.mouseEnter(passage);
    expect(onRangeChange).toHaveBeenLastCalledWith(uphillRange);

    fireEvent.mouseLeave(passage);
    expect(onRangeChange).toHaveBeenLastCalledWith(null);

    fireEvent.click(passage);
    expect(passage).toHaveAttribute("aria-pressed", "true");
    expect(onRangeChange).toHaveBeenLastCalledWith(uphillRange);

    fireEvent.mouseLeave(passage);
    expect(onRangeChange).toHaveBeenLastCalledWith(uphillRange);
  });

  it("shows surface and OSM difficulty shares in the route tab", () => {
    render(
      <RouteAnalysis
        activeTab="route"
        climbs={[]}
        difficultyBreakdown={[
          {
            color: "#7f9db9",
            distanceMeters: 600,
            id: "T2",
            label: "T2",
          },
          {
            color: "#d4dbe3",
            distanceMeters: 400,
            id: "unknown",
            label: "?",
          },
        ]}
        gradientDistribution={[]}
        onRangeChange={vi.fn()}
        onTabChange={vi.fn()}
        routeDistanceMeters={1_000}
        splits={[]}
        surfaceBreakdown={[
          {
            color: "#8fa1ad",
            distanceMeters: 250,
            id: "paved",
            label: "Strasse",
          },
          {
            color: "#3f9b68",
            distanceMeters: 750,
            id: "natural",
            label: "Trail/Natur",
          },
        ]}
        sustainedGradients={[]}
      />,
    );

    expect(screen.getByText("Strasse")).toBeInTheDocument();
    expect(screen.getByText("25 % · 250 m")).toBeInTheDocument();
    expect(screen.getByText("T2")).toBeInTheDocument();
    expect(screen.getByText("60 % · 600 m")).toBeInTheDocument();
    expect(
      screen.getByText(/Unbekannt bedeutet: keine nutzbare OSM-Angabe/),
    ).toBeInTheDocument();
  });

  it("does not present missing OSM difficulty as a 100 percent rating", () => {
    render(
      <RouteAnalysis
        activeTab="route"
        climbs={[]}
        difficultyBreakdown={[
          {
            color: "#d4dbe3",
            distanceMeters: 1_000,
            id: "?",
            label: "?",
          },
        ]}
        gradientDistribution={[]}
        onRangeChange={vi.fn()}
        onTabChange={vi.fn()}
        routeDistanceMeters={1_000}
        splits={[]}
        surfaceBreakdown={[]}
        sustainedGradients={[]}
      />,
    );

    expect(
      screen.getByText(
        "Für diese Route liegen keine OSM-Schwierigkeitsangaben vor.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("100 % · 1.00 km")).not.toBeInTheDocument();
  });

  it("rounds displayed shares to their common total", () => {
    render(
      <RouteAnalysis
        activeTab="route"
        climbs={[]}
        difficultyBreakdown={[]}
        gradientDistribution={[]}
        onRangeChange={vi.fn()}
        onTabChange={vi.fn()}
        routeDistanceMeters={10_000}
        splits={[]}
        surfaceBreakdown={[
          { color: "#aaa", distanceMeters: 469, id: "a", label: "A" },
          { color: "#bbb", distanceMeters: 1_578, id: "b", label: "B" },
          { color: "#ccc", distanceMeters: 7_953, id: "c", label: "C" },
        ]}
        sustainedGradients={[]}
      />,
    );

    expect(screen.getByText("5 % · 469 m")).toBeInTheDocument();
    expect(screen.getByText("16 % · 1.58 km")).toBeInTheDocument();
    expect(screen.getByText("79 % · 7.95 km")).toBeInTheDocument();
  });
});
