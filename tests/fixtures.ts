import type { LocalePack, PuzzleDefinition } from "../src/types.ts";

export const esLocale: LocalePack = {
  id: "es-ES",
  dir: "ltr",
  ui: {
    difficulty: "Dificultad",
    difficulty_easy: "Fácil",
    difficulty_medium: "Media",
    difficulty_hard: "Difícil",
    gameName: "Entre Paréntesis",
    gameLabel: "Pistas anidadas",
    modeNavigation: "Modo de la aplicación",
    authorMode: "Crear",
    dateSelector: "Fecha del rompecabezas",
    puzzleLabel: "Rompecabezas",
    clueCount: "{count} pistas",
    instructions: "Pulsa para obtener pistas, pero escribe cada respuesta para continuar.",
    instructionsTitle: "Cómo jugar a Entre Paréntesis",
    instructionsIntro: "Resuelve las pistas para descubrir una efeméride de un hecho histórico.",
    instructionsRuleStartTitle: "Empieza por las pistas resaltadas",
    instructionsRuleStart: "Empieza por las pistas de color azul claro.",
    instructionsRuleChainTitle: "Una respuesta puede formar parte de la siguiente pista",
    instructionsRuleChain: "Cuando resuelvas una pista, puede resaltarse otra.",
    instructionsRuleAnswerTitle: "Escribe tu respuesta",
    instructionsRuleAnswer: "Escríbela en la barra inferior y pulsa Enviar.",
    instructionsRuleFinalTitle: "Completa la frase final",
    instructionsRuleFinal: "Descubrirás una efeméride.",
    instructionsRuleHelpTitle: "Pide ayuda si te atascas",
    instructionsRuleHelp: "Toca una pista azul para ver una letra y perder 5 puntos.",
    instructionsExamplesTitle: "Así se ven las pistas",
    instructionsExampleReplacement: "Sustitución completa",
    instructionsExampleDirectional: "Pista direccional",
    instructionsExampleInfill: "Hueco dentro de la pista",
    instructionsExampleAnswer: "Respuesta: {answer}",
    instructionsStart: "Empezar a jugar",
    guessLabel: "Respuesta",
    guessPlaceholder: "Respuesta",
    submit: "Enviar",
    peek: "Mostrar la primera letra.",
    reveal: "Mostrar la respuesta y perder 5 puntos.",
    enterAfterPeek: "Escribe la respuesta para continuar.",
    enterAfterReveal: "Escribe la respuesta para continuar.",
    peekValue: "Primera letra: {peek}.",
    revealValue: "Respuesta: {answer}.",
    peekMarker: " · {peek}…",
    clueLabel: "Pista: {clue}.",
    directionLeft: "La respuesta va a la izquierda",
    directionRight: "La respuesta va a la derecha",
    showKeyboard: "Mostrar teclado",
    hideKeyboard: "Ocultar teclado",
    virtualKeyboard: "Teclado español",
    space: "Espacio",
    backspace: "Borrar",
    score: "Puntuación",
    scoreValue: "Puntuación: {score}.",
    completionTitle: "Entre Paréntesis resuelto",
    result: "{score} puntos · {rank}",
    shareResult: "Compartir resultado",
    sharePoints: "puntos",
    shareCopied: "Resultado copiado.",
    shareCopyFailed: "No se pudo copiar el resultado.",
    shareFailed: "No se pudo abrir el menú para compartir.",
    revealed: "La respuesta es {answer}. Pierdes 5 puntos.",
    rankPerfect: "Precisión total",
    rankSharp: "Mente aguda",
    rankSteady: "Paso firme"
  },
  matching: {
    locale: "es-ES",
    foldCase: true,
    trim: true,
    collapseWhitespace: true,
    canonicalizeQuotes: true,
    canonicalizeHyphens: true,
    optionalAcuteVowels: true,
    ignorePunctuation: false
  },
  keyboard: {
    mode: "virtual",
    rows: [["a", "ñ"]],
    extras: ["á", " "]
  }
};

export const branchPuzzle: PuzzleDefinition = {
  schemaVersion: 1,
  id: "branch-es",
  revision: 3,
  locale: "es-ES",
  title: "Ramas",
  releaseDate: "2026-08-28",
  finalText: "El libro azul.",
  root: ["El ", { ref: "object" }, "."],
  clues: {
    object: {
      answer: "libro azul",
      prompt: [{ ref: "book" }, " ", { ref: "colour" }]
    },
    book: {
      answer: "libro",
      accept: ["volumen"],
      prompt: [{ ref: "lib" }, "ro"]
    },
    lib: {
      answer: "lib",
      prompt: ["inicio de una palabra para una obra encuadernada"]
    },
    colour: {
      answer: "azul",
      prompt: ["color del ", { ref: "sky" }]
    },
    sky: {
      answer: "cielo",
      prompt: ["lo que vemos sobre nosotros"]
    }
  }
};

export function freshBranch(): PuzzleDefinition {
  return structuredClone(branchPuzzle);
}
