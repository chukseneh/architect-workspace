# Quality Contract: skill-lab/orders.csv

- `order_id` must be unique — no duplicate order IDs across the dataset.
- `region` is required — every row must have a non-empty region.
- `revenue` must be greater than zero.
- `load_timestamp` must be less than 24 hours old, measured against the current time.
- Expected row count is at least 10.
