# Puzzle analytics

Production records anonymous puzzle runs in Supabase. The browser sends one
`load` event when a puzzle is ready and, if the run finishes, one `completion`
event with the same random `run_id`.

The events include the puzzle ID and revision, declared difficulty, score,
maximum score, elapsed run time, wrong guesses, and first-letter hints. The
current difficulty scale is:

- `easy` = 1
- `medium` = 2
- `hard` = 3

The puzzle definition remains the source of truth. Each event stores a
difficulty snapshot so that results for a prior rating remain interpretable.
Normalized score is derived as `score / nullif(max_score, 0)` and is not stored.

## View the results

Open the production creator, sign in with an allowlisted manager account, and
select **Analítica** in the mode navigation. The dashboard supports 7-day,
30-day, 90-day, and all-time periods. It shows summary metrics, performance by
puzzle revision, and calibration by declared difficulty.

The dashboard uses the same manager check as puzzle publication. The Edge
Function returns only aggregate results. It does not send event rows or
`run_id` values to the browser.

For direct inspection, open the production project in the Supabase dashboard
and use **SQL Editor**. The migration provides two private summary views:

```sql
select *
from private.puzzle_usage_analytics
order by puzzle_id, puzzle_revision;
```

This view gives loads, completions, and completion rate. For difficulty
calibration, run:

```sql
select *
from private.puzzle_difficulty_analytics
order by difficulty, puzzle_id, puzzle_revision;
```

This view gives completion count, mean and median normalized score, mean
completion time, mean mistakes, and mean hints.

## Interpretation limits

A load is one puzzle load, not one unique person. The design has no persistent
visitor identifier, so it cannot measure unique visitors or connect runs
across puzzles or visits. Reloads and date changes create new runs.

Delivery is best effort. Analytics requests run asynchronously and never block
gameplay. A visitor who closes the page immediately can lose an event. Browser
clients can insert events but cannot read, update, or delete them.

The analytics table does not contain IP addresses, user-agent strings, account
IDs, persistent visitor IDs, device fingerprints, or exact locations. Normal
Supabase infrastructure logs can still contain request metadata outside this
table.

Because the browser key is public, a determined third party can submit false
events for a released puzzle. Database constraints reject unknown puzzle
revisions and malformed event values, but they cannot prove that a person
played the puzzle. Add an Edge Function with rate limits only if abuse becomes
a real data-quality problem.
