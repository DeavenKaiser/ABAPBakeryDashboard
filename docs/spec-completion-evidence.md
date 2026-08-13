# Spec — completion requires evidence

Two related changes:

1. A task can require a **value**, not just a tick. Empty means not done.
2. Inventory can be **verified unchanged** in one tap — no retyping, but a real
   record that someone looked.

Both close the same hole: today a completion is a claim with nothing behind it.

---

## Why this matters more than it looks

`isBelow()` in `config.js`:

```js
return it && it.current_on_hand != null && it.threshold != null
  && Number(it.current_on_hand) < Number(it.threshold);
```

A null `current_on_hand` returns false. The nav badge, the dashboard
inventory-health widget, and the shopping list all filter this way, so **an
item that has never been counted cannot appear in any low-stock warning.**
The surest way to hide a stockout is to skip the item entirely. Requiring a
value is what closes that.

---

## Part 1 — Tasks that require a value

### Schema

```sql
alter table tasks
  add column result_type          text,           -- null | number | text | temperature
  add column result_label         text,           -- "Walk-in temp"
  add column result_unit          text,           -- "°F", "ppm", "lb"
  add column result_required      boolean not null default false,
  add column result_min           numeric,        -- either bound optional
  add column result_max           numeric,
  add column out_of_range_action  text not null default 'warn';
                                  -- 'none' | 'warn' | 'block'

alter table task_completions
  add column result_value  numeric,
  add column result_text   text,
  add column out_of_range  boolean not null default false,
  add column note          text,
  add column resolved_at   timestamptz,
  add column resolved_by   uuid references profiles(id);
```

Tasks with `result_type = null` behave exactly as they do today. This is
additive — nothing existing changes behaviour.

### Behaviour

**Empty value.** If `result_required` and the field is blank, the checkbox
won't complete. Inline message, no dialog. Do not silently write a completion
row.

**In range.** Saves normally, task goes green, value stored.

**Out of range, `action = 'warn'`.** Value saves. `out_of_range = true`. A note
is required. Task completes as *done with exception* — visually distinct from
a clean completion, and surfaced to the admin.

**Out of range, `action = 'block'`.** *The value still saves.* What is blocked
is the task counting as satisfactorily complete:

- the reading is written with `out_of_range = true`
- an exception opens and is pushed to the admin immediately
- the task stays incomplete until a later reading comes back in range, which
  sets `resolved_at` / `resolved_by`

Rationale: refusing to record a bad reading doesn't make the walk-in colder.
It makes the next person type a number that passes. The record of the real
temperature — and when it was found — is the entire point of the log.

### Note on frequency

`task_completions` has `UNIQUE (task_id, period_key)`, so one completion per
task per period. For twice-daily readings, model opening and closing as two
tasks and use the existing `shift_part` field. No schema change needed.

### Examples

| Task | type | unit | min | max | action |
|---|---|---|---|---|---|
| Walk-in cooler temp | temperature | °F | — | 41 | block |
| Freezer temp | temperature | °F | — | 0 | block |
| Sanitizer concentration | number | ppm | 200 | 400 | block |
| Syrup pumps remaining | number | ct | 2 | — | warn |
| Cooling time to 70°F | number | min | — | 120 | block |
| Waste weight | number | lb | — | — | none |

---

## Part 2 — Verify inventory unchanged

### The problem

`on_inventory_update` only logs when the value actually changes:

```sql
if new.current_on_hand is distinct from old.current_on_hand then
```

So when someone counts an item and it genuinely hasn't moved, **nothing is
recorded.** No proof it was checked, no timestamp, no person. Indistinguishable
from being skipped.

### Schema

```sql
alter table inventory_history
  add column entry_type text not null default 'count';
  -- 'count' | 'verified_unchanged' | 'adjustment' | 'waste'

alter table inventory_items
  add column last_verified_at timestamptz,
  add column last_verified_by uuid references profiles(id);
```

`entry_type` also gives the waste log (Roadmap List 3 #4) a home later — same
table, new type.

### Behaviour

Each inventory row gets a **"Same as last count"** action beside the number
field. One tap:

- writes an `inventory_history` row with the *current* value and
  `entry_type = 'verified_unchanged'`, stamped with who and when
- sets `last_verified_at` / `last_verified_by`
- sets `counted_this_week = true`
- does **not** require retyping

Because the value is unchanged, no artificial decrease is introduced and
`v_usage_rate` stays correct.

### Never-counted items

Replace the two-state `isBelow()` with three states:

```js
function stockStatus(it) {
  if (it.current_on_hand == null) return "unknown";
  if (it.threshold == null)       return "ok";
  return Number(it.current_on_hand) < Number(it.threshold) ? "below" : "ok";
}
```

`unknown` items get their own bucket — "never counted" — and appear in the nav
badge and dashboard separately from `below`. They must stop being invisible.

---

## Part 3 — Anti-rubber-stamp

A one-tap button on a busy shift drifts toward being tapped without looking.
Detect it, don't prevent it.

Key nuance: **compare each item against its own history, not a global rule.**
Vanilla extract legitimately doesn't move for months; that's not rubber
stamping. Flour confirmed unchanged three weeks running while you bake daily
is.

```sql
create view v_verification_health as
-- for each item: consecutive verified_unchanged entries at the tail of its
-- history, alongside its own consumed_30d from v_usage_rate.
-- suspicious = streak >= 3 and the item has demonstrated real usage.
```

Surface as an admin dashboard widget: *"3 items confirmed unchanged repeatedly
but historically move — worth a spot check."* Never block the action, never
scold the person. It's a prompt for the manager, not a gate on the shift.

---

## Build order

1. Schema migration (additive, no behaviour change on its own)
2. Inventory verify-unchanged + three-state stock status — smallest, and fixes
   the invisible-stockout hole immediately
3. Task result capture, `warn` path
4. Task `block` path with exception open/resolve
5. `v_verification_health` and the admin widget

Depends on: Roadmap Features #1 (task enable/disable) touching the same UI, and
Features #2 (admin settings) for editing result config per task. Sequence
after those where practical.
