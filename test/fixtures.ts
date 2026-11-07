// Synthetic season structure shared by tests of dated records. No real
// Athlete Record data.

export const offSeason = {
  name: "2026 Off-season",
  kind: "bridge",
  startDate: "2026-11-02",
  endDate: "2026-12-27",
  phases: [
    { name: "Recovery", startDate: "2026-11-02", endDate: "2026-11-15", focus: "Rest", mileageTarget: "10-15 mi/wk" },
    { name: "Base", startDate: "2026-11-16", endDate: "2026-12-27", focus: "Easy aerobic", mileageTarget: "15-20 mi/wk" },
  ],
};

export const springHalf = {
  name: "2027 Spring Half",
  kind: "race_build",
  startDate: "2026-12-28",
  endDate: "2027-04-11",
  aRace: { name: "Synthetic City Half", date: "2027-04-11" },
  phases: [
    { name: "Base", startDate: "2026-12-28", endDate: "2027-02-07", focus: "Aerobic base", mileageTarget: "20-25 mi/wk" },
    { name: "Build", startDate: "2027-02-08", endDate: "2027-03-28", focus: "Threshold", mileageTarget: "25-30 mi/wk" },
    { name: "Taper", startDate: "2027-03-29", endDate: "2027-04-10", focus: "Freshen up", mileageTarget: "15-20 mi/wk" },
    { name: "Race", kind: "race", startDate: "2027-04-11", endDate: "2027-04-11" },
  ],
};

/** What a write returns as the Program a date in the Off-season belongs to. */
export const offSeasonProgram = {
  name: "2026 Off-season",
  kind: "bridge",
  startDate: "2026-11-02",
  endDate: "2026-12-27",
  aRace: null,
};

/** What a write returns as the Off-season's Recovery Phase. */
export const recoveryPhase = {
  name: "Recovery",
  kind: "training",
  startDate: "2026-11-02",
  endDate: "2026-11-15",
  focus: "Rest",
  mileageTarget: "10-15 mi/wk",
};
