import type { Corridor } from "../types.js";

// Demo data shaped like NTA GTFS output (stop names, routes, frequencies) for one
// real Dublin corridor. Swap `legFetchers` in services/liveFeed.ts for a real
// NTA GTFS-Realtime poll later without changing this shape.
export const belfieldToCityCentre: Corridor = {
  id: "belfield-city-centre",
  name: "UCD Belfield -> Dublin City Centre",
  legs: [
    {
      id: "leg-1",
      from: "UCD Belfield (home end)",
      to: "UCD Belfield, Stillorgan Road",
      isTransferPoint: true,
      transferAmenities: [
        "UCD Student Centre cafe",
        "O'Brien Centre for Science seating area",
        "Restaurant Village food court",
      ],
      options: [
        {
          id: "leg-1-walk",
          mode: "walk",
          label: "Walk to the bus stop",
          durationMin: 8,
          departures: [],
          costEuro: 0,
          co2Kg: 0,
        },
        {
          id: "leg-1-cycle",
          mode: "cycle",
          label: "Cycle (campus bike share)",
          durationMin: 4,
          departures: [],
          costEuro: 1,
          co2Kg: 0,
        },
      ],
    },
    {
      id: "leg-2",
      from: "UCD Belfield, Stillorgan Road",
      to: "Dundrum",
      isTransferPoint: true,
      transferAmenities: [
        "Dundrum Town Centre cafes",
        "Supervalu Dundrum",
        "Dundrum Library reading room",
      ],
      options: [
        {
          id: "leg-2-bus-145",
          mode: "bus",
          label: "Bus 145 towards city centre",
          durationMin: 14,
          departures: ["08:05", "08:20", "08:35", "08:50"],
          costEuro: 2.0,
          co2Kg: 0.4,
          notes: "Runs every ~15 min at peak times.",
        },
        {
          id: "leg-2-bus-46a",
          mode: "bus",
          label: "Bus 46A towards city centre",
          durationMin: 17,
          departures: ["08:02", "08:18", "08:34"],
          costEuro: 2.0,
          co2Kg: 0.4,
        },
        {
          id: "leg-2-cycle",
          mode: "cycle",
          label: "Cycle via Dundrum Road",
          durationMin: 16,
          departures: [],
          costEuro: 0,
          co2Kg: 0,
        },
      ],
    },
    {
      id: "leg-3",
      from: "Dundrum",
      to: "St Stephen's Green",
      isTransferPoint: false,
      options: [
        {
          id: "leg-3-luas",
          mode: "luas",
          label: "Luas Green Line to St Stephen's Green",
          durationMin: 19,
          departures: ["08:12", "08:18", "08:24", "08:30", "08:36"],
          costEuro: 2.3,
          co2Kg: 0.1,
          notes: "Every ~6 min at peak times.",
        },
        {
          id: "leg-3-bus-44",
          mode: "bus",
          label: "Bus 44 to city centre",
          durationMin: 28,
          departures: ["08:10", "08:30"],
          costEuro: 2.0,
          co2Kg: 0.4,
        },
      ],
    },
  ],
};
