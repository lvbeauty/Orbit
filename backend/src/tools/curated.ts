/**
 * Sabre has no dining/experiences product at all, so this is deliberately a small curated
 * demo dataset rather than a real inventory integration — swap for a real API (Yelp,
 * Google Places, etc.) post-hackathon if this needs to be more than a demo.
 */
export interface DiningPick {
  name: string;
  cuisine: string;
  city: string;
  priceRange: "$" | "$$" | "$$$" | "$$$$";
  blurb: string;
}

export interface ExperiencePick {
  name: string;
  category: string;
  city: string;
  durationHours: number;
  blurb: string;
}

const DINING: DiningPick[] = [
  { name: "Katz's Delicatessen", cuisine: "deli", city: "NYC", priceRange: "$$", blurb: "Legendary pastrami on rye since 1888." },
  { name: "Le Bernardin", cuisine: "seafood", city: "NYC", priceRange: "$$$$", blurb: "Michelin three-star seafood tasting menu." },
  { name: "In-N-Out Burger", cuisine: "burgers", city: "LAX", priceRange: "$", blurb: "West coast burger institution." },
  { name: "Gjelina", cuisine: "californian", city: "LAX", priceRange: "$$$", blurb: "Venice mainstay, wood-fired everything." },
  { name: "Alinea", cuisine: "molecular", city: "ORD", priceRange: "$$$$", blurb: "Avant-garde multi-course tasting experience." },
];

const EXPERIENCES: ExperiencePick[] = [
  { name: "Top of the Rock Sunset", category: "sightseeing", city: "NYC", durationHours: 1.5, blurb: "Golden-hour skyline views." },
  { name: "Broadway Show", category: "theater", city: "NYC", durationHours: 3, blurb: "A rotating pick of current hits." },
  { name: "Getty Center Tour", category: "museum", city: "LAX", durationHours: 3, blurb: "Art, gardens, and city views." },
  { name: "Griffith Observatory Night Sky", category: "sightseeing", city: "LAX", durationHours: 2, blurb: "Free telescopes and planetarium shows." },
  { name: "Architecture River Cruise", category: "tour", city: "ORD", durationHours: 1.5, blurb: "Chicago's skyline from the water." },
];

export function recommendDining(city: string, cuisine?: string): DiningPick[] {
  const norm = city.toUpperCase();
  let picks = DINING.filter((d) => d.city === norm);
  if (cuisine) picks = picks.filter((d) => d.cuisine.toLowerCase().includes(cuisine.toLowerCase()));
  return picks.length ? picks : DINING.slice(0, 3);
}

export function recommendExperiences(city: string, interest?: string): ExperiencePick[] {
  const norm = city.toUpperCase();
  let picks = EXPERIENCES.filter((e) => e.city === norm);
  if (interest) picks = picks.filter((e) => e.category.toLowerCase().includes(interest.toLowerCase()));
  return picks.length ? picks : EXPERIENCES.slice(0, 3);
}
