# Strength Training: Movement-Pattern Framework

**Purpose:** a simple, durable strength program built on six fundamental movement patterns. It builds and keeps full-body strength for running, posture and long-term resilience, with nothing for the runner to work out session to session.

This is the generic framework. The loads and reps of each session are recorded with `log_strength_session`, one entry per exercise, and the active Phase's Plan says how strength fits that Phase's week. For tendinopathy rehab, see [hsr-protocols.md](hsr-protocols.md).

---

## The six movement patterns

Build every session from these patterns: one exercise per pattern slot, rotating exercises across weeks for variety.

| Pattern | Menu (rotate) |
|---|---|
| **Horizontal push** | Flat or incline DB or barbell bench, machine chest press, weighted push-up, dips |
| **Horizontal pull** | Chest-supported row, 1-arm DB row, seated cable row, barbell bent-over row, inverted row |
| **Vertical press** | Seated or standing DB shoulder press, barbell overhead press, machine shoulder press, landmine press, Arnold press |
| **Vertical pull** | Pull-up or chin-up (assisted as needed), lat pulldown (wide or neutral grip), straight-arm pulldown (accessory) |
| **Squat** | Back squat, goblet squat, leg press, **or unilateral:** split squat, walking lunge, step-up |
| **Hinge** | Trap-bar deadlift, RDL, conventional deadlift, **or unilateral:** single-leg RDL, B-stance RDL |

**Single-leg work lives inside Squat and Hinge**: rotate a unilateral option in regularly. Running is a single-leg sport, and much of a runner's injury resilience is unilateral strength.

**Optional finisher (never mandatory):** one of

- **Core, anti-rotation or carry:** Pallof press, farmer or suitcase carry, hanging knee or leg raise, ab-wheel rollout, weighted plank.
- **Arms superset:** biceps (DB, hammer or cable curl) with triceps (cable pushdown, overhead extension).
- **Shoulder and posture health:** face pulls, band pull-aparts, reverse flyes, external rotations.
- **Glute-med insurance:** banded lateral walks, side-lying abduction, side plank.
- **Adductors:** Copenhagen plank (short lever, knee on the bench, progressing to long lever, foot on the bench).

> **Glute-med and adductor work are not interchangeable, and the Copenhagen plank is not a glute-med exercise.** The Copenhagen loads the top leg's **adductors**: feeling it in the groin means it is working. Hip abductor (glute-med) strength is what matters for **knee valgus control**, which is why it earns a place in knee rehab; the Copenhagen does nothing for that. If both are wanted, they are two exercises.
>
> **The Copenhagen is also not a cheap add-on.** It is one of the hardest, highest-EMG adductor exercises there is. If it is in the program, give it a real slot and a real progression; if there is no room for that, use a lower-cost movement.

---

## Weekly structure

Three sessions on non-consecutive days land each pattern about twice a week, the sweet spot for a general baseline:

| Session | Focus | Slots |
|---|---|---|
| **Upper** | Best the day after the long run, so tired legs rest | Horizontal push, horizontal pull, vertical press, vertical pull (+ optional finisher) |
| **Lower** | Away from hard runs | Squat, hinge, single-leg (+ optional finisher) |
| **Mix** | | 1 push, 1 pull, 1 squat or hinge (alternate with the Lower session's pick) (+ optional slot) |

With two sessions a week, run Upper and Lower, or two Mix sessions.

### Default lineup (rotate exercises for variety)

- **Upper:** DB bench, chest-supported row, DB shoulder press, lat pulldown (+ optional arms).
- **Lower:** back squat (controlled ~3 s descent), trap-bar deadlift or RDL, split squat (+ optional core).
- **Mix:** incline DB press, pull-ups or pulldown, goblet squat or RDL (+ optional finisher).

### Fitting strength around running

- Heavy lifting after an easy run is fine, or on an easy day.
- **Never before** a hard run, a long run or a race.
- Leave at least 48 hours between heavy lower-body sessions.
- High-intensity running competes with heavy lifting for recovery: pair heavy lower-body days with easy running.

---

## Loading: double progression

**Add reps first, then weight.** That is the whole system: no percentages, no maths.

**Rep ranges (3 sets each):**

- **Mains** (all six patterns): 3 × 8–12.
- **Single-leg:** 3 × 8–12 per side.
- **Finishers:** 2–3 × 12–15.

**How it works:**

1. Pick a weight the runner can do for 3 × 8 with 1–2 reps in reserve, never grinding to failure.
2. Each session, chase more reps at that weight, working the sets toward the top of the range.
3. Once every set reaches the top of the range (e.g. 3 × 12) cleanly with reps in reserve, add the smallest load increment and drop back to the bottom (3 × 8).
4. Repeat indefinitely.

**Load increments when a lift graduates:**

- **Upper and smaller lifts** (bench, press, rows, curls): +2.5–5 lb (the next dumbbell up).
- **Lower and bigger lifts** (squat, hinge, leg press): +5–10 lb.

**The coach's role:** the runner reports loads and reps each session; the coach reads the history (`query` over the Strength Sessions) and **tells the runner when a lift has earned its load bump** (top of the range, every set, clean). The runner never has to remember where they are.

After a layoff (illness, travel), reopen lower-body loads about 30% below the previous numbers and climb back over 1–2 sessions.

---

## Tempo and form

- **General tempo:** controlled, about 2 s down and 1 s up. No bouncing.
- **Squat descent:** control it to about 3 s. It brings some of the tendon benefit of heavy slow resistance into a normal squat, and is a good habit for any runner with a history of knee or tendon pain.
- **Reps in reserve:** leave 1–2 in the tank on mains. This is a sustainable baseline, not a powerlifting peak.
- **Respect niggles:** for a shoulder, elbow or knee twinge, swap the exercise within its pattern (e.g. barbell bench to DB or machine) rather than push through.

---

## What to record each session

With `log_strength_session`, one entry per exercise:

- The pattern and exercise.
- The working load and what it means (per hand, total, bodyweight, band).
- Sets and the reps in each set.
- Notes: warm-up ramp (not counted as working sets), tempo, reps in reserve, pain or niggles, modifications, and a flag when a lift graduates.
