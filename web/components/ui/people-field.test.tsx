// @vitest-environment jsdom
/** Naming people as a person types (2026-11-25: an Area's contacts "pop up if they exist as users type name/email"). */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PeopleField } from "@/components/ui/people-field";

const DIRECTORY = [
  { ref: "user:ana@shop.example", name: "Ana Rao", email: "ana@shop.example", source: "directory" },
  { ref: "user:bo@shop.example", name: "Bo Lind", email: "bo@shop.example", source: "directory" },
];

function Field({ start = [] as string[], onChange = vi.fn() }) {
  const [value, setValue] = useState<string[]>(start);
  return <PeopleField label="Business contacts" value={value} onChange={(v) => { setValue(v); onChange(v); }} />;
}

afterEach(() => vi.unstubAllGlobals());

describe("naming people", () => {
  it("offers who exists as a name or an email is typed, and names the one picked", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      asked.push(String(url));
      const q = new URL(String(url), "http://x").searchParams.get("q") ?? "";
      return new Response(JSON.stringify(DIRECTORY.filter((p) => p.name.toLowerCase().includes(q) || p.email.includes(q))));
    }));
    const onChange = vi.fn();
    render(<Field onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Business contacts"), { target: { value: "ana" } });
    expect(await screen.findByRole("option", { name: /Ana Rao/ })).toBeTruthy();
    expect(asked.some((u) => u.includes("/people?q=ana"))).toBe(true);
    fireEvent.click(screen.getByRole("option", { name: /Ana Rao/ }));
    expect(onChange).toHaveBeenLastCalledWith(["user:ana@shop.example"]);
    expect(screen.getAllByTestId("people-chip").map((c) => c.textContent)).toEqual(["ana@shop.example"]);
  });

  it("names someone nobody holds as typed, never twice, and takes the last back with Backspace", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]")));
    const onChange = vi.fn();
    render(<Field start={["user:cai"]} onChange={onChange} />);
    const box = screen.getByLabelText("Business contacts");
    fireEvent.change(box, { target: { value: "dee@shop.example" } });
    await waitFor(() => screen.getByText(/Nobody by that name yet/));
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(["user:cai", "user:dee@shop.example"]);
    fireEvent.change(box, { target: { value: "cai" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(1);                         // already named: nothing changes
    fireEvent.keyDown(box, { key: "Backspace" });
    expect(onChange).toHaveBeenLastCalledWith(["user:cai"]);
  });
});
