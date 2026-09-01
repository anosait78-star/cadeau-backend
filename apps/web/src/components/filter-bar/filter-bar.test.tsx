import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/i18n-provider";
import { setViewport } from "@/test/setup";
import { FilterBar } from "./filter-bar";

function renderBar(props: Partial<Parameters<typeof FilterBar>[0]> = {}) {
  return render(
    <I18nProvider>
      <FilterBar activeCount={0} clearAllLabel="امسح" {...props}>
        <label>
          الحالة
          <input />
        </label>
      </FilterBar>
    </I18nProvider>,
  );
}

describe("FilterBar", () => {
  describe("on Desktop", () => {
    it("lays the controls out inline", () => {
      setViewport(true);
      renderBar();
      expect(screen.getByText("الحالة")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /الفلاتر/ })).not.toBeInTheDocument();
    });
  });

  describe("on Mobile", () => {
    it("keeps the controls behind a sheet until asked for", async () => {
      const user = userEvent.setup();
      setViewport(false);
      renderBar();

      expect(screen.queryByText("الحالة")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /الفلاتر/ }));
      expect(await screen.findByText("الحالة")).toBeInTheDocument();
    });

    it("reports the active count on the trigger, so a hidden filter is still visible", () => {
      setViewport(false);
      renderBar({ activeCount: 2 });
      expect(screen.getByRole("button", { name: "الفلاتر (2)" })).toBeInTheDocument();
    });

    it("leaves actions in the bar rather than burying them in the sheet", () => {
      setViewport(false);
      renderBar({ actions: <button type="button">تعديل المخزون</button> });
      expect(screen.getByRole("button", { name: "تعديل المخزون" })).toBeInTheDocument();
    });

    it("still offers clear-all once something is filtered", async () => {
      const user = userEvent.setup();
      const onClearAll = vi.fn();
      setViewport(false);
      renderBar({ activeCount: 1, onClearAll });

      await user.click(screen.getByRole("button", { name: "امسح" }));
      expect(onClearAll).toHaveBeenCalledOnce();
    });
  });
});
