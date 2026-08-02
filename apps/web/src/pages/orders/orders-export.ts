import type { OrderListItem } from "@/features/orders/orders-api";

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Client-side CSV of the currently-loaded/filtered rows — no backend call. */
export function ordersToCsv(orders: OrderListItem[]): string {
  const header = [
    "orderNumber",
    "customerName",
    "itemCount",
    "total",
    "collectedAmount",
    "paymentStatus",
    "status",
    "createdAt",
  ];
  const rows = orders.map((o) =>
    [
      String(o.orderNumber),
      o.customerName,
      String(o.itemCount),
      (o.total / 100).toFixed(2),
      (o.collectedAmount / 100).toFixed(2),
      o.paymentStatus,
      o.status,
      o.createdAt,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

/** Triggers a browser download of the given CSV text. */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
