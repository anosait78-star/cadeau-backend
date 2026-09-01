import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { Sparkline } from "@/components/kpi/sparkline";
import { cn } from "@/lib/cn";

/** One KPI tile: a headline number with its icon, trend and optional series. */
export interface KpiTileSpec {
  readonly label: string;
  readonly value: string;
  readonly icon: ReactNode;
  readonly iconToneClassName: string;
  /** Percent change against the comparison period; `null` when there is no baseline. */
  readonly trendPct: number | null;
  /** Sparkline points, oldest → newest. `null` for a tile with no history. */
  readonly series: readonly number[] | null;
  /** Marks a value derived from a capped sample rather than a full aggregate. */
  readonly approximate?: boolean;
}

/**
 * A KPI tile. Fixed height so a row of them stays a grid rather than a ragged
 * set of boxes, and the number is `tabular-nums` + `dir="ltr"` so digits line up
 * across cards and read left-to-right inside an RTL page.
 */
export function KpiCard({
  tile,
  trendSuffix,
}: {
  tile: KpiTileSpec;
  /** What the trend is measured against, e.g. "vs yesterday". */
  trendSuffix: string;
}): ReactNode {
  const trendTone =
    tile.trendPct === null
      ? "text-muted-foreground"
      : tile.trendPct > 0
        ? "text-success"
        : tile.trendPct < 0
          ? "text-destructive"
          : "text-muted-foreground";

  return (
    <div className="flex h-[140px] flex-col justify-between rounded-2xl border border-border bg-card p-4 shadow-xs">
      <div className="flex items-start justify-between">
        <span
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full",
            tile.iconToneClassName,
          )}
        >
          {tile.icon}
        </span>
        {tile.series !== null ? (
          <Sparkline
            values={tile.series}
            className="h-6 w-16"
            toneClassName="text-muted-foreground"
          />
        ) : null}
      </div>
      <div>
        <p className="truncate text-caption text-muted-foreground">{tile.label}</p>
        <p className="text-h1 leading-tight text-foreground tabular-nums" dir="ltr">
          {tile.value}
        </p>
      </div>
      <div className={cn("flex items-center gap-1 text-caption", trendTone)}>
        {tile.trendPct !== null && tile.trendPct !== 0 ? (
          tile.trendPct > 0 ? (
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />
          )
        ) : null}
        <span dir="ltr">
          {tile.trendPct === null
            ? "—"
            : `${tile.trendPct > 0 ? "+" : ""}${tile.trendPct.toFixed(1)}%`}
        </span>
        <span className="truncate text-muted-foreground">
          {tile.approximate === true ? "· ≈" : trendSuffix}
        </span>
      </div>
    </div>
  );
}

/** A responsive row of {@link KpiCard}s: two up on a phone, six across on a wide screen. */
export function KpiRow({
  tiles,
  trendSuffix,
  testId,
}: {
  tiles: readonly KpiTileSpec[];
  trendSuffix: string;
  testId?: string;
}): ReactNode {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6" data-testid={testId}>
      {tiles.map((tile) => (
        <KpiCard key={tile.label} tile={tile} trendSuffix={trendSuffix} />
      ))}
    </div>
  );
}
