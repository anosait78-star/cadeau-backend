import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/i18n/i18n-provider";
import { PermissionPicker } from "./permission-picker";
import type { AvailablePermission } from "./team-api";

function permission(key: string, featureKey: string | null, available = true): AvailablePermission {
  return { key, featureKey, description: `raw ${key}`, available };
}

const CATALOG: AvailablePermission[] = [
  permission("orders.read", "orders"),
  permission("orders.manage", "orders"),
  permission("access.manage", null),
  // Out of plan for this company.
  permission("finance.read", "finance", false),
  permission("finance.manage", "finance", false),
];

/** Renders the picker with real selection state, as the invite dialog does. */
function Harness({ catalog = CATALOG }: { catalog?: AvailablePermission[] }): ReactNode {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  return (
    <I18nProvider>
      <PermissionPicker
        permissions={catalog}
        selected={selected}
        onToggle={(key) =>
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          })
        }
        onSelectMany={(keys, select) =>
          setSelected((prev) => {
            const next = new Set(prev);
            for (const key of keys) {
              if (select) next.add(key);
              else next.delete(key);
            }
            return next;
          })
        }
      />
    </I18nProvider>
  );
}

/** The section whose header carries `label`, expanded. */
async function section(label: string): Promise<HTMLElement> {
  const header = await screen.findByText(label);
  const el = header.closest("section");
  if (el === null) throw new Error(`no section for ${label}`);
  const toggle = within(el).getAllByRole("button")[0] as HTMLElement;
  if (toggle.getAttribute("aria-expanded") === "false") await userEvent.click(toggle);
  return el;
}

describe("PermissionPicker", () => {
  it("names permissions in Arabic instead of showing the dotted key", async () => {
    render(<Harness />);
    const orders = await section("الطلبات");

    expect(within(orders).getByText("عرض الطلبات")).toBeInTheDocument();
    expect(within(orders).getByText("إدارة الطلبات")).toBeInTheDocument();
    // The key is still reachable for support, but never on the face of the row.
    expect(within(orders).queryByText("orders.read")).not.toBeInTheDocument();
    expect(within(orders).getByLabelText(/عرض الطلبات/)).toHaveAttribute("id", "perm-orders.read");
  });

  it("shows out-of-plan permissions disabled rather than hiding them", async () => {
    render(<Harness />);
    const finance = await section("المالية");

    const locked = within(finance).getByLabelText(/عرض المالية/);
    expect(locked).toBeDisabled();
    expect(within(finance).getAllByText("غير متاح في خطتك").length).toBe(2);
  });

  it("keeps a locked permission out of the selection when the section is bulk-selected", async () => {
    render(<Harness />);
    const finance = await section("المالية");

    // A section with nothing grantable offers no bulk control at all — there is
    // no set of keys the server would accept.
    expect(
      within(finance).queryByRole("button", { name: "اختيار كل صلاحيات القسم" }),
    ).not.toBeInTheDocument();
  });

  it("counts the selection per module as the user picks", async () => {
    render(<Harness />);
    const orders = await section("الطلبات");

    await userEvent.click(within(orders).getByLabelText(/عرض الطلبات/));
    expect(within(orders).getByText("1/2")).toBeInTheDocument();

    await userEvent.click(within(orders).getByRole("button", { name: "اختيار كل صلاحيات القسم" }));
    expect(within(orders).getByText("2/2")).toBeInTheDocument();
  });

  it("sorts core first but opens nothing until asked", async () => {
    render(<Harness />);
    const sections = document.querySelectorAll("section");
    expect(within(sections[0] as HTMLElement).getByText("عام")).toBeInTheDocument();

    // Closed on arrival: the module names are the whole first screen.
    expect(screen.queryByText("إدارة الصلاحيات")).not.toBeInTheDocument();

    await section("عام");
    expect(screen.getByText("إدارة الصلاحيات")).toBeInTheDocument();
  });
});
