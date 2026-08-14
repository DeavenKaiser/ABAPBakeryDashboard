-- ============================================================
-- ABAP Bakery — recipe yield
--
-- Adds how much a recipe makes, which unlocks two things:
--   1. Scaling at the bench — "make 1.5×" recalculating every ingredient.
--   2. Cost per unit, which the app has never been able to compute.
--
-- (2) is a correctness fix, not a feature. v_recipe_pricing divides the
-- BATCH ingredient cost by the food-cost percentage, so for a recipe making
-- 24 scones it has been reporting a suggested retail price for all 24 at once
-- — displayed in planner.html right beside per-item prices from
-- recipe_options. See ROADMAP List 3 #1.
-- ============================================================

begin;

alter table public.recipes
  add column if not exists yield_qty  numeric,
  add column if not exists yield_unit text;

comment on column public.recipes.yield_qty is
  'How many units one batch makes. NULL means unknown — pricing per unit cannot be computed.';
comment on column public.recipes.yield_unit is
  'What the yield is counted in: loaves, dozen, servings, each.';

alter table public.recipes
  add constraint recipes_yield_qty_positive
  check (yield_qty is null or yield_qty > 0);

-- ------------------------------------------------------------
-- Rebuild v_recipe_pricing so suggested prices are PER UNIT.
--
-- Deliberate decision: when yield_qty is unknown the suggested prices are
-- NULL rather than falling back to the batch figure. A wrong price that looks
-- right is worse than a blank that prompts someone to fill in the yield —
-- especially since these numbers are what wholesale quotes get built from.
--
-- ingredient_cost stays as the batch total, which is what it always meant.
-- ------------------------------------------------------------

create or replace view public.v_recipe_pricing as
  select
    r.id,
    r.name,
    r.category,
    r.yield_qty,
    r.yield_unit,
    coalesce(sum(ri.est_cost), 0)::numeric as ingredient_cost,
    case
      when r.yield_qty > 0 then round(coalesce(sum(ri.est_cost), 0) / r.yield_qty, 4)
      else null
    end as cost_per_unit,
    ps.retail_food_cost_pct,
    ps.wholesale_food_cost_pct,
    case
      when r.yield_qty > 0 and ps.retail_food_cost_pct > 0
      then round((coalesce(sum(ri.est_cost), 0) / r.yield_qty) / ps.retail_food_cost_pct, 2)
      else null
    end as suggested_retail,
    case
      when r.yield_qty > 0 and ps.wholesale_food_cost_pct > 0
      then round((coalesce(sum(ri.est_cost), 0) / r.yield_qty) / ps.wholesale_food_cost_pct, 2)
      else null
    end as suggested_wholesale
  from recipes r
  left join recipe_ingredients ri on ri.recipe_id = r.id
  left join pricing_settings ps on ps.category = coalesce(r.category, 'Other')
  where r.active = true
  group by r.id, r.name, r.category, r.yield_qty, r.yield_unit,
           ps.retail_food_cost_pct, ps.wholesale_food_cost_pct;

-- CREATE OR REPLACE preserves reloptions, but set it explicitly so this view
-- can never silently regress to bypassing RLS (migration 001 §2).
alter view public.v_recipe_pricing set (security_invoker = on);

revoke all on public.v_recipe_pricing from anon;
grant select on public.v_recipe_pricing to authenticated;

commit;


-- ============================================================
-- Verify
-- ============================================================

-- Recipes still needing a yield — these show blank suggested prices until set.
-- select name, category from recipes where active and yield_qty is null order by name;

-- Sanity: cost_per_unit should be ingredient_cost / yield_qty.
-- select name, yield_qty, yield_unit, ingredient_cost, cost_per_unit,
--        suggested_retail, suggested_wholesale
--   from v_recipe_pricing order by name;
