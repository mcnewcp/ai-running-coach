# Codebase Concerns

**Analysis Date:** 2026-01-26

## Health & Injury Management

**Patellar Tendinopathy Monitoring at Threshold:**
- Issue: Knee pain frequently reaches 3/10 threshold (maximum acceptable before modifications), indicating load management is borderline tight
- Files: `2026-music-city-half/logs/week-01.md`, `2026-music-city-half/logs/week-02.md`, `2026-music-city-half/logs/00-baseline.md`
- Context: Weekly pain tracking shows spike after long runs and consecutive training days
- Impact: Risk of pain breaking threshold (>3/10) requiring workout modifications during critical training phases; potentially impacts race readiness
- Fix approach:
  - Consider reducing long-run progression rate (currently +1 mile every 2-3 weeks)
  - More aggressive cutback week scheduling (current: every 4 weeks may be insufficient)
  - Add midweek recovery mobility sessions before they're reactive
  - Establish pain trend analysis: If trending upward 2+ consecutive weeks, trigger immediate load reduction

**Incomplete Baseline for Performance Metrics:**
- Issue: No established PRs or benchmark times (5K, 10K, HM pace) before training phase begins
- Files: `2026-music-city-half/logs/00-baseline.md`, `2026-music-city-half/plans/phase-1-base.md`
- Current state: Baseline assessment notes "Consider 5K time trial in weeks 2-3" but no plan created (as of Week 4)
- Impact: Cannot objectively assess aerobic improvement; training paces are estimated rather than data-driven
- Risk: May be training at inappropriate intensities (too hard easy days, too easy hard days)
- Fix approach:
  - Execute 5K time trial during cutback week (Week 4) or early Week 5 when fresh
  - Record: time, splits, average/max HR, perceived effort
  - Establish pace zones from result: Easy (Z2), Tempo (Z3-4), VO2max (Z5)

---

## Training Plan Execution Gaps

**Week-by-Week Plan Incompleteness:**
- Issue: Detailed weekly plans exist for Phase 1 (Weeks 1-6) but only macro overview for Phases 2-4
- Files: `2026-music-city-half/plans/phase-1-base.md` (338 lines, detailed), `2026-music-city-half/plans/master-plan.md` (365 lines, summary)
- Missing: Weeks 7-16 lack daily breakdowns, specific workout guidance, form cues, progression details
- Impact: Coach will need to create weekly guidance on-the-fly starting Week 7, risk of inconsistent coaching quality and programming errors
- Fix approach:
  - Create `phase-2-build.md` with same detail as Phase 1 (weeks 7-11, day-by-day)
  - Create `phase-3-peak.md` (weeks 12-14, day-by-day)
  - Create `phase-4-taper.md` (weeks 15-16, day-by-day)
  - Include: pacing, HR targets, form cues, recovery expectations

**HSR Protocol Progression Unclear:**
- Issue: Progressive loading for strength-endurance is implicit, not explicitly programmed
- Files: `2026-music-city-half/resources/hsr-protocols.md`, `2026-music-city-half/logs/` (week logs show ad-hoc increases)
- Current behavior: Weight increases are reactive ("ready to increase") rather than scheduled
- Example: Week 1 hamstring curl 100 lbs → Week 3 "reduced to 90 lbs" (de-load) → pattern unclear going forward
- Impact: Inconsistent tendon loading; risk of either insufficient stimulus or premature overload
- Fix approach:
  - Create 16-week HSR progression schedule: specific weights, reps, sets per week
  - Include: 3-week build, 1-week cutback pattern to match running periodization
  - Document progression logic (e.g., "Add 5 lbs when all sets x reps achieved with RPE <7")

**Recovery Activities Not Fully Prescribed:**
- Issue: Target is "4x sauna per week, 20 min" and "daily mobility" but execution is episodic
- Files: `2026-music-city-half/plans/master-plan.md` (target listed), `2026-music-city-half/logs/` (completion variable)
- Context: Week 4 affected by gym closure (ice/snow), sauna unavailable
- Vulnerability: Recovery is health-critical for BP management and injury prevention, but weekly logs show inconsistent execution based on logistics
- Impact: May undermine training adaptations; particularly risky for BP management (sauna is evidence-based intervention)
- Fix approach:
  - Document backup mobility routines for home (no equipment, no gym access)
  - Establish sauna alternatives or acceptance criteria when unavailable (e.g., "ice bath equivalent" or "reduce running load 10%")
  - Add "recovery completion %" metric to weekly logs (target: 85% of prescribed sessions)

---

## Data Tracking Inconsistencies

**Heart Rate Data Source Unreliable:**
- Issue: HR targets specified as "<150 bpm" but Apple Health data collection method depends on outdoor GPS + HR watch
- Files: `2026-music-city-half/logs/week-01.md` (shows "Average Heart Rate: 140 bpm" from runs)
- Problem: Treadmill runs do not generate VO2 max data (no GPS), so HR only trackable via manual watch/chest strap
- Impact: HR discipline assessment depends on proper watch/strap usage; inconsistent data creates pacing uncertainty
- Risk: If runner forgets watch on some runs, no way to validate Zone 2 compliance on those days
- Fix approach:
  - Establish mandatory HR tracking method: "Always wear chest strap OR Apple Watch with HR sensor on all runs"
  - Document which watch/device provides most reliable data
  - Accept treadmill runs may lack HR data and use RPE (Rate of Perceived Exertion) as backup
  - Add to morning check-in: "HR device charged and ready? [Y/N]"

**Morning Metrics Collection Inconsistent:**
- Issue: Some days have complete metrics (sleep hrs, RHR, knee pain L/R, energy, motivation, stress), others are missing fields
- Files: `2026-music-city-half/logs/week-01.md`, `week-02.md`, `week-03.md`, `week-04.md`
- Examples:
  - Week 3 Monday: No body weight measurement
  - Week 4 Monday: "Body Weight: Deferred (gym closed)"
  - Sleep quality varies: some entries use "Good/Fair/Excellent" labels, others just record hours
- Impact: Makes weekly trend analysis harder; missing RHR makes overtraining detection weaker
- Fix approach:
  - Create standardized morning check-in template in weekly logs with required fields [✓], optional fields [○]
  - Required: Sleep (hrs + quality), RHR, Knee L/R (0-10), Energy (1-10), Motivation (1-10), Life Stress (1-10)
  - Optional: Body weight, notes
  - Coach note: "Do NOT proceed with workout planning until all required fields collected"

**Workout Completion Tracking Not Standardized:**
- Issue: Completed workouts logged with varying detail levels
- Files: `2026-music-city-half/logs/` (all weeks)
- Inconsistencies:
  - Some runs have pace/HR/VO2max data (outdoor), others have pace only (treadmill)
  - HSR sessions sometimes show all exercises completed, sometimes condensed
  - Modifications are noted but not always linked to baseline plan
- Impact: Hard to assess adherence %; hard to identify which workouts are routinely modified
- Fix approach:
  - Use consistent workout log format:
    ```
    **[Workout Name]**: [Status: ✅ COMPLETED / ⚠️ MODIFIED / ❌ SKIPPED]
    - Duration: [actual]
    - Distance: [actual] (if running)
    - HR: [avg bpm] (if available)
    - Pace: [actual] (if running)
    - Modifications: [none / list specific changes]
    - Reason for modification: [N/A / reason]
    ```

---

## Weather/Environment Dependency Risks

**Weather Creates Significant Training Disruptions:**
- Issue: Ice/snow closure of gym facilities (Week 4) forces HSR postponement and eliminates sauna access
- Files: `2026-music-city-half/logs/week-04.md`, lines 58-62
- Context: "Gym closed due to ice/snow"
- Impact: Can't execute prescribed HSR sessions; can't access sauna (critical for BP management)
- Risk: Months with significant weather events (Jan-Feb are high-risk) can cascade training disruptions
- Geographic vulnerability: Nashville area can experience ice storms; no contingency documented
- Fix approach:
  - Create home HSR backup protocol (bodyweight, dumbbell, resistance band exercises)
  - Document in `hsr-protocols.md`: "Gym Closure Modifications - Home Equipment Only"
  - Establish indoor running backup: Peloton treadmill is available (use for pacing workouts)
  - Sauna alternative: Accept 15-20 min hot bath when sauna unavailable
  - Add to weekly plan: "If gym closed due to weather, execute [specific home HSR variant]"

**Cruise Travel Requires Modification (Week 2 Precedent):**
- Issue: Week 2 cruise ship travel required multiple adaptations (treadmill running, dumbbell HSR, pacing adjustments for heat)
- Files: `2026-music-city-half/logs/week-02.md`
- Pattern: Future travel/events may disrupt consistent training environment
- Risk: Unplanned adaptations can reduce training quality or cause injury if not properly modified
- Fix approach:
  - Document travel protocol template: location, facility access, equipment available, planned modifications
  - Create pre-travel checklist: "Notify coach of travel dates, facility access, available equipment 2 weeks in advance"
  - For future scheduled events, pre-plan Week X modifications

---

## Missing Documentation for Future Phases

**No Phase 2 Detailed Plan:**
- Issue: Master plan lists Week 7-11 workouts, but no detailed guidance document exists
- Files: `2026-music-city-half/plans/master-plan.md` (macro plan only)
- Missing: Daily breakdown, pacing guidance, form cues, progression specifics for:
  - Tempo runs (25, then 30 min)
  - Hill repeats (8-10 x 90s)
  - Progressive long runs
- Impact: Starting Week 7, coaching will be less structured; risk of under-intensity or over-intensity
- Fix approach: Create `phase-2-build.md` with same structure as `phase-1-base.md`

**No Phase 3/4 Detailed Plans:**
- Issue: Peak and taper phases (Weeks 12-16) only in master plan summary format
- Files: `2026-music-city-half/plans/master-plan.md`
- Missing: Race-specific pacing practice, taper psychology, race-day logistics
- Impact: Transition into peak phase will require reactive planning
- Fix approach: Create `phase-3-peak.md` and `phase-4-taper.md` before Week 11 ends

---

## Scaling Issues (16-Week Duration)

**Weekly Log File Growth:**
- Issue: Each week gets a detailed log file (week-01.md = 333 lines, week-02.md = 303 lines)
- Files: Current logs are 300+ lines each, 16 weeks × 300 lines = 4,800 lines of logs
- Expected: By week 16, logs directory will have ~16 files, ~5,000 total lines
- Impact: Makes searching/analyzing trends harder as logging grows; risk of incomplete weekly updates as volume accumulates
- Fix approach:
  - Keep current format (useful for detail)
  - Create monthly summary: `month-01-jan.md` (rolls up weekly summaries at month-end)
  - Add script/template for quarterly review documents
  - Use grep/search to identify trending issues across weeks

**Plan File Maintenance:**
- Issue: If plans need adjustments (e.g., injury forcing 2-week cutback, race date change), no clear version control or "as-run" documentation
- Files: `2026-music-city-half/plans/` (currently: baseline plan only)
- Risk: If plan is modified mid-training, original plan logic may be lost; hard to retrospectively understand what changed and why
- Fix approach:
  - Add version date to plan files: "Master Plan - v1.0 (Jan 6, 2026)"
  - If major changes: document as "Master Plan - v1.1 (Feb 15, 2026) - Extended cutback due to knee pain"
  - Keep both versions for historical record

---

## Knowledge Transfer Gaps

**CLAUDE.md System Context Comprehensive but Coach Dependency:**
- Issue: All coaching philosophy, profiles, and guidelines are embedded in CLAUDE.md (306 lines)
- Files: `/CLAUDE.md`
- Context: This works for Claude sessions but depends on Claude being "in the loop" each conversation
- Risk: If system needs to transfer to human coach or different AI, critical context could be missed
- Fix approach:
  - Keep CLAUDE.md as reference
  - Extract athlete profile into dedicated file: `athlete-profile.md` (biometrics, medical history, psychology)
  - Extract coaching philosophy into: `coaching-philosophy.md` (principles, periodization approach)
  - Extract daily workflow into: `coaching-workflow.md` (step-by-step for each session type)
  - This makes system more portable and human-readable

**Running-Specific Knowledge Assumed:**
- Issue: HSR protocols, mobility routines, Zone 2 training philosophy documented, but assumes coach understands running science
- Files: `2026-music-city-half/resources/hsr-protocols.md`, `mobility-routines.md`
- Gap: "Why" documentation is minimal; protocols show "what" and "how" but not "why this prevents patellar tendinopathy"
- Impact: If running coach needs to adapt protocols, decisions may lack scientific grounding
- Fix approach:
  - Add rationale sections to protocol files:
    ```
    ### Why This Protocol Works for Patellar Tendinopathy
    - Eccentric loading (3s down, 1s pause) strengthens tendon...
    - Single-leg work addresses compensation patterns...
    - Progressive loading follows research on HSR efficacy...
    ```

---

## Medical Management Assumptions

**Blood Pressure Management Relies on Sauna Access:**
- Issue: Sauna use is prescribed as evidence-based intervention for hereditary high BP (target: 4x/week, 20 min)
- Files: `CLAUDE.md` (line 66-67), `2026-music-city-half/plans/master-plan.md` (line 82)
- Dependency: Sauna access assumed at gym (Lifetime Fitness, Franklin TN)
- Risk: If gym access lost (relocation, closure, membership issue), no documented backup
- Impact: Loss of BP management tool during 16-week race preparation
- Fix approach:
  - Document sauna alternatives: "If sauna unavailable, implement [specific BP-supportive practice]"
  - Consider: ice baths, contrast therapy, meditation as alternatives
  - Add to weekly template: "Sauna sessions completed: [#/4], barriers: [none / list]"

**Medication/Supplementation Not Documented:**
- Issue: CLAUDE.md mentions "Supplements: Protein shakes" and "Low sodium diet" but no comprehensive medication/supplement review
- Files: `CLAUDE.md` (lines 71)
- Risk: If runner needs to add supplements for BP or joint health, no baseline to reference
- Unknown: Is runner on BP medication? Are there drug-supplement interactions?
- Fix approach:
  - Create `medical-baseline.md`: current medications, supplements, medical clearances
  - Document any BP medication: name, dose, timing relative to training
  - Note any supplement restrictions (e.g., "avoid NSAIDs due to tendinopathy")

---

## Race-Specific Preparedness Gaps

**No Specific Race Course Analysis:**
- Issue: Master plan mentions "Music City Half Marathon" but no course profile analyzed
- Files: `2026-music-city-half/plans/master-plan.md` (race name, date only)
- Missing: Elevation profile, terrain type (road vs trail), expected conditions, crowd logistics
- Impact: Training is generic "half marathon" not "Music City specific"
- Risk: Surprise elevation changes or terrain mismatch on race day
- Fix approach:
  - Create `race-course-profile.md`: elevation map, mile-by-mile breakdown, terrain type, expected conditions
  - Adjust training specificity: if course is hilly, ensure more hill repeats in Phase 2-3

**Race-Day Logistics Not Documented:**
- Issue: No documented plan for: registration, bib pickup, start line arrival, gear check, post-race
- Files: None found
- Impact: Adds day-of-race stress; may impact warm-up/mental preparation
- Fix approach:
  - Create `race-day-plan.md` (4 weeks before race):
    ```
    - Alarm: [time]
    - Wake-up routine: [time breakdown]
    - Breakfast: [meal, timing]
    - Arrival at race: [time, parking location]
    - Warm-up: [duration, workout, pace]
    - Start line: [time, logistics]
    - Pacing strategy: [specific splits for miles 1-13.1]
    - Post-race: [recovery protocol]
    ```

---

## Summary: Priority Concerns by Impact

| Concern | Impact Level | Fix Timeline |
|---------|--------------|--------------|
| Patellar tendinopathy at 3/10 threshold | High | Ongoing monitoring + Week 5+ |
| No 5K baseline established | High | Week 4-5 (execute ASAP) |
| Missing Phase 2/3/4 detailed plans | High | By end of Week 6 |
| HR tracking inconsistency | Medium | Immediate (verify device before each run) |
| Morning metrics incomplete | Medium | Standardize template immediately |
| Weather/travel contingency plans missing | Medium | Document by Week 5 |
| HSR progression not explicit | Medium | Create 16-week schedule by Week 5 |
| Sauna access single point of failure | Medium | Document backup by Week 6 |
| Race course/logistics planning missing | Low | Create by Week 10 |
| Knowledge transfer documentation sparse | Low | Extract from CLAUDE.md by Week 8 |

---

*Concerns audit: 2026-01-26*
