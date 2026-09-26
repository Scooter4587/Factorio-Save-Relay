CREATE TABLE r2_operation_budget (
    period TEXT PRIMARY KEY,
    class_a INTEGER NOT NULL DEFAULT 0 CHECK (class_a >= 0),
    class_b INTEGER NOT NULL DEFAULT 0 CHECK (class_b >= 0)
);
