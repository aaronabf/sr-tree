import type { Attendance, GraphData, Person } from "./types"

/**
 * Fictional demo lineage. Served when DATABASE_URL is missing (so the UI can be
 * previewed) and used by `npm run db:seed` to populate an empty database.
 */

type DemoInvite = [year: number, inviter: string | null, invitee: string]

// Names double as keys. Two Alices exist on purpose: "Alice K" and "Alice".
const PEOPLE: string[] = [
  "Zara",
  "Marcus",
  "Dev",
  "Priya",
  "Alice K",
  "Jun",
  "Tomas",
  "Sam",
  "Bea",
  "Oli",
  "Ines",
  "Kwame",
  "Alice M",
  "Lena",
  "Rafa",
  "Nico",
  "Yuki",
  "Frankie",
  "Sol",
  "Mika",
  "Theo",
  "Alice",
  "Dara",
  "Iggy",
  "Hana",
  "Milo",
  "Wren",
  "Cass",
  "Bobby",
  "Jules",
  "Remy",
  "Kit",
  "Nadia",
  "Avi",
  "Esme",
  "Otis",
  "Suki",
  "Lou",
  "Rune",
  "Pax",
  "Zed",
  "Tao",
  "Ash",
  "Bex",
  "Fern",
  "Gus",
  "Vera",
  "Dot",
  "Hollis",
  "Ren",
  "Ivy",
  "Coco",
]

const INVITES: DemoInvite[] = [
  [2014, null, "Zara"],
  [2014, null, "Marcus"],
  [2014, null, "Dev"],
  [2015, "Zara", "Priya"],
  [2015, "Marcus", "Alice K"],
  [2015, "Dev", "Jun"],
  [2016, "Zara", "Tomas"],
  [2016, "Priya", "Sam"],
  [2016, "Alice K", "Bea"],
  [2016, "Jun", "Oli"],
  [2017, "Marcus", "Ines"],
  [2017, "Priya", "Kwame"],
  [2017, "Sam", "Alice M"],
  [2017, "Tomas", "Lena"],
  [2018, "Alice K", "Rafa"],
  [2018, "Bea", "Nico"],
  [2018, "Kwame", "Yuki"],
  [2018, "Lena", "Frankie"],
  [2018, "Oli", "Sol"],
  [2019, "Zara", "Mika"],
  [2019, "Sam", "Theo"],
  [2019, "Nico", "Alice"],
  [2019, "Yuki", "Dara"],
  [2019, "Sol", "Iggy"],
  [2021, "Jun", "Hana"],
  [2021, "Rafa", "Milo"],
  [2021, "Theo", "Wren"],
  [2021, "Mika", "Cass"],
  [2022, "Alice M", "Bobby"],
  [2022, "Frankie", "Jules"],
  [2022, "Dara", "Remy"],
  [2022, "Hana", "Kit"],
  [2022, "Cass", "Nadia"],
  [2023, "Priya", "Avi"],
  [2023, "Milo", "Esme"],
  [2023, "Wren", "Otis"],
  [2023, "Bobby", "Suki"],
  [2023, "Remy", "Lou"],
  [2024, "Dev", "Rune"],
  [2024, "Iggy", "Pax"],
  [2024, "Kit", "Zed"],
  [2024, "Esme", "Tao"],
  [2024, "Nadia", "Ash"],
  [2024, "Suki", "Bex"],
  [2025, "Alice", "Fern"],
  [2025, "Otis", "Gus"],
  [2025, "Lou", "Vera"],
  [2025, "Rune", "Dot"],
  [2025, "Pax", "Hollis"],
  [2026, "Marcus", "Ren"],
  [2026, "Tao", "Ivy"],
  [2026, "Zed", "Coco"],
]

export function buildDemoGraph(): GraphData {
  const people: Person[] = PEOPLE.map((name, i) => ({ id: i + 1, name }))
  const idByName = new Map(PEOPLE.map((name, i) => [name, i + 1]))

  const attendances: Attendance[] = []
  const seen = new Set<string>()
  const push = (personId: number, year: number, invitedById: number | null) => {
    const k = `${personId}:${year}`
    if (seen.has(k)) {
      return
    }
    seen.add(k)
    attendances.push({ id: attendances.length + 1, personId, year, invitedById })
  }

  // Invitees first (so their inviter is recorded), then make sure every
  // inviter also has an attendance row for that year.
  for (const [year, inviter, invitee] of INVITES) {
    push(idByName.get(invitee)!, year, inviter ? idByName.get(inviter)! : null)
  }
  for (const [year, inviter] of INVITES) {
    if (inviter) {
      push(idByName.get(inviter)!, year, null)
    }
  }

  attendances.sort((a, b) => a.year - b.year || a.id - b.id)
  return { people, attendances, demo: true }
}
