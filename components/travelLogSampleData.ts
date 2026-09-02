import type { TravelPoint } from "./TravelLogGlobe.tsx";

export const travelLogSampleData: readonly TravelPoint[] = [
  {
    id: "london",
    title: "London",
    date: "2024-06-12",
    description: "Wandering along the Thames and chasing neon sunsets.",
    latitude: 51.5074,
    longitude: -0.1278,
    photos: [
      {
        url: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=800&q=80",
        alt: "London skyline",
        caption: "The Thames at dusk"
      }
    ]
  },
  {
    id: "lisbon",
    title: "Lisbon",
    date: "2024-07-03",
    description: "Tile facades and espresso breaks.",
    latitude: 38.7223,
    longitude: -9.1393,
    photos: [
      {
        url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=80",
        alt: "Lisbon rooftops",
        caption: "Golden hour in Alfama"
      }
    ]
  },
  {
    id: "tokyo",
    title: "Tokyo",
    date: "2024-08-20",
    description: "Arcades, ramen, and rain.",
    latitude: 35.6762,
    longitude: 139.6503,
    photos: [
      {
        url: "https://images.unsplash.com/photo-1498654896293-37aacf113fd9?auto=format&fit=crop&w=800&q=80",
        alt: "Tokyo street scene",
        caption: "Shibuya after the rain"
      }
    ]
  }
];
