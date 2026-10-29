import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SocialPublishingOnboarding } from "./SocialPublishingOnboarding";

describe("SocialPublishingOnboarding", () => {
  it("names every provider with its setup and account step and never claims direct publishing", () => {
    const { container } = render(<SocialPublishingOnboarding />);
    expect(screen.getByText("Social-Konten einrichten")).toBeInTheDocument();
    for (const name of ["Instagram und Facebook", "TikTok", "YouTube"]) {
      const summary = screen.getByText(`${name} · Einrichtung erforderlich`);
      const card = summary.closest("details");
      expect(card).not.toBeNull();
      expect(within(card as HTMLElement).getByText("App einrichten:")).toBeInTheDocument();
      expect(within(card as HTMLElement).getByText("Konto verbinden:")).toBeInTheDocument();
    }
    expect(screen.getByText(/direkte Veröffentlichungen sind in dieser Version noch nicht verfügbar/)).toBeInTheDocument();
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("opens provider guides in a new tab without handing over the opener", () => {
    render(<SocialPublishingOnboarding />);
    const links = screen.getAllByRole("link", { hidden: true });
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link.getAttribute("href")).toMatch(/^https:\/\//);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
      expect(link.getAttribute("rel")).toContain("noreferrer");
    }
  });
});
