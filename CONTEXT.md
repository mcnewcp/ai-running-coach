# AI Running Coach

An AI coach that guides one athlete's running training: planning, logging, and adapting training around goals, health, and life. The repo holds the coaching method; the athlete's own data lives elsewhere.

## Language

### The two halves of the system

**Coaching Framework**:
The athlete-agnostic coaching method — philosophy, workflow, training principles, and generic protocols. Public, and never names or describes a specific athlete.
_Avoid_: system prompt, config, template

**Athlete Record**:
Everything about one specific athlete — profile, goals, race history, programs, and every logged session or measurement. Private, and never stored in the repo.
_Avoid_: data, user data, personal files

**Runner Profile**:
The athlete's durable description — biometrics, medical history, lifestyle, logistics, and training psychology. Part of the Athlete Record, read at the start of every coaching session.
_Avoid_: bio, athlete config

### Training structure

**Program**:
A named, bounded training period with one purpose — a race build (e.g., a spring half-marathon build) or a bridge between builds (e.g., an off-season). Programs tile the calendar: each ends the day before the next begins.
_Avoid_: training goal, block, cycle

**Phase**:
A date-windowed segment of a Program with a single focus and mileage target (e.g., Base, Build, Injury Rehab, Taper). Every training day belongs to exactly one Phase, determined by its date. Its window is planned until the Phase ends, then actual.
_Avoid_: block, stage, period, training goal

**A-race**:
The race a race-build Program exists for. The Program ends on its A-race day, which forms that Program's final, one-day Race Phase. Bridge Programs have no A-race.
_Avoid_: goal race, target race

**Tune-up Race**:
Any race that is not the A-race of its Program. It is recorded as a Race Result inside whichever Phase it falls in, and never gets a Phase of its own.
_Avoid_: B-race, fitness check (a fitness check is the purpose, not the kind of race)

**Mileage Cap**:
The guideline ceiling for a week's mileage: the previous week's actual mileage × 1.10. Any proposed week above it (in a Plan or in a change agreed in conversation) triggers a warning and needs the runner's explicit confirmation. The decision belongs to the runner.
_Avoid_: 10% rule, hard cap, limit

**Plan**:
A document describing the intended training for a Program or Phase.
_Avoid_: schedule

**Log**:
A narrative document recording what actually happened across a Phase or week — context, decisions, reflections.
_Avoid_: journal, diary

### Recorded sessions and measurements

**Run**:
One completed run with its objective measures (distance, time, pace, HR) and the athlete's annotations (type, pain ratings, notes). Belongs to a Phase by its date.
_Avoid_: activity, workout (a workout is planned; a Run is done)

**Strength Session**:
One completed gym session, made up of one entry per exercise performed. Belongs to a Phase by its date.
_Avoid_: lift, HSR session (HSR is one protocol, not the session)

**Daily Check-in**:
The athlete's morning wellness report for one day — sleep, resting HR, pain ratings, energy, motivation, life stress.
_Avoid_: metrics, morning metrics

**Body-comp Scan**:
One InBody body-composition measurement.
_Avoid_: weigh-in, InBody (the device, not the concept)

**Race Result**:
The official outcome of one race — time, pace, conditions — plus a narrative of how it went.
_Avoid_: race, PR (a PR is derived from Race Results)

**Shoe**:
One pair of running shoes, tracked for accumulated mileage. Its mileage is derived from the Runs worn in it, never stored.
_Avoid_: gear
