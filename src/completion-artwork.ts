export interface CompletionArtwork {
  readonly src: string;
  readonly alt: string;
}

function imageSource(filename: string): string {
  return new URL(`../img/${filename}`, import.meta.url).href;
}

export const completionGardenArtwork: CompletionArtwork = {
  src: imageSource("completion_garden.jpeg"),
  alt: "Jardín de celebración: Lo lograste, puzzle resuelto."
};

const warmupArtwork: CompletionArtwork = {
  src: imageSource("calentando_motores.jpeg"),
  alt: "Calentando motores"
};

const goodFormArtwork: CompletionArtwork = {
  src: imageSource("en_buena_forma.jpeg"),
  alt: "En buena forma"
};

const sharpMindArtwork: CompletionArtwork = {
  src: imageSource("mente_aguda.jpeg"),
  alt: "Mente aguda"
};

const perfectAccuracyArtwork: CompletionArtwork = {
  src: imageSource("precision_total.jpeg"),
  alt: "Precisión total"
};

export function completionArtworkForScore(score: number): CompletionArtwork {
  if (score >= 100) return perfectAccuracyArtwork;
  if (score >= 90) return sharpMindArtwork;
  if (score >= 60) return goodFormArtwork;
  return warmupArtwork;
}
