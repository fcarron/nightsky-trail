import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RouteAnalysis } from "./RouteAnalysis";

describe("RouteAnalysis", () => {
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
