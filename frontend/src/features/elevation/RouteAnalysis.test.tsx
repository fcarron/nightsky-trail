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
});
