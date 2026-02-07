# Architecture

**Analysis Date:** 2026-01-26

## Pattern Overview

**Overall:** Document-Driven Coaching System with Periodic Planning and Daily Execution

**Key Characteristics:**
- Human-centered (Claude AI as coaching assistant, not autonomous system)
- Time-based periodization: 4 training phases across 16-week race cycle
- Plan-first architecture: Phase plans define all training before execution
- Daily update pattern: Each day begins with metrics collection, plan lookup, and adjustment
- Recovery-integrated: HSR training, sauna, and mobility are co-equal training pillars
- Injury-first approach: All decisions weighted toward knee health and pain monitoring

## Layers

**System Context & Configuration Layer:**
- Purpose: Define runner profile, coaching philosophy, and daily workflow rules
- Location: `CLAUDE.md`
- Contains: Mission statement, coaching principles, runner biometrics, medical constraints, training system usage instructions, critical workflow rules, red flags to watch for
- Depends on: None (foundational context)
- Used by: All coaching sessions, Claude instances reading the file

**Periodization & Macro Planning Layer:**
- Purpose: 16-week training structure with phase progression and mileage progression
- Location: `2026-music-city-half/plans/master-plan.md`
- Contains: 4-phase structure (Base Building, Build, Peak, Taper), week-by-week mileage table, weekly training structure template, phase-specific objectives
- Depends on: System Context (runner profile, principles)
- Used by: Phase plan developers, weekly log creators

**Phase-Specific Planning Layer:**
- Purpose: Detailed weekly breakdown for a single training phase
- Location: `2026-music-city-half/plans/phase-1-base.md` (and future phase-2-build.md, phase-3-peak.md, phase-4-taper.md)
- Contains: Phase overview with primary goals, week-by-week table with specific workouts for each day, key focus points per week, progression guidelines
- Depends on: Master plan (phase dates, mileage ranges)
- Used by: Daily coaching sessions (Claude looks up day's workout here)

**Training Execution Layer:**
- Purpose: Record actual completed training and real-time biometric response
- Location: `2026-music-city-half/logs/00-baseline.md`, `week-01.md`, `week-02.md`, etc.
- Contains: Morning metrics (sleep, HR, pain, energy, motivation, stress), workout completions (distance, time, pace, HR), subjective response (effort, energy, issues), modifications made, weekly summaries
- Depends on: Phase plans (what was planned)
- Used by: Weekly review, plan adjustment decisions, trend detection

**Supporting Resources Layer:**
- Purpose: Detailed protocols and routines for training components and recovery
- Location: `2026-music-city-half/resources/`
- Contains:
  - `hsr-protocols.md`: Heavy Slow Resistance session structure, exercise progression, tempo notation, rep/set schemes
  - `mobility-routines.md`: Pre-run dynamic warm-ups, post-run stretching, standalone deep mobility sessions
- Depends on: Phase plans (which define HSR frequency, mobility targets)
- Used by: Daily coaching to prescribe specific exercises and sequences

**CLI/Agent Framework Layer:**
- Purpose: Command dispatch and workflow orchestration for GSD system
- Location: `.claude/commands/gsd/`, `.claude/agents/`, `.claude/hooks/`
- Contains: Command definitions (map-codebase.md, plan-phase.md, execute-phase.md, etc.), agent role definitions, statusline hook for context awareness
- Depends on: Codebase structure (knows where plans/logs live)
- Used by: User commands like `/gsd:map-codebase`, `/gsd:plan-phase`

## Data Flow

**Daily Coaching Session:**

1. **Session Start** → Claude executes `date` command to establish what day it is
2. **Metrics Collection** → Claude prompts for morning metrics (sleep, HR, knee pain, energy, motivation, stress)
3. **Metrics Recording** → Claude immediately updates/creates weekly log file with morning metrics
4. **Plan Lookup** → Claude reads appropriate phase plan (e.g., phase-1-base.md) and finds today's prescribed workout
5. **Plan Presentation** → Claude tells runner the day's workout with specific guidance (pace targets, HR limits, duration)
6. **Discussion & Adjustment** → Claude discusses runner's current state and agrees on modifications if needed
7. **Workout Execution** → Runner completes workout (outside Claude session)
8. **Post-Workout Reporting** → Runner starts new chat, reports metrics (distance, time, pace, HR, effort, issues)
9. **Log Update** → Claude records completion details in weekly log with all relevant data

**Weekly Review (Sunday/Monday boundary):**

1. Claude reviews past week's logs and plans for next week
2. Identifies patterns (mileage progression, knee response, HR discipline, sleep quality)
3. For Monday: Creates new week-##.md log file with baseline metrics
4. Adjusts upcoming phase plan if runner is over/under-reaching or experiencing issues

**Phase Transition (every 4-6 weeks):**

1. Final week log includes phase summary and reflection
2. Next phase plan file is developed or reviewed
3. New mileage ranges, long run targets, and workout types are set
4. Baseline metrics reset for new phase

**State Management:**

- **Planned state**: Defined in phase plans (master-plan.md, phase-#-*.md)
- **Execution state**: Recorded in weekly logs (week-##.md)
- **Metrics state**: Real-time biometric/subjective data collected daily, stored in logs
- **Injury state**: Knee pain 0-10 ratings tracked daily, thresholds (<3/10 proceed, 4-6/10 modify, 7+/10 rest)
- **Context state**: Stored in CLAUDE.md (runner profile, constraints, preferences, red flags)

## Key Abstractions

**Phase:**
- Purpose: Training cycle with specific focus (Base, Build, Peak, Taper) and measurable progression
- Examples: `phase-1-base.md` (weeks 1-6), `phase-2-build.md` (weeks 7-11)
- Pattern: Each phase defines 4-6 weeks of training with progressive mileage, long run distance, and workout intensity

**Workout:**
- Purpose: Single training stimulus (easy run, tempo, hills, long run, HSR, mobility, sauna)
- Examples: "Easy Run (30-45 min, Zone 2)", "Tempo Run (25 min steady)", "Heavy Slow Resistance Session"
- Pattern: Prescribed with duration/distance, intensity/pace (Zone 2, tempo pace, hard effort), HR targets, and special notes

**Weekly Training Block:**
- Purpose: 7-day cycle with balanced distribution of easy, hard, and recovery work
- Pattern: Standard template repeated with modifications (4-5 runs, 2 HSR sessions, 4 sauna sessions, 1-2 mobility sessions)
- Structure: Monday through Sunday with specific role for each day

**Metrics Triad:**
- Purpose: Daily snapshot of readiness and response
- Components: Biometric (sleep hrs + quality, RHR, knee pain left/right), Performance (run distance/pace/HR if applicable), Subjective (energy 1-10, motivation 1-10, stress 1-10)
- Pattern: Collected each morning, updated after workouts, reviewed for trends weekly

**HSR Protocol:**
- Purpose: Tendon-strengthening resistance work (not strength training for muscle gain)
- Pattern: Heavy load (70-85% 1RM), slow tempo (3-1-3), low reps (6-8), 2-3 sets, 2-3 min rest, 2x/week non-consecutive
- Exercises: Decline squats, Bulgarian split squats, single-leg deadlifts, lateral band steps, hamstring curls

**Mobility Routine:**
- Purpose: Movement quality, joint health, injury prevention
- Pattern: Pre-run dynamic (5-10 min, every run), post-run static (5-10 min, 3+ times/week), standalone deep (20-30 min, 1-2x/week)
- Examples: Walking leg swings, lunges, high knees, butt kicks, stretching, foam rolling

## Entry Points

**User Command `/gsd:map-codebase`:**
- Location: Orchestrator invokes `.claude/commands/gsd/map-codebase.md`
- Triggers: User types command in Claude
- Responsibilities: Spawn codebase mapper agent, analyze focus area (tech/arch/quality/concerns), write documents to `.planning/codebase/`

**Daily Coaching Chat (New Chat):**
- Location: User starts fresh chat each day
- Triggers: User opens Claude and begins conversation
- Responsibilities:
  1. Run `date` to know what day it is
  2. Greet user and collect morning metrics
  3. Read appropriate phase plan and find today's workout
  4. Present plan with specific guidance
  5. Discuss and agree on modifications
  6. Record metrics to weekly log immediately
  7. Follow up after workout with log update

**Monday (Week Start):**
- Location: First coaching chat of the week
- Triggers: User starts chat on Monday morning
- Responsibilities:
  1. Confirm date is Monday
  2. Collect weekend training metrics (Saturday long run, Sunday recovery)
  3. Collect Monday morning metrics + optional body weight
  4. CREATE NEW WEEKLY LOG FILE (week-##.md) immediately
  5. Read phase plan, present Monday's workout
  6. Establish baseline metrics for the week

**Periodic Codebase Mapping:**
- Location: `.planning/codebase/` document generation
- Triggers: `/gsd:map-codebase` command with focus area
- Responsibilities: Explore codebase, write ARCHITECTURE.md, STRUCTURE.md (and other docs based on focus), store to `.planning/codebase/`

## Error Handling

**Strategy:** Pain-based thresholds with graduated response

**Patterns:**

- **Knee Pain 0-3/10**: Proceed with training as planned
- **Knee Pain 4-6/10**: Modify training (reduce distance, move to treadmill, easy pace only, avoid hills)
- **Knee Pain 7+/10**: Rest day, potential medical consultation
- **Illness/Injury**: Modify or skip workout, extend recovery, reassess timeline
- **Metrics Trending Negative** (declining sleep, RHR up 5+ bpm, energy/motivation dropping): Reduce mileage intensity/volume, add rest day
- **Missed Workouts** (multiple in sequence): Possible overreach, review life stress, discuss schedule adjustments
- **HR Discipline Failure** (can't keep easy runs <150 bpm): May indicate overtraining, reduce volume, ensure 1-2 true rest days

## Cross-Cutting Concerns

**Logging:** All training logged in weekly `.md` files with structured format (day, date, planned workout, actual completion, metrics, notes)

**Validation:** Knee pain threshold validation (compare daily ratings to <3/10 rule), HR zone validation (easy runs must be <150 bpm), mileage progression validation (10% increase rule)

**Authentication:** Not applicable (single user coaching system)

**Monitoring:** Daily metrics triad (sleep, RHR, knee pain, energy, motivation, stress), weekly summaries, 4-week cutback patterns

**Recovery:** Sauna 4x/week, HSR 2x/week, mobility daily pre/post run, 1-2 standalone sessions/week

---

*Architecture analysis: 2026-01-26*
