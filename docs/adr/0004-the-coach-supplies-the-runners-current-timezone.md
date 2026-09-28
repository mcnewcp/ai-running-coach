# The coach supplies the runner's current timezone

The runner travels, so their timezone isn't fixed. The Runner Profile holds a **Home Timezone**. Tools that need to know what day it is (`today`, and later `get_coaching_context`) use it by default, and take an optional IANA `timezone` for when the coach knows the runner is somewhere else. The Coaching Framework tells the coach to pass it once the runner mentions travelling, or when the app says where they are. Tools report which timezone they used and whether it was the Home Timezone or a given one, so a wrong guess is easy to spot. Timezone abbreviations (`CST`, `EST`) are rejected. They're ambiguous, and the runtime maps some of them to zones without DST.

A timezone is only needed to turn "now" into a date. Records are stored as local calendar dates (where the runner was), and Monday–Sunday weeks and the Mileage Cap are counted over those dates, so travel never re-dates history.

## Considered Options

- **A fixed Worker setting** (first version of #3): rejected because it gives the wrong day whenever the runner is away, especially late at night. As a Worker secret, it only stayed out of the public repo by treating a non-secret setting as a secret.
- **The coach always supplies the timezone**: rejected because the coach doesn't always know it. Claude Code knows the date but not where the runner is. And `get_coaching_context` needs today's date before the coach has read anything about the runner.

## Consequences

- Until the Runner Profile exists in R2 (#8) and `today` reads the Home Timezone from it (#9), the Home Timezone is a temporary default in code, US Central (`America/Chicago`).
- The Home Timezone is part of the Athlete Record, so a template user sets their own in their Runner Profile, not in the repo.
