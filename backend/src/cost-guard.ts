import { ApiError } from "./http";

// Intentionally far below R2 Standard's monthly free allowances. These limits
// apply only to this Worker's private bucket; other account usage is separate.
export const MAX_RESERVED_STORAGE_BYTES = 1_000_000_000;
export const MAX_MONTHLY_CLASS_A = 10_000;
export const MAX_MONTHLY_CLASS_B = 500_000;

export function storageBudgetAllows(size: number): string {
  return `(SELECT COALESCE(SUM(file_size_bytes), 0) FROM revisions WHERE status != 'deleted') <= ${MAX_RESERVED_STORAGE_BYTES} - ${size}`;
}

export async function storageBudgetExceeded(db: D1Database, size: number): Promise<boolean> {
  const row = await db.prepare("SELECT COALESCE(SUM(file_size_bytes), 0) AS used FROM revisions WHERE status != 'deleted'")
    .first<{ used: number }>();
  return (row?.used ?? 0) > MAX_RESERVED_STORAGE_BYTES - size;
}

async function reserveOperation(db: D1Database, kind: "class_a" | "class_b"): Promise<void> {
  const limit = kind === "class_a" ? MAX_MONTHLY_CLASS_A : MAX_MONTHLY_CLASS_B;
  // One atomic write reserves an operation before it can reach R2. Failed R2
  // calls still consume a reservation, which errs toward stopping early.
  const row = await db.prepare(`
    INSERT INTO r2_operation_budget (period, ${kind}) VALUES (strftime('%Y-%m', 'now'), 1)
    ON CONFLICT(period) DO UPDATE SET ${kind} = ${kind} + 1 WHERE ${kind} < ${limit}
    RETURNING period
  `).first();
  if (!row) throw new ApiError(503, "cost_limit_reached", "The private test service has reached its monthly R2 operation limit.");
}

export function meteredBucket(db: D1Database, bucket: R2Bucket): R2Bucket {
  return new Proxy(bucket, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      if (property === "put" || property === "get" || property === "head") {
        const kind = property === "put" ? "class_a" : "class_b";
        return async (...args: unknown[]) => {
          await reserveOperation(db, kind);
          return Reflect.apply(value, target, args);
        };
      }
      if (property === "delete") return value.bind(target); // R2 deletes are free.
      // Future R2 methods must be classified before they can reach this bucket.
      return () => { throw new ApiError(503, "unmetered_operation", "This R2 operation is not enabled for the private test service."); };
    },
  });
}
